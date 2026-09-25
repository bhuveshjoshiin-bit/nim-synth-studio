// E2B sandbox helpers. Loaded only inside server handlers.
import { Sandbox } from "e2b";

const TEMPLATE = "base";
const TIMEOUT_MS = 30 * 60 * 1000; // keep sandboxes alive 30 min between uses
export const PROJECT_DIR = "/home/user/project";

export async function getOrCreateSandbox(existing?: string | null): Promise<Sandbox> {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY not configured");
  if (existing) {
    try {
      const sb = await Sandbox.connect(existing, { apiKey });
      await sb.setTimeout(TIMEOUT_MS).catch(() => {});
      return sb;
    } catch {
      /* expired — create a new one */
    }
  }
  return await Sandbox.create(TEMPLATE, { apiKey, timeoutMs: TIMEOUT_MS });
}

export async function runCommand(
  sandbox: Sandbox,
  command: string,
  timeoutMs = 120_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const res = await sandbox.commands.run(command, { timeoutMs, cwd: PROJECT_DIR });
    return { stdout: res.stdout ?? "", stderr: res.stderr ?? "", exitCode: res.exitCode ?? 0 };
  } catch (err: any) {
    // e2b throws CommandExitError for non-zero exits — surface it as a result, not a crash.
    if (err && typeof err.exitCode === "number") {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? err.message ?? "", exitCode: err.exitCode };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return { stdout: "", stderr: msg, exitCode: /timeout|deadline/i.test(msg) ? 124 : 1 };
  }
}

/** Starts a long-running process (dev server, bot, worker) detached, logging to a file. */
export async function runBackground(sandbox: Sandbox, command: string, logFile: string) {
  const wrapped = `cd ${PROJECT_DIR} && nohup sh -c ${JSON.stringify(command)} > ${logFile} 2>&1 &`;
  await sandbox.commands.run(wrapped, { timeoutMs: 15_000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  const tail = await runCommand(sandbox, `tail -n 40 ${logFile} 2>/dev/null`, 10_000);
  return tail.stdout;
}

export async function syncFiles(sandbox: Sandbox, files: Array<{ path: string; content: string }>) {
  if (!files.length) return;
  await sandbox.commands.run(`mkdir -p ${PROJECT_DIR}`);
  const dirs = new Set<string>();
  for (const f of files) {
    const abs = `${PROJECT_DIR}/${f.path.replace(/^\/+/, "")}`;
    const dir = abs.substring(0, abs.lastIndexOf("/"));
    if (dir) dirs.add(dir);
  }
  if (dirs.size) {
    await sandbox.commands.run(`mkdir -p ${[...dirs].map((d) => JSON.stringify(d)).join(" ")}`);
  }
  await sandbox.files.write(
    files.map((f) => ({ path: `${PROJECT_DIR}/${f.path.replace(/^\/+/, "")}`, data: f.content })),
  );
}

/**
 * Connects to (or creates) the project's sandbox and pushes only files changed
 * since the last sync. Works with either a user-scoped or admin client.
 */
export async function syncProject(db: any, projectId: string): Promise<Sandbox> {
  const { data: proj } = await db
    .from("projects").select("sandbox_id,synced_at").eq("id", projectId).maybeSingle();
  const sandbox = await getOrCreateSandbox(proj?.sandbox_id ?? null);
  const fresh = sandbox.sandboxId !== proj?.sandbox_id;
  let q = db.from("files").select("path,content").eq("project_id", projectId).eq("is_directory", false);
  if (!fresh && proj?.synced_at) q = q.gt("updated_at", proj.synced_at);
  const started = new Date().toISOString();
  const { data: files } = await q;
  await syncFiles(sandbox, files ?? []);
  await db.from("projects").update({ sandbox_id: sandbox.sandboxId, synced_at: started }).eq("id", projectId);
  return sandbox;
}

export function getPreviewUrl(sandbox: Sandbox, port = 3000): string {
  return `https://${sandbox.getHost(port)}`;
}
