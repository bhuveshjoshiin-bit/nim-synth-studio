import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Terminal, Folder, LogOut, Loader2, Trash2, Sparkles, ArrowRight, RotateCcw, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { generatePRD, createProjectFromPRD, implementPhase, type PRD } from "@/lib/prd.functions";
import { listNimModels } from "@/lib/ai-chat.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Your projects — NimIDE" }] }),
  component: Dashboard,
});

type Project = {
  id: string;
  name: string;
  description: string | null;
  updated_at: string;
};

function Dashboard() {
  const navigate = useNavigate();
  const genPRD = useServerFn(generatePRD);
  const createProj = useServerFn(createProjectFromPRD);
  const buildPhase = useServerFn(implementPhase);
  const fetchModels = useServerFn(listNimModels);

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [prd, setPrd] = useState<PRD | null>(null);
  const [refining, setRefining] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [showRefine, setShowRefine] = useState(false);
  const [building, setBuilding] = useState(false);
  const [model, setModel] = useState<string>("");
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);

  useEffect(() => {
    fetchModels({ data: {} })
      .then((r) => {
        setModels(r.models.map((m) => ({ id: m.id, label: m.label })));
        setModel(r.default);
      })
      .catch(() => {});
  }, [fetchModels]);

  async function refresh() {
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,description,updated_at")
      .order("updated_at", { ascending: false });
    if (error) toast.error(error.message);
    else setProjects(data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function onGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setGenerating(true);
    try {
      const { prd } = await genPRD({ data: { prompt: prompt.trim() } });
      setPrd(prd);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to generate PRD");
    } finally {
      setGenerating(false);
    }
  }

  async function onRefine(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim() || !prd) return;
    setRefining(true);
    try {
      const { prd: next } = await genPRD({
        data: { prompt: prompt.trim(), feedback: feedback.trim(), previous: prd },
      });
      setPrd(next);
      setFeedback("");
      setShowRefine(false);
      toast.success("PRD updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to refine");
    } finally {
      setRefining(false);
    }
  }

  async function onApprove() {
    if (!prd) return;
    setBuilding(true);
    try {
      const { projectId } = await createProj({ data: { prompt: prompt.trim(), prd } });
      toast.message("Building Phase 1…", { description: "The AI is writing your first files." });
      await buildPhase({ data: { projectId, phaseIndex: 0 } });
      toast.success("Phase 1 ready");
      navigate({ to: "/ide/$projectId", params: { projectId } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Build failed");
      setBuilding(false);
    }
  }

  function reset() {
    setPrd(null);
    setPrompt("");
    setFeedback("");
    setShowRefine(false);
  }

  async function deleteProject(id: string) {
    if (!confirm("Delete this project and all its files?")) return;
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Project deleted");
      refresh();
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <div className="size-7 rounded-md bg-primary text-primary-foreground grid place-items-center">
              <Terminal className="size-4" />
            </div>
            NimIDE
          </Link>
          <button
            onClick={signOut}
            className="px-3 py-1.5 text-sm rounded-md hover:bg-accent flex items-center gap-2"
          >
            <LogOut className="size-3.5" />
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        {!prd ? (
          <section className="text-center">
            <div className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border bg-card text-muted-foreground mb-5">
              <Sparkles className="size-3.5 text-primary" />
              Idea → Plan → Code
            </div>
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
              What do you want to build?
            </h1>
            <p className="mt-3 text-muted-foreground">
              Describe your idea. The AI drafts a phased plan and ships Phase 1 the moment you approve.
            </p>

            <form onSubmit={onGenerate} className="mt-8 rounded-2xl border bg-card p-3 text-left shadow-[var(--shadow-warm)]">
              <textarea
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. A pomodoro timer with task list and dark mode"
                rows={3}
                className="w-full bg-transparent resize-none px-3 py-2 text-base outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between px-2 pt-1">
                <span className="text-xs text-muted-foreground">Powered by NVIDIA NIM</span>
                <button
                  type="submit"
                  disabled={generating || !prompt.trim()}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                >
                  {generating ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                  Draft plan
                </button>
              </div>
            </form>
          </section>
        ) : (
          <section>
            <div className="flex items-start justify-between mb-2">
              <div>
                <h1 className="text-2xl font-semibold">{prd.title}</h1>
                <p className="text-muted-foreground mt-1">{prd.summary}</p>
              </div>
              <button onClick={reset} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1">
                <RotateCcw className="size-3.5" /> Start over
              </button>
            </div>

            {prd.stack?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {prd.stack.map((s) => (
                  <span key={s} className="text-xs px-2 py-0.5 rounded-full border bg-card text-muted-foreground">{s}</span>
                ))}
              </div>
            )}

            <ol className="mt-6 space-y-3">
              {prd.phases.map((p, i) => (
                <li key={i} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center gap-2">
                    <span className="size-6 rounded-md bg-primary/15 text-primary text-xs font-semibold grid place-items-center">
                      {i + 1}
                    </span>
                    <h3 className="font-medium">{p.name}</h3>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">{p.goal}</p>
                  {p.deliverables?.length > 0 && (
                    <ul className="mt-2 text-sm space-y-1">
                      {p.deliverables.map((d, j) => (
                        <li key={j} className="text-muted-foreground">• {d}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>

            <div className="mt-6 rounded-xl border bg-card p-4">
              <p className="text-sm">Happy with this plan?</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={onApprove}
                  disabled={building}
                  className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                >
                  {building ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                  Yes — build Phase 1
                </button>
                <button
                  onClick={() => setShowRefine((v) => !v)}
                  disabled={building}
                  className="px-4 py-2 rounded-lg border text-sm hover:bg-accent disabled:opacity-50"
                >
                  No — tell me what to change
                </button>
              </div>

              {showRefine && (
                <form onSubmit={onRefine} className="mt-4 space-y-2">
                  <textarea
                    autoFocus
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    rows={3}
                    placeholder="What should be different? (e.g. add user accounts, drop dark mode, use vanilla JS, fewer phases…)"
                    className="w-full rounded-lg bg-input border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <button
                    type="submit"
                    disabled={refining || !feedback.trim()}
                    className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                  >
                    {refining && <Loader2 className="size-3.5 animate-spin" />}
                    Regenerate plan
                  </button>
                </form>
              )}
            </div>
          </section>
        )}

        {/* Existing projects */}
        <section className="mt-16">
          <h2 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wider">Your projects</h2>
          {loading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-muted-foreground text-sm">
              No projects yet — draft your first plan above.
            </div>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-3">
              {projects.map((p) => (
                <li
                  key={p.id}
                  className="rounded-xl border bg-card p-4 hover:border-primary/40 transition-colors group"
                >
                  <Link to="/ide/$projectId" params={{ projectId: p.id }} className="block">
                    <div className="flex items-center gap-2 mb-1">
                      <Folder className="size-4 text-primary" />
                      <span className="font-medium truncate">{p.name}</span>
                    </div>
                    {p.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{p.description}</p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      Updated {new Date(p.updated_at).toLocaleString()}
                    </p>
                  </Link>
                  <button
                    onClick={() => deleteProject(p.id)}
                    className="mt-3 text-xs text-muted-foreground hover:text-destructive flex items-center gap-1"
                  >
                    <Trash2 className="size-3" />
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
