-- WhatsApp: (1) the "to be claimed" inbox for history sync, (2) the registry of phone numbers that
-- deliver to us but belong to no client, (3) a lookup index for delivery-failure receipts.
-- Design: docs/specs/2026-10-14-whatsapp-inbound-classify-v1.md §2 and §7.
-- Rollout order: apply this migration BEFORE deploying the code that writes to it, and BEFORE anyone
-- subscribes the Meta app to the `history` field (history is delivered once; the code refuses it with
-- 503 until the inbox exists). Empty tables = no behaviour change.
-- Privacy: the inbox keeps METADATA ONLY (who/when/direction/type) — never message bodies (PM 2026-10-10).
-- Apply in a quiet hour: the partial index on conversation_outbound_log briefly blocks writes to that table.
-- (UPDATE/DELETE are granted now so the later claim/cleanup work needs no second migration.)
-- Reversible: DROP TABLE public.whatsapp_history_inbox; DROP TABLE public.whatsapp_unclaimed_numbers;
--             DROP INDEX IF EXISTS public.conversation_outbound_log_meta_message_idx;

CREATE TABLE IF NOT EXISTS public.whatsapp_history_inbox (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  phone_number_id  text NOT NULL CHECK (phone_number_id ~ '^[0-9]{1,32}$'),
  customer_wa_id   text NOT NULL CHECK (customer_wa_id ~ '^[0-9]{5,20}$'),
  message_id       text NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('customer', 'business')),
  msg_type         text,
  sent_at          timestamptz,
  history_status   text,
  phase            integer,
  chunk_order      integer,
  received_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, message_id)
);

CREATE INDEX IF NOT EXISTS whatsapp_history_inbox_customer_idx
  ON public.whatsapp_history_inbox (client_id, customer_wa_id, sent_at);

CREATE TABLE IF NOT EXISTS public.whatsapp_unclaimed_numbers (
  phone_number_id text PRIMARY KEY CHECK (phone_number_id ~ '^[0-9]{1,32}$'),
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_kind       text NOT NULL CHECK (last_kind IN ('customer_messages', 'echoes', 'statuses', 'history')),
  resolved_at     timestamptz
);

-- Status receipts look the send record up by Meta's message id; that column had no index.
CREATE INDEX IF NOT EXISTS conversation_outbound_log_meta_message_idx
  ON public.conversation_outbound_log (meta_message_id) WHERE meta_message_id IS NOT NULL;

ALTER TABLE public.whatsapp_history_inbox ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full ON public.whatsapp_history_inbox;
CREATE POLICY service_role_full ON public.whatsapp_history_inbox
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.whatsapp_history_inbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_history_inbox TO service_role;

ALTER TABLE public.whatsapp_unclaimed_numbers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full ON public.whatsapp_unclaimed_numbers;
CREATE POLICY service_role_full ON public.whatsapp_unclaimed_numbers
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.whatsapp_unclaimed_numbers FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_unclaimed_numbers TO service_role;

COMMENT ON TABLE public.whatsapp_history_inbox IS
  'WhatsApp history-sync messages waiting to be claimed. Metadata only (no bodies). No contacts/conversations/touchpoints are created from these rows.';
COMMENT ON TABLE public.whatsapp_unclaimed_numbers IS
  'phone_number_ids that delivered to /api/webhooks/whatsapp but are bound to no client. resolved_at is set by the daily to-do pusher once a client binds the number.';
