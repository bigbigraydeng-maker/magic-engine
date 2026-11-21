-- Magic Network unit ledger (MU). v1.2 distributor backoffice.
-- Spec: docs/mn-marketplace/reuse-map.md
-- Engine: src/lib/distributor/mn/ (pure functions). This file only stores rows.
--
-- Do not apply this migration from the pull request. Apply it only after
-- 20261110190000_distributor_commission_tables.sql, and only when Ray says so.
-- It creates new tables. It does not change or delete existing rows.
-- 1 MU cent = 1 USD cent. Rates are basis points (1% = 100).
-- RLS: service_role only. FOR ALL TO service_role. No anon or authenticated access.

BEGIN;

CREATE TABLE public.mn_fx_rates (
  year_month          DATE NOT NULL CHECK (date_trunc('month', year_month) = year_month),
  currency            TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  -- Micro-USD per 1.00 of currency. There is no seeded rate: the source is not decided.
  usd_per_unit_micros INTEGER NOT NULL CHECK (usd_per_unit_micros > 0),
  source              TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 120),
  locked_on           DATE NOT NULL,
  PRIMARY KEY (year_month, currency)
);

CREATE TABLE public.mn_product_cards (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code          TEXT NOT NULL UNIQUE CHECK (product_code ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  name                  TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  currency              TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_commission_bp   INTEGER NOT NULL CHECK (total_commission_bp BETWEEN 0 AND 10000),
  distributor_cap_bp    INTEGER NOT NULL CHECK (distributor_cap_bp BETWEEN 0 AND 10000),
  active                BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (distributor_cap_bp <= total_commission_bp)
);

-- One row per decided policy version. Nothing is inserted here.
-- confirmed = false means the identity numbers are still the proposal.
CREATE TABLE public.mn_commission_policy (
  version     TEXT PRIMARY KEY CHECK (length(version) BETWEEN 1 AND 80),
  config      JSONB NOT NULL,
  confirmed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.mn_identity_grants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id  UUID NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  identity        TEXT NOT NULL CHECK (identity IN ('Link', 'Node', 'Nexus', 'Core')),
  effective_from  TIMESTAMPTZ NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('proposal', 'confirmed-rule', 'invite')),
  note            TEXT NOT NULL CHECK (length(note) BETWEEN 1 AND 500),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (source = 'invite' OR identity <> 'Core')
);
CREATE INDEX mn_identity_grants_distributor_idx ON public.mn_identity_grants(distributor_id, effective_from);

CREATE TABLE public.mn_sales (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code           TEXT NOT NULL REFERENCES public.mn_product_cards(product_code) ON DELETE RESTRICT,
  buyer_ref              TEXT NOT NULL CHECK (length(buyer_ref) BETWEEN 1 AND 128),
  seller_id              UUID NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  paid_at                TIMESTAMPTZ NOT NULL,
  qualified_at           TIMESTAMPTZ,
  sales_month            DATE CHECK (sales_month IS NULL OR date_trunc('month', sales_month) = sales_month),
  amount_net_cents       INTEGER NOT NULL CHECK (amount_net_cents > 0),
  currency               TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  fx_usd_per_unit_micros INTEGER NOT NULL CHECK (fx_usd_per_unit_micros > 0),
  amount_usd_cents       INTEGER NOT NULL CHECK (amount_usd_cents > 0),
  mu_cents               INTEGER NOT NULL CHECK (mu_cents > 0),
  self_purchase          BOOLEAN NOT NULL DEFAULT false,
  annual                 BOOLEAN NOT NULL DEFAULT false,
  annual_recognition     TEXT NOT NULL DEFAULT 'unset'
                          CHECK (annual_recognition IN ('unset', 'full_in_sale_month', 'monthly_slice', 'cap_two_units')),
  status                 TEXT NOT NULL CHECK (status IN ('pending', 'valid', 'clawed_back')),
  config_snapshot        JSONB NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((status = 'valid') = (qualified_at IS NOT NULL AND sales_month IS NOT NULL)),
  CHECK (annual = false OR annual_recognition <> 'unset')
);
CREATE INDEX mn_sales_seller_month_idx ON public.mn_sales(seller_id, sales_month);

-- First valid purchase sticks until an operator changes it, unless lock_days is set.
CREATE TABLE public.mn_customer_locks (
  buyer_ref    TEXT PRIMARY KEY CHECK (length(buyer_ref) BETWEEN 1 AND 128),
  seller_id    UUID NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  product_code TEXT NOT NULL REFERENCES public.mn_product_cards(product_code) ON DELETE RESTRICT,
  locked_at    TIMESTAMPTZ NOT NULL,
  lock_days    INTEGER CHECK (lock_days IS NULL OR lock_days >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.mn_settlement_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_month         DATE NOT NULL CHECK (date_trunc('month', sales_month) = sales_month),
  status              TEXT NOT NULL DEFAULT 'computed' CHECK (status IN ('computed', 'approved', 'paid', 'voided')),
  pool_mu_cents       BIGINT NOT NULL CHECK (pool_mu_cents >= 0),
  payable_mu_cents    BIGINT NOT NULL CHECK (payable_mu_cents >= 0),
  peer_cut_mu_cents   BIGINT NOT NULL DEFAULT 0 CHECK (peer_cut_mu_cents >= 0),
  team_cut_mu_cents   BIGINT NOT NULL DEFAULT 0 CHECK (team_cut_mu_cents >= 0),
  shortfall_mu_cents  BIGINT NOT NULL DEFAULT 0 CHECK (shortfall_mu_cents >= 0),
  payout_exit         TEXT NOT NULL DEFAULT 'fiat' CHECK (payout_exit = 'fiat'),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mn_settlement_batches_one_live_per_month
  ON public.mn_settlement_batches(sales_month) WHERE status <> 'voided';

CREATE TABLE public.mn_mu_ledger (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id   UUID NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  sale_id          UUID REFERENCES public.mn_sales(id) ON DELETE RESTRICT,
  batch_id         UUID REFERENCES public.mn_settlement_batches(id) ON DELETE RESTRICT,
  sales_month      DATE CHECK (sales_month IS NULL OR date_trunc('month', sales_month) = sales_month),
  product_code     TEXT REFERENCES public.mn_product_cards(product_code) ON DELETE RESTRICT,
  entry_type       TEXT NOT NULL CHECK (entry_type IN ('retail', 'l1', 'l2', 'team', 'peer', 'clawback', 'adjustment')),
  mu_cents         BIGINT NOT NULL CHECK (mu_cents <> 0),
  status           TEXT NOT NULL CHECK (status IN ('pending', 'valid', 'settled', 'clawed_back', 'paid')),
  payout_exit      TEXT NOT NULL DEFAULT 'fiat' CHECK (payout_exit = 'fiat'),
  note             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mn_mu_ledger_distributor_idx ON public.mn_mu_ledger(distributor_id, sales_month);
CREATE INDEX mn_mu_ledger_batch_idx ON public.mn_mu_ledger(batch_id);

ALTER TABLE public.mn_fx_rates            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_product_cards       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_commission_policy   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_identity_grants     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_sales               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_customer_locks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_settlement_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mn_mu_ledger           ENABLE ROW LEVEL SECURITY;

CREATE POLICY mn_fx_rates_service_role ON public.mn_fx_rates
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mn_product_cards_service_role ON public.mn_product_cards
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mn_commission_policy_service_role ON public.mn_commission_policy
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mn_identity_grants_service_role ON public.mn_identity_grants
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mn_sales_service_role ON public.mn_sales
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mn_customer_locks_service_role ON public.mn_customer_locks
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mn_settlement_batches_service_role ON public.mn_settlement_batches
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY mn_mu_ledger_service_role ON public.mn_mu_ledger
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
