-- Shared trip links: stores itinerary snapshots for public viewing/editing
create table if not exists shared_trips (
  id text primary key,             -- short random ID (e.g. "x7k9m2")
  user_id uuid references auth.users(id) on delete cascade,
  trip_id text not null,
  permission text not null default 'view' check (permission in ('view', 'edit')),
  trip_data jsonb not null,        -- snapshot of the itinerary at share time
  created_at timestamptz not null default now()
);

-- Allow anyone to read shared trips (they're public by design)
alter table shared_trips enable row level security;

create policy "Anyone can view shared trips"
  on shared_trips for select
  using (true);

create policy "Authenticated users can create shared trips"
  on shared_trips for insert
  with check (auth.uid() = user_id);

create policy "Owners can delete their shared trips"
  on shared_trips for delete
  using (auth.uid() = user_id);
