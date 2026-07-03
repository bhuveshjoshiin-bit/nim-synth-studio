import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { autoStartDevServer, deployProject } from "@/lib/sandbox.functions";
import { Eye, RefreshCw, ExternalLink, Loader2, Play, Share2, Copy } from "lucide-react";
import { toast } from "sonner";

export function PreviewPanel({ projectId }: { projectId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [nonce, setNonce] = useState(0);
  const start = useServerFn(autoStartDevServer);
  const deploy = useServerFn(deployProject);

  async function launch() {
    setLoading(true);
    try {
      const { url } = await start({ data: { projectId } });
      setUrl(url);
      setNonce((n) => n + 1);
      toast.success("Dev server started on port 3000");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setLoading(false);
    }
  }

  async function share() {
    setDeploying(true);
    try {
      const { url } = await deploy({ data: { projectId } });
      await navigator.clipboard.writeText(url).catch(() => {});
      setUrl(url);
      setNonce((n) => n + 1);
      toast.success("Share link copied to clipboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deploy");
    } finally {
      setDeploying(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Eye className="size-3.5" />
          Preview <span className="text-[10px] normal-case opacity-60">:3000</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={launch}
            disabled={loading}
            className="text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
            title={url ? "Restart dev server" : "Start dev server on port 3000"}
          >
            {loading ? <Loader2 className="size-3 animate-spin" /> : url ? <RefreshCw className="size-3" /> : <Play className="size-3" />}
            {url ? "Reload" : "Start"}
          </button>
          <button
            onClick={share}
            disabled={deploying}
            className="text-xs px-2 py-1 rounded border hover:bg-accent flex items-center gap-1"
            title="Copy shareable link"
          >
            {deploying ? <Loader2 className="size-3 animate-spin" /> : <Share2 className="size-3" />}
            Share
          </button>
          {url && (
            <>
              <button
                onClick={() => { navigator.clipboard.writeText(url); toast.success("URL copied"); }}
                className="text-xs text-muted-foreground hover:text-foreground"
                title="Copy URL"
              >
                <Copy className="size-3" />
              </button>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground"
                title="Open in new tab"
              >
                <ExternalLink className="size-3" />
              </a>
            </>
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
              <p className="mt-1">Click <b>Start</b> — the dev server binds to port 3000 automatically.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
