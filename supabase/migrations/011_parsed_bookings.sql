-- Parsed bookings from inbound email forwarding and Gmail sync
--
-- The inbound-booking edge function receives forwarded booking confirmation
-- emails (via SendGrid Inbound Parse), extracts booking details with AI,
-- and stores them here. The app polls this table to show pending bookings
-- that the user can import into their trips.

CREATE TABLE IF NOT EXISTS parsed_bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'imported', 'dismissed')),
  booking_data          JSONB NOT NULL,
  source_email_subject  TEXT,
  source_email_from     TEXT,
  gmail_message_id      TEXT UNIQUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast user-scoped queries (app polls for pending bookings)
CREATE INDEX IF NOT EXISTS parsed_bookings_user_id_idx
  ON parsed_bookings (user_id);

CREATE INDEX IF NOT EXISTS parsed_bookings_user_status_idx
  ON parsed_bookings (user_id, status);

-- RLS: users can read and update their own parsed bookings
ALTER TABLE parsed_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own parsed bookings"
  ON parsed_bookings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own parsed bookings"
  ON parsed_bookings FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role (edge function) inserts rows; no user INSERT policy needed.
-- The inbound-booking edge function uses SUPABASE_SERVICE_ROLE_KEY.
