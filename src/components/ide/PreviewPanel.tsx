import { Eye, RefreshCw, ExternalLink, Copy } from "lucide-react";
import { toast } from "sonner";

export function PreviewPanel({
  url,
  onReload,
}: {
  url: string | null;
  onReload: () => void;
}) {
  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="flex items-center justify-between px-3 py-1.5 border-b gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <Eye className="size-3.5" />
          Preview <span className="text-[10px] normal-case opacity-60">:3000</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={onReload}
            disabled={!url}
            className="text-xs px-2 py-1 rounded border hover:bg-accent disabled:opacity-40 flex items-center gap-1"
            title="Reload iframe"
          >
            <RefreshCw className="size-3" /> Reload
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
            src={url}
            title="Sandbox preview"
            className="w-full h-full border-0 bg-white"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
          />
        ) : (
          <div className="h-full grid place-items-center text-xs text-muted-foreground text-center p-4">
            <div>
              <p>No preview yet.</p>
              <p className="mt-1">Click <b>Run</b> in the top bar to start the dev server on port 3000.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
