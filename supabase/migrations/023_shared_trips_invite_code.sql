-- Add invite_code column to shared_trips so share links can include
-- a join code that opens the trip inside the app via Universal Link.
alter table shared_trips add column if not exists invite_code text;
