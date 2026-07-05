import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SaveInput = z.object({
  provider: z.enum(["github", "vercel"]),
  token: z.string().min(10).max(500),
});

export const saveUserIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => SaveInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    let meta: { login?: string; avatar_url?: string; username?: string; email?: string } = {};
    if (data.provider === "github") {
      const r = await fetch("https://api.github.com/user", {
        headers: { Authorization: `Bearer ${data.token}`, Accept: "application/vnd.github+json" },
      });
      if (!r.ok) throw new Error("GitHub token rejected. Check the token & scopes (repo).");
      const j = (await r.json()) as { login: string; avatar_url: string };
      meta = { login: j.login, avatar_url: j.avatar_url };
    } else {
      const r = await fetch("https://api.vercel.com/v2/user", {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      if (!r.ok) throw new Error("Vercel token rejected. Check the token permissions.");
      const j = (await r.json()) as { user: { username: string; email: string } };
      meta = { username: j.user.username, email: j.user.email };
    }
    const { error } = await supabase.from("user_integrations").upsert(
      { user_id: userId, provider: data.provider, token: data.token, meta: meta as any },
      { onConflict: "user_id,provider" },
    );
    if (error) throw new Error(error.message);
    return { ok: true, meta };

  });

const StatusInput = z.object({});
export const getUserIntegrations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => StatusInput.parse(d))
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("user_integrations")
      .select("provider, meta, created_at")
      .eq("user_id", userId);
    return { integrations: data ?? [] };
  });

const DisconnectInput = z.object({ provider: z.enum(["github", "vercel"]) });
export const disconnectUserIntegration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => DisconnectInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await supabase.from("user_integrations").delete().eq("user_id", userId).eq("provider", data.provider);
    return { ok: true };
  });

export async function loadUserToken(
  supabase: any,
  userId: string,
  provider: "github" | "vercel",
): Promise<string | null> {
  const { data } = await supabase
    .from("user_integrations")
    .select("token")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();
  return (data?.token as string | undefined) ?? null;
}
