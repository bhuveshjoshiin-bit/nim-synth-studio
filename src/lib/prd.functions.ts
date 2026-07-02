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
    // Verify ownership before dispatching background work.
    const { data: project, error } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (error || !project) throw new Error("Project not found");

    // Try Inngest first (durable, retried, off request path).
    try {
      const { dispatchInngestEvent } = await import("./inngest.server");
      const r = await dispatchInngestEvent("project/phase.build", {
        projectId: data.projectId,
        phaseIndex: data.phaseIndex,
        model: data.model,
      });
      if (r.dispatched) {
        await supabase.from("chat_messages").insert({
          project_id: data.projectId,
          role: "assistant",
          content: `⚡ Phase ${data.phaseIndex + 1} queued via Inngest — building in the background.`,
        });
        return { ok: true, dispatched: "inngest" as const };
      }
    } catch (err) {
      console.warn("Inngest dispatch failed, falling back inline:", err);
    }

    // Inline fallback (no Inngest connector linked).
    const { runImplementPhase } = await import("./phase-runner.server");
    const res = await runImplementPhase({
      projectId: data.projectId,
      phaseIndex: data.phaseIndex,
      model: data.model,
    });
    return { dispatched: "inline" as const, ...res };
  });
