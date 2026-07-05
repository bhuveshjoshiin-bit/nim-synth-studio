import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadUserToken } from "./integrations.functions";
import { z } from "zod";


const PushInput = z.object({
  projectId: z.string().uuid(),
  repo: z.string().regex(/^[^\/\s]+\/[^\/\s]+$/, "Expected owner/repo"),
  branch: z.string().default("main"),
  message: z.string().default("Update from NimIDE"),
  createIfMissing: z.boolean().default(true),
  privateRepo: z.boolean().default(true),
});

async function gh(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function ensureRepo(token: string, owner: string, repo: string, privateRepo: boolean) {
  const check = await gh(token, `/repos/${owner}/${repo}`);
  if (check.ok) return;
  if (check.status !== 404) {
    const t = await check.text();
    throw new Error(`GitHub check failed [${check.status}]: ${t.slice(0, 200)}`);
  }
  // Try creating in the auth user's account first
  const me = await gh(token, `/user`);
  const meJson = (await me.json()) as { login?: string };
  const path = meJson.login === owner ? `/user/repos` : `/orgs/${owner}/repos`;
  const create = await gh(token, path, {
    method: "POST",
    body: JSON.stringify({ name: repo, private: privateRepo, auto_init: true }),
  });
  if (!create.ok) {
    const t = await create.text();
    throw new Error(`GitHub repo create failed [${create.status}]: ${t.slice(0, 200)}`);
  }
}

export const pushProjectToGithub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => PushInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const token = await loadUserToken(supabase, userId, "github");
    if (!token) throw new Error("NOT_CONNECTED: Connect your GitHub account first.");


    const { data: project } = await supabase
      .from("projects").select("id").eq("id", data.projectId).eq("owner_id", userId).maybeSingle();
    if (!project) throw new Error("Project not found");

    const { data: files } = await supabase
      .from("files").select("path,content").eq("project_id", data.projectId);
    const list = files ?? [];
    if (!list.length) throw new Error("No files to push");

    const [owner, repo] = data.repo.split("/");
    if (data.createIfMissing) await ensureRepo(token, owner, repo, data.privateRepo);

    // 1. Resolve current branch ref (or create from default)
    let refSha: string | null = null;
    const refRes = await gh(token, `/repos/${owner}/${repo}/git/ref/heads/${data.branch}`);
    if (refRes.ok) {
      refSha = ((await refRes.json()) as { object: { sha: string } }).object.sha;
    } else {
      const repoRes = await gh(token, `/repos/${owner}/${repo}`);
      const repoJson = (await repoRes.json()) as { default_branch: string };
      const defRef = await gh(token, `/repos/${owner}/${repo}/git/ref/heads/${repoJson.default_branch}`);
      const defJson = (await defRef.json()) as { object: { sha: string } };
      refSha = defJson.object.sha;
      // create new branch
      await gh(token, `/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/heads/${data.branch}`, sha: refSha }),
      });
    }

    // 2. Get commit + base tree
    const commitRes = await gh(token, `/repos/${owner}/${repo}/git/commits/${refSha}`);
    const commitJson = (await commitRes.json()) as { tree: { sha: string } };
    const baseTreeSha = commitJson.tree.sha;

    // 3. Create blobs
    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    for (const f of list) {
      const blob = await gh(token, `/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({
          content: Buffer.from(f.content ?? "", "utf-8").toString("base64"),
          encoding: "base64",
        }),
      });
      if (!blob.ok) {
        const t = await blob.text();
        throw new Error(`Blob failed for ${f.path} [${blob.status}]: ${t.slice(0, 150)}`);
      }
      const { sha } = (await blob.json()) as { sha: string };
      treeEntries.push({ path: f.path, mode: "100644", type: "blob", sha });
    }

    // 4. Create tree
    const treeRes = await gh(token, `/repos/${owner}/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
    });
    const treeJson = (await treeRes.json()) as { sha: string };

    // 5. Create commit
    const newCommit = await gh(token, `/repos/${owner}/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message: data.message, tree: treeJson.sha, parents: [refSha] }),
    });
    const newCommitJson = (await newCommit.json()) as { sha: string };

    // 6. Update ref
    await gh(token, `/repos/${owner}/${repo}/git/refs/heads/${data.branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommitJson.sha, force: false }),
    });

    return {
      ok: true,
      url: `https://github.com/${owner}/${repo}/tree/${data.branch}`,
      commit: newCommitJson.sha,
      files: list.length,
    };
  });
