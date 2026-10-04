-- Chat history sync: stores all chat threads (which contain messages) per user.

CREATE TABLE IF NOT EXISTS user_chat (
  user_id    UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  threads    JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE user_chat ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own chat"
  ON user_chat FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can upsert own chat"
  ON user_chat FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own chat"
  ON user_chat FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own chat"
  ON user_chat FOR DELETE
  USING (auth.uid() = user_id);
