-- Customer briefs — the AI-written card a CTS salesperson reads instead of the thread.
--
-- Depends on 20260726000001_messenger_conversations.sql.
--
-- One current brief per conversation, rewritten in place when the thread moves on.
-- History is deliberately not kept: staff act on the latest state, and keeping every
-- revision of every thread would grow without bound for no operational benefit.

CREATE TABLE IF NOT EXISTS messenger_briefs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id       UUID NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  -- Denormalised from the parent so every client-facing query can filter on
  -- client_id directly. A portal user must never be able to reach another
  -- client's brief through a join they control.
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  schema_version        INTEGER NOT NULL DEFAULT 1,
  model                 TEXT,

  -- Chinese — read by CTS staff in a Chinese UI.
  summary               TEXT NOT NULL,
  intent_level          TEXT NOT NULL CHECK (intent_level IN ('high', 'medium', 'low', 'unknown')),
  customer_needs        JSONB NOT NULL DEFAULT '[]'::jsonb,
  objections            JSONB NOT NULL DEFAULT '[]'::jsonb,
  promises_made         JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_action           TEXT,
  follow_up_due_at      TIMESTAMPTZ,
  risk_flags            JSONB NOT NULL DEFAULT '[]'::jsonb,
  trip                  JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- English — this text goes to a New Zealand customer. Never auto-sent.
  draft_reply           TEXT,

  -- Message count of the thread when this brief was written. A thread whose
  -- message_count has since moved is stale and due for a rewrite.
  source_message_count  INTEGER NOT NULL DEFAULT 0,
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Rate limiting: a back-and-forth thread must not be re-summarised on every
  -- message. Counter resets when regen_count_date rolls over.
  regen_count           INTEGER NOT NULL DEFAULT 0,
  regen_count_date      DATE NOT NULL DEFAULT CURRENT_DATE,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT messenger_briefs_conversation_key UNIQUE (conversation_id)
);

-- The client-facing list view: "my threads, highest intent first".
CREATE INDEX IF NOT EXISTS messenger_briefs_client_intent_idx
  ON messenger_briefs (client_id, intent_level, generated_at DESC);

ALTER TABLE messenger_briefs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON messenger_briefs FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Outbound audit — every message a human sends from ME.
--
-- Sending from ME speaks as CTS to a real customer, so who sent what must be
-- answerable later. Written before the Graph call and marked on the result, so a
-- send that fails mid-flight still leaves a trace.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS messenger_outbound_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES messenger_conversations(id) ON DELETE CASCADE,
  client_id        UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Email of the logged-in portal user who pressed send.
  sent_by_email    TEXT NOT NULL,
  body             TEXT NOT NULL,
  -- True when the body was sent exactly as the AI drafted it.
  used_ai_draft    BOOLEAN NOT NULL DEFAULT FALSE,
  -- 'standard' inside Meta's 24h window, 'human_agent' outside it.
  messaging_type   TEXT,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'sent', 'failed')),
  meta_message_id  TEXT,
  error_message    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS messenger_outbound_log_conversation_idx
  ON messenger_outbound_log (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS messenger_outbound_log_client_idx
  ON messenger_outbound_log (client_id, created_at DESC);

ALTER TABLE messenger_outbound_log ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON messenger_outbound_log FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
