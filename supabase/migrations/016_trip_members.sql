-- Trip collaboration: tracks who has access to which trip and invite codes
create table if not exists trip_members (
  id uuid primary key default gen_random_uuid(),
  trip_id text not null,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member', 'viewer')),
  invite_code text unique,
  invited_by uuid references auth.users,
  joined_at timestamptz default now(),
  created_at timestamptz default now()
);

create index if not exists trip_members_trip_id_idx on trip_members (trip_id);
create index if not exists trip_members_user_id_idx on trip_members (user_id);
create index if not exists trip_members_invite_code_idx on trip_members (invite_code);

alter table trip_members enable row level security;

-- Members can see rows for trips they're part of (by user_id or as inviter)
create policy "Members can view their trip memberships"
  on trip_members for select
  using (
    user_id = auth.uid()
    or invited_by = auth.uid()
    or trip_id in (select trip_id from trip_members where user_id = auth.uid())
  );

-- Allow looking up a pending (unclaimed) invite by code — needed for join flow
create policy "Anyone can look up unclaimed invite codes"
  on trip_members for select
  using (invite_code is not null and user_id is null);

-- Authenticated users can create invite rows
create policy "Authenticated users can create invite codes"
  on trip_members for insert
  with check (auth.uid() is not null);

-- Users can claim (update) unclaimed invites or update their own row
create policy "Users can claim invites and update their own membership"
  on trip_members for update
  using (user_id is null or user_id = auth.uid());

-- Inviters can delete/revoke rows they created; members can remove themselves
create policy "Inviters and members can delete memberships"
  on trip_members for delete
  using (auth.uid() = invited_by or auth.uid() = user_id);


-- Update RLS on trips table to allow members to access shared trips
-- Drop existing policies first (use IF EXISTS to be safe with any naming variation)
drop policy if exists "Users can select their own trips" on trips;
drop policy if exists "Users can view their own trips" on trips;
drop policy if exists "Users can read their own trips" on trips;
drop policy if exists "Owners can select trips" on trips;
drop policy if exists "Users can update their own trips" on trips;
drop policy if exists "Users can insert their own trips" on trips;
drop policy if exists "Users can delete their own trips" on trips;

-- SELECT: owner or any active member can read
create policy "Owners and members can view trips"
  on trips for select
  using (
    user_id = auth.uid()
    or id in (
      select trip_id from trip_members where user_id = auth.uid()
    )
  );

-- UPDATE: owner or non-viewer members can edit
create policy "Owners and editors can update trips"
  on trips for update
  using (
    user_id = auth.uid()
    or id in (
      select trip_id from trip_members
      where user_id = auth.uid() and role in ('owner', 'member')
    )
  );

-- INSERT: only the owner row (own trip)
create policy "Users can insert their own trips"
  on trips for insert
  with check (user_id = auth.uid());

-- DELETE: only the owner
create policy "Owners can delete their trips"
  on trips for delete
  using (user_id = auth.uid());
