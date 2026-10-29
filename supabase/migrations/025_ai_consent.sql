-- Whether each user has agreed to share their data with our AI provider (Anthropic).
-- The app blocks AI requests on the device until the user taps Allow; this copy lets
-- server-side AI — reading forwarded booking emails — respect the same choice.
-- App Review Guideline 5.1.2(i).
create table if not exists user_ai_consent (
  user_id    uuid primary key references auth.users on delete cascade,
  granted    boolean not null,
  updated_at timestamptz not null default now()
);

alter table user_ai_consent enable row level security;

-- A user can only see their own choice
create policy "Users can read their own AI consent"
  on user_ai_consent for select
  using (auth.uid() = user_id);

-- A user can only insert their own row
create policy "Users can insert their own AI consent"
  on user_ai_consent for insert
  with check (auth.uid() = user_id);

-- A user can only update their own row
create policy "Users can update their own AI consent"
  on user_ai_consent for update
  using (auth.uid() = user_id);
