import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const RunInput = z.object({
  projectId: z.string().uuid(),
  command: z.string().min(1).max(4000),
});

async function ensureProject(supabase: any, userId: string, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, sandbox_id")
    .eq("id", projectId)
    .eq("owner_id", userId)
    .maybeSingle();
  if (error || !data) throw new Error("Project not found");
  return data as { id: string; sandbox_id: string | null };
}

export const runSandboxCommand = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => RunInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const project = await ensureProject(supabase, userId, data.projectId);

    const { data: logRow } = await supabase
      .from("terminal_logs")
      .insert({
        project_id: data.projectId,
        command: data.command,
        status: "running",
        output: "",
      })
      .select("id")
      .single();

    try {
      const { getOrCreateSandbox, runCommand, syncFiles } = await import("./e2b.server");
      const sandbox = await getOrCreateSandbox(project.sandbox_id);
      const sid = sandbox.sandboxId;
      if (sid !== project.sandbox_id) {
        await supabase.from("projects").update({ sandbox_id: sid }).eq("id", data.projectId);
      }
      // Sync project files into the sandbox on every run so it stays in sync
      const { data: files } = await supabase
        .from("files")
        .select("path,content")
        .eq("project_id", data.projectId);
      await syncFiles(sandbox, files ?? []);

      const result = await runCommand(sandbox, data.command);
      const output = (result.stdout + (result.stderr ? "\n" + result.stderr : "")).slice(0, 20000);
      await supabase
        .from("terminal_logs")
        .update({
          status: result.exitCode === 0 ? "success" : "error",
          output,
          exit_code: result.exitCode,
        })
        .eq("id", logRow!.id);
      return { ok: true, exitCode: result.exitCode, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase
        .from("terminal_logs")
        .update({ status: "error", output: msg, exit_code: 1 })
        .eq("id", logRow!.id);
      throw err;
    }
  });

const PreviewInput = z.object({
  projectId: z.string().uuid(),
  port: z.number().int().min(1).max(65535).default(3000),
});

export const getSandboxPreviewUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PreviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const project = await ensureProject(supabase, userId, data.projectId);
    const { getOrCreateSandbox, getPreviewUrl, syncFiles } = await import("./e2b.server");
    const sandbox = await getOrCreateSandbox(project.sandbox_id);
    if (sandbox.sandboxId !== project.sandbox_id) {
      await supabase
        .from("projects")
        .update({ sandbox_id: sandbox.sandboxId })
        .eq("id", data.projectId);
    }
    const { data: files } = await supabase
      .from("files")
      .select("path,content")
      .eq("project_id", data.projectId);
    await syncFiles(sandbox, files ?? []);
    return { url: getPreviewUrl(sandbox, data.port) };
  });
