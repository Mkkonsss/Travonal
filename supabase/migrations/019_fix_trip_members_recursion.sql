-- Fix infinite recursion in trip_members RLS policy.
-- The original "Members can view their trip memberships" policy queried
-- trip_members from within a trip_members policy, causing recursion.
-- Solution: use a SECURITY DEFINER function to break the cycle.

create or replace function auth_user_trip_ids()
returns setof text
language sql
security definer
stable
as $$
  select trip_id from trip_members where user_id = auth.uid()
$$;

-- Drop the recursive policy and replace it
drop policy if exists "Members can view their trip memberships" on trip_members;

create policy "Members can view their trip memberships"
  on trip_members for select
  using (
    user_id = auth.uid()
    or invited_by = auth.uid()
    or trip_id in (select auth_user_trip_ids())
  );
