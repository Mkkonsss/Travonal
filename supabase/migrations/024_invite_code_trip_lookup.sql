-- Migration 024: Allow invite code recipients to look up trip data
--
-- Problem: findTripByInviteCode fails because the trips table RLS policy
-- requires the reader to be the trip owner or an active member (with user_id
-- set in trip_members). When a new user taps a share link they haven't
-- claimed the invite yet, so both conditions fail and the trip read is blocked.
--
-- Fix: A SECURITY DEFINER function that validates the invite code and returns
-- the trip data, bypassing RLS safely.

CREATE OR REPLACE FUNCTION lookup_trip_by_invite_code(p_invite_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trip_id TEXT;
  v_trip_data JSONB;
BEGIN
  -- Find the unclaimed invite code in trip_members
  SELECT trip_id INTO v_trip_id
  FROM trip_members
  WHERE invite_code = UPPER(TRIM(p_invite_code))
  LIMIT 1;

  IF v_trip_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Fetch the trip data
  SELECT data INTO v_trip_data
  FROM trips
  WHERE id = v_trip_id;

  RETURN v_trip_data;
END;
$$;
