// NVIDIA NIM (OpenAI-compatible) client.
// Loaded only inside server function handlers; never imported from client code.

export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

export const NIM_MODELS = [
  { id: "moonshotai/kimi-k2.6", label: "kimi k2.6 (Fast)" },
  {
    id: "qwen/qwen3.5-122b-a10b",
    label: "Qwen3.5 122b",
  },
  { id: "minimaxai/minimax-m3", label: "Mini Maxx (coding)" },
  { id: "deepseek-ai/deepseek-v4-pro", label: "Deepseek v4 pro" },
  { id: "openai/gpt-oss-120b", label: "Gpt Oss" },
] as const;

export const DEFAULT_NIM_MODEL = "moonshotai/kimi-k2.6";

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
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface NimResponse {
  choices: Array<{
    message: NimMessage;
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function callNim(opts: {
  model: string;
  messages: NimMessage[];
  tools?: NimTool[];
  temperature?: number;
  max_tokens?: number;
}): Promise<NimResponse> {
  const apiKey = process.env.NVIDIA_NIM_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NVIDIA_NIM_API_KEY is not configured. Add it in project secrets to use the AI assistant.",
    );
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.max_tokens ?? 2048,
    stream: false,
  };
  if (opts.tools && opts.tools.length) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
  }

  const res = await fetch(`${NIM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NVIDIA NIM error ${res.status}: ${text.slice(0, 500)}`);
  }

  return (await res.json()) as NimResponse;
}
