// Tool definitions + executors for the NimIDE coding agent.
import type { NimTool } from "./nim.server";

export type AgentMode = "chat" | "plan" | "build" | "custom";

const MAX_OUT = 3000;
export function cap(s: string, max = MAX_OUT): string {
  return s.length > max ? s.slice(0, max) + `\n…[truncated ${s.length - max} chars]` : s;
}

function fn(name: string, description: string, properties: Record<string, unknown>, required: string[]): NimTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required } } };
}
const S = { type: "string" };
const N = { type: "number" };

const ALL: Record<string, NimTool> = {
  list_files: fn("list_files", "List project file paths. Optional prefix filter (e.g. 'src/').", { prefix: S }, []),
  read_file: fn("read_file", "Read a file with line numbers. Use start_line/end_line for big files.", { path: S, start_line: N, end_line: N }, ["path"]),
  search_files: fn("search_files", "Search all files for text or a JS regex. Returns path:line: match.", { query: S, regex: { type: "boolean" }, prefix: S }, ["query"]),
  create_file: fn("create_file", "Create a NEW file. Fails if it exists.", { path: S, content: S }, ["path", "content"]),
  edit_section: fn("edit_section", "Replace a unique snippet. old_string must match EXACTLY ONCE (include 2-4 context lines).", { path: S, old_string: S, new_string: S }, ["path", "old_string", "new_string"]),
  multi_edit: fn("multi_edit", "Apply several unique find/replace edits to one file atomically.", {
    path: S,
    edits: { type: "array", items: { type: "object", properties: { old_string: S, new_string: S }, required: ["old_string", "new_string"] } },
  }, ["path", "edits"]),
  append_file: fn("append_file", "Append to end of file (creates if missing). Use to write large files in chunks.", { path: S, content: S }, ["path", "content"]),
  overwrite_file: fn("overwrite_file", "Replace whole file. Only for small files or full rewrites.", { path: S, content: S }, ["path", "content"]),
  delete_file: fn("delete_file", "Delete a file.", { path: S }, ["path"]),
  rename_file: fn("rename_file", "Rename/move a file.", { from: S, to: S }, ["from", "to"]),
  run_command: fn("run_command", "Run a shell command in the Linux sandbox (cwd = project root; node, npm, pnpm, python3, pip available). Set background=true for servers, bots and watchers (dev servers MUST use port 3000). timeout_sec default 120, max 290.", { command: S, background: { type: "boolean" }, timeout_sec: N }, ["command"]),
  fetch_url: fn("fetch_url", "HTTP GET a URL (docs, APIs, raw files). Returns text.", { url: S }, ["url"]),
  todo_write: fn("todo_write", "Create/replace your task list. Call at the start of multi-step work and update statuses as you go.", {
    todos: { type: "array", items: { type: "object", properties: { id: S, content: S, status: { type: "string", enum: ["pending", "in_progress", "done"] } }, required: ["id", "content", "status"] } },
  }, ["todos"]),
  spawn_subagents: fn("spawn_subagents", "Launch parallel helper agents for independent sub-tasks (e.g. backend + frontend). Each gets its own context and tools and reports back a summary. Use only when the user asks for parallel/multiple agents or work is clearly separable.", {
    agents: { type: "array", items: { type: "object", properties: { label: S, task: S }, required: ["label", "task"] } },
  }, ["agents"]),
};

const READ = ["list_files", "read_file", "search_files", "fetch_url"];
const WRITE = ["create_file", "edit_section", "multi_edit", "append_file", "overwrite_file", "delete_file", "rename_file", "run_command", "todo_write"];

export function toolsFor(mode: AgentMode, isSubagent: boolean): NimTool[] {
  let names: string[];
  if (mode === "chat") names = READ;
  else if (mode === "plan") names = [...READ, "todo_write"];
  else names = [...READ, ...WRITE, ...(isSubagent ? [] : ["spawn_subagents"])];
  return names.map((n) => ALL[n]);
}

export function languageFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript", json: "json", md: "markdown", css: "css", html: "html", py: "python", sh: "shell", yml: "yaml", yaml: "yaml", sql: "sql", toml: "toml", env: "shell" };
  return ext ? (map[ext] ?? ext) : null;
}

type Ctx = { db: any; projectId: string; runId: string };

async function getFile(ctx: Ctx, path: string) {
  const { data } = await ctx.db.from("files").select("id,content").eq("project_id", ctx.projectId).eq("path", path).maybeSingle();
  return data as { id: string; content: string } | null;
}

function applyEdit(content: string, oldStr: string, newStr: string): string {
  if (!oldStr) throw new Error("old_string required");
  const idx = content.indexOf(oldStr);
  if (idx < 0) throw new Error("old_string not found — re-read the file and copy exact text");
  if (content.indexOf(oldStr, idx + 1) >= 0) throw new Error("old_string matches multiple times — add more context");
  return content.slice(0, idx) + newStr + content.slice(idx + oldStr.length);
}

export async function executeTool(ctx: Ctx, name: string, args: any): Promise<string> {
  const db = ctx.db;
  const p = (v: unknown) => String(v ?? "").replace(/^\/+/, "").trim();
  switch (name) {
    case "list_files": {
      let q = db.from("files").select("path").eq("project_id", ctx.projectId).order("path").limit(1000);
      if (args.prefix) q = q.like("path", `${p(args.prefix)}%`);
      const { data } = await q;
      const list = (data ?? []).map((f: any) => f.path);
      return list.length ? list.join("\n") : "(no files)";
    }
    case "read_file": {
      const f = await getFile(ctx, p(args.path));
      if (!f) return `File not found: ${p(args.path)}`;
      const lines = f.content.split("\n");
      const s = Math.max(1, Number(args.start_line) || 1);
      const e = Math.min(lines.length, Number(args.end_line) || s + 299);
      const body = lines.slice(s - 1, e).map((l, i) => `${String(s + i).padStart(4)}| ${l}`).join("\n");
      return cap(`${p(args.path)} (${lines.length} lines, showing ${s}-${e})\n${body}`, 12000);
    }
    case "search_files": {
      let q = db.from("files").select("path,content").eq("project_id", ctx.projectId).limit(500);
      if (args.prefix) q = q.like("path", `${p(args.prefix)}%`);
      const { data } = await q;
      const re = args.regex ? new RegExp(String(args.query), "i") : null;
      const needle = String(args.query).toLowerCase();
      const hits: string[] = [];
      for (const f of data ?? []) {
        f.content.split("\n").forEach((l: string, i: number) => {
          if (hits.length < 80 && (re ? re.test(l) : l.toLowerCase().includes(needle))) hits.push(`${f.path}:${i + 1}: ${l.trim().slice(0, 160)}`);
        });
      }
      return hits.length ? hits.join("\n") : "No matches";
    }
    case "create_file": {
      const path = p(args.path);
      if (await getFile(ctx, path)) return `Error: ${path} exists — use edit_section`;
      const { error } = await db.from("files").insert({ project_id: ctx.projectId, path, content: String(args.content ?? ""), language: languageFromPath(path) });
      if (error) throw error;
      return `Created ${path} (${String(args.content ?? "").split("\n").length} lines)`;
    }
    case "edit_section": {
      const path = p(args.path);
      const f = await getFile(ctx, path);
      if (!f) return `Error: file not found: ${path}`;
      const updated = applyEdit(f.content, String(args.old_string ?? ""), String(args.new_string ?? ""));
      await db.from("files").update({ content: updated }).eq("id", f.id);
      return `Edited ${path}`;
    }
    case "multi_edit": {
      const path = p(args.path);
      const f = await getFile(ctx, path);
      if (!f) return `Error: file not found: ${path}`;
      let c = f.content;
      (args.edits ?? []).forEach((e: any, i: number) => {
        try { c = applyEdit(c, String(e.old_string ?? ""), String(e.new_string ?? "")); }
        catch (err) { throw new Error(`edit #${i + 1}: ${(err as Error).message}`); }
      });
      await db.from("files").update({ content: c }).eq("id", f.id);
      return `Applied ${(args.edits ?? []).length} edits to ${path}`;
    }
    case "append_file": {
      const path = p(args.path);
      const add = String(args.content ?? "");
      const f = await getFile(ctx, path);
      if (!f) await db.from("files").insert({ project_id: ctx.projectId, path, content: add, language: languageFromPath(path) });
      else await db.from("files").update({ content: f.content + (f.content.endsWith("\n") || !f.content ? "" : "\n") + add }).eq("id", f.id);
      return `${f ? "Appended to" : "Created"} ${path}`;
    }
    case "overwrite_file": {
      const path = p(args.path);
      const content = String(args.content ?? "");
      const f = await getFile(ctx, path);
      if (f) await db.from("files").update({ content }).eq("id", f.id);
      else await db.from("files").insert({ project_id: ctx.projectId, path, content, language: languageFromPath(path) });
      return `Wrote ${path}`;
    }
    case "delete_file": {
      await db.from("files").delete().eq("project_id", ctx.projectId).eq("path", p(args.path));
      return `Deleted ${p(args.path)}`;
    }
    case "rename_file": {
      const f = await getFile(ctx, p(args.from));
      if (!f) return `Error: not found ${p(args.from)}`;
      await db.from("files").update({ path: p(args.to), language: languageFromPath(p(args.to)) }).eq("id", f.id);
      return `Renamed ${p(args.from)} → ${p(args.to)}`;
    }
    case "fetch_url": {
      const res = await fetch(String(args.url), { headers: { "User-Agent": "NimIDE-agent" } });
      const text = (await res.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ");
      return cap(`HTTP ${res.status}\n${text}`, 6000);
    }
    case "todo_write": {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      await db.from("agent_runs").update({ todos }).eq("id", ctx.runId);
      const d = todos.filter((t: any) => t.status === "done").length;
      return `Todo list updated (${d}/${todos.length} done)`;
    }
    case "run_command": {
      const cmd = String(args.command ?? "");
      const { data: log } = await db.from("terminal_logs").insert({ project_id: ctx.projectId, command: cmd, status: "running", output: "" }).select("id").single();
      try {
        const { syncProject, runCommand, runBackground } = await import("./e2b.server");
        const sb = await syncProject(db, ctx.projectId);
        let out: string;
        let code = 0;
        if (args.background) {
          const logFile = /3000|dev|start|serve/.test(cmd) ? "/tmp/dev.log" : `/tmp/bg-${Date.now()}.log`;
          const tail = await runBackground(sb, cmd, logFile);
          out = `Started in background (log: ${logFile}).\n--- first output ---\n${tail}`;
        } else {
          const t = Math.min(290, Math.max(5, Number(args.timeout_sec) || 120)) * 1000;
          const r = await runCommand(sb, cmd, t);
          code = r.exitCode;
          out = `exit ${r.exitCode}\n${r.stdout}${r.stderr ? "\n[stderr]\n" + r.stderr : ""}`;
          if (r.exitCode === 124) out += "\n(timed out — use background=true for long-running processes)";
        }
        await db.from("terminal_logs").update({ status: code === 0 ? "success" : "error", output: cap(out, 20000), exit_code: code }).eq("id", log?.id);
        return cap(out);
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        await db.from("terminal_logs").update({ status: "error", output: m, exit_code: 1 }).eq("id", log?.id);
        return `Error running command: ${m}`;
      }
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
