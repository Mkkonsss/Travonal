-- Gmail OAuth connections for syncing booking confirmation emails.
-- Each user can have at most one connected Gmail account.
-- The refresh_token is long-lived; access_token is cached for efficiency.

CREATE TABLE IF NOT EXISTS public.gmail_connections (
  user_id           UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  refresh_token     TEXT NOT NULL,
  access_token      TEXT,
  token_expires_at  TIMESTAMPTZ,
  connected_at      TIMESTAMPTZ DEFAULT NOW(),
  last_sync_at      TIMESTAMPTZ
);

ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own connection"
  ON public.gmail_connections FOR ALL
  USING (auth.uid() = user_id);
