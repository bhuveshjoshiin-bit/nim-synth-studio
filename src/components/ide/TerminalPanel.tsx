import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { runSandboxCommand } from "@/lib/sandbox.functions";
import { Terminal as TerminalIcon, Trash2 } from "lucide-react";
import { toast } from "sonner";

type Log = {
  id: string;
  command: string;
  output: string | null;
  status: string;
  exit_code: number | null;
  created_at: string;
};

export function TerminalPanel({ projectId }: { projectId: string }) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [cmd, setCmd] = useState("");
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const runFn = useServerFn(runSandboxCommand);

  async function refresh() {
    const { data } = await supabase
      .from("terminal_logs")
      .select("id,command,output,status,exit_code,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(200);
    setLogs(data ?? []);
  }

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel(`terminal-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "terminal_logs",
          filter: `project_id=eq.${projectId}`,
        },
        () => refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [logs]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const command = cmd.trim();
    if (!command) return;
    setRunning(true);
    setCmd("");
    try {
      await runFn({ data: { projectId, command } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Command failed");
    } finally {
      setRunning(false);
    }
  }

  async function clearAll() {
    if (!confirm("Clear terminal history?")) return;
    await supabase.from("terminal_logs").delete().eq("project_id", projectId);
    refresh();
  }

  return (
    <div className="h-full flex flex-col bg-terminal text-sm font-mono">
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-panel">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <TerminalIcon className="size-3.5" />
          Terminal
        </div>
        <button
          onClick={clearAll}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <Trash2 className="size-3" />
          Clear
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-2">
        {logs.length === 0 && (
          <div className="text-muted-foreground text-xs">
            Type a command below or let the AI use{" "}
            <code className="text-primary">run_command</code>.
          </div>
        )}
        {logs.map((l) => (
          <div key={l.id}>
            <div className="text-primary">
              <span className="text-muted-foreground">$</span> {l.command}
            </div>
            {l.output && (
              <pre className="whitespace-pre-wrap text-muted-foreground text-xs mt-0.5">
                {l.output}
              </pre>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={run} className="flex items-center gap-2 border-t px-3 py-2 bg-panel">
        <span className="text-primary">$</span>
        <input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          disabled={running}
          placeholder="ls -la"
          className="flex-1 bg-transparent outline-none text-xs"
          autoComplete="off"
        />
      </form>
    </div>
  );
}
