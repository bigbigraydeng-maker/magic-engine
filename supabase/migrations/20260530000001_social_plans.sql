-- ============================================
-- social_plans — generated Facebook social content plans
-- Phase A: Social Plan Generator
-- 2026-05-30
-- ============================================

CREATE TABLE IF NOT EXISTS public.social_plans (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  campaign_id  UUID        REFERENCES public.campaign_briefs(id) ON DELETE SET NULL,
  platform     TEXT        NOT NULL DEFAULT 'facebook',
  wave_number  INTEGER     NOT NULL DEFAULT 1,
  plan_data    JSONB       NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS social_plans_client_id_idx
  ON public.social_plans(client_id);

CREATE INDEX IF NOT EXISTS social_plans_campaign_id_idx
  ON public.social_plans(campaign_id);

ALTER TABLE public.social_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full"
  ON public.social_plans FOR ALL TO service_role
  USING (true) WITH CHECK (true);
