// NVIDIA NIM (OpenAI-compatible) client.
// Loaded only inside server function handlers; never imported from client code.

export const NIM_BASE_URL = "https://integrate.api.nvidia.com/v1";

export const NIM_MODELS = [
  { id: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B (general)" },
  {
    id: "nvidia/llama-3.1-nemotron-70b-instruct",
    label: "Nemotron 70B (instruct-tuned)",
  },
  { id: "qwen/qwen3-coder-480b-a35b-instruct", label: "Qwen3 Coder 480B (coding)" },
  { id: "mistralai/mixtral-8x22b-instruct-v0.1", label: "Mixtral 8x22B" },
  { id: "deepseek-ai/deepseek-r1", label: "DeepSeek R1 (reasoning)" },
] as const;

export const DEFAULT_NIM_MODEL = "meta/llama-3.3-70b-instruct";

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
