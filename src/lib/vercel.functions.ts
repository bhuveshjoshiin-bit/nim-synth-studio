import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const DeployInput = z.object({
  projectId: z.string().uuid(),
  target: z.enum(["preview", "production"]).default("production"),
  projectName: z.string().min(1).max(52).optional(),
});

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 52) || "nimide-app";
}

export const deployToVercel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DeployInput.parse(d))
  .handler(async ({ data, context }) => {
    const token = process.env.VERCEL_TOKEN;
    if (!token) throw new Error("VERCEL_TOKEN is not configured. Add it in project secrets.");
    const { supabase, userId } = context;

    const { data: project } = await supabase
      .from("projects").select("id,name").eq("id", data.projectId).eq("owner_id", userId).maybeSingle();
    if (!project) throw new Error("Project not found");

    const { data: files } = await supabase
      .from("files").select("path,content").eq("project_id", data.projectId);
    const list = files ?? [];
    if (!list.length) throw new Error("No files to deploy");

    const name = slugify(data.projectName ?? project.name);

    const payload = {
      name,
      target: data.target,
      files: list.map((f) => ({
        file: f.path,
        data: Buffer.from(f.content ?? "", "utf-8").toString("base64"),
        encoding: "base64",
      })),
      projectSettings: { framework: null as string | null },
    };

    const res = await fetch("https://api.vercel.com/v13/deployments?forceNew=1", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string }; alias?: string[] };
    if (!res.ok) {
      throw new Error(`Vercel deploy failed [${res.status}]: ${json.error?.message ?? "unknown"}`);
    }
    const url = json.alias?.[0] ? `https://${json.alias[0]}` : json.url ? `https://${json.url}` : "";
    return { ok: true, url, name };
  });
