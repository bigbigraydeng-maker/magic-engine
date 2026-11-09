-- 代理销售管理系统 第一刀：经销商、等级历史、销售记录、月结、分润明细、月结余额。
-- 规格：docs/specs/2026-11-10-distributor-commission-system-v0.1.md
-- 计算逻辑：src/lib/distributor/（纯函数，本文件只存结果并兜底拦截错账）。
--
-- 不要自行 apply。只建新表和它们自己的触发器，不改、不删任何已有表或行。合并与 apply 都留给 Ray 本人。
-- 金额一律整数「分」，比例一律基点（1% = 100）。月份按新西兰时间（Pacific/Auckland）。
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
CREATE INDEX distributor_sales_refund_of_idx ON public.distributor_sales(refund_of_sale_id);

-- 退款兜底：只能退原单（不能退退款），卖家与币种必须和原单一致，累计退款不能超过原单金额。
-- 原单加行锁，避免两笔退款同时写入一起超额。已结算的销售不许再改关键字段。
CREATE FUNCTION public.distributor_sales_refund_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  original public.distributor_sales%ROWTYPE;
  refunded BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.amount_cents, NEW.distributor_id, NEW.paid_at, NEW.currency, NEW.kind, NEW.refund_of_sale_id)
       IS DISTINCT FROM (OLD.amount_cents, OLD.distributor_id, OLD.paid_at, OLD.currency, OLD.kind, OLD.refund_of_sale_id) THEN
    -- 已进过任何一份未作废月结的销售或退款，金额、卖家、时间、币种、类型都不许再改。
    IF EXISTS (
      SELECT 1 FROM public.distributor_commission_lines l
        JOIN public.distributor_statements s ON s.id = l.statement_id
       WHERE l.sale_id = OLD.id AND s.status <> 'voided'
    ) THEN
      RAISE EXCEPTION 'sale % is already settled; record a refund instead of editing it', OLD.id;
    END IF;
  END IF;
  IF NEW.kind <> 'refund' THEN
    -- 原单金额不能改到比已退款合计还小。
    IF TG_OP = 'UPDATE' AND NEW.amount_cents + (
         SELECT COALESCE(sum(amount_cents), 0) FROM public.distributor_sales WHERE refund_of_sale_id = NEW.id) < 0 THEN
      RAISE EXCEPTION 'sale % would be below its refunds', NEW.id;
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO original FROM public.distributor_sales WHERE id = NEW.refund_of_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refund % has no original sale', NEW.id;
  END IF;
  IF original.kind = 'refund' THEN
    RAISE EXCEPTION 'refund % points at another refund', NEW.id;
  END IF;
  IF original.distributor_id <> NEW.distributor_id OR original.currency <> NEW.currency THEN
    RAISE EXCEPTION 'refund % seller or currency differs from original %', NEW.id, original.id;
  END IF;
  SELECT COALESCE(sum(amount_cents), 0) INTO refunded FROM public.distributor_sales
   WHERE refund_of_sale_id = original.id AND id <> NEW.id;
  IF original.amount_cents + refunded + NEW.amount_cents < 0 THEN
    RAISE EXCEPTION 'refunds of % would exceed the original amount', original.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER distributor_sales_refund_guard BEFORE INSERT OR UPDATE ON public.distributor_sales
  FOR EACH ROW EXECUTE FUNCTION public.distributor_sales_refund_guard();

-- 一次月结（某个月、某个规则版本算出来的一整份）。
-- computed = 只是算账结果，可以改；approved = PM 批准付款，之后明细锁死；paid = 已付；voided = 作废。
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
  -- 零售 / 平级必须指向销售；团队月度行为空，团队退款倒扣行指向那笔退款。
  sale_id         UUID REFERENCES public.distributor_sales(id) ON DELETE RESTRICT,
  amount_cents    BIGINT NOT NULL CHECK (amount_cents <> 0),
  payable         BOOLEAN NOT NULL,
  note            TEXT NOT NULL,
  CHECK (kind = 'team' OR sale_id IS NOT NULL)
);
CREATE INDEX distributor_commission_lines_statement_idx ON public.distributor_commission_lines(statement_id);
CREATE INDEX distributor_commission_lines_distributor_idx ON public.distributor_commission_lines(distributor_id);
CREATE INDEX distributor_commission_lines_sale_idx ON public.distributor_commission_lines(sale_id);

-- 每份月结里每个经销商一行：期初欠款 + 本期 = 本期实付 + 结转欠款；同时存本月团队费率，供以后退款倒扣。
CREATE TABLE public.distributor_statement_balances (
  statement_id     UUID NOT NULL REFERENCES public.distributor_statements(id) ON DELETE RESTRICT,
  distributor_id   UUID NOT NULL REFERENCES public.distributors(id) ON DELETE RESTRICT,
  opening_cents    BIGINT NOT NULL CHECK (opening_cents <= 0),
  period_cents     BIGINT NOT NULL,
  payout_cents     BIGINT NOT NULL CHECK (payout_cents >= 0),
  closing_cents    BIGINT NOT NULL CHECK (closing_cents <= 0),
  team_sales_cents BIGINT NOT NULL CHECK (team_sales_cents >= 0),
  team_rate_bp     INTEGER NOT NULL CHECK (team_rate_bp BETWEEN 0 AND 10000),
  -- 本月团队收益是否真的发了（被扣住 / 账号停用 = false）；以后退款只倒扣发过的。
  team_paid        BOOLEAN NOT NULL,
  PRIMARY KEY (statement_id, distributor_id),
  CHECK (opening_cents + period_cents = payout_cents + closing_cents),
  CHECK (payout_cents = 0 OR closing_cents = 0)
);

-- 明细和余额只能在 computed 状态的月结里增删改；批准之后锁死。
CREATE FUNCTION public.distributor_statement_children_lock() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  sid UUID;
  st TEXT;
BEGIN
  sid := CASE WHEN TG_OP = 'DELETE' THEN OLD.statement_id ELSE NEW.statement_id END;
  SELECT status INTO st FROM public.distributor_statements WHERE id = sid FOR SHARE;
  IF st IS DISTINCT FROM 'computed' THEN
    RAISE EXCEPTION 'statement % is %, its lines and balances are locked', sid, st;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.statement_id <> NEW.statement_id THEN
    RAISE EXCEPTION 'cannot move rows between statements';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER distributor_commission_lines_lock BEFORE INSERT OR UPDATE OR DELETE ON public.distributor_commission_lines
  FOR EACH ROW EXECUTE FUNCTION public.distributor_statement_children_lock();
CREATE TRIGGER distributor_statement_balances_lock BEFORE INSERT OR UPDATE OR DELETE ON public.distributor_statement_balances
  FOR EACH ROW EXECUTE FUNCTION public.distributor_statement_children_lock();

-- 同一笔销售的同一种收益、同一个人，只能出现在一份未作废的月结里（防跨月重复付）。
CREATE FUNCTION public.distributor_commission_lines_no_double() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.sale_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- Serialise concurrent writers for the same sale so the check below cannot race.
  PERFORM pg_advisory_xact_lock(hashtext('distributor_line:' || NEW.sale_id::text));
  IF EXISTS (
    SELECT 1 FROM public.distributor_commission_lines l
      JOIN public.distributor_statements s ON s.id = l.statement_id
     WHERE l.sale_id = NEW.sale_id AND l.kind = NEW.kind AND l.distributor_id = NEW.distributor_id
       AND l.id <> NEW.id AND s.status <> 'voided'
  ) THEN
    RAISE EXCEPTION 'sale % already settled as % for %', NEW.sale_id, NEW.kind, NEW.distributor_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER distributor_commission_lines_no_double BEFORE INSERT OR UPDATE ON public.distributor_commission_lines
  FOR EACH ROW EXECUTE FUNCTION public.distributor_commission_lines_no_double();

-- 月结状态只能往前走：computed → approved → paid，computed/approved → voided；paid、voided 是终点。
-- 批准时总额必须等于各人实付之和；批准后除状态与时间戳外不许改。
CREATE FUNCTION public.distributor_statements_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  payout_sum BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'statements are never deleted; void instead';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'computed' THEN
      RAISE EXCEPTION 'a new statement must start as computed';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT ((OLD.status = NEW.status AND NEW.status = 'computed')
       OR (OLD.status = 'computed' AND NEW.status IN ('approved','voided'))
       OR (OLD.status = 'approved' AND NEW.status IN ('paid','voided'))
       OR (OLD.status = NEW.status AND NEW.status IN ('approved','paid','voided')
           AND NEW.approved_by IS NOT DISTINCT FROM OLD.approved_by
           AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
           AND NEW.paid_at IS NOT DISTINCT FROM OLD.paid_at)) THEN
    RAISE EXCEPTION 'statement % cannot go from % to %', OLD.id, OLD.status, NEW.status;
  END IF;
  IF OLD.status <> 'computed' AND (NEW.period_month <> OLD.period_month OR NEW.rule_version <> OLD.rule_version
       OR NEW.total_payable_cents <> OLD.total_payable_cents OR NEW.computed_at <> OLD.computed_at) THEN
    RAISE EXCEPTION 'statement % is %, its amounts are locked', OLD.id, OLD.status;
  END IF;
  IF OLD.status = 'computed' AND NEW.status = 'approved' THEN
    SELECT COALESCE(sum(payout_cents), 0) INTO payout_sum
      FROM public.distributor_statement_balances WHERE statement_id = NEW.id;
    IF payout_sum <> NEW.total_payable_cents THEN
      RAISE EXCEPTION 'statement % total % does not match balances %', NEW.id, NEW.total_payable_cents, payout_sum;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER distributor_statements_transition BEFORE INSERT OR UPDATE OR DELETE ON public.distributor_statements
  FOR EACH ROW EXECUTE FUNCTION public.distributor_statements_transition();

-- 每笔销售 / 退款进了哪份月结。指向作废月结的视为没结算过，重算时会被覆盖。
ALTER TABLE public.distributor_sales
  ADD COLUMN settled_statement_id UUID REFERENCES public.distributor_statements(id) ON DELETE RESTRICT;
CREATE INDEX distributor_sales_settled_idx ON public.distributor_sales(settled_statement_id);

-- 一次事务保存整份月结：月结行、每人余额、分润明细、把这些销售标成已结算。任何一步失败整份回滚。
-- 只给 service_role 用（SECURITY INVOKER，不提权）。
CREATE FUNCTION public.distributor_save_statement(p JSONB) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  sid UUID;
  wanted INTEGER;
  already INTEGER;
  marked INTEGER;
BEGIN
  INSERT INTO public.distributor_statements(period_month, rule_version, total_payable_cents)
  VALUES ((p->>'period_month')::date, p->>'rule_version', (p->>'total_payable_cents')::bigint)
  RETURNING id INTO sid;

  INSERT INTO public.distributor_statement_balances
    (statement_id, distributor_id, opening_cents, period_cents, payout_cents, closing_cents, team_sales_cents, team_rate_bp, team_paid)
  SELECT sid, (b->>'distributor_id')::uuid, (b->>'opening_cents')::bigint, (b->>'period_cents')::bigint,
         (b->>'payout_cents')::bigint, (b->>'closing_cents')::bigint, (b->>'team_sales_cents')::bigint,
         (b->>'team_rate_bp')::integer, (b->>'team_paid')::boolean
    FROM jsonb_array_elements(p->'balances') b;

  INSERT INTO public.distributor_commission_lines (statement_id, distributor_id, kind, sale_id, amount_cents, payable, note)
  SELECT sid, (l->>'distributor_id')::uuid, l->>'kind', NULLIF(l->>'sale_id', '')::uuid,
         (l->>'amount_cents')::bigint, (l->>'payable')::boolean, l->>'note'
    FROM jsonb_array_elements(p->'lines') l;

  SELECT count(*) INTO wanted FROM jsonb_array_elements_text(p->'sale_ids');
  SELECT count(*) INTO already
    FROM public.distributor_sales s JOIN public.distributor_statements st ON st.id = s.settled_statement_id
   WHERE s.id IN (SELECT x::uuid FROM jsonb_array_elements_text(p->'sale_ids') x) AND st.status <> 'voided';
  IF already > 0 THEN
    RAISE EXCEPTION '% sale(s) are already settled in a live statement', already;
  END IF;
  UPDATE public.distributor_sales SET settled_statement_id = sid
   WHERE id IN (SELECT x::uuid FROM jsonb_array_elements_text(p->'sale_ids') x);
  GET DIAGNOSTICS marked = ROW_COUNT;
  IF marked <> wanted THEN
    RAISE EXCEPTION 'statement lists % sale(s) but % exist', wanted, marked;
  END IF;
  RETURN sid;
END $$;

REVOKE ALL ON FUNCTION public.distributor_save_statement(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.distributor_save_statement(JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.distributor_save_statement(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.distributor_sales_refund_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.distributor_statement_children_lock() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.distributor_commission_lines_no_double() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.distributor_statements_transition() FROM PUBLIC;

ALTER TABLE public.distributor_rule_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributors                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_level_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_sales              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_statements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_commission_lines   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.distributor_statement_balances ENABLE ROW LEVEL SECURITY;

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
CREATE POLICY distributor_statement_balances_service_role ON public.distributor_statement_balances
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
