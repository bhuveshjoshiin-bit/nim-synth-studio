import { useState } from "react";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder,
  FolderOpen,
  Plus,
  Trash2,
} from "lucide-react";

export type FileNode = {
  id: string;
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
};

export function FileTree({
  tree,
  activeId,
  onOpen,
  onCreate,
  onDelete,
}: {
  tree: FileNode[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onCreate: (path: string) => void;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");

  return (
    <div className="h-full flex flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center justify-between px-3 py-2 border-b text-xs uppercase tracking-wide text-muted-foreground">
        <span>Files</span>
        <button
          onClick={() => setCreating(true)}
          className="p-1 hover:bg-sidebar-accent rounded"
          title="New file"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newPath.trim()) {
              onCreate(newPath.trim());
              setNewPath("");
              setCreating(false);
            }
          }}
          className="px-2 py-1.5 border-b"
        >
          <input
            autoFocus
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onBlur={() => {
              setCreating(false);
              setNewPath("");
            }}
            placeholder="src/file.ts"
            className="w-full text-xs px-2 py-1 rounded bg-input border outline-none focus:ring-1 focus:ring-ring"
          />
        </form>
      )}
      <div className="flex-1 overflow-auto py-1 text-sm">
        {tree.length === 0 ? (
          <div className="px-3 py-4 text-xs text-muted-foreground">
            No files yet. Click + to create one.
          </div>
        ) : (
          tree.map((n) => (
            <Node
              key={n.id}
              node={n}
              depth={0}
              activeId={activeId}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}

function Node({
  node,
  depth,
  activeId,
  onOpen,
  onDelete,
}: {
  node: FileNode;
  depth: number;
  activeId: string | null;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const isActive = activeId === node.id;
  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-sidebar-accent ${
          isActive ? "bg-sidebar-accent text-primary" : ""
        }`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onClick={() => (node.isDir ? setOpen((o) => !o) : onOpen(node.id))}
      >
        {node.isDir ? (
          <>
            {open ? (
              <ChevronDown className="size-3.5 shrink-0" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0" />
            )}
            {open ? (
              <FolderOpen className="size-3.5 shrink-0 text-primary/80" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-primary/80" />
            )}
          </>
        ) : (
          <>
            <span className="w-3.5" />
            <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate flex-1">{node.name}</span>
        {!node.isDir && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(node.id);
            }}
            className="opacity-0 group-hover:opacity-100 hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="size-3" />
          </button>
        )}
      </div>
      {node.isDir && open && node.children && (
        <div>
          {node.children.map((c) => (
            <Node
              key={c.id}
              node={c}
              depth={depth + 1}
              activeId={activeId}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
