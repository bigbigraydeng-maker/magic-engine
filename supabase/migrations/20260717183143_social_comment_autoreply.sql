-- Social Comment Auto-Reply (Phase 20.D — social pillar / DAPE Execution)
--
-- Two tables:
--   social_comment_config:       per-client enable flag + auto-reply settings
--   social_comment_engagements:  one row per comment — classification + reply state (audit trail)
--
-- Full-auto engine: cron polls Page comments, classifies, auto-replies (public
-- + optional DM), and logs every decision here for the FDE audit view.
--
-- RLS: service-role only (ME accesses via supabaseAdmin; no end-user Auth).

-- ────────────────────────────────────────────────────────────────────────────
-- Config: one row per client
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_comment_config (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT false,

  -- Meta context
  fb_page_id            text NOT NULL,

  -- Behaviour switches (pilot-safe defaults)
  auto_reply_praise     boolean NOT NULL DEFAULT true,   -- auto public reply to praise
  auto_reply_question   boolean NOT NULL DEFAULT true,   -- auto holding reply + route to human
  auto_reply_complaint  boolean NOT NULL DEFAULT true,   -- auto empathetic reply + route to human
  auto_hide_spam        boolean NOT NULL DEFAULT false,  -- auto-hide spam (off by default — conservative)
  private_reply_enabled boolean NOT NULL DEFAULT true,   -- allow DM guidance
  lookback_days         int  NOT NULL DEFAULT 7  CHECK (lookback_days BETWEEN 1 AND 30),
  max_replies_per_run   int  NOT NULL DEFAULT 20 CHECK (max_replies_per_run >= 1),

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS idx_scc_client  ON public.social_comment_config(client_id);
CREATE INDEX IF NOT EXISTS idx_scc_enabled ON public.social_comment_config(enabled) WHERE enabled = true;

ALTER TABLE public.social_comment_config ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.social_comment_config FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- Engagements: one row per comment (idempotent on comment_id)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.social_comment_engagements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  platform           text NOT NULL DEFAULT 'facebook',  -- 'facebook' | 'instagram'
  page_id            text NOT NULL,
  post_id            text NOT NULL,
  comment_id         text NOT NULL,                     -- idempotency key
  author_id          text,
  author_name        text,
  comment_text       text,
  comment_created_at timestamptz,

  -- Classification
  category           text,   -- 'praise'|'question'|'complaint'|'spam'|'other'
  category_confidence numeric,
  needs_human        boolean NOT NULL DEFAULT false,
  guardrail_flags    text[]  NOT NULL DEFAULT '{}',
  reply_source       text,   -- 'llm'|'fallback'|'none'

  -- Reply state
  reply_status       text NOT NULL DEFAULT 'pending',   -- processing|pending|replied|dm_sent|hidden|skipped|failed|reverted
  attempts           int  NOT NULL DEFAULT 0,           -- send attempts (bounds 'failed' retries)
  public_reply_text  text,
  public_reply_id    text,   -- returned comment id of our reply
  private_reply_text text,
  private_reply_sent boolean NOT NULL DEFAULT false,
  hidden             boolean NOT NULL DEFAULT false,
  error_message      text,
  reviewed_by        text,   -- FDE who intervened (audit view)
  reviewed_at        timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  UNIQUE (comment_id)
);

CREATE INDEX IF NOT EXISTS idx_sce_client   ON public.social_comment_engagements(client_id);
CREATE INDEX IF NOT EXISTS idx_sce_status   ON public.social_comment_engagements(reply_status);
CREATE INDEX IF NOT EXISTS idx_sce_created  ON public.social_comment_engagements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sce_needs_human ON public.social_comment_engagements(needs_human) WHERE needs_human = true;

ALTER TABLE public.social_comment_engagements ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.social_comment_engagements FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
