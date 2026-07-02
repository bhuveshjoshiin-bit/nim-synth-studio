// Inngest client + function definitions. Loaded only on the server.
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "nim-ide" });

/**
 * Long-running phase build: runs the phase implementation off the request path
 * so the UI doesn't have to wait for a long AI loop to finish.
 */
export const buildPhaseFn = inngest.createFunction(
  {
    id: "build-phase",
    retries: 1,
    triggers: [{ event: "project/phase.build" }],
  },
  async ({ event }: { event: { data: { projectId: string; phaseIndex: number; model?: string } } }) => {
    const { projectId, phaseIndex, model } = event.data;
    const { runImplementPhase } = await import("./phase-runner.server");
    return await runImplementPhase({ projectId, phaseIndex, model });
  },
);

export const inngestFunctions = [buildPhaseFn];

/**
 * Send an event through the Lovable connector gateway.
 * Requires LOVABLE_API_KEY + INNGEST_API_KEY (from the Inngest connector).
 * Returns { dispatched: false, reason } if the connector isn't linked.
 */
export async function dispatchInngestEvent(
  name: string,
  data: Record<string, unknown>,
): Promise<{ dispatched: boolean; reason?: string }> {
  const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
  const INNGEST_API_KEY = process.env.INNGEST_API_KEY;
  if (!LOVABLE_API_KEY || !INNGEST_API_KEY) {
    return { dispatched: false, reason: "Inngest connector not linked" };
  }
  const res = await fetch("https://connector-gateway.lovable.dev/inngest/e/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "X-Connection-Api-Key": INNGEST_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, data }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Inngest dispatch failed [${res.status}]: ${body.slice(0, 300)}`);
  }
  return { dispatched: true };
}
