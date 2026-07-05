import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { useServerFn } from "@tanstack/react-start";
import { FileTree, type FileNode } from "@/components/ide/FileTree";
import { EditorPane } from "@/components/ide/EditorPane";
import { TerminalPanel } from "@/components/ide/TerminalPanel";
import { PreviewPanel } from "@/components/ide/PreviewPanel";
import { LogsPanel } from "@/components/ide/LogsPanel";
import { AIChatPanel } from "@/components/ide/AIChatPanel";
import { TopBar } from "@/components/ide/TopBar";
import { autoStartDevServer, stopDevServer } from "@/lib/sandbox.functions";
import { pushProjectToGithub } from "@/lib/github.functions";
import { deployToVercel } from "@/lib/vercel.functions";
import { saveUserIntegration } from "@/lib/integrations.functions";
import { Terminal as TerminalIcon, FileText, Code as CodeIcon, Eye } from "lucide-react";



export const Route = createFileRoute("/_authenticated/ide/$projectId")({
  head: () => ({ meta: [{ title: "Workspace — NimIDE" }] }),
  component: IdePage,
});

type FileRow = {
  id: string;
  path: string;
  content: string;
  language: string | null;
  updated_at: string;
};

function IdePage() {
  const { projectId } = useParams({ from: "/_authenticated/ide/$projectId" });
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState("");
  const [files, setFiles] = useState<FileRow[]>([]);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: project, error: pErr } = await supabase
        .from("projects")
        .select("id,name")
        .eq("id", projectId)
        .maybeSingle();
      if (pErr || !project) {
        toast.error("Project not found");
        navigate({ to: "/dashboard" });
        return;
      }
      if (cancelled) return;
      setProjectName(project.name);

      const { data: f } = await supabase
        .from("files")
        .select("id,path,content,language,updated_at")
        .eq("project_id", projectId)
        .order("path");
      if (cancelled) return;
      setFiles(f ?? []);
      if (f && f.length) {
        setOpenTabs([f[0].id]);
        setActiveId(f[0].id);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, navigate]);

  // Realtime file updates so AI tool calls reflect in UI
  useEffect(() => {
    const channel = supabase
      .channel(`files-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "files", filter: `project_id=eq.${projectId}` },
        () => refreshFiles(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId]);

  async function refreshFiles() {
    const { data } = await supabase
      .from("files")
      .select("id,path,content,language,updated_at")
      .eq("project_id", projectId)
      .order("path");
    if (!data) return;
    setFiles(data);
    // Drop tabs whose file was deleted
    setOpenTabs((tabs) => tabs.filter((id) => data.some((f) => f.id === id)));
    setActiveId((cur) => (cur && data.some((f) => f.id === cur) ? cur : data[0]?.id ?? null));
  }

  const tree = useMemo<FileNode[]>(() => buildTree(files), [files]);

  const openFile = useCallback((id: string) => {
    setOpenTabs((tabs) => (tabs.includes(id) ? tabs : [...tabs, id]));
    setActiveId(id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setOpenTabs((tabs) => {
        const next = tabs.filter((t) => t !== id);
        if (activeId === id) setActiveId(next[next.length - 1] ?? null);
        return next;
      });
      setDirty((d) => {
        const c = { ...d };
        delete c[id];
        return c;
      });
    },
    [activeId],
  );

  const onChange = useCallback(
    (id: string, value: string) => {
      setDirty((d) => ({ ...d, [id]: value }));
      const existing = saveTimers.current[id];
      if (existing) clearTimeout(existing);
      saveTimers.current[id] = setTimeout(async () => {
        const { error } = await supabase.from("files").update({ content: value }).eq("id", id);
        if (error) toast.error(`Save failed: ${error.message}`);
        else {
          setFiles((fs) => fs.map((f) => (f.id === id ? { ...f, content: value } : f)));
          setDirty((d) => {
            const c = { ...d };
            delete c[id];
            return c;
          });
        }
      }, 600);
    },
    [],
  );

  async function createFile(path: string) {
    const clean = path.replace(/^\/+/, "").trim();
    if (!clean) return;
    if (files.some((f) => f.path === clean)) {
      toast.error("That file already exists");
      return;
    }
    const { data, error } = await supabase
      .from("files")
      .insert({
        project_id: projectId,
        path: clean,
        content: "",
        language: extLang(clean),
      })
      .select("id,path,content,language,updated_at")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed");
      return;
    }
    setFiles((fs) => [...fs, data].sort((a, b) => a.path.localeCompare(b.path)));
    openFile(data.id);
  }

  async function deleteFile(id: string) {
    const file = files.find((f) => f.id === id);
    if (!file) return;
    if (!confirm(`Delete ${file.path}?`)) return;
    const { error } = await supabase.from("files").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      closeTab(id);
      setFiles((fs) => fs.filter((f) => f.id !== id));
    }
  }

  const activeFile = files.find((f) => f.id === activeId) ?? null;
  const activeValue =
    activeFile && activeId !== null
      ? (dirty[activeId] ?? activeFile.content)
      : "";

  // Preview / dev server state (lifted so TopBar Run button controls it)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [starting, setStarting] = useState(false);
  const [bottomTab, setBottomTab] = useState<"terminal" | "logs">("terminal");
  const startFn = useServerFn(autoStartDevServer);
  const stopFn = useServerFn(stopDevServer);
  const pushFn = useServerFn(pushProjectToGithub);
  const deployFn = useServerFn(deployToVercel);
  const saveIntegration = useServerFn(saveUserIntegration);


  async function handleRun() {
    setStarting(true);
    try {
      const { url, alreadyRunning } = await startFn({ data: { projectId } });
      setPreviewUrl(url);
      setPreviewOpen(true);
      setBottomTab("logs");
      setPreviewNonce((n) => n + 1);
      toast.success(alreadyRunning ? "Dev server already running on :3000" : "Dev server started on :3000");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  }

  async function handleStop() {
    setStarting(true);
    try {
      await stopFn({ data: { projectId } });
      toast.success("Dev server stopped");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to stop");
    } finally {
      // Always flip UI back so the Run button reappears, even on transient errors.
      setPreviewOpen(false);
      setPreviewUrl(null);
      setStarting(false);
    }
  }

  async function ensureConnected(provider: "github" | "vercel"): Promise<boolean> {
    const label = provider === "github" ? "GitHub" : "Vercel";
    const url =
      provider === "github"
        ? "https://github.com/settings/tokens/new?scopes=repo&description=NimIDE"
        : "https://vercel.com/account/tokens";
    const token = window.prompt(
      `Connect your ${label} account.\n\nCreate a personal access token at:\n${url}\n\nThen paste it here (stored per-user, never shared).`,
      "",
    );
    if (!token) return false;
    const t = toast.loading(`Verifying ${label} token…`);
    try {
      const res = await saveIntegration({ data: { provider, token: token.trim() } });
      const who =
        (res.meta as { login?: string; username?: string }).login ??
        (res.meta as { login?: string; username?: string }).username ??
        "connected";
      toast.success(`${label} connected as ${who}`, { id: t });
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to connect ${label}`, { id: t });
      return false;
    }
  }

  async function handleGithub() {
    const repo = window.prompt("GitHub repo (owner/repo):", "");
    if (!repo) return;
    const branch = window.prompt("Branch:", "main") || "main";
    const message = window.prompt("Commit message:", "Update from NimIDE") || "Update from NimIDE";
    const doPush = async () => {
      const t = toast.loading(`Pushing ${files.length} files to ${repo}…`);
      try {
        const res = await pushFn({ data: { projectId, repo, branch, message } });
        toast.success(`Pushed to ${repo} (${res.files} files)`, { id: t });
        window.open(res.url, "_blank");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Push failed";
        if (/NOT_CONNECTED/.test(msg)) {
          toast.dismiss(t);
          const ok = await ensureConnected("github");
          if (ok) await doPush();
        } else {
          toast.error(msg, { id: t });
        }
      }
    };
    await doPush();
  }

  async function handleVercel() {
    const name = window.prompt("Vercel project name (optional):", projectName) || undefined;
    const doDeploy = async () => {
      const t = toast.loading("Deploying to Vercel…");
      try {
        const res = await deployFn({ data: { projectId, projectName: name, target: "production" } });
        toast.success(`Deployed: ${res.url}`, { id: t });
        if (res.url) window.open(res.url, "_blank");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Deploy failed";
        if (/NOT_CONNECTED/.test(msg)) {
          toast.dismiss(t);
          const ok = await ensureConnected("vercel");
          if (ok) await doDeploy();
        } else {
          toast.error(msg, { id: t });
        }
      }
    };
    await doDeploy();
  }


  if (loading) {
    return (
      <div className="h-screen grid place-items-center text-muted-foreground text-sm">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <TopBar
        projectName={projectName}
        running={starting}
        previewOpen={previewOpen}
        onBack={() => navigate({ to: "/dashboard" })}
        onRun={handleRun}
        onStop={handleStop}
        onGithub={handleGithub}
        onVercel={handleVercel}
      />
      <div className="flex-1 min-h-0">
        <PanelGroup orientation="horizontal">
          {/* File tree */}
          <Panel defaultSize={16} minSize={10}>
            <FileTree
              tree={tree}
              activeId={activeId}
              onOpen={openFile}
              onCreate={createFile}
              onDelete={deleteFile}
            />
          </Panel>
          <PanelResizeHandle className="w-px bg-border hover:bg-primary/40 transition-colors" />

          {/* Center: editor/preview toggle + bottom (terminal / logs) */}
          <Panel defaultSize={56} minSize={30}>
            <PanelGroup orientation="vertical">
              <Panel defaultSize={70} minSize={20}>
                <div className="h-full flex flex-col">
                  {previewOpen && (
                    <div className="flex items-center gap-1 border-b bg-panel px-2 py-1">
                      <button
                        onClick={() => setPreviewOpen(false)}
                        className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${!previewOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <CodeIcon className="size-3" /> Code
                      </button>
                      <button
                        onClick={() => setPreviewOpen(true)}
                        className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${previewOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        <Eye className="size-3" /> Preview
                      </button>
                    </div>
                  )}
                  <div className="flex-1 min-h-0">
                    {previewOpen ? (
                      <PreviewPanel
                        key={previewNonce}
                        url={previewUrl}
                        onReload={() => setPreviewNonce((n) => n + 1)}
                      />
                    ) : (
                      <EditorPane
                        files={files}
                        openTabs={openTabs}
                        activeId={activeId}
                        dirty={dirty}
                        value={activeValue}
                        onSelectTab={setActiveId}
                        onCloseTab={closeTab}
                        onChange={onChange}
                      />
                    )}
                  </div>
                </div>
              </Panel>
              <PanelResizeHandle className="h-px bg-border hover:bg-primary/40 transition-colors" />
              <Panel defaultSize={30} minSize={10}>
                <BottomTabs projectId={projectId} tab={bottomTab} setTab={setBottomTab} />
              </Panel>
            </PanelGroup>
          </Panel>
          <PanelResizeHandle className="w-px bg-border hover:bg-primary/40 transition-colors" />

          {/* AI chat */}
          <Panel defaultSize={28} minSize={18}>
            <AIChatPanel projectId={projectId} />
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}

function BottomTabs({
  projectId,
  tab,
  setTab,
}: {
  projectId: string;
  tab: "terminal" | "logs";
  setTab: (t: "terminal" | "logs") => void;
}) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 border-b bg-panel px-2 py-1">
        <button
          onClick={() => setTab("terminal")}
          className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${tab === "terminal" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <TerminalIcon className="size-3" /> Terminal
        </button>
        <button
          onClick={() => setTab("logs")}
          className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${tab === "logs" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          <FileText className="size-3" /> Logs
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {tab === "terminal" ? <TerminalPanel projectId={projectId} /> : <LogsPanel projectId={projectId} active={tab === "logs"} />}
      </div>
    </div>
  );
}


function extLang(path: string): string | null {
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    json: "json",
    md: "markdown",
    css: "css",
    html: "html",
    py: "python",
    sh: "shell",
    yml: "yaml",
    yaml: "yaml",
    sql: "sql",
  };
  return ext ? (map[ext] ?? null) : null;
}

function buildTree(files: FileRow[]): FileNode[] {
  type DirMap = Map<string, { node: FileNode; children: DirMap }>;
  const root: DirMap = new Map();
  for (const f of files) {
    const parts = f.path.split("/");
    let cursor = root;
    parts.forEach((part, idx) => {
      const isLeaf = idx === parts.length - 1;
      let entry = cursor.get(part);
      if (!entry) {
        entry = {
          node: {
            id: isLeaf ? f.id : `dir:${parts.slice(0, idx + 1).join("/")}`,
            name: part,
            path: parts.slice(0, idx + 1).join("/"),
            isDir: !isLeaf,
            children: [],
          },
          children: new Map(),
        };
        cursor.set(part, entry);
      }
      cursor = entry.children;
    });
  }
  function materialize(map: DirMap): FileNode[] {
    const items: FileNode[] = [];
    for (const { node, children } of map.values()) {
      if (node.isDir) node.children = materialize(children);
      items.push(node);
    }
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return items;
  }
  return materialize(root);
}
