-- Feedback and reports on AI replies (👍 / 👎 and "Report response").
-- App Review Guideline 1.2 covers AI-generated content: users need a way to report
-- offensive replies, and we review what gets reported.
create table if not exists ai_feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  rating     text not null check (rating in ('up', 'down')),
  reason     text check (reason in ('offensive', 'inaccurate', 'unsafe', 'other')),
  context    text not null default 'chat',   -- 'chat' or 'trip_chat'
  message    text not null,                  -- the AI reply being rated
  created_at timestamptz not null default now()
);

create index if not exists ai_feedback_reports_idx on ai_feedback (created_at desc) where rating = 'down';

alter table ai_feedback enable row level security;

-- A user can only submit feedback as themselves
create policy "Users can insert their own AI feedback"
  on ai_feedback for insert
  with check (auth.uid() = user_id);

-- A user can see what they've submitted
create policy "Users can read their own AI feedback"
  on ai_feedback for select
  using (auth.uid() = user_id);
