import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { tailDevLog, stopDevServer } from "@/lib/sandbox.functions";
import { FileText, Square, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function LogsPanel({ projectId, active }: { projectId: string; active: boolean }) {
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const tail = useServerFn(tailDevLog);
  const stop = useServerFn(stopDevServer);
  const scrollRef = useRef<HTMLPreElement>(null);

  async function refresh() {
    try {
      const { log } = await tail({ data: { projectId, lines: 300 } });
      setLog(log || "(no dev server output yet)");
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!active) return;
    refresh();
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [log]);

  async function stopServer() {
    setBusy(true);
    try {
      await stop({ data: { projectId } });
      toast.success("Dev server stopped");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-terminal text-sm font-mono">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-panel">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <FileText className="size-3.5" />
          Dev Server Logs
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refresh} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
            <RefreshCw className="size-3" /> Refresh
          </button>
          <button
            onClick={stopServer}
            disabled={busy}
            className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 disabled:opacity-50"
          >
            <Square className="size-3" /> Stop
          </button>
        </div>
      </div>
      <pre ref={scrollRef} className="flex-1 overflow-auto p-3 text-xs whitespace-pre-wrap text-muted-foreground">
        {log || "Waiting for logs…"}
      </pre>
    </div>
  );
}
