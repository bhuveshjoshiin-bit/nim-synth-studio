import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ChatInput = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(8000),
  model: z.string().min(1),
});

const ModelsInput = z.object({}).optional();

export const listNimModels = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => ModelsInput.parse(d ?? {}))
  .handler(async () => {
    const { NIM_MODELS, DEFAULT_NIM_MODEL } = await import("./nim.server");
    return { models: NIM_MODELS, default: DEFAULT_NIM_MODEL };
  });

const SYSTEM_PROMPT = `You are NimIDE's AI coding assistant, running on NVIDIA NIM.

You have direct write access to the user's project via tools. **Prefer surgical edits over full rewrites.**

TOOLS:
- read_file(path) — read a file
- create_file(path, content) — create a NEW file (fails if it exists)
- edit_section(path, old_string, new_string) — SURGICAL find & replace. USE THIS FOR EDITS.
    * \`old_string\` must occur EXACTLY ONCE in the file — include enough surrounding lines (3–5) for uniqueness.
    * Cheapest option; use it whenever changing part of an existing file.
- append_file(path, content) — append text to end of file (create if missing). Use for adding new functions/components without resending the whole file.
- overwrite_file(path, content) — replace entire file. Use ONLY for tiny files or when >70% of the file changes.
- delete_file(path)
- run_command(command) — run a shell command in the E2B sandbox.

RULES:
1. When editing existing files, ALWAYS try edit_section or append_file first. Overwrite_file wastes context.
2. Do not paste code into chat — always use tools.
3. Forward slashes in paths, no leading slash.
4. After changes, give a short (1–3 sentence) summary.`;

const TOOLS = [
  { type: "function" as const, function: { name: "read_file", description: "Read a file's contents.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function" as const, function: { name: "create_file", description: "Create a NEW file. Fails if the file already exists.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function" as const, function: { name: "edit_section", description: "Surgically replace a unique section of a file. old_string must appear EXACTLY ONCE.", parameters: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } }, required: ["path", "old_string", "new_string"] } } },
  { type: "function" as const, function: { name: "append_file", description: "Append content to end of a file (create if missing).", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function" as const, function: { name: "overwrite_file", description: "Replace the entire contents of a file. Prefer edit_section/append_file when possible.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function" as const, function: { name: "delete_file", description: "Delete a file.", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function" as const, function: { name: "run_command", description: "Run a shell command in the E2B sandbox (cwd: /home/user/project).", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
];

function languageFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", json: "json", md: "markdown", css: "css", html: "html", py: "python", sh: "shell", yml: "yaml", yaml: "yaml", sql: "sql" };
  return ext ? (map[ext] ?? ext) : null;
}

const MAX_TOOL_OUTPUT = 4000;
function cap(s: string): string {
  return s.length > MAX_TOOL_OUTPUT ? s.slice(0, MAX_TOOL_OUTPUT) + `\n…[truncated ${s.length - MAX_TOOL_OUTPUT} chars]` : s;
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChatInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { NIM_MODELS, DEFAULT_NIM_MODEL } = await import("./nim.server");
    const model = NIM_MODELS.some((m) => m.id === data.model) ? data.model : DEFAULT_NIM_MODEL;

    const { data: project, error: projErr } = await supabase
      .from("projects").select("id").eq("id", data.projectId).eq("owner_id", userId).maybeSingle();
    if (projErr || !project) throw new Error("Project not found");

    const { data: history } = await supabase
      .from("chat_messages").select("role,content,tool_calls,tool_call_id")
      .eq("project_id", data.projectId).order("created_at", { ascending: true }).limit(40);

    const { data: filesIndex } = await supabase
      .from("files").select("path").eq("project_id", data.projectId).order("path");
    const fileList = (filesIndex ?? []).map((f) => f.path).join("\n") || "(empty project)";
    const contextSystem = `Current project files:\n${fileList}`;

    await supabase.from("chat_messages").insert({
      project_id: data.projectId, role: "user", content: data.message,
    });

    const { callNim } = await import("./nim.server");
    type NimMsg = import("./nim.server").NimMessage;

    const messages: NimMsg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: contextSystem },
      ...((history ?? []).map((m) => {
        const base: NimMsg = { role: m.role as NimMsg["role"], content: m.content ?? "" };
        if (m.tool_calls) base.tool_calls = m.tool_calls as unknown as NimMsg["tool_calls"];
        if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
        return base;
      })),
      { role: "user", content: data.message },
    ];

    const MAX_STEPS = 50;
    let step = 0;
    let finalAssistant = "";

    while (step < MAX_STEPS) {
      step++;
      const response = await callNim({ model, messages, tools: TOOLS, max_tokens: 4000 });
      const choice = response.choices[0];
      if (!choice) throw new Error("Empty response from NVIDIA NIM");
      const msg = choice.message;

      await supabase.from("chat_messages").insert({
        project_id: data.projectId, role: "assistant",
        content: msg.content ?? "",
        tool_calls: (msg.tool_calls ?? null) as unknown as never,
        model,
      });
      messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalAssistant = msg.content ?? "";
        break;
      }

      for (const call of msg.tool_calls) {
        let result = "";
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          const path: string | undefined = args.path;
          const cleanPath = path?.replace(/^\/+/, "");

          switch (call.function.name) {
            case "read_file": {
              if (!cleanPath) throw new Error("path required");
              const { data: f } = await supabase.from("files").select("content")
                .eq("project_id", data.projectId).eq("path", cleanPath).maybeSingle();
              result = f ? cap(f.content) : `File not found: ${cleanPath}`;
              break;
            }
            case "create_file": {
              if (!cleanPath) throw new Error("path required");
              const { data: existing } = await supabase.from("files").select("id")
                .eq("project_id", data.projectId).eq("path", cleanPath).maybeSingle();
              if (existing) { result = `Error: ${cleanPath} already exists — use edit_section or overwrite_file`; break; }
              const { error } = await supabase.from("files").insert({
                project_id: data.projectId, path: cleanPath,
                content: String(args.content ?? ""), language: languageFromPath(cleanPath),
              });
              if (error) throw error;
              result = `Created ${cleanPath}`;
              break;
            }
            case "edit_section": {
              if (!cleanPath) throw new Error("path required");
              const oldStr = String(args.old_string ?? "");
              const newStr = String(args.new_string ?? "");
              if (!oldStr) { result = "Error: old_string required"; break; }
              const { data: f } = await supabase.from("files").select("id,content")
                .eq("project_id", data.projectId).eq("path", cleanPath).maybeSingle();
              if (!f) { result = `Error: file not found: ${cleanPath}`; break; }
              const idx = f.content.indexOf(oldStr);
              if (idx < 0) { result = `Error: old_string not found in ${cleanPath}`; break; }
              if (f.content.indexOf(oldStr, idx + 1) >= 0) {
                result = `Error: old_string matches multiple times in ${cleanPath}. Add more surrounding context.`;
                break;
              }
              const updated = f.content.slice(0, idx) + newStr + f.content.slice(idx + oldStr.length);
              const { error } = await supabase.from("files").update({ content: updated }).eq("id", f.id);
              if (error) throw error;
              result = `Edited ${cleanPath} (section replaced)`;
              break;
            }
            case "append_file": {
              if (!cleanPath) throw new Error("path required");
              const add = String(args.content ?? "");
              const { data: f } = await supabase.from("files").select("id,content")
                .eq("project_id", data.projectId).eq("path", cleanPath).maybeSingle();
              if (!f) {
                const { error } = await supabase.from("files").insert({
                  project_id: data.projectId, path: cleanPath, content: add, language: languageFromPath(cleanPath),
                });
                if (error) throw error;
                result = `Created ${cleanPath} with appended content`;
              } else {
                const sep = f.content.endsWith("\n") || !f.content ? "" : "\n";
                const { error } = await supabase.from("files").update({ content: f.content + sep + add }).eq("id", f.id);
                if (error) throw error;
                result = `Appended to ${cleanPath}`;
              }
              break;
            }
            case "overwrite_file": {
              if (!cleanPath) throw new Error("path required");
              const content = String(args.content ?? "");
              const { data: existing } = await supabase.from("files").select("id")
                .eq("project_id", data.projectId).eq("path", cleanPath).maybeSingle();
              if (existing) {
                const { error } = await supabase.from("files").update({ content }).eq("id", existing.id);
                if (error) throw error;
                result = `Overwrote ${cleanPath}`;
              } else {
                const { error } = await supabase.from("files").insert({
                  project_id: data.projectId, path: cleanPath, content, language: languageFromPath(cleanPath),
                });
                if (error) throw error;
                result = `Created ${cleanPath}`;
              }
              break;
            }
            case "delete_file": {
              if (!cleanPath) throw new Error("path required");
              const { error } = await supabase.from("files").delete()
                .eq("project_id", data.projectId).eq("path", cleanPath);
              if (error) throw error;
              result = `Deleted ${cleanPath}`;
              break;
            }
            case "run_command": {
              const cmd = String(args.command ?? "");
              const { data: logRow } = await supabase.from("terminal_logs")
                .insert({ project_id: data.projectId, command: cmd, status: "running", output: "" })
                .select("id").single();
              try {
                const { data: proj } = await supabase.from("projects")
                  .select("sandbox_id").eq("id", data.projectId).maybeSingle();
                const { getOrCreateSandbox, runCommand, syncFiles } = await import("./e2b.server");
                const sandbox = await getOrCreateSandbox(proj?.sandbox_id ?? null);
                if (sandbox.sandboxId !== proj?.sandbox_id) {
                  await supabase.from("projects").update({ sandbox_id: sandbox.sandboxId }).eq("id", data.projectId);
                }
                const { data: files } = await supabase.from("files").select("path,content").eq("project_id", data.projectId);
                await syncFiles(sandbox, files ?? []);
                const r = await runCommand(sandbox, cmd);
                const output = cap((r.stdout + (r.stderr ? "\n[stderr]\n" + r.stderr : "")));
                await supabase.from("terminal_logs").update({
                  status: r.exitCode === 0 ? "success" : "error",
                  output: `exit ${r.exitCode}\n${output}`,
                  exit_code: r.exitCode,
                }).eq("id", logRow!.id);
                result = `exit ${r.exitCode}\n${output}`;
              } catch (err) {
                const m = err instanceof Error ? err.message : String(err);
                await supabase.from("terminal_logs").update({ status: "error", output: m, exit_code: 1 }).eq("id", logRow!.id);
                result = `Error running command: ${m}`;
              }
              break;
            }
            default:
              result = `Unknown tool: ${call.function.name}`;
          }
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        const capped = cap(result);
        await supabase.from("chat_messages").insert({
          project_id: data.projectId, role: "tool", content: capped, tool_call_id: call.id,
        });
        messages.push({ role: "tool", content: capped, tool_call_id: call.id });
      }
    }

    return { ok: true, assistant: finalAssistant, steps: step };
  });
