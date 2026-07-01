import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ChatInput = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(8000),
  model: z.string().min(1),
});

const ModelsInput = z.object({}).optional();

export const listNimModels = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => ModelsInput.parse(d ?? {}))
  .handler(async () => {
    const { NIM_MODELS, DEFAULT_NIM_MODEL } = await import("./nim.server");
    return { models: NIM_MODELS, default: DEFAULT_NIM_MODEL };
  });

const SYSTEM_PROMPT = `You are NimIDE's AI coding assistant, running on NVIDIA NIM.

You have direct, write access to the user's project file system via tools:
- read_file(path): read the contents of a file
- create_file(path, content): create a new file (errors if it already exists)
- edit_file(path, content): replace the entire contents of an existing file
- delete_file(path): delete a file
- run_command(command): run a shell command (currently simulated — outputs are placeholder until the sandbox is wired up)

Be decisive and use tools to make changes directly. Do not paste large code blocks into chat —
use create_file or edit_file instead. After making changes, briefly explain what you did.
Always use forward slashes in paths. Do not start paths with a slash.`;

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the entire contents of a file in the user's project.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Project-relative file path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_file",
      description: "Create a new file with the given contents. Errors if the file already exists.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description: "Replace the entire contents of an existing file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete a file from the project.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description:
        "Run a shell command in the project's sandbox. Currently simulated; output is a placeholder.",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

function languageFromPath(path: string): string | null {
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
  return ext ? (map[ext] ?? ext) : null;
}

export const sendChatMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => ChatInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { NIM_MODELS, DEFAULT_NIM_MODEL } = await import("./nim.server");
    const model = NIM_MODELS.some((m) => m.id === data.model) ? data.model : DEFAULT_NIM_MODEL;

    // Confirm ownership
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .eq("owner_id", userId)
      .maybeSingle();
    if (projErr || !project) throw new Error("Project not found");

    // Load history (last 30 messages)
    const { data: history } = await supabase
      .from("chat_messages")
      .select("role,content,tool_calls,tool_call_id")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true })
      .limit(30);

    // Load file index (paths only) to give the model context
    const { data: filesIndex } = await supabase
      .from("files")
      .select("path")
      .eq("project_id", data.projectId)
      .order("path");

    const fileList = (filesIndex ?? []).map((f) => f.path).join("\n") || "(empty project)";
    const contextSystem = `Current project files:\n${fileList}`;

    // Save user message
    await supabase.from("chat_messages").insert({
      project_id: data.projectId,
      role: "user",
      content: data.message,
    });

    const { callNim } = await import("./nim.server");
    type NimMsg = import("./nim.server").NimMessage;

    const messages: NimMsg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "system", content: contextSystem },
      ...((history ?? []).map((m) => {
        const base: NimMsg = {
          role: m.role as NimMsg["role"],
          content: m.content ?? "",
        };
        if (m.tool_calls) base.tool_calls = m.tool_calls as unknown as NimMsg["tool_calls"];
        if (m.tool_call_id) base.tool_call_id = m.tool_call_id;
        return base;
      })),
      { role: "user", content: data.message },
    ];

    const MAX_STEPS = 50;
    let step = 0;
    let finalAssistant = "";

    while (step < MAX_STEPS) {
      step++;
      const response = await callNim({
        model: model,
        messages,
        tools: TOOLS,
      });
      const choice = response.choices[0];
      if (!choice) throw new Error("Empty response from NVIDIA NIM");
      const msg = choice.message;

      // Persist assistant turn (with optional tool_calls)
      await supabase.from("chat_messages").insert({
        project_id: data.projectId,
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: (msg.tool_calls ?? null) as unknown as never,
        model: model,
      });
      messages.push({
        role: "assistant",
        content: msg.content ?? "",
        tool_calls: msg.tool_calls,
      });

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalAssistant = msg.content ?? "";
        break;
      }

      // Execute every tool call
      for (const call of msg.tool_calls) {
        let result = "";
        try {
          const args = JSON.parse(call.function.arguments || "{}");
          const path: string | undefined = args.path;
          const cleanPath = path?.replace(/^\/+/, "");

          switch (call.function.name) {
            case "read_file": {
              if (!cleanPath) throw new Error("path required");
              const { data: f, error } = await supabase
                .from("files")
                .select("content")
                .eq("project_id", data.projectId)
                .eq("path", cleanPath)
                .maybeSingle();
              if (error) throw error;
              if (!f) result = `File not found: ${cleanPath}`;
              else result = f.content;
              break;
            }
            case "create_file": {
              if (!cleanPath) throw new Error("path required");
              const { error } = await supabase.from("files").insert({
                project_id: data.projectId,
                path: cleanPath,
                content: String(args.content ?? ""),
                language: languageFromPath(cleanPath),
              });
              if (error) throw error;
              result = `Created ${cleanPath}`;
              break;
            }
            case "edit_file": {
              if (!cleanPath) throw new Error("path required");
              const { data: existing } = await supabase
                .from("files")
                .select("id")
                .eq("project_id", data.projectId)
                .eq("path", cleanPath)
                .maybeSingle();
              if (!existing) {
                // Treat edit on missing file as create
                const { error } = await supabase.from("files").insert({
                  project_id: data.projectId,
                  path: cleanPath,
                  content: String(args.content ?? ""),
                  language: languageFromPath(cleanPath),
                });
                if (error) throw error;
                result = `Created ${cleanPath} (did not exist)`;
              } else {
                const { error } = await supabase
                  .from("files")
                  .update({ content: String(args.content ?? "") })
                  .eq("id", existing.id);
                if (error) throw error;
                result = `Edited ${cleanPath}`;
              }
              break;
            }
            case "delete_file": {
              if (!cleanPath) throw new Error("path required");
              const { error } = await supabase
                .from("files")
                .delete()
                .eq("project_id", data.projectId)
                .eq("path", cleanPath);
              if (error) throw error;
              result = `Deleted ${cleanPath}`;
              break;
            }
            case "run_command": {
              const cmd = String(args.command ?? "");
              const { data: logRow } = await supabase
                .from("terminal_logs")
                .insert({ project_id: data.projectId, command: cmd, status: "running", output: "" })
                .select("id")
                .single();
              try {
                const { data: proj } = await supabase
                  .from("projects").select("sandbox_id").eq("id", data.projectId).maybeSingle();
                const { getOrCreateSandbox, runCommand, syncFiles } = await import("./e2b.server");
                const sandbox = await getOrCreateSandbox(proj?.sandbox_id ?? null);
                if (sandbox.sandboxId !== proj?.sandbox_id) {
                  await supabase.from("projects").update({ sandbox_id: sandbox.sandboxId }).eq("id", data.projectId);
                }
                const { data: files } = await supabase
                  .from("files").select("path,content").eq("project_id", data.projectId);
                await syncFiles(sandbox, files ?? []);
                const r = await runCommand(sandbox, cmd);
                const output = (r.stdout + (r.stderr ? "\n" + r.stderr : "")).slice(0, 20000);
                await supabase.from("terminal_logs").update({
                  status: r.exitCode === 0 ? "success" : "error",
                  output,
                  exit_code: r.exitCode,
                }).eq("id", logRow!.id);
                result = `exit ${r.exitCode}\n${output}`.slice(0, 8000);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                await supabase.from("terminal_logs").update({ status: "error", output: msg, exit_code: 1 }).eq("id", logRow!.id);
                result = `Error running command: ${msg}`;
              }
              break;
            }
            default:
              result = `Unknown tool: ${call.function.name}`;
          }
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        await supabase.from("chat_messages").insert({
          project_id: data.projectId,
          role: "tool",
          content: result,
          tool_call_id: call.id,
        });
        messages.push({ role: "tool", content: result, tool_call_id: call.id });
      }
    }

    return { ok: true, assistant: finalAssistant, steps: step };
  });
