import { createFileRoute, useParams, useNavigate, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelResizeHandle,
} from "react-resizable-panels";
import { FileTree, type FileNode } from "@/components/ide/FileTree";
import { EditorPane } from "@/components/ide/EditorPane";
import { TerminalPanel } from "@/components/ide/TerminalPanel";
import { TerminalPanel } from "@/components/ide/TerminalPanel";
import { PreviewPanel } from "@/components/ide/PreviewPanel";
import { AIChatPanel } from "@/components/ide/AIChatPanel";
import { TopBar } from "@/components/ide/TopBar";
import { Terminal as TerminalIcon, Eye } from "lucide-react";

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
        projectId={projectId}
        onBack={() => navigate({ to: "/dashboard" })}
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

          {/* Center: editor + terminal */}
          <Panel defaultSize={56} minSize={30}>
            <PanelGroup orientation="vertical">
              <Panel defaultSize={70} minSize={20}>
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
              </Panel>
              <PanelResizeHandle className="h-px bg-border hover:bg-primary/40 transition-colors" />
              <Panel defaultSize={30} minSize={10}>
                <TerminalPanel projectId={projectId} />
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
