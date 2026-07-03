import { createFileRoute } from "@tanstack/react-router";

// The Inngest serve handler requires INNGEST_SIGNING_KEY to verify requests.
// When the Inngest connector isn't linked (dev/preview without secrets), the
// handler throws and returns 500 to the browser. Guard that path so the route
// stays responsive and returns a helpful message instead of a crash.
async function buildHandler(): Promise<((req: Request) => Promise<Response>) | null> {
  if (!process.env.INNGEST_SIGNING_KEY) return null;
  try {
    const { serve } = await import("inngest/edge");
    const { inngest, inngestFunctions } = await import("@/lib/inngest.server");
    return serve({ client: inngest, functions: inngestFunctions }) as (req: Request) => Promise<Response>;
  } catch (err) {
    console.error("Failed to init Inngest handler:", err);
    return null;
  }
}

async function handleRequest(request: Request): Promise<Response> {
  const handler = await buildHandler();
  if (!handler) {
    return new Response(
      JSON.stringify({
        ok: false,
        configured: false,
        message:
          "Inngest is not configured. Link the Inngest connector to enable durable background jobs. The IDE continues to work with inline execution.",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  try {
    return await handler(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: msg.slice(0, 500) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: ({ request }) => handleRequest(request),
      POST: ({ request }) => handleRequest(request),
      PUT: ({ request }) => handleRequest(request),
    },
  },
});
