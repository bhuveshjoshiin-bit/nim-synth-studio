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

// Phase 4: auto-detect project type and start a dev server on port 3000 in the
// background. Returns the preview URL immediately; the server keeps running
// inside the sandbox until it times out.
const AutoStartInput = z.object({ projectId: z.string().uuid() });

export const autoStartDevServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AutoStartInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const project = await ensureProject(supabase, userId, data.projectId);
    const { getOrCreateSandbox, getPreviewUrl, syncFiles, runCommand } = await import("./e2b.server");
    const sandbox = await getOrCreateSandbox(project.sandbox_id);
    if (sandbox.sandboxId !== project.sandbox_id) {
      await supabase.from("projects").update({ sandbox_id: sandbox.sandboxId }).eq("id", data.projectId);
    }
    const { data: files } = await supabase.from("files").select("path,content").eq("project_id", data.projectId);
    const list = files ?? [];
    await syncFiles(sandbox, list);

    // If something is already listening on 3000, don't restart.
    const check = await runCommand(sandbox, "(ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ':3000 ' && echo up || echo down");
    if (check.stdout.trim().endsWith("up")) {
      return { url: getPreviewUrl(sandbox, 3000), sandboxId: sandbox.sandboxId, alreadyRunning: true };
    }

    const paths = new Set(list.map((f) => f.path));
    let startCmd: string;
    if (paths.has("package.json")) {
      const pkg = list.find((f) => f.path === "package.json");
      const hasDev = pkg && /"dev"\s*:/.test(pkg.content);
      const install = "([ -d node_modules ] || npm install --no-audit --no-fund --loglevel=error) >/tmp/install.log 2>&1";
      const run = hasDev
        ? "PORT=3000 nohup npm run dev -- --port 3000 --host 0.0.0.0 >/tmp/dev.log 2>&1 &"
        : "PORT=3000 nohup npx --yes serve -l 3000 . >/tmp/dev.log 2>&1 &";
      startCmd = `${install}; ${run} echo started`;
    } else if (paths.has("index.html")) {
      startCmd = "nohup python3 -m http.server 3000 --bind 0.0.0.0 >/tmp/dev.log 2>&1 & echo started";
    } else {
      startCmd = "nohup python3 -m http.server 3000 --bind 0.0.0.0 >/tmp/dev.log 2>&1 & echo started";
    }

    await runCommand(sandbox, startCmd);
    const url = getPreviewUrl(sandbox, 3000);
    return { url, sandboxId: sandbox.sandboxId, alreadyRunning: false };
  });

const TailInput = z.object({ projectId: z.string().uuid(), lines: z.number().int().min(1).max(500).default(200) });

export const tailDevLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => TailInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const project = await ensureProject(supabase, userId, data.projectId);
    if (!project.sandbox_id) return { log: "" };
    const { getOrCreateSandbox, runCommand } = await import("./e2b.server");
    const sandbox = await getOrCreateSandbox(project.sandbox_id);
    const r = await runCommand(sandbox, `tail -n ${data.lines} /tmp/dev.log 2>/dev/null || true`);
    return { log: r.stdout.slice(-8000) };
  });

export const stopDevServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => AutoStartInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const project = await ensureProject(supabase, userId, data.projectId);
    if (!project.sandbox_id) return { ok: true };
    const { getOrCreateSandbox, runCommand } = await import("./e2b.server");
    const sandbox = await getOrCreateSandbox(project.sandbox_id);
    await runCommand(sandbox, "pkill -f 'node|vite|next|http.server|serve' 2>/dev/null; echo stopped");
    return { ok: true };
  });


