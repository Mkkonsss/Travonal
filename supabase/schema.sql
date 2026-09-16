-- Travonal Supabase Schema
-- Run this in your Supabase project: SQL Editor → New query → paste & run

-- ─── profiles ────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id            uuid references auth.users on delete cascade primary key,
  travel_profile jsonb,
  updated_at    timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "users can select own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "users can insert own profile"
  on public.profiles for insert with check (auth.uid() = id);

create policy "users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- ─── trips ───────────────────────────────────────────────────────────────────
-- Trips are stored as JSONB blobs matching the client-side Trip type exactly.
-- No relational normalization needed — the client is the source of truth for structure.
create table if not exists public.trips (
  id         text primary key,          -- app-generated ID (e.g. "1234567890123")
  user_id    uuid references auth.users on delete cascade not null,
  data       jsonb not null,            -- full Trip object
  updated_at timestamptz default now()
);

alter table public.trips enable row level security;

create policy "users can select own trips"
  on public.trips for select using (auth.uid() = user_id);

create policy "users can insert own trips"
  on public.trips for insert with check (auth.uid() = user_id);

create policy "users can update own trips"
  on public.trips for update using (auth.uid() = user_id);

create policy "users can delete own trips"
  on public.trips for delete using (auth.uid() = user_id);

-- Index for fast user-scoped trip queries
create index if not exists trips_user_id_idx on public.trips (user_id);
