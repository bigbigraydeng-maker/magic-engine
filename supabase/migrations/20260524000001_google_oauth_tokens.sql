-- Google OAuth tokens — one row per client, covers GSC + GA4 + Google Ads
-- Authentication: standard OAuth 2.0 web flow; refresh_token is long-lived.
create table google_oauth_tokens (
  id            uuid        default gen_random_uuid() primary key,
  client_id     uuid        not null references clients(id) on delete cascade,
  access_token  text        not null,
  refresh_token text,
  token_expiry  timestamptz not null,
  scopes        text[]      not null default '{}',
  google_email  text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now(),
  unique (client_id)
);

create index google_oauth_tokens_client_id_idx on google_oauth_tokens (client_id);
