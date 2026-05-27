-- Add composite unique constraint so upsert ON CONFLICT(email, client_id) works.
-- The original UNIQUE(email) was dropped in 20260522000001 to allow multi-client
-- access, but the replacement composite constraint was never created.

-- Defensive drop in case the single-column constraint survived or was re-introduced.
ALTER TABLE client_portal_users DROP CONSTRAINT IF EXISTS client_portal_users_email_key;

ALTER TABLE client_portal_users
  ADD CONSTRAINT client_portal_users_email_client_id_key UNIQUE (email, client_id);
