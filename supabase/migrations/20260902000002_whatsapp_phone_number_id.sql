-- WhatsApp inbound plumbing. Four changes, all additive.
--
-- 1. clients.whatsapp_phone_number_id — inbound routing key, mirrors
--    clients.facebook_page_id exactly (20260726000001_messenger_conversations.sql).
--    The webhook receiver gets a `phone_number_id` from Meta on every inbound
--    message and must resolve it to a client_id without hardcoding any client's
--    id in shared code (张良 platform-tier-gate 红线 2). It is also the
--    authoritative sender identity for OUTBOUND sends: lib/whatsapp/send.ts
--    fails closed when this column disagrees with WHATSAPP_PHONE_NUMBER_ID,
--    so one client can never send from another client's number.
--
-- 2. conversations.entry_referral — the ad/CTA click that started the thread.
--    Meta puts `referral` (source_id, ctwa_clid, headline…) on the FIRST inbound
--    message only, and no read API returns it afterwards —
--    messenger/link-contacts.ts:660-672 documents ME already losing this exact
--    data on the Messenger side. The webhook is the only place it is ever
--    visible, so it is captured now even though the 72h free-window logic that
--    consumes it is not built yet (see lib/whatsapp/send.ts header).
--
-- 3. A COMMENT on conversations.participant_psid — that column now means
--    different things per channel and carries PII on the WhatsApp side.
--    It has never had a comment; without one the reuse is unreadable to
--    whoever touches this next.
--
-- No RLS change: `clients` and `conversations` policies already cover all
-- columns, and both are correctly scoped. Verified against
-- 20260425000001_magic_engine_foundation.sql:19 (clients policy is
-- `FOR ALL TO service_role`) and 20260803020000_rls_lock_policies_to_service_role.sql
-- (which lists `clients` under "未受影响" and swept every other policy to
-- service_role). Adding a column does not create a new policy requirement.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id TEXT;

COMMENT ON COLUMN clients.whatsapp_phone_number_id IS
  'WhatsApp Cloud API Phone Number ID (numeric, from Meta Business Manager after the number is shared into the Magic Engine business portfolio — see #1300). Inbound: the webhook routes messages for this number to this client. Outbound: lib/whatsapp/send.ts refuses to send when this disagrees with the configured sender number.';

CREATE UNIQUE INDEX IF NOT EXISTS clients_whatsapp_phone_number_id_key
  ON clients (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS entry_referral JSONB;

-- 4. conversation_messages.media_* — the Meta media id for non-text messages.
--    Meta deletes the underlying file after ~30 days and no read API hands the
--    id back later, so a customer's passport photo or itinerary screenshot is
--    unrecoverable if the id is not captured on arrival. Downloading the file
--    is a later PR; keeping the id is what makes that PR possible at all.
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS media_type TEXT;
ALTER TABLE conversation_messages ADD COLUMN IF NOT EXISTS media_id TEXT;

COMMENT ON COLUMN conversation_messages.media_type IS
  'For non-text inbound messages: image | video | audio | document | sticker. NULL for text.';
COMMENT ON COLUMN conversation_messages.media_id IS
  'Provider-side media id (WhatsApp: Meta media id). The file itself is not downloaded yet; Meta deletes it after ~30 days.';

COMMENT ON COLUMN conversations.entry_referral IS
  'The ad or CTA click that started this thread, captured verbatim from the first inbound webhook payload. Meta only ever sends this once and no read API returns it later. Used for ad attribution and (future) the 72-hour free-entry-point messaging window.';

COMMENT ON COLUMN conversations.participant_psid IS
  'The customer''s identifier ON THIS CHANNEL — the meaning differs per channel. messenger: Page-scoped ID (PSID), opaque, not a real Facebook user id, cannot be merged across channels. whatsapp: the customer''s wa_id, i.e. their phone number in WhatsApp format — this is PII and IS a cross-channel merge key (see lib/crm/identity.ts).';
