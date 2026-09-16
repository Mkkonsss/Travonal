-- Shared photo cache — stores Google Places photo URLs so each place is
-- fetched from Google only once, then served from cache for all users.
--
-- Photos are stored in Supabase Storage (permanent URLs). This table maps
-- place_id → storage URL so subsequent lookups skip Google entirely.

CREATE TABLE IF NOT EXISTS photo_cache (
  place_id    TEXT PRIMARY KEY,
  photo_url   TEXT NOT NULL,           -- permanent Supabase Storage URL
  photo_ref   TEXT,                    -- original Google photo reference (for re-fetch if needed)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for cleanup queries (delete entries older than TTL)
CREATE INDEX IF NOT EXISTS idx_photo_cache_created
  ON photo_cache (created_at);

-- Allow public read access (photos are non-sensitive)
ALTER TABLE photo_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read photo cache"
  ON photo_cache FOR SELECT
  USING (true);

-- Only the service role (edge functions) can insert/update
CREATE POLICY "service role can insert photo cache"
  ON photo_cache FOR INSERT
  WITH CHECK (true);

CREATE POLICY "service role can update photo cache"
  ON photo_cache FOR UPDATE
  USING (true);
