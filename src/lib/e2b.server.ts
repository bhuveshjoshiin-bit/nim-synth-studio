// E2B sandbox helpers. Loaded only inside server function handlers.
// The e2b SDK works on Cloudflare Workers because it uses fetch + web websockets.
import { Sandbox } from "e2b";

const TEMPLATE = "base";
const TIMEOUT_MS = 10 * 60 * 1000; // 10 min

export async function getOrCreateSandbox(existing?: string | null): Promise<Sandbox> {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY not configured");
  if (existing) {
    try {
      return await Sandbox.connect(existing, { apiKey });
    } catch {
      /* fall through and create a new one */
    }
  }
  return await Sandbox.create(TEMPLATE, { apiKey, timeoutMs: TIMEOUT_MS });
}

export async function runCommand(
  sandbox: Sandbox,
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const res = await sandbox.commands.run(command, {
    timeoutMs: 60_000,
    cwd: "/home/user/project",
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    exitCode: res.exitCode ?? 0,
  };
}

export async function syncFiles(
  sandbox: Sandbox,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  await sandbox.commands.run("mkdir -p /home/user/project");
  for (const f of files) {
    const abs = `/home/user/project/${f.path.replace(/^\/+/, "")}`;
    const dir = abs.substring(0, abs.lastIndexOf("/"));
    if (dir) await sandbox.commands.run(`mkdir -p ${JSON.stringify(dir)}`);
    await sandbox.files.write(abs, f.content);
  }
}

export function getPreviewUrl(sandbox: Sandbox, port = 3000): string {
  return `https://${sandbox.getHost(port)}`;
}
