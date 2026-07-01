
ALTER TABLE public.chat_messages REPLICA IDENTITY FULL;
ALTER TABLE public.terminal_logs REPLICA IDENTITY FULL;
ALTER TABLE public.files REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.terminal_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.files;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS sandbox_id text;
