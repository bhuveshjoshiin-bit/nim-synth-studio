import { ArrowLeft, Github, Rocket, Play, Loader2, Square, Terminal } from "lucide-react";

export function TopBar({
  projectName,
  running,
  previewOpen,
  onBack,
  onRun,
  onStop,
  onGithub,
  onVercel,
}: {
  projectName: string;
  running?: boolean;
  previewOpen?: boolean;
  onBack: () => void;
  onRun: () => void;
  onStop: () => void;
  onGithub: () => void;
  onVercel: () => void;
}) {
  return (
    <header className="flex items-center justify-between px-3 py-2 border-b bg-panel">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-1.5 rounded hover:bg-accent" title="Back to projects">
          <ArrowLeft className="size-4" />
        </button>
        <div className="size-6 rounded bg-primary text-primary-foreground grid place-items-center">
          <Terminal className="size-3.5" />
        </div>
        <span className="font-medium text-sm">{projectName}</span>
      </div>
      <div className="flex items-center gap-2">
        {previewOpen ? (
          <button
            onClick={onStop}
            className="px-2.5 py-1 text-xs rounded hover:bg-accent flex items-center gap-1.5"
            title="Stop dev server"
          >
            <Square className="size-3.5" /> Stop
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={running}
            className="px-2.5 py-1 text-xs rounded hover:bg-accent flex items-center gap-1.5 disabled:opacity-50"
            title="Start dev server on port 3000"
          >
            {running ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
            Run
          </button>
        )}
        <button
          onClick={onGithub}
          className="px-2.5 py-1 text-xs rounded hover:bg-accent flex items-center gap-1.5"
          title="Push to GitHub"
        >
          <Github className="size-3.5" />
          GitHub
        </button>
        <button
          onClick={onVercel}
          className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5"
          title="Deploy to Vercel"
        >
          <Rocket className="size-3.5" />
          Deploy
        </button>
      </div>
    </header>
  );
}
