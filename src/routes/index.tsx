import { createFileRoute, Link } from "@tanstack/react-router";
import { Terminal, Cpu, Sparkles, GitBranch, Rocket, Zap } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "NimIDE — AI-native cloud IDE powered by NVIDIA NIM" },
      {
        name: "description",
        content:
          "Code, chat with an AI assistant powered by NVIDIA NIM, run a terminal, and ship to Vercel — all in your browser.",
      },
      { property: "og:title", content: "NimIDE — AI-native cloud IDE" },
      {
        property: "og:description",
        content:
          "Code, chat with an AI assistant powered by NVIDIA NIM, run a terminal, and ship to Vercel — all in your browser.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: Landing,
});

function Feature({ icon: Icon, title, desc }: { icon: typeof Cpu; title: string; desc: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="size-9 rounded-md bg-primary/15 text-primary flex items-center justify-center">
          <Icon className="size-4" />
        </div>
        <h3 className="font-medium">{title}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function Landing() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold">
            <div className="size-7 rounded-md bg-primary text-primary-foreground grid place-items-center">
              <Terminal className="size-4" />
            </div>
            NimIDE
          </div>
          <nav className="flex items-center gap-3">
            <Link
              to="/auth"
              className="px-3 py-1.5 text-sm rounded-md hover:bg-accent transition-colors"
            >
              Sign in
            </Link>
            <Link
              to="/auth"
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border bg-card text-muted-foreground mb-6">
            <Sparkles className="size-3.5 text-primary" />
            Powered by NVIDIA NIM
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            A cloud IDE with an AI{" "}
            <span className="text-primary">that actually edits your code</span>.
          </h1>
          <p className="mt-5 text-lg text-muted-foreground max-w-2xl mx-auto">
            Monaco editor, a real terminal, and a single AI assistant that can create, edit and
            delete files in your project — all in your browser.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              to="/auth"
              className="px-5 py-2.5 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90"
            >
              Start coding free
            </Link>
            <a
              href="#features"
              className="px-5 py-2.5 rounded-md border hover:bg-accent transition-colors"
            >
              See features
            </a>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid md:grid-cols-3 gap-4">
            <Feature
              icon={Cpu}
              title="NVIDIA NIM Assistant"
              desc="One AI, with tool-calling — create_file, edit_file, delete_file, read_file, run_command."
            />
            <Feature
              icon={Terminal}
              title="Web IDE + Terminal"
              desc="Monaco editor, multi-tab, file tree, and a terminal panel wired to your project."
            />
            <Feature
              icon={Zap}
              title="Event-driven"
              desc="Inngest powers AI jobs, file indexing, terminal tracking, and deploy pipelines."
            />
            <Feature
              icon={GitBranch}
              title="GitHub integration"
              desc="Import repos and push commits straight from your workspace."
            />
            <Feature
              icon={Rocket}
              title="One-click Vercel deploy"
              desc="Ship your project to production from the top bar."
            />
            <Feature
              icon={Sparkles}
              title="Multi-model"
              desc="Switch between NIM-hosted Llama, Nemotron, Mixtral, Qwen-Coder and more."
            />
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-6 text-sm text-muted-foreground flex items-center justify-between">
          <span>© NimIDE</span>
          <span>Built on NVIDIA NIM · Inngest · Lovable Cloud</span>
        </div>
      </footer>
    </div>
  );
}
