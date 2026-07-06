import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { listNimModels, sendChatMessage } from "@/lib/ai-chat.functions";
import { Sparkles, Send, Loader2, Wrench, Plus } from "lucide-react";
import { toast } from "sonner";

type Msg = {
  id: string;
  role: string;
  content: string;
  tool_calls: unknown;
  tool_call_id: string | null;
  model: string | null;
  created_at: string;
};

export function AIChatPanel({ projectId }: { projectId: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState<string>("meta/llama-3.3-70b-instruct");
  const [models, setModels] = useState<{ id: string; label: string }[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const send = useServerFn(sendChatMessage);
  const fetchModels = useServerFn(listNimModels);

  useEffect(() => {
    fetchModels({ data: {} })
      .then((r) => {
        setModels(r.models.map((m) => ({ id: m.id, label: m.label })));
        setModel(r.default);
      })
      .catch(() => {
        /* leave defaults */
      });
  }, [fetchModels]);

  async function refresh() {
    // Fetch the NEWEST rows (desc + limit), then reverse for chronological display.
    const { data, error } = await supabase
      .from("chat_messages")
      .select("id,role,content,tool_calls,tool_call_id,model,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      console.error("[AIChatPanel] refresh error:", error);
      return;
    }
    if (!data) return;
    const asc = data.slice().reverse();
    setMessages((prev) => {
      const serverIds = new Set(asc.map((d) => d.id));
      const pending = prev.filter(
        (m) => m.id.startsWith("optimistic-") && !serverIds.has(m.id),
      );
      return [...asc, ...pending];
    });
  }

  useEffect(() => {
    setMessages([]);
    refresh();
    const channel = supabase
      .channel(`chat-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
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

  // Always poll gently as a realtime fallback; faster while the AI is working.
  useEffect(() => {
    const iv = setInterval(() => refresh(), sending ? 1200 : 4000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, projectId]);

  async function onNewChat() {
    if (sending) {
      toast.error("Wait for the current response to finish");
      return;
    }
    if (!confirm("Start a new chat? This clears the current conversation.")) return;
    const { error } = await supabase.from("chat_messages").delete().eq("project_id", projectId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setMessages([]);
    toast.success("New chat started");
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function onSend(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending) return;
    setInput("");
    setSending(true);
    // Optimistic user bubble so the UI reacts immediately.
    const tempId = `optimistic-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      {
        id: tempId,
        role: "user",
        content: message,
        tool_calls: null,
        tool_call_id: null,
        model: null,
        created_at: new Date().toISOString(),
      },
    ]);
    try {
      await send({ data: { projectId, message, model } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI request failed");
    } finally {
      setSending(false);
      refresh();
    }
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          AI Assistant
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onNewChat}
            className="text-xs flex items-center gap-1 px-2 py-1 rounded border hover:bg-accent"
            title="Start a new chat (clears history)"
          >
            <Plus className="size-3" /> New
          </button>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="text-xs bg-input border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-ring max-w-[180px]"
            title="NVIDIA NIM model"
          >
            {(models.length ? models : [{ id: model, label: model }]).map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-3 space-y-3 text-sm">
        {messages.length === 0 && (
          <div className="text-muted-foreground text-xs">
            Ask the assistant to scaffold files, edit code, or run commands. It can directly modify
            your project via tools.
          </div>
        )}
        {messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Thinking…
          </div>
        )}
      </div>

      <form onSubmit={onSend} className="border-t p-2 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend(e as unknown as React.FormEvent);
            }
          }}
          rows={2}
          placeholder="Ask the AI to build, edit or run something…"
          className="flex-1 resize-none bg-input border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="px-3 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
          title="Send (Enter)"
        >
          <Send className="size-4" />
        </button>
      </form>
    </div>
  );
}

function Message({ m }: { m: Msg }) {
  if (m.role === "user") {
    return (
      <div className="rounded-md bg-accent/40 px-3 py-2">
        <div className="text-xs text-muted-foreground mb-1">You</div>
        <div className="whitespace-pre-wrap">{m.content}</div>
      </div>
    );
  }
  if (m.role === "assistant") {
    const toolCalls = Array.isArray(m.tool_calls)
      ? (m.tool_calls as Array<{ function: { name: string; arguments: string } }>)
      : [];
    return (
      <div className="rounded-md border bg-card px-3 py-2">
        <div className="text-xs text-primary mb-1 flex items-center gap-1">
          <Sparkles className="size-3" />
          Assistant
        </div>
        {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
        {toolCalls.map((tc, i) => (
          <div
            key={i}
            className="mt-2 text-xs rounded bg-background/60 border border-border/60 px-2 py-1 flex items-center gap-2"
          >
            <Wrench className="size-3 text-primary" />
            <span className="text-primary">{tc.function.name}</span>
            <span className="text-muted-foreground truncate">
              {tc.function.arguments.slice(0, 120)}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (m.role === "tool") {
    return (
      <div className="rounded-md border border-dashed px-3 py-1.5 text-xs">
        <div className="text-muted-foreground mb-0.5">tool result</div>
        <pre className="whitespace-pre-wrap font-mono text-[11px] max-h-40 overflow-auto">
          {m.content}
        </pre>
      </div>
    );
  }
  return null;
}
