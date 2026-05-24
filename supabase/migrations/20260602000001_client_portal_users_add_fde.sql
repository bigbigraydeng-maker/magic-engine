-- Extend access_type to include 'fde' role for Frontline Deployment Engineers
-- Also add created_by_email audit column for admin UI tracking

ALTER TABLE client_portal_users
  DROP CONSTRAINT IF EXISTS client_portal_users_access_type_check;

ALTER TABLE client_portal_users
  ADD CONSTRAINT client_portal_users_access_type_check
    CHECK (access_type IN ('portal', 'dashboard', 'fde', 'both'));

ALTER TABLE client_portal_users
  ADD COLUMN IF NOT EXISTS created_by_email text;
