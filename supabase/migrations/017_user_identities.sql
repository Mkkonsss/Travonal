-- Public identity table: a minimal, world-readable projection of
-- displayName / username / avatarUrl for use in trip collaboration.
-- The full profiles table remains self-only.
create table if not exists user_identities (
  user_id      uuid primary key references auth.users on delete cascade,
  display_name text,
  username     text,
  avatar_url   text,   -- https:// only; local file:// URIs are never stored here
  updated_at   timestamptz not null default now()
);

create index if not exists user_identities_username_idx on user_identities (username);

alter table user_identities enable row level security;

-- Anyone authenticated can read any row (needed for member list + join preview)
create policy "Authenticated users can read user identities"
  on user_identities for select
  using (auth.uid() is not null);

-- A user can only insert their own row
create policy "Users can insert their own identity"
  on user_identities for insert
  with check (auth.uid() = user_id);

-- A user can only update their own row
create policy "Users can update their own identity"
  on user_identities for update
  using (auth.uid() = user_id);

-- A user can delete their own row (account cleanup)
create policy "Users can delete their own identity"
  on user_identities for delete
  using (auth.uid() = user_id);
