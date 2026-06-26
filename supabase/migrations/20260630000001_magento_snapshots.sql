-- Magento ecommerce snapshots — stores order summary + top products
-- per client per date range, fetched via /api/clients/[id]/magento/sync.
--
-- RLS: service-role-only (CLAUDE.md strong rule — no workspace_id / auth.uid).

CREATE TABLE IF NOT EXISTS public.magento_snapshots (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid         NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  store_url      text         NOT NULL,
  period_start   date         NOT NULL,
  period_end     date         NOT NULL,
  total_orders   integer      NOT NULL DEFAULT 0,
  total_revenue  numeric(12,2) NOT NULL DEFAULT 0,
  aov            numeric(12,2) NOT NULL DEFAULT 0,
  top_products   jsonb,
  raw_data       jsonb,
  created_at     timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.magento_snapshots IS
  'Magento ecommerce performance snapshots per client per period. '
  'Written by POST /api/clients/[id]/magento/sync. '
  'Read by MCP tool me_get_ecommerce_summary.';

CREATE INDEX IF NOT EXISTS idx_magento_snapshots_client_period
  ON public.magento_snapshots(client_id, period_end DESC);

ALTER TABLE public.magento_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.magento_snapshots FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
