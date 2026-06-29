import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Terminal, Plus, Folder, LogOut, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

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
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

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

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data, error } = await supabase
      .from("projects")
      .insert({ name: name.trim(), description: desc.trim() || null, owner_id: user.id })
      .select("id")
      .single();
    if (error) {
      toast.error(error.message);
      setCreating(false);
      return;
    }
    // Seed a starter file
    await supabase.from("files").insert({
      project_id: data.id,
      path: "README.md",
      content: `# ${name}\n\nWelcome to your new NimIDE project.\n`,
      language: "markdown",
    });
    setName("");
    setDesc("");
    setShowNew(false);
    setCreating(false);
    navigate({ to: "/ide/$projectId", params: { projectId: data.id } });
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

      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">Your projects</h1>
            <p className="text-sm text-muted-foreground">Open a workspace or start a new one.</p>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 flex items-center gap-2"
          >
            <Plus className="size-4" />
            New project
          </button>
        </div>

        {showNew && (
          <form
            onSubmit={createProject}
            className="mb-6 rounded-lg border bg-card p-4 space-y-3"
          >
            <input
              autoFocus
              required
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-input border text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <input
              placeholder="Description (optional)"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              className="w-full px-3 py-2 rounded-md bg-input border text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creating}
                className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
              >
                {creating && <Loader2 className="size-3.5 animate-spin" />}
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="px-3 py-2 rounded-md text-sm hover:bg-accent"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="text-muted-foreground text-sm">Loading projects…</div>
        ) : projects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            No projects yet. Create your first one.
          </div>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-3">
            {projects.map((p) => (
              <li
                key={p.id}
                className="rounded-lg border bg-card p-4 hover:border-primary/40 transition-colors group"
              >
                <Link
                  to="/ide/$projectId"
                  params={{ projectId: p.id }}
                  className="block"
                >
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
      </main>
    </div>
  );
}
