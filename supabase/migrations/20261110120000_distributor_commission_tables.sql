-- 代理销售管理系统 第一刀：经销商、等级历史、销售记录、分润明细、月结批准、规则版本。
-- 规格：docs/specs/2026-11-10-distributor-commission-system-v0.1.md
-- 计算逻辑：src/lib/distributor/（纯函数，本文件只存结果）。
--
-- 不要自行 apply。只建新表，不改、不删任何已有表或行。合并与 apply 都留给 Ray 本人。
-- 金额一律整数「分」，比例一律基点（1% = 100）。
-- RLS：一律 service-role 模板（FOR ALL TO service_role），匿名与登录用户都读不到。

BEGIN;

CREATE TABLE public.distributor_rule_versions (
  version         TEXT PRIMARY KEY CHECK (length(version) BETWEEN 1 AND 64),
  config          JSONB NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL,
  created_by      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.distributors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id       UUID REFERENCES public.distributors(id) ON DELETE RESTRICT,
  display_name    TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 200),
  contact_email   TEXT,
  contact_phone   TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected','suspended')),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE INDEX distributors_parent_idx ON public.distributors(parent_id);

CREATE TABLE public.distributor_level_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id  UUID NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  level           TEXT NOT NULL CHECK (level IN ('standard','tier1','premier')),
  effective_from  TIMESTAMPTZ NOT NULL,
  reason          TEXT NOT NULL,
  rule_version    TEXT NOT NULL REFERENCES public.distributor_rule_versions(version),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (distributor_id, effective_from)
);

CREATE TABLE public.distributor_sales (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_id    UUID NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  kind              TEXT NOT NULL CHECK (kind IN ('plan','addon','refund')),
  order_ref         TEXT NOT NULL CHECK (length(order_ref) BETWEEN 1 AND 128),
  plan_code         TEXT,
  months            INTEGER CHECK (months IS NULL OR months > 0),
  extra_avatars     INTEGER NOT NULL DEFAULT 0 CHECK (extra_avatars >= 0),
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL CHECK (length(currency) = 3),
  paid_at           TIMESTAMPTZ NOT NULL,
  is_self_purchase  BOOLEAN NOT NULL DEFAULT false,
  refund_of_sale_id UUID REFERENCES public.distributor_sales(id) ON DELETE RESTRICT,
  recorded_by       TEXT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, order_ref),
  CHECK ((kind = 'refund') = (refund_of_sale_id IS NOT NULL)),
  CHECK ((kind = 'refund' AND amount_cents < 0) OR (kind <> 'refund' AND amount_cents > 0))
);
CREATE INDEX distributor_sales_seller_paid_idx ON public.distributor_sales(distributor_id, paid_at);

-- 一次月结（某个月、某个规则版本算出来的一整份）。批准前只是算账结果，不是付款授权。
CREATE TABLE public.distributor_statements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month    DATE NOT NULL CHECK (date_trunc('month', period_month) = period_month),
  rule_version    TEXT NOT NULL REFERENCES public.distributor_rule_versions(version),
  status          TEXT NOT NULL DEFAULT 'computed'
                   CHECK (status IN ('computed','approved','paid','voided')),
  total_payable_cents BIGINT NOT NULL CHECK (total_payable_cents >= 0),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  CHECK (status NOT IN ('approved','paid') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'paid' OR paid_at IS NOT NULL)
);
-- 同一个月只允许一份有效月结；作废的可以有多份。
CREATE UNIQUE INDEX distributor_statements_one_live_per_month
  ON public.distributor_statements(period_month) WHERE status <> 'voided';

CREATE TABLE public.distributor_commission_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  statement_id    UUID NOT NULL REFERENCES public.distributor_statements(id) ON DELETE RESTRICT,
  distributor_id  UUID NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  kind            TEXT NOT NULL CHECK (kind IN ('retail','peer','team')),
  sale_id         UUID REFERENCES public.distributor_sales(id) ON DELETE RESTRICT,
  amount_cents    BIGINT NOT NULL,
  payable         BOOLEAN NOT NULL,
  note            TEXT NOT NULL,
  CHECK ((kind = 'team') = (sale_id IS NULL))
);
CREATE INDEX distributor_commission_lines_statement_idx ON public.distributor_commission_lines(statement_id);
CREATE INDEX distributor_commission_lines_distributor_idx ON public.distributor_commission_lines(distributor_id);

ALTER TABLE public.distributor_rule_versions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributors                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_level_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_sales             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_statements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_commission_lines  ENABLE ROW LEVEL SECURITY;

CREATE POLICY distributor_rule_versions_service_role ON public.distributor_rule_versions
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY distributors_service_role ON public.distributors
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY distributor_level_history_service_role ON public.distributor_level_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY distributor_sales_service_role ON public.distributor_sales
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY distributor_statements_service_role ON public.distributor_statements
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY distributor_commission_lines_service_role ON public.distributor_commission_lines
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
