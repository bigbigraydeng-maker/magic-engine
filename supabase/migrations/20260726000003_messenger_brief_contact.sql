-- messenger_briefs.contact — phone/email the customer volunteered in the thread.
--
-- Added after reviewing the first real briefs: lead-form enquiries arrive with the
-- customer's phone and email inside the first message body, and that is the single
-- thing a salesperson reaches for. Without this column it stayed buried in the
-- transcript.

ALTER TABLE messenger_briefs
  ADD COLUMN IF NOT EXISTS contact JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN messenger_briefs.contact IS
  'Contact details the CUSTOMER supplied ({phone, email}). Never CTS''s own numbers.';
