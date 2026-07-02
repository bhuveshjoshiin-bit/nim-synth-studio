// Server-only phase implementation. Used by prd.functions.ts and inngest.server.ts.
// Uses the service-role client since it's called from background workers with no user session.
import type { PRD } from "./prd.functions";

const MAX_TOOL_OUTPUT = 4000;
function cap(s: string): string {
  return s.length > MAX_TOOL_OUTPUT ? s.slice(0, MAX_TOOL_OUTPUT) + `\n…[truncated]` : s;
}

function languageFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", json: "json", md: "markdown", css: "css", html: "html", py: "python" };
  return ext ? (map[ext] ?? ext) : null;
}

const TOOLS = [
  { type: "function" as const, function: { name: "create_file", description: "Create a NEW file with given contents (fails if exists).", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function" as const, function: { name: "edit_section", description: "Surgical find/replace on an existing file. old_string must appear exactly once.", parameters: { type: "object", properties: { path: { type: "string" }, old_string: { type: "string" }, new_string: { type: "string" } }, required: ["path", "old_string", "new_string"] } } },
  { type: "function" as const, function: { name: "append_file", description: "Append content to an existing file (create if missing).", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
  { type: "function" as const, function: { name: "overwrite_file", description: "Replace entire file. Only for tiny files or full rewrites.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
];

export async function runImplementPhase(opts: {
  projectId: string;
  phaseIndex: number;
  model?: string;
}): Promise<{ ok: boolean; summary: string; phase: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { callNim, DEFAULT_NIM_MODEL, NIM_MODELS } = await import("./nim.server");
  type NimMsg = import("./nim.server").NimMessage;

  const { data: project, error } = await supabaseAdmin
    .from("projects")
    .select("id, name, prd, initial_prompt")
    .eq("id", opts.projectId)
    .maybeSingle();
  if (error || !project) throw new Error("Project not found");
  const prd = project.prd as unknown as PRD | null;
  const phase = prd?.phases?.[opts.phaseIndex];
  if (!phase) throw new Error("Phase not found");

  const model =
    opts.model && NIM_MODELS.some((m) => m.id === opts.model) ? opts.model : DEFAULT_NIM_MODEL;

  const { data: existingFiles } = await supabaseAdmin
    .from("files").select("path").eq("project_id", opts.projectId);
  const existingList = (existingFiles ?? []).map((f) => f.path).join("\n") || "(empty)";

  const sys = `You are implementing one phase of a project inside a browser IDE.
Project: ${project.name}
Original idea: ${project.initial_prompt}
PRD summary: ${prd?.summary}
Stack: ${prd?.stack?.join(", ")}

You are building PHASE: ${phase.name}
Goal: ${phase.goal}
Deliverables:
${phase.deliverables.map((d) => `- ${d}`).join("\n")}
Suggested files:
${phase.files.map((f) => `- ${f}`).join("\n")}

Existing project files:
${existingList}

Rules:
- Prefer edit_section / append_file over overwrite_file to keep edits small.
- Keep files under 150 lines each; split into modules if needed.
- Use create_file for NEW files, edit_section for changes to existing ones.
- After tool calls, give a 1-paragraph summary.`;

  const messages: NimMsg[] = [
    { role: "system", content: sys },
    { role: "user", content: `Build phase ${opts.phaseIndex + 1} now.` },
  ];

  await supabaseAdmin.from("chat_messages").insert({
    project_id: opts.projectId,
    role: "assistant",
    content: `🚧 Starting **${phase.name}** — ${phase.goal}`,
    model,
  });

  let summary = "";
  for (let step = 0; step < 40; step++) {
    const response = await callNim({ model, messages, tools: TOOLS, max_tokens: 4000 });
    const msg = response.choices[0]?.message;
    if (!msg) break;
    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });

    await supabaseAdmin.from("chat_messages").insert({
      project_id: opts.projectId,
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: (msg.tool_calls ?? null) as unknown as never,
      model,
    });

    if (!msg.tool_calls?.length) {
      summary = msg.content ?? "";
      break;
    }
    for (const call of msg.tool_calls) {
      let result = "ok";
      try {
        const args = JSON.parse(call.function.arguments || "{}");
        const path = String(args.path ?? "").replace(/^\/+/, "");
        if (!path) throw new Error("missing path");
        const { data: existing } = await supabaseAdmin
          .from("files").select("id,content").eq("project_id", opts.projectId).eq("path", path).maybeSingle();

        switch (call.function.name) {
          case "create_file": {
            if (existing) { result = `Error: ${path} exists — use edit_section`; break; }
            await supabaseAdmin.from("files").insert({
              project_id: opts.projectId, path,
              content: String(args.content ?? ""), language: languageFromPath(path),
            });
            result = `Created ${path}`;
            break;
          }
          case "edit_section": {
            if (!existing) { result = `Error: file not found: ${path}`; break; }
            const oldStr = String(args.old_string ?? "");
            const newStr = String(args.new_string ?? "");
            if (!oldStr) { result = "Error: old_string required"; break; }
            const idx = existing.content.indexOf(oldStr);
            if (idx < 0) { result = `Error: old_string not found in ${path}`; break; }
            if (existing.content.indexOf(oldStr, idx + 1) >= 0) {
              result = `Error: old_string matches multiple times in ${path}. Add more context.`;
              break;
            }
            const updated = existing.content.slice(0, idx) + newStr + existing.content.slice(idx + oldStr.length);
            await supabaseAdmin.from("files").update({ content: updated }).eq("id", existing.id);
            result = `Edited ${path}`;
            break;
          }
          case "append_file": {
            const add = String(args.content ?? "");
            if (!existing) {
              await supabaseAdmin.from("files").insert({
                project_id: opts.projectId, path, content: add, language: languageFromPath(path),
              });
              result = `Created ${path}`;
            } else {
              const sep = existing.content.endsWith("\n") || !existing.content ? "" : "\n";
              await supabaseAdmin.from("files").update({ content: existing.content + sep + add }).eq("id", existing.id);
              result = `Appended to ${path}`;
            }
            break;
          }
          case "overwrite_file": {
            const content = String(args.content ?? "");
            if (existing) {
              await supabaseAdmin.from("files").update({ content }).eq("id", existing.id);
              result = `Overwrote ${path}`;
            } else {
              await supabaseAdmin.from("files").insert({
                project_id: opts.projectId, path, content, language: languageFromPath(path),
              });
              result = `Created ${path}`;
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
      messages.push({ role: "tool", content: capped, tool_call_id: call.id });
      await supabaseAdmin.from("chat_messages").insert({
        project_id: opts.projectId, role: "tool", content: capped, tool_call_id: call.id,
      });
    }
  }

  await supabaseAdmin
    .from("projects")
    .update({ current_phase: opts.phaseIndex + 1 })
    .eq("id", opts.projectId);

  await supabaseAdmin.from("chat_messages").insert({
    project_id: opts.projectId,
    role: "assistant",
    content: `✅ Built **${phase.name}**\n\n${summary}`,
    model,
  });

  return { ok: true, summary, phase: phase.name };
}
