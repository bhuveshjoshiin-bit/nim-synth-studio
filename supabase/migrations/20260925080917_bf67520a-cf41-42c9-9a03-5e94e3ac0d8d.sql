CREATE TABLE public.chat_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New chat',
  mode text NOT NULL DEFAULT 'build',
  custom_prompt text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_threads TO authenticated;
GRANT ALL ON public.chat_threads TO service_role;
ALTER TABLE public.chat_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "threads via project" ON public.chat_threads FOR ALL TO authenticated
  USING (public.owns_project(project_id)) WITH CHECK (public.owns_project(project_id));
CREATE TRIGGER chat_threads_updated BEFORE UPDATE ON public.chat_threads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  parent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  parent_tool_call_id text,
  label text,
  task text NOT NULL DEFAULT '',
  mode text NOT NULL DEFAULT 'build',
  model text NOT NULL,
  custom_prompt text,
  status text NOT NULL DEFAULT 'running',
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  step integer NOT NULL DEFAULT 0,
  todos jsonb NOT NULL DEFAULT '[]'::jsonb,
  result text,
  error text,
  driver text NOT NULL DEFAULT 'client',
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs via project" ON public.agent_runs FOR ALL TO authenticated
  USING (public.owns_project(project_id)) WITH CHECK (public.owns_project(project_id));
CREATE TRIGGER agent_runs_updated BEFORE UPDATE ON public.agent_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX agent_runs_thread_idx ON public.agent_runs(thread_id, status);

ALTER TABLE public.chat_messages
  ADD COLUMN thread_id uuid REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  ADD COLUMN reasoning text,
  ADD COLUMN run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  ADD COLUMN agent_label text,
  ADD COLUMN status text;
CREATE INDEX chat_messages_thread_idx ON public.chat_messages(thread_id, created_at);

CREATE TABLE public.plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt text NOT NULL,
  title text NOT NULL DEFAULT 'Untitled plan',
  content text NOT NULL DEFAULT '',
  comments jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  model text,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plans TO authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own plans" ON public.plans FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE TRIGGER plans_updated BEFORE UPDATE ON public.plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.projects ADD COLUMN synced_at timestamptz;

ALTER TABLE public.agent_runs REPLICA IDENTITY FULL;
ALTER TABLE public.chat_threads REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_runs, public.chat_threads;