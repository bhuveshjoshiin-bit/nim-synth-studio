import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSandboxPreviewUrl } from "@/lib/sandbox.functions";
import { Eye, RefreshCw, ExternalLink, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

export function PreviewPanel({ projectId }: { projectId: string }) {
  const [port, setPort] = useState(3000);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const getUrl = useServerFn(getSandboxPreviewUrl);

  async function start() {
    setLoading(true);
    try {
      const { url } = await getUrl({ data: { projectId, port } });
      setUrl(url);
      setNonce((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Eye className="size-3.5" />
          Preview
        </div>
        <div className="flex items-center gap-1.5">
          <label className="text-xs text-muted-foreground">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(Number(e.target.value) || 3000)}
            className="w-16 bg-input border rounded px-1.5 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={start}
            disabled={loading}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            title={url ? "Refresh" : "Start preview"}
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : url ? <RefreshCw className="size-3" /> : <Play className="size-3" />}
            {url ? "Reload" : "Start"}
          </button>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              title="Open in new tab"
            >
              <ExternalLink className="size-3" />
            </a>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 bg-background">
        {url ? (
          <iframe
            key={nonce}
            src={url}
            title="Sandbox preview"
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
          />
        ) : (
          <div className="h-full grid place-items-center text-xs text-muted-foreground text-center p-4">
            <div>
              <p>No preview yet.</p>
              <p className="mt-1">Run a dev server in the Terminal (e.g. <code className="text-primary">python -m http.server 3000</code>) then click <b>Start</b>.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
