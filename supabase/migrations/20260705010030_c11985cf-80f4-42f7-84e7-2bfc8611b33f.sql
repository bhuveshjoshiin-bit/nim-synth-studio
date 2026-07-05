CREATE TABLE public.user_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('github','vercel')),
  token text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_integrations TO authenticated;
GRANT ALL ON public.user_integrations TO service_role;
ALTER TABLE public.user_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own integrations" ON public.user_integrations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER user_integrations_set_updated_at
  BEFORE UPDATE ON public.user_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();