import { ArrowLeft, Github, Rocket, Play, Terminal } from "lucide-react";
import { toast } from "sonner";

export function TopBar({
  projectName,
  projectId: _projectId,
  onBack,
}: {
  projectName: string;
  projectId: string;
  onBack: () => void;
}) {
  function comingSoon(label: string) {
    toast.info(`${label} ships in the next phase.`);
  }
  return (
    <header className="flex items-center justify-between px-3 py-2 border-b bg-panel">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1.5 rounded hover:bg-accent"
          title="Back to projects"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="size-6 rounded bg-primary text-primary-foreground grid place-items-center">
          <Terminal className="size-3.5" />
        </div>
        <span className="font-medium text-sm">{projectName}</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => comingSoon("Run / preview")}
          className="px-2.5 py-1 text-xs rounded hover:bg-accent flex items-center gap-1.5"
        >
          <Play className="size-3.5" />
          Run
        </button>
        <button
          onClick={() => comingSoon("GitHub sync")}
          className="px-2.5 py-1 text-xs rounded hover:bg-accent flex items-center gap-1.5"
        >
          <Github className="size-3.5" />
          GitHub
        </button>
        <button
          onClick={() => comingSoon("Vercel deploy")}
          className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5"
        >
          <Rocket className="size-3.5" />
          Deploy
        </button>
      </div>
    </header>
  );
}
