// NVIDIA NIM (OpenAI-compatible) client with streaming + reasoning support.
// Loaded only inside server handlers; never imported from client code.

export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

export type NimModelInfo = {
  id: string;
  label: string;
  tag: string;
  reasoning?: boolean;
};

// Verified live against the NIM catalog (Sep 2026).
export const NIM_MODELS: readonly NimModelInfo[] = [
  { id: "moonshotai/kimi-k3", label: "Kimi K3", tag: "Best agent", reasoning: true },
  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", tag: "Fast agent" },
  { id: "z-ai/glm-5.3", label: "GLM 5.3", tag: "Coding", reasoning: true },
  { id: "z-ai/glm-5.3-flash", label: "GLM 5.3 Flash", tag: "Fast" },
  { id: "deepseek-ai/deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash", tag: "Reasoning", reasoning: true },
  { id: "nvidia/nemotron-3-ultra-550b-a55b", label: "Nemotron 3 Ultra", tag: "Large", reasoning: true },
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super", tag: "Balanced", reasoning: true },
  { id: "mistralai/mistral-nemotron", label: "Mistral Nemotron", tag: "Tools" },
  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B", tag: "Light" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B", tag: "Light", reasoning: true },
] as const;

export const DEFAULT_NIM_MODEL = "moonshotai/kimi-k3";

export function resolveModel(id?: string | null): string {
  return id && NIM_MODELS.some((m) => m.id === id) ? id : DEFAULT_NIM_MODEL;
}

export type NimRole = "system" | "user" | "assistant" | "tool";

export interface NimToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface NimMessage {
  role: NimRole;
  content: string | null;
  name?: string;
  tool_calls?: NimToolCall[];
  tool_call_id?: string;
}

export interface NimTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface NimResponse {
  choices: Array<{ message: NimMessage & { reasoning_content?: string }; finish_reason: string }>;
}

function key(): string {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_NIM_API_KEY is not configured.");
  return apiKey;
}

export async function callNim(opts: {
  model: string;
  messages: NimMessage[];
  tools?: NimTool[];
  temperature?: number;
  max_tokens?: number;
}): Promise<NimResponse> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.max_tokens ?? 4096,
    stream: false,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`NVIDIA NIM error ${res.status}: ${(await res.text()).slice(0, 400)}`);
  return (await res.json()) as NimResponse;
}

export type StreamResult = {
  content: string;
  reasoning: string;
  tool_calls: NimToolCall[];
  finish_reason: string | null;
};

/**
 * Streams a completion. onDelta is called (throttled by the caller) with the
 * accumulated content/reasoning so the UI can render it live.
 */
export async function streamNim(opts: {
  model: string;
  messages: NimMessage[];
  tools?: NimTool[];
  temperature?: number;
  max_tokens?: number;
  onDelta?: (s: { content: string; reasoning: string; toolNames: string[] }) => void;
}): Promise<StreamResult> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.max_tokens ?? 8192,
    stream: true,
  };
  if (opts.tools?.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }
  const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Authorization: `Bearer ${key()}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(`NVIDIA NIM error ${res.status}: ${(await res.text().catch(() => "")).slice(0, 400)}`);
  }

  let content = "";
  let reasoning = "";
  let finish: string | null = null;
  const calls: Record<number, NimToolCall> = {};
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;
      let j: any;
      try {
        j = JSON.parse(payload);
      } catch {
        continue;
      }
      const ch = j.choices?.[0];
      if (!ch) continue;
      const d = ch.delta ?? {};
      if (typeof d.content === "string") content += d.content;
      const r = d.reasoning_content ?? d.reasoning;
      if (typeof r === "string") reasoning += r;
      for (const tc of d.tool_calls ?? []) {
        const i = tc.index ?? 0;
        calls[i] ??= { id: tc.id ?? `call_${i}_${Date.now()}`, type: "function", function: { name: "", arguments: "" } };
        if (tc.id) calls[i].id = tc.id;
        if (tc.function?.name) calls[i].function.name += tc.function.name;
        if (tc.function?.arguments) calls[i].function.arguments += tc.function.arguments;
      }
      if (ch.finish_reason) finish = ch.finish_reason;
      opts.onDelta?.({ content, reasoning, toolNames: Object.values(calls).map((c) => c.function.name) });
    }
  }

  // Some models inline thinking as <think>…</think> in content.
  const m = content.match(/^\s*<think>([\s\S]*?)(<\/think>|$)/);
  if (m) {
    reasoning = (reasoning + "\n" + m[1]).trim();
    content = content.slice(m[0].length).trim();
  }
  return { content, reasoning, tool_calls: Object.values(calls).filter((c) => c.function.name), finish_reason: finish };
}
