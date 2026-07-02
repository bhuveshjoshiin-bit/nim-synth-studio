import { createFileRoute } from "@tanstack/react-router";
import { serve } from "inngest/edge";
import { inngest, inngestFunctions } from "@/lib/inngest.server";

const handler = serve({ client: inngest, functions: inngestFunctions });

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: ({ request }) => handler(request),
      POST: ({ request }) => handler(request),
      PUT: ({ request }) => handler(request),
    },
  },
});
