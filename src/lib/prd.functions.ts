import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type PRDPhase = {
  name: string;
  goal: string;
  deliverables: string[];
  files: string[];
};

export type PRD = {
  title: string;
  summary: string;
  stack: string[];
  features: string[];
  phases: PRDPhase[];
};

const GenInput = z.object({
  prompt: z.string().min(4).max(4000),
  feedback: z.string().max(4000).optional(),
  previous: z.any().optional(),
  model: z.string().optional(),
});

const PRD_SYSTEM = `You are a senior product architect. Given a one-line user idea, produce a concise PRD (Product Requirements Document) for a small web app the user will build INSIDE a browser IDE.

Return STRICT JSON only — no prose, no markdown fences. Shape:
{
  "title": "Short project name (max 4 words)",
  "summary": "1-2 sentence summary",
  "stack": ["React", "TypeScript", "Tailwind", ...],
  "features": ["bullet feature 1", ...],
  "phases": [
    {
      "name": "Phase 1 — Foundation",
      "goal": "One sentence",
      "deliverables": ["..."],
      "files": ["index.html", "src/App.tsx", ...]
    }
  ]
}

Rules:
- 3 to 5 phases, each shippable independently. Phase 1 must be the smallest working skeleton.
- Keep stacks browser-runnable (HTML/CSS/JS, React, Tailwind via CDN). No backend unless asked.
- File paths are project-relative, forward slashes, no leading slash.
- Be specific — name real files the AI will create.`;

export const generatePRD = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => GenInput.parse(d))
  .handler(async ({ data }) => {
    const { callNim, DEFAULT_NIM_MODEL, NIM_MODELS } = await import("./nim.server");
    const model =
      data.model && NIM_MODELS.some((m) => m.id === data.model) ? data.model : DEFAULT_NIM_MODEL;

    const userMsg = data.feedback
      ? `Original idea:\n${data.prompt}\n\nPrevious PRD:\n${JSON.stringify(data.previous ?? {}, null, 2)}\n\nUser feedback — revise accordingly:\n${data.feedback}`
      : `Idea: ${data.prompt}`;

    const res = await callNim({
      model,
      messages: [
        { role: "system", content: PRD_SYSTEM },
        { role: "user", content: userMsg },
      ],
      temperature: 0.5,
      max_tokens: 2000,
    });

    const raw = res.choices[0]?.message?.content ?? "";
    const cleaned = raw
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end < 0) throw new Error("AI did not return a PRD");
    let prd: PRD;
    try {
      prd = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      throw new Error("Failed to parse PRD JSON from AI");
    }
    if (!prd.phases?.length) throw new Error("PRD missing phases");
    return { prd };
  });

const CreateInput = z.object({
  prompt: z.string().min(4),
  prd: z.any(),
});

export const createProjectFromPRD = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const prd = data.prd as PRD;
    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        owner_id: userId,
        name: prd.title || "Untitled",
        description: prd.summary,
        initial_prompt: data.prompt,
        prd: prd as unknown as never,
        current_phase: 0,
      })
      .select("id")
      .single();
    if (error || !project) throw new Error(error?.message ?? "Failed to create");

    await supabase.from("files").insert({
      project_id: project.id,
      path: "README.md",
      content: `# ${prd.title}\n\n${prd.summary}\n\n## Stack\n${prd.stack.map((s) => `- ${s}`).join("\n")}\n\n## Phases\n${prd.phases.map((p, i) => `${i + 1}. **${p.name}** — ${p.goal}`).join("\n")}\n`,
      language: "markdown",
    });

    return { projectId: project.id };
  });

const PhaseInput = z.object({
  projectId: z.string().uuid(),
  phaseIndex: z.number().int().min(0),
  model: z.string().optional(),
});

function languageFromPath(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", md: "markdown", css: "css", html: "html", py: "python",
  };
  return ext ? map[ext] ?? ext : null;
}

export const implementPhase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PhaseInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("id, name, prd, initial_prompt")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (error || !project) throw new Error("Project not found");
    const prd = project.prd as unknown as PRD | null;
    const phase = prd?.phases?.[data.phaseIndex];
    if (!phase) throw new Error("Phase not found");

    const { data: existingFiles } = await supabase
      .from("files")
      .select("path")
      .eq("project_id", data.projectId);
    const existingList = (existingFiles ?? []).map((f) => f.path).join("\n") || "(empty)";

    const { callNim, DEFAULT_NIM_MODEL, NIM_MODELS } = await import("./nim.server");
    const model =
      data.model && NIM_MODELS.some((m) => m.id === data.model) ? data.model : DEFAULT_NIM_MODEL;
    type NimMsg = import("./nim.server").NimMessage;

    const TOOLS = [
      { type: "function" as const, function: { name: "create_file", description: "Create or overwrite a file with given contents.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
      { type: "function" as const, function: { name: "edit_file", description: "Replace contents of an existing file.", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
    ];

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

Use create_file / edit_file to write COMPLETE, WORKING code for this phase only. Do not write code in chat — only via tools. After tool calls, give a 1-paragraph summary of what was built.`;

    const messages: NimMsg[] = [
      { role: "system", content: sys },
      { role: "user", content: `Build phase ${data.phaseIndex + 1} now.` },
    ];

    // Announce phase start in the project chat (streams live to the IDE panel).
    await supabase.from("chat_messages").insert({
      project_id: data.projectId,
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

      // Persist assistant turn so the IDE chat updates live during the build
      await supabase.from("chat_messages").insert({
        project_id: data.projectId,
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
          const content = String(args.content ?? "");
          if (!path) throw new Error("missing path");
          const { data: existing } = await supabase
            .from("files").select("id").eq("project_id", data.projectId).eq("path", path).maybeSingle();
          if (existing) {
            await supabase.from("files").update({ content }).eq("id", existing.id);
            result = `Updated ${path}`;
          } else {
            await supabase.from("files").insert({ project_id: data.projectId, path, content, language: languageFromPath(path) });
            result = `Created ${path}`;
          }
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        messages.push({ role: "tool", content: result, tool_call_id: call.id });
        await supabase.from("chat_messages").insert({
          project_id: data.projectId,
          role: "tool",
          content: result,
          tool_call_id: call.id,
        });
      }
    }

    await supabase
      .from("projects")
      .update({ current_phase: data.phaseIndex + 1 })
      .eq("id", data.projectId);

    await supabase.from("chat_messages").insert({
      project_id: data.projectId,
      role: "assistant",
      content: `✅ Built **${phase.name}**\n\n${summary}`,
      model,
    });

    return { ok: true, summary, phase: phase.name };
  });
