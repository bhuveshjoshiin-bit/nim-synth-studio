import Editor from "@monaco-editor/react";
import { X, Circle } from "lucide-react";

type FileRow = {
  id: string;
  path: string;
  content: string;
  language: string | null;
};

export function EditorPane({
  files,
  openTabs,
  activeId,
  dirty,
  value,
  onSelectTab,
  onCloseTab,
  onChange,
}: {
  files: FileRow[];
  openTabs: string[];
  activeId: string | null;
  dirty: Record<string, string>;
  value: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onChange: (id: string, value: string) => void;
}) {
  const activeFile = files.find((f) => f.id === activeId);

  return (
    <div className="h-full flex flex-col bg-editor">
      <div className="flex items-stretch border-b overflow-x-auto bg-panel">
        {openTabs.map((id) => {
          const f = files.find((ff) => ff.id === id);
          if (!f) return null;
          const isActive = id === activeId;
          const isDirty = id in dirty;
          return (
            <div
              key={id}
              className={`flex items-center gap-2 px-3 py-2 text-xs border-r cursor-pointer whitespace-nowrap ${
                isActive
                  ? "bg-editor text-foreground border-b-2 border-b-primary"
                  : "text-muted-foreground hover:bg-accent/50"
              }`}
              onClick={() => onSelectTab(id)}
            >
              <span>{f.path.split("/").pop()}</span>
              {isDirty ? (
                <Circle className="size-2 fill-current text-primary" />
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(id);
                  }}
                  className="hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex-1 min-h-0">
        {activeFile ? (
          <Editor
            key={activeFile.id}
            theme="vs-dark"
            language={activeFile.language ?? "plaintext"}
            value={value}
            onChange={(v) => onChange(activeFile.id, v ?? "")}
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              fontFamily:
                "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              wordWrap: "on",
              padding: { top: 12 },
            }}
          />
        ) : (
          <div className="h-full grid place-items-center text-muted-foreground text-sm">
            Open a file from the tree to start editing.
          </div>
        )}
      </div>
    </div>
  );
}
