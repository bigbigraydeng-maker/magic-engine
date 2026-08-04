-- Messenger conversation ingestion (step 1 of the Messenger → sales-brief pipeline).
--
-- Stores the raw Facebook Page inbox so ME can later summarise each thread into a
-- sales-facing needs card (mirrors the voice_calls / voice_call_transcript_segments
-- pattern already in production).
--
-- PRIVACY: these tables hold real customer conversation content — display names and
-- verbatim messages. PM authorised storing this for CTS Tours on 2026-07-26.
-- Sync is opt-in per client: only clients with clients.facebook_page_id set are pulled.

-- ---------------------------------------------------------------------------
-- clients.facebook_page_id — the numeric Page ID the sync runs against.
-- clients.facebook_page_url already exists but holds a vanity URL
-- (https://www.facebook.com/CTSTOURS/) which the Graph API cannot be keyed on.
-- TODO(next PR): expose this on the client Settings page — FDE/PM must not edit it
-- in Supabase Studio (CLAUDE.md § FDE/PM 配置类数据必须有 UI).
-- ---------------------------------------------------------------------------
ALTER TABLE clients ADD COLUMN IF NOT EXISTS facebook_page_id TEXT;

COMMENT ON COLUMN clients.facebook_page_id IS
  'Numeric Facebook Page ID. When set, the hourly Messenger sync pulls this Page''s inbox into messenger_conversations.';

-- ---------------------------------------------------------------------------
-- messenger_conversations — one row per Messenger thread.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messenger_conversations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  page_id            TEXT NOT NULL,
  -- Meta's thread id, e.g. "t_1234567890".
  conversation_id    TEXT NOT NULL,
  -- Page-scoped id of the customer (stable per Page, not a real Facebook user id).
  participant_psid   TEXT,
  participant_name   TEXT,
  message_count      INTEGER NOT NULL DEFAULT 0,
  -- Meta's own updated_time for the thread. Used as the incremental-sync
  -- watermark: it moves on events that do not create a message (e.g. reactions),
  -- so it must not be conflated with last_message_at.
  meta_updated_time  TIMESTAMPTZ,
  last_message_at    TIMESTAMPTZ,
  -- 'customer' when the customer spoke last (i.e. we owe them a reply), else 'page'.
  last_message_from  TEXT CHECK (last_message_from IN ('customer', 'page')),
  first_synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messenger_conversations_client_thread_key UNIQUE (client_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS messenger_conversations_client_last_message_idx
  ON messenger_conversations (client_id, last_message_at DESC NULLS LAST);

-- Drives "threads waiting on us" without a table scan.
CREATE INDEX IF NOT EXISTS messenger_conversations_awaiting_reply_idx
  ON messenger_conversations (client_id, last_message_at DESC)
  WHERE last_message_from = 'customer';

-- ---------------------------------------------------------------------------
-- messenger_messages — one row per message inside a thread.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messenger_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  -- Meta's message id ("mid.xxx"); unique within a thread, used for idempotent resync.
  message_id       TEXT NOT NULL,
  -- 'inbound'  = from the customer
  -- 'outbound' = from the Page (a human agent OR Meta's Business AI)
  direction        TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  sender_id        TEXT,
  sender_name      TEXT,
  body             TEXT,
  sent_at          TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messenger_messages_thread_message_key UNIQUE (conversation_id, message_id)
);

CREATE INDEX IF NOT EXISTS messenger_messages_conversation_sent_idx
  ON messenger_messages (conversation_id, sent_at);

-- ---------------------------------------------------------------------------
-- RLS — ME accesses these through service-role + Bearer-token APIs only.
-- ---------------------------------------------------------------------------
ALTER TABLE messenger_conversations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON messenger_conversations FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE messenger_messages ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON messenger_messages FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Enable the sync for CTS Tours NZ only (PM: "先做 CTS", 2026-07-26).
-- Every other client stays opt-out until its page id is filled in.
-- ---------------------------------------------------------------------------
UPDATE clients
   SET facebook_page_id = '1616575215312482'
 WHERE id = 'c0000000-0000-0000-0000-000000000000'
   AND facebook_page_id IS NULL;
