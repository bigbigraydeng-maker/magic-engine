-- ============================================================================
-- Magic Engine 2.0 · Execution Kernel v1  (Issue #859 · ADR-001 / ADR-002 / ADR-004)
--
-- 域无关的执行内核。形状是从 `content_work_orders` 抬上来的（它是仓库里唯一
-- 一个已经跑对过的执行状态机），但**不是复制**：域阶段被赶进 step_key，
-- 通用状态留在 status，16 态收敛成 8 态。逐字段依据见 Issue #859 的
-- DESIGN-SUPPLEMENT-1 §2 extraction matrix。
--
-- 本迁移只**建表**。v1 不接任何 cron、不产生任何客户外部副作用。
-- 🔴 PM 显式 go 之后才 apply，agent 严禁自行 apply_migration。
--
-- 新增：
--   1. client_automation_policies  — 客户级 policy envelope（默认 deny 是「没有行」）
--   2. authorization_decisions     — append-only 授权审计
--   3. action_runs                 — 域无关执行实例
--   4. action_run_steps            — 多步 / 断点续跑 / 重试 / 死信 / 验证
--   5. kernel_claim_run_step()     — 原子认领（照抄 factory_claim_work_order 的形状）
--   6. flywheel_actions.action_run_id — 补上 lineage 的最后一条边（可空，零行为变化）
--   7. kernel_action_lineage       — 一条 SQL 走通 goal → outcome 的视图
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. client_automation_policies —— 客户级 policy envelope
--
-- 🔴 默认 deny 的实现方式是「查不到行 = deny」，不是给 mode 一个默认值。
--    默认值会让「忘了配」和「明确配了自动」在库里长得一样。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.client_automation_policies (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  action_key               text NOT NULL,
  mode                     text NOT NULL CHECK (mode IN ('auto_approve','require_approval','deny')),

  -- 政策版本。改一次 +1；已签发但未消费的授权决策会因此变 stale，必须重新授权。
  policy_version           integer NOT NULL DEFAULT 1,

  -- 花钱信封。NULL = 该动作不许花钱（不是「不限」—— 不限必须显式写一个大数）。
  spend_cap_per_run_usd    numeric,
  -- 🔴 RESERVED · NOT ENFORCED · 不要在设置页把它展示成「已生效的上限」。
  --    周期累计预算还没有任何判定逻辑（v1 只实现了单次上限 spend_cap_per_run_usd）。
  --    列先建好是为了将来不用再来一轮 migration，但在 enforcement 落地之前，
  --    任何 UI 把它显示成安全上限 = 给人一个假的安全感。
  spend_cap_per_period_usd numeric,
  spend_cap_period         text CHECK (spend_cap_period IN ('day','week','month')),

  -- 授权有效期。签发的 decision 最多活这么久，过期必须重走授权。
  decision_ttl_seconds     integer NOT NULL DEFAULT 900 CHECK (decision_ttl_seconds > 0),

  effective_from           timestamptz NOT NULL DEFAULT now(),
  effective_to             timestamptz,

  updated_by               text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT policy_window_sane CHECK (effective_to IS NULL OR effective_to > effective_from),

  -- 🔴 T2c：**上限本身**也得是个真实金额。
  --    NaN 最阴：numeric 的 `x > 'NaN'` 恒假，于是授权时的估算闸、开跑前的硬上限、
  --    事后的兜底断言**同时**失效 —— 整条花钱链路一句话都拦不住。
  --    判据跟 action_run_steps.cost_actual_usd 逐条一致（生产 PG 17.6 实测过：
  --    `'NaN'::numeric >= 0` 是 true，只写 `>= 0` 拦不住它）。
  --    「不限」必须由人显式写一个大数，不能靠 Infinity 这种特殊值悄悄生效。
  CONSTRAINT spend_caps_are_real_amounts CHECK (
    (spend_cap_per_run_usd IS NULL OR (
      spend_cap_per_run_usd >= 0
      AND spend_cap_per_run_usd <> 'NaN'::numeric
      AND spend_cap_per_run_usd <  'Infinity'::numeric))
    AND
    (spend_cap_per_period_usd IS NULL OR (
      spend_cap_per_period_usd >= 0
      AND spend_cap_per_period_usd <> 'NaN'::numeric
      AND spend_cap_per_period_usd <  'Infinity'::numeric))
  ),
  -- 有花费上限就必须说清是哪个周期，反之亦然
  CONSTRAINT policy_period_paired CHECK (
    (spend_cap_per_period_usd IS NULL) = (spend_cap_period IS NULL)
  )
);

-- 同一个客户 + 同一个动作，同一时刻只能有一条**还没过期**的政策。
CREATE UNIQUE INDEX IF NOT EXISTS idx_cap_active
  ON public.client_automation_policies (client_id, action_key)
  WHERE effective_to IS NULL;

ALTER TABLE public.client_automation_policies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测泄露 118 条策略）。
  CREATE POLICY "service_role_full" ON public.client_automation_policies
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1b. 政策版本由数据库强制演进 —— 不靠「改一次记得 +1」
--
-- 🔴 Gateway 的 stale-policy 防护完全建立在「政策一变，policy_version 就变」上：
--    旧的 allow 决策靠版本对不上而失效。如果这条不变量只是注释里的一句约定，
--    那么将来任何一个忘了 bump 的写入方（Settings 页、修数据的脚本、API）
--    都会让「客户刚把自动改成禁止」这件事对已签发的授权**完全没有效果**。
--
--    所以：调用方**不能**决定要不要 bump。授权相关字段一变，数据库自己 +1。
--    授权无关的字段（updated_by 之类）改动不 bump —— 那些不影响任何判定结果。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.client_automation_policies_version_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- 身份字段不许原地改：把一条政策从 A 客户/A 动作改挂到 B，
  -- 等于让所有引用旧版本号的决策悄悄换了适用对象。要换就新建一条。
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
     OR NEW.action_key IS DISTINCT FROM OLD.action_key THEN
    RAISE EXCEPTION
      'client_automation_policies: client_id / action_key are immutable (insert a new policy row instead)';
  END IF;

  IF NEW.mode                     IS DISTINCT FROM OLD.mode
     OR NEW.spend_cap_per_run_usd    IS DISTINCT FROM OLD.spend_cap_per_run_usd
     OR NEW.spend_cap_per_period_usd IS DISTINCT FROM OLD.spend_cap_per_period_usd
     OR NEW.spend_cap_period         IS DISTINCT FROM OLD.spend_cap_period
     OR NEW.decision_ttl_seconds     IS DISTINCT FROM OLD.decision_ttl_seconds
     OR NEW.effective_from           IS DISTINCT FROM OLD.effective_from
     OR NEW.effective_to             IS DISTINCT FROM OLD.effective_to
  THEN
    -- 无视调用方传进来的 policy_version，一律在旧值上 +1
    NEW.policy_version := OLD.policy_version + 1;
  ELSE
    -- 授权相关字段没变 → 版本也不许被手工改动（防止有人靠改版本号
    -- 悄悄让一批已签发的授权失效或复活）
    NEW.policy_version := OLD.policy_version;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_automation_policies_version_guard_trigger
  ON public.client_automation_policies;
CREATE TRIGGER client_automation_policies_version_guard_trigger
  BEFORE UPDATE ON public.client_automation_policies
  FOR EACH ROW EXECUTE FUNCTION public.client_automation_policies_version_guard();


-- ────────────────────────────────────────────────────────────────────────────
-- 2. authorization_decisions —— append-only 授权审计
--
-- 当前 12 张日志表没有一张记「谁授权的、依据哪条政策」。这张补上。
-- append-only 由触发器强制：只允许把 consumed_at 从 NULL 写成一次值，
-- 其余列一律不可改，行不可删。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.authorization_decisions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_run_id          uuid NOT NULL,
  client_id              uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  action_key             text NOT NULL,
  action_version         integer NOT NULL,

  verdict                text NOT NULL CHECK (verdict IN ('allow','require_approval','deny')),
  -- 机器可读的拒绝原因（unknown_action / no_policy / policy_deny / over_cost_cap / ...）
  deny_code              text,
  -- 给人看的一句话，沿用 judgeAutoRun 已确立的风格
  reason                 text NOT NULL,

  -- 判定当时的政策快照 —— 政策后来改了也能复盘「当时凭什么放行」
  policy_snapshot        jsonb NOT NULL DEFAULT '{}',
  -- 🔴 签发依据的**具体那一行**政策。只记版本号不够：
  --    「auto_approve v1 → 删掉 → 重建一条 deny v1」时版本号完全一样，
  --    只有行身份（uuid，删了就再也造不出同一个）能把两条政策分开。
  policy_id              uuid,
  policy_version         integer,

  decided_by             text NOT NULL CHECK (decided_by IN ('policy','human')),
  decided_by_user        text,

  cost_cap_usd           numeric,
  cost_estimate_usd      numeric,
  idempotency_key        text NOT NULL,

  expires_at             timestamptz,
  -- 一次授权只能兑换一次执行。重放同一个 decision 必须失败。
  consumed_at            timestamptz,
  consumed_by            text,

  created_at             timestamptz NOT NULL DEFAULT now(),

  -- 人做的决定必须留下是谁做的；机器做的不许冒充人
  CONSTRAINT decided_by_user_present CHECK (
    (decided_by = 'human') = (decided_by_user IS NOT NULL)
  ),
  -- deny 必须有机器可读的码，allow 不许有
  CONSTRAINT deny_code_matches_verdict CHECK (
    (verdict = 'deny') = (deny_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_authz_run    ON public.authorization_decisions (action_run_id);
CREATE INDEX IF NOT EXISTS idx_authz_client ON public.authorization_decisions (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_authz_verdict ON public.authorization_decisions (verdict, created_at DESC);

ALTER TABLE public.authorization_decisions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.authorization_decisions
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- append-only 强制。审计记录能被改写 = 没有审计。
CREATE OR REPLACE FUNCTION public.authorization_decisions_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'authorization_decisions is append-only: rows cannot be deleted';
  END IF;

  -- 唯一允许的变更：把 consumed_at / consumed_by 从 NULL 写成一次值（兑换授权）
  IF OLD.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'authorization decision % already consumed at %', OLD.id, OLD.consumed_at;
  END IF;

  IF ROW(NEW.id, NEW.action_run_id, NEW.client_id, NEW.action_key, NEW.action_version,
         NEW.verdict, NEW.deny_code, NEW.reason, NEW.policy_snapshot, NEW.policy_id, NEW.policy_version,
         NEW.decided_by, NEW.decided_by_user, NEW.cost_cap_usd, NEW.cost_estimate_usd,
         NEW.idempotency_key, NEW.expires_at, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.action_run_id, OLD.client_id, OLD.action_key, OLD.action_version,
         OLD.verdict, OLD.deny_code, OLD.reason, OLD.policy_snapshot, OLD.policy_id, OLD.policy_version,
         OLD.decided_by, OLD.decided_by_user, OLD.cost_cap_usd, OLD.cost_estimate_usd,
         OLD.idempotency_key, OLD.expires_at, OLD.created_at)
  THEN
    RAISE EXCEPTION 'authorization_decisions is append-only: only consumed_at/consumed_by may be set';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS authorization_decisions_append_only_trigger ON public.authorization_decisions;
CREATE TRIGGER authorization_decisions_append_only_trigger
  BEFORE UPDATE OR DELETE ON public.authorization_decisions
  FOR EACH ROW EXECUTE FUNCTION public.authorization_decisions_append_only();


-- ────────────────────────────────────────────────────────────────────────────
-- 3. action_runs —— 域无关的执行实例
--
-- 状态机（8 态，逐条依据见 Issue #859 §2.3）：
--   queued → authorizing → { authorized | pending_approval | denied }
--            authorized  → running → { succeeded | failed → dead_letter }
--            pending_approval → (人点) → authorized | denied
-- ────────────────────────────────────────────────────────────────────────────
-- 🔴 C4 前置：给 goals 建 (client_id, id) 唯一索引，让下面的复合外键有落点。
--    goals.id 本身就是主键（全表唯一），所以这个索引**不可能因历史数据冲突而失败**。
CREATE UNIQUE INDEX IF NOT EXISTS idx_goals_client_id_id
  ON public.goals (client_id, id);

-- 🔴 S2 前置：execution_items 同理。`execution_items.id` 是 PRIMARY KEY
--    （见 20260513000001_diagnostic_engine.sql:153），全表唯一，
--    所以 (client_id, id) 这个组合**不可能因历史业务行重复而失败**。
CREATE UNIQUE INDEX IF NOT EXISTS idx_execution_items_client_id_id
  ON public.execution_items (client_id, id);

CREATE TABLE IF NOT EXISTS public.action_runs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id                 uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  -- 🔴 goal_id 不是 NOT NULL。仓库已经因为「强制挂 Goal」造过一个假 Goal
  --    （strategy/goals.ts 的 "[Migration] Unassigned Backlog"，每个查询还要把它滤掉）。
  --    维护 / 合规 / 恢复 / 系统卫生这四类任务本来就不服务任何增长目标。
  purpose                   text NOT NULL CHECK (purpose IN
                              ('growth','compliance','maintenance','recovery','housekeeping')),
  goal_id                   uuid,

  -- 双向约束：growth 必须有 Goal；非 growth 挂了 Goal **也拒绝**。
  -- 让「给维护任务伪造 Goal」在数据库层不可能，而不是靠约定。
  CONSTRAINT goal_matches_purpose CHECK ((purpose = 'growth') = (goal_id IS NOT NULL)),

  -- 🔴 C4：Goal 必须属于**同一个客户**。单列 FK 只验证「目标存在」，
  --    拦不住「A 客户的 run 挂 B 客户的目标」—— 那会把 lineage 串台到别的客户身上。
  --    MATCH SIMPLE 语义下 goal_id 为 NULL 时本约束自动放过（非 growth 任务不受影响）。
  --
  -- 🔴 **只保留这一条**外键，且**刻意不写 ON DELETE**（= NO ACTION）。
  --
  --    早先是「列上 ON DELETE SET NULL + 这条复合约束」两条并存 —— 那是个坑：
  --    同一次 DELETE 会排队两个 RI 触发器，触发顺序按约束 OID（= CREATE TABLE 里的
  --    文本顺序）决定。谁先谁后能决定删得掉删不掉，等于把正确性押在书写次序上，
  --    第一次有人 DROP/ADD CONSTRAINT 就静默翻车。
  --
  --    而且 SET NULL 对 growth 的 run **根本不可能成功**：把 goal_id 置空会当场违反
  --    上面那条 goal_matches_purpose（growth 必须有目标）。也就是说旧写法对
  --    「真的引用了目标的 run」两种情况都是报错，只是报的错不一样。
  --
  --    NO ACTION 是诚实的语义：**已经有执行记录的目标删不掉**（要删先归档/搬走记录）。
  --    选 NO ACTION 而不是 RESTRICT，是因为 NO ACTION 推迟到语句结束才查 ——
  --    删客户时 goals 和 action_runs 各自 CASCADE 删掉，语句结束时已经没有引用行，
  --    整条 DELETE 照样成功；RESTRICT 会当场炸。
  CONSTRAINT fk_action_runs_goal_same_client
    FOREIGN KEY (client_id, goal_id) REFERENCES public.goals (client_id, id),

  -- 🔴 S2：执行看板卡片同理。挂错客户的卡片 = 执行按 A 的授权跑，
  --    lineage / 看板关系却挂到 B —— 归因和「这件事为谁做的」当场串台。
  --
  --    跟 goal 一样**只保留这一条**外键（列上不再单独写 REFERENCES）。
  --    区别在删除语义：看板卡片是会被例行删掉的（撤回营销计划会批量删 pending 卡片、
  --    删处方会 CASCADE 过来），而 run 是执行台账 —— 卡片没了台账要留下，
  --    所以这里要 SET NULL，只是**必须带列清单**：`client_id` 是 NOT NULL，
  --    不带列清单的 SET NULL 会去置空它，直接违反非空约束。
  --    列清单形式需要 PG ≥ 15；生产实测是 PostgreSQL 17.6，可用。
  CONSTRAINT fk_action_runs_execution_item_same_client
    FOREIGN KEY (client_id, execution_item_id)
    REFERENCES public.execution_items (client_id, id)
    ON DELETE SET NULL (execution_item_id),

  -- 连回人看的看板（execution_items 继续是意图卡，不是执行引擎）
  execution_item_id         uuid,

  triggered_by              text NOT NULL CHECK (triggered_by IN
                              ('signal','schedule','human','agent','run')),
  triggered_by_ref          text,

  action_key                text NOT NULL,
  action_version            integer NOT NULL,
  input                     jsonb NOT NULL DEFAULT '{}',

  -- 为什么做这件事 + 证据。形状抄自 content_work_orders 的
  -- rationale_one_liner / angle_source，但换掉了内容域的词汇。
  rationale                 text,
  evidence                  jsonb NOT NULL DEFAULT '{}',

  idempotency_key           text NOT NULL,

  status                    text NOT NULL DEFAULT 'queued' CHECK (status IN
                              ('queued','authorizing','authorized','pending_approval',
                               'denied','running','succeeded','failed','dead_letter',
                               'superseded')),

  authorization_decision_id uuid REFERENCES public.authorization_decisions(id) ON DELETE SET NULL,

  -- 贯穿 lineage 的关联号：一次触发可以生出多个 run，它们共享 correlation_id
  correlation_id            uuid NOT NULL DEFAULT gen_random_uuid(),

  -- 🔴 cap 在 run（授权时从 policy 快照下来的信封），actual 在 step（钱是在具体调用上花掉的）
  cost_cap_usd              numeric,
  cost_estimate_usd         numeric,

  -- 未知动作 / 死信 / 需要人判断 —— 必须有人看见，不许死在日志里
  needs_human               boolean NOT NULL DEFAULT false,
  last_error                text,

  -- ── 运行所有权（租约）─────────────────────────────────────────────────
  -- 🔴 T1：「已经有人在做了」必须意味着**真的还有一个没过期的 owner**。
  --
  --    没有这几列的时候：进程在 queued / authorizing / authorized 崩掉，
  --    run 就永远卡在那儿 —— 幂等唯一键让相同请求再也插不进来，
  --    调用方每次只拿到 in_progress，而实际上没有任何人在推进它。
  --    唯一键本来是防重复执行的，结果把这件事**永久锁死**。
  --
  --    字段名沿用 action_run_steps 那套（claimed_by / heartbeat_at / reclaim_count），
  --    仓库里唯一并发正确的那份租约就是这么写的，不另发明一套词。
  claimed_by                text,
  claimed_at                timestamptz,
  heartbeat_at              timestamptz,
  lease_expires_at          timestamptz,
  -- 接管审计：被谁从谁手里接走、接过几次、最后一次什么时候
  previous_claimed_by       text,
  reclaim_count             integer NOT NULL DEFAULT 0,
  last_reclaimed_at         timestamptz,

  -- 🔴 F1：**单调递增的领取代际（fencing token）**。每次「换人」都 +1。
  --
  --    光有 owner 字符串不够。真正危险的时序是：
  --      A 领到租约 → A 卡住 → 租约过期 → B 接管 → **A 醒过来继续写**。
  --    A 手里握着 step_id / run_id / decision_id，这些 id 在接管之后依然有效，
  --    所以「按 id 更新」的每一句都还能写进去 —— 步骤产物、花费、run 终态，
  --    全都会被一个已经没有执行权的进程覆盖掉。
  --
  --    代际让每一次推进性写入都能问一句「我这一代还是当前那一代吗」。
  --    bigint 单调递增 + 只在换人时 +1，所以不存在 ABA：
  --    A 的代际一旦被跳过就永远回不来（哪怕 A 后来又重新领到，那也是更大的一代）。
  claim_generation          bigint NOT NULL DEFAULT 0,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  started_at                timestamptz,
  finished_at               timestamptz
);

-- 幂等：同一个客户 + 同一把幂等键，永远只有一个 run。重放直接撞这个索引。
CREATE UNIQUE INDEX IF NOT EXISTS idx_action_runs_idempotency
  ON public.action_runs (client_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_action_runs_queue  ON public.action_runs (status, created_at);
CREATE INDEX IF NOT EXISTS idx_action_runs_client ON public.action_runs (client_id, status);
CREATE INDEX IF NOT EXISTS idx_action_runs_goal   ON public.action_runs (goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_action_runs_corr   ON public.action_runs (correlation_id);
-- 找「中间态里租约已经过期的 run」——接管的查询走这条
CREATE INDEX IF NOT EXISTS idx_action_runs_lease
  ON public.action_runs (status, lease_expires_at)
  WHERE status IN ('queued','authorizing','authorized');

ALTER TABLE public.action_runs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.action_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- decision 反向指回 run（建表顺序所致，此处补 FK）
DO $$ BEGIN
  ALTER TABLE public.authorization_decisions
    ADD CONSTRAINT fk_authz_action_run
    FOREIGN KEY (action_run_id) REFERENCES public.action_runs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. action_run_steps —— 多步 / 断点续跑 / 重试 / 死信 / 验证
--
-- 域阶段住在 step_key（produce / render / publish / verify …），
-- 通用状态住在 status。这样每接一个新域不用往 run 的枚举里加 3-4 个值。
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.action_run_steps (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id           uuid NOT NULL REFERENCES public.action_runs(id) ON DELETE CASCADE,
  client_id        uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,

  step_key         text NOT NULL,
  step_index       smallint NOT NULL,

  status           text NOT NULL DEFAULT 'pending' CHECK (status IN
                     ('pending','claimed','running','succeeded','failed','dead_letter','skipped')),

  -- 租约式认领（原样提取自 content_work_orders —— 全仓唯一并发正确的那套）
  claimed_by       text,
  claimed_at       timestamptz,
  heartbeat_at     timestamptz,

  -- 🔴 两个计数必须分开：「重试了 N 次」和「被回收了 N 次」是不同的故障信号
  attempt          smallint NOT NULL DEFAULT 0,
  reclaim_count    smallint NOT NULL DEFAULT 0,
  next_attempt_at  timestamptz,

  output           jsonb NOT NULL DEFAULT '{}',
  -- 验证结果（method / passed / checks / 失败原因）—— 验证是一等公民，不是日志
  verification     jsonb,

  cost_actual_usd  numeric NOT NULL DEFAULT 0,
  last_error       text,

  -- 🔴 F1：这一行**属于哪一代执行者**。
  --    步骤写入走 `WHERE id = ? AND claim_generation = ?` —— 过期的执行者
  --    影响 0 行，而不是把接管者的结果覆盖掉。
  --    换人时由 kernel_claim_or_takeover_run / kernel_claim_run_recovery
  --    在**同一个事务**里统一改写这一列。
  claim_generation bigint NOT NULL DEFAULT 0,

  -- 🔴 T3：花掉的钱是**运行时输入**（capability 返回什么就是什么），
  --    TypeScript 的 `number` 拦不住 NaN / Infinity / 负数。
  --    负数最危险：它能把「已花金额」减回来，等于绕开预算上限。
  --
  --    numeric 的三个坑，全部在生产库（PostgreSQL 17.6）实测过，不是照猜：
  --      · `'NaN'::numeric >= 0`            → **true**（`>= 0` 一条根本拦不住 NaN）
  --      · `'NaN'::numeric <> 'NaN'`        → false  （所以 `<> 'NaN'` 能拦住它）
  --      · `'Infinity'::numeric >= 0`       → true   （`< 'Infinity'` 才拦得住）
  --      · `'-Infinity'::numeric >= 0`      → false  （`>= 0` 就拦住了）
  --    numeric 从 PG 14 起支持 ±Infinity，所以这两条都不是理论问题。
  --
  --    应用层也有同一套判据。两层都要：应用层是为了说人话 + 不污染账本，
  --    这一层是为了「绕开应用直接写库」也写不进去。
  CONSTRAINT cost_actual_usd_is_a_real_amount CHECK (
    cost_actual_usd IS NULL
    OR (
      cost_actual_usd >= 0
      AND cost_actual_usd <> 'NaN'::numeric
      AND cost_actual_usd <  'Infinity'::numeric
    )
  ),

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,

  -- 一个 run 里同一个步骤只有一行 —— 断点续跑靠它，不靠「找最新那条」
  CONSTRAINT uq_run_step UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_ars_run    ON public.action_run_steps (run_id, step_index);
CREATE INDEX IF NOT EXISTS idx_ars_claim  ON public.action_run_steps (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_ars_stale  ON public.action_run_steps (heartbeat_at)
  WHERE status IN ('claimed','running');

ALTER TABLE public.action_run_steps ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.action_run_steps
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. kernel_claim_run_step —— 原子认领
--
-- 形状原样提取自 factory_claim_work_order：SECURITY DEFINER + FOR UPDATE SKIP LOCKED，
-- 杜绝「先 SELECT 再 UPDATE」的竞态。p_client_ids 白名单本身就是一个授权维度。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_claim_run_step(
  p_worker_id  text,
  p_client_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (
  ok         boolean,
  step_id    uuid,
  run_id     uuid,
  client_id  uuid,
  step_key   text,
  attempt    smallint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step RECORD;
BEGIN
  SELECT s.id, s.run_id, s.client_id, s.step_key, s.attempt
    INTO v_step
    FROM public.action_run_steps s
    JOIN public.action_runs r ON r.id = s.run_id
   WHERE s.status = 'pending'
     AND (s.next_attempt_at IS NULL OR s.next_attempt_at <= now())
     -- 🔴 只有已经拿到授权的 run 里的步骤才可被认领。
     --    这是「授权在数据库层也是执行的前置条件」，不只是应用层的一个 if。
     AND r.status IN ('authorized','running')
     AND r.authorization_decision_id IS NOT NULL
     AND (p_client_ids IS NULL OR s.client_id = ANY(p_client_ids))
   ORDER BY s.created_at ASC, s.step_index ASC
   FOR UPDATE OF s SKIP LOCKED
   LIMIT 1;

  IF v_step.id IS NULL THEN
    RETURN QUERY SELECT false, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::smallint;
    RETURN;
  END IF;

  UPDATE public.action_run_steps
     SET status       = 'claimed',
         claimed_by   = p_worker_id,
         claimed_at   = now(),
         heartbeat_at = now(),
         attempt      = attempt + 1,
         updated_at   = now()
   WHERE id = v_step.id;

  RETURN QUERY SELECT true, v_step.id, v_step.run_id, v_step.client_id,
                      v_step.step_key, (v_step.attempt + 1)::smallint;
END;
$$;

-- 🔴 SECURITY DEFINER 函数默认把 EXECUTE 授予 anon/authenticated，而 anon key
--    在浏览器 bundle 里 —— 不收口 = 任何人可经 PostgREST 认领执行步骤。
REVOKE EXECUTE ON FUNCTION public.kernel_claim_run_step(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_claim_run_step(text, uuid[]) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5b. kernel_begin_authorized_run —— 原子领取「这个 run 的唯一执行权」
--
-- 🔴 为什么必须是一条 RPC，而不是「先兑换 decision，再把 run 改成 running」：
--    那两句之间存在竞态窗口。更要命的是，一个 run 理论上可能存在**多条** allow
--    决策（比如两个调用方各自签了一份），而「各自原子地兑换各自那一条」
--    并不能阻止两个 capability 同时开跑 —— 兑换的是决策，不是执行权。
--
--    所以这里锁的是 **run**：一个 run 从 authorized 进 running 只可能发生一次，
--    而且只有 `run.authorization_decision_id` 当前指着的那一条决策能兑换。
--    其余决策（哪怕 verdict='allow' 且没被消费过）一律领不到执行权。
--
-- 返回 (ok, reason)。reason 是机器可读的，应用层据此说人话。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_begin_authorized_run(
  p_run_id              uuid,
  p_decision_id         uuid,
  p_worker_id           text,
  -- 🔴 F1：兑换授权也要出示自己那一代。过期的执行者不许把授权用掉 ——
  --    授权一旦被消费就再也签不回来，那是不可逆的。
  p_expected_generation bigint DEFAULT NULL
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      public.action_runs%ROWTYPE;
  v_decision public.authorization_decisions%ROWTYPE;
  v_policy_id      uuid;
  v_policy_version integer;
  v_policy_mode    text;
  v_policy_found   boolean;
BEGIN
  -- ① 先锁 run。谁拿到这把锁，谁才有资格谈执行权。
  SELECT * INTO v_run FROM public.action_runs
   WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found'; RETURN;
  END IF;

  -- ② 再锁决策（顺序固定 run → decision，避免与其他路径互相死锁）
  SELECT * INTO v_decision FROM public.authorization_decisions
   WHERE id = p_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'decision_not_found'; RETURN;
  END IF;

  -- ③ run 必须正好停在「已授权、还没开跑」
  IF v_run.status <> 'authorized' THEN
    RETURN QUERY SELECT false, 'run_not_authorized:' || v_run.status; RETURN;
  END IF;

  -- ③b 🔴 F1 代际闸：只有**当前这一代**的执行者能把授权兑换掉。
  --     状态闸和指针闸都拦不住这一种：接管者把 run 重新推回 authorized、
  --     指针也指向新签的那条决策之后，上一代要是恰好拿着同一条决策的 id
  --     （比如接管发生在它读完之后），状态和指针都能对上 —— 只有代际能分开。
  IF p_expected_generation IS NOT NULL AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text; RETURN;
  END IF;

  -- ④ 🔴 双向绑定：run 当前指着的必须就是这一条决策，且这条决策也必须属于这个 run。
  --    这一条是「同一个 run 的两份 allow 决策只有一份能兑换执行权」的实现。
  IF v_run.authorization_decision_id IS DISTINCT FROM p_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current'; RETURN;
  END IF;
  IF v_decision.action_run_id <> v_run.id THEN
    RETURN QUERY SELECT false, 'decision_run_mismatch'; RETURN;
  END IF;

  -- ⑤ 身份与契约必须逐项对得上
  IF v_decision.client_id <> v_run.client_id THEN
    RETURN QUERY SELECT false, 'cross_client'; RETURN;
  END IF;
  IF v_decision.action_key <> v_run.action_key THEN
    RETURN QUERY SELECT false, 'action_key_mismatch'; RETURN;
  END IF;
  IF v_decision.action_version <> v_run.action_version THEN
    RETURN QUERY SELECT false, 'action_version_mismatch'; RETURN;
  END IF;
  IF v_decision.idempotency_key <> v_run.idempotency_key THEN
    RETURN QUERY SELECT false, 'idempotency_mismatch'; RETURN;
  END IF;

  -- ⑥ 授权本身必须有效
  IF v_decision.verdict <> 'allow' THEN
    RETURN QUERY SELECT false, 'not_allow:' || v_decision.verdict; RETURN;
  END IF;
  IF v_decision.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_consumed'; RETURN;
  END IF;
  IF v_decision.expires_at IS NOT NULL AND v_decision.expires_at <= now() THEN
    RETURN QUERY SELECT false, 'expired'; RETURN;
  END IF;

  -- ⑦ 政策必须还是**签发时那一行、那一版、且模式仍允许这类授权**。
  --    时间窗（C5）：带结束时间但还没到期的政策一样是生效的，
  --    不能用 effective_to IS NULL 把它当成「没有政策」。
  SELECT p.id, p.policy_version, p.mode
    INTO v_policy_id, v_policy_version, v_policy_mode
    FROM public.client_automation_policies p
   WHERE p.client_id = v_run.client_id
     AND p.action_key = v_run.action_key
     AND p.effective_from <= now()
     AND (p.effective_to IS NULL OR p.effective_to > now())
   ORDER BY p.effective_from DESC
   LIMIT 1;
  v_policy_found := FOUND;

  -- 🔴 政策被删掉 ≠ 「没有版本号所以随便过」。没有生效政策 = 不许执行。
  IF NOT v_policy_found THEN
    RETURN QUERY SELECT false, 'no_active_policy'; RETURN;
  END IF;
  -- 🔴 身份（C2）：版本号只在同一行政策内有意义。
  --    「auto v1 → 删掉 → 重建 deny v1」两条版本号一样，只有行 id 分得开。
  IF v_decision.policy_id IS DISTINCT FROM v_policy_id THEN
    RETURN QUERY SELECT false, 'policy_identity_changed'; RETURN;
  END IF;
  IF v_decision.policy_version IS DISTINCT FROM v_policy_version THEN
    RETURN QUERY SELECT false, 'stale_policy_version'; RETURN;
  END IF;
  -- 🔴 模式复核（C2）：机器签的放行只在「现在仍是自动」时有效，
  --    人签的放行只在「现在仍要人审」时有效 —— 模式一换，旧授权作废。
  IF v_decision.decided_by = 'policy' AND v_policy_mode <> 'auto_approve' THEN
    RETURN QUERY SELECT false, 'policy_mode_changed'; RETURN;
  END IF;
  IF v_decision.decided_by = 'human' AND v_policy_mode <> 'require_approval' THEN
    RETURN QUERY SELECT false, 'policy_mode_changed'; RETURN;
  END IF;

  -- ⑧ 一次性完成：兑换授权 + run 进入 running
  UPDATE public.authorization_decisions
     SET consumed_at = now(), consumed_by = p_worker_id
   WHERE id = p_decision_id;

  UPDATE public.action_runs
     SET status     = 'running',
         started_at = COALESCE(started_at, now()),
         last_error = NULL,
         updated_at = now()
   WHERE id = p_run_id;

  RETURN QUERY SELECT true, 'ok';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_begin_authorized_run(uuid, uuid, text, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_begin_authorized_run(uuid, uuid, text, bigint)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5c. kernel_resolve_pending_approval —— 人工批准 / 拒绝的原子状态转换
--
-- 🔴 为什么必须是一条 RPC：两个人（或一次双击）同时批准同一条等审批的 run，
--    两边都能读到旧状态、各签一份放行 —— A 开始执行把 run 推进 running 之后，
--    B 的无条件 update 还能把它拽回 authorized 并换上自己那份决策，
--    然后再领一次执行权 → capability 执行两次。
--    批准和拒绝抢的是**同一把行锁**：谁先锁到 run 谁说了算，输的一方
--    拿到机器可读的原因，绝不覆盖赢家写下的状态。
--
-- 应用层先跑完整 preflight（契约 / 输入 / 用途 / 对外 / 预算）说人话；
-- 这里重查的是 preflight 和提交之间**可能变化的数据库事实**。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_resolve_pending_approval(
  p_run_id              uuid,
  p_pending_decision_id uuid,
  p_resolution          text,     -- 'approve' | 'reject'
  p_resolved_by         text,
  p_reason              text,
  p_policy_snapshot     jsonb DEFAULT '{}',
  p_cost_estimate_usd   numeric DEFAULT NULL
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      public.action_runs%ROWTYPE;
  v_pending  public.authorization_decisions%ROWTYPE;
  v_policy   public.client_automation_policies%ROWTYPE;
  v_new_id   uuid;
  v_cost_cap numeric;
BEGIN
  IF p_resolution NOT IN ('approve','reject') THEN
    RETURN QUERY SELECT false, 'bad_resolution', NULL::uuid; RETURN;
  END IF;

  -- ① 锁 run —— 批准、拒绝、以及并发的另一次批准，全在这把锁上排队
  SELECT * INTO v_run FROM public.action_runs
   WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::uuid; RETURN;
  END IF;

  -- ② 必须**仍然**停在等审批。running / succeeded / denied 一律不许覆盖。
  IF v_run.status <> 'pending_approval' THEN
    RETURN QUERY SELECT false, 'not_pending:' || v_run.status, NULL::uuid; RETURN;
  END IF;

  -- ③ run 当前指着的必须还是这份审批请求（防拿旧页面上的过期请求来批）
  IF v_run.authorization_decision_id IS DISTINCT FROM p_pending_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current', NULL::uuid; RETURN;
  END IF;

  -- ④ 锁住这份审批请求本身，并核对它的身份
  SELECT * INTO v_pending FROM public.authorization_decisions
   WHERE id = p_pending_decision_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'pending_not_found', NULL::uuid; RETURN;
  END IF;
  IF v_pending.action_run_id <> v_run.id THEN
    RETURN QUERY SELECT false, 'pending_run_mismatch', NULL::uuid; RETURN;
  END IF;
  IF v_pending.verdict <> 'require_approval' THEN
    RETURN QUERY SELECT false, 'not_require_approval', NULL::uuid; RETURN;
  END IF;

  IF p_resolution = 'reject' THEN
    -- 拒绝不查政策：政策被删了、变了，人依然有权说「不做」。
    INSERT INTO public.authorization_decisions
      (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
       policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
       cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
    VALUES
      (v_run.id, v_run.client_id, v_run.action_key, v_run.action_version, 'deny',
       'policy_deny', p_reason, p_policy_snapshot, v_pending.policy_id,
       v_pending.policy_version, 'human', p_resolved_by,
       v_run.cost_cap_usd, v_run.cost_estimate_usd, v_run.idempotency_key, NULL)
    RETURNING id INTO v_new_id;

    UPDATE public.action_runs
       SET status = 'denied',
           authorization_decision_id = v_new_id,
           needs_human = false,
           -- 🔴 T1：这是一次**交接**，不是继续推进 —— 把租约清干净。
           --    挂起等审批期间那份租约的 owner 早就走了；不清的话，
           --    真正要来推进的人会被这份僵尸租约挡成「已经有人在做了」。
           claimed_by       = NULL,
           claimed_at       = NULL,
           heartbeat_at     = NULL,
           lease_expires_at = NULL,
           last_error  = p_reason,
           finished_at = now(),
           updated_at  = now()
     WHERE id = v_run.id;

    RETURN QUERY SELECT true, 'rejected', v_new_id; RETURN;
  END IF;

  -- ── approve ────────────────────────────────────────────────────────────
  -- ⑤ 政策三连（跟执行前同一套）：当前生效的那一行必须还是挂起时那一行、
  --    同一版、且模式仍是「要人审」。时间窗口径与 kernel_begin_authorized_run 一致。
  SELECT * INTO v_policy
    FROM public.client_automation_policies p
   WHERE p.client_id = v_run.client_id
     AND p.action_key = v_run.action_key
     AND p.effective_from <= now()
     AND (p.effective_to IS NULL OR p.effective_to > now())
   ORDER BY p.effective_from DESC
   LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'no_active_policy', NULL::uuid; RETURN;
  END IF;
  IF v_policy.id IS DISTINCT FROM v_pending.policy_id THEN
    RETURN QUERY SELECT false, 'policy_identity_changed', NULL::uuid; RETURN;
  END IF;
  IF v_policy.policy_version IS DISTINCT FROM v_pending.policy_version THEN
    RETURN QUERY SELECT false, 'stale_policy_version', NULL::uuid; RETURN;
  END IF;
  IF v_policy.mode <> 'require_approval' THEN
    RETURN QUERY SELECT false, 'policy_mode_changed', NULL::uuid; RETURN;
  END IF;

  -- ⑥ 审批请求描述的必须还是这条 run 本身
  IF v_pending.client_id <> v_run.client_id
     OR v_pending.action_key <> v_run.action_key
     OR v_pending.action_version <> v_run.action_version
     OR v_pending.idempotency_key <> v_run.idempotency_key THEN
    RETURN QUERY SELECT false, 'pending_identity_mismatch', NULL::uuid; RETURN;
  END IF;

  v_cost_cap := COALESCE(v_policy.spend_cap_per_run_usd, 0);

  -- ⑦ 一次性：签人签的放行 + run → authorized + 指向新决策
  INSERT INTO public.authorization_decisions
    (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
     policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
     cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
  VALUES
    (v_run.id, v_run.client_id, v_run.action_key, v_run.action_version, 'allow',
     NULL, p_reason, p_policy_snapshot, v_policy.id, v_policy.policy_version,
     'human', p_resolved_by, v_cost_cap, p_cost_estimate_usd,
     v_run.idempotency_key,
     now() + (v_policy.decision_ttl_seconds * interval '1 second'))
  RETURNING id INTO v_new_id;

  UPDATE public.action_runs
     SET status = 'authorized',
         authorization_decision_id = v_new_id,
         cost_cap_usd = v_cost_cap,
         cost_estimate_usd = p_cost_estimate_usd,
         needs_human = false,
         -- 🔴 T1：批准是一次**交接**。挂起等审批期间留下的那份租约，
         --    它的 owner 早就走了 —— 不清掉的话，真正要来推进这条 run 的人
         --    会被这份僵尸租约挡成「已经有人在做了」，而实际没有任何人在做。
         claimed_by       = NULL,
         claimed_at       = NULL,
         heartbeat_at     = NULL,
         lease_expires_at = NULL,
         updated_at  = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'approved', v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_resolve_pending_approval(uuid, uuid, text, text, text, jsonb, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_resolve_pending_approval(uuid, uuid, text, text, text, jsonb, numeric)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5d. kernel_claim_run_recovery —— 恢复权的原子领取（denied / dead_letter 共用）
--
-- 🔴 跟人工批准是同一类竞态：两个操作者（或双击）都看到 denied/dead_letter，
--    A 抢先恢复并开跑，B 晚到的无条件 update 又把已经 running/succeeded 的 run
--    改回 queued 并再签一份 allow → capability 做第二遍。
--
--    这里锁的是 run：状态必须**仍是**那个可恢复的终态、指针必须**仍是**
--    调用方看到的那条决策，两条同时满足才领得到恢复权。输家拿到机器可读原因。
--
-- 🔴 死信恢复的**步骤重置也在这个事务里**。先 reset steps 再 update run 会留下
--    「步骤已经放回待跑、run 却还是 dead_letter」的半恢复状态；崩在中间就再也说不清了。
--    已经成功的步骤原样保留（断点续跑），**并且不碰 cost_actual_usd** ——
--    历史已花的钱不许因为重跑变小（见 S3）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_claim_run_recovery(
  p_run_id               uuid,
  p_expected_decision_id uuid,
  p_recovery_kind        text,     -- 'denied' | 'dead_letter'
  p_actor                text,
  p_reason               text
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      public.action_runs%ROWTYPE;
  v_decision public.authorization_decisions%ROWTYPE;
  -- 🔴 可恢复的拒绝码白名单。必须跟 runner.ts 的 RECOVERABLE_DENY_CODES 一字不差，
  --    有一条架构测试专门盯着两边不许分家（两处各写一份清单必然分家）。
  v_recoverable text[] := ARRAY[
    'no_policy', 'policy_expired', 'policy_changed_since_request', 'over_cost_cap'
  ];
BEGIN
  IF p_recovery_kind NOT IN ('denied', 'dead_letter') THEN
    RETURN QUERY SELECT false, 'bad_recovery_kind'; RETURN;
  END IF;

  -- ① 锁 run —— 两次恢复、以及恢复与正常执行，全在这把锁上排队
  SELECT * INTO v_run FROM public.action_runs
   WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found'; RETURN;
  END IF;

  -- ② 状态 CAS：必须**仍然**停在那个可恢复的终态。
  --    running / succeeded / 已被别人恢复成 queued 的，一律不许覆盖。
  IF v_run.status <> p_recovery_kind THEN
    RETURN QUERY SELECT false, 'not_recoverable:' || v_run.status; RETURN;
  END IF;

  -- ③ 指针 CAS：run 当前指着的必须还是调用方看到的那条决策
  --    （防拿旧页面 / 旧快照上的过期决策来恢复）
  IF v_run.authorization_decision_id IS DISTINCT FROM p_expected_decision_id THEN
    RETURN QUERY SELECT false, 'decision_not_current'; RETURN;
  END IF;

  IF p_expected_decision_id IS NOT NULL THEN
    SELECT * INTO v_decision FROM public.authorization_decisions
     WHERE id = p_expected_decision_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN QUERY SELECT false, 'decision_not_found'; RETURN;
    END IF;
    IF v_decision.action_run_id <> v_run.id THEN
      RETURN QUERY SELECT false, 'decision_run_mismatch'; RETURN;
    END IF;
  END IF;

  -- ④ denied 恢复：只能恢复**机器**因环境问题拒掉的那几种。
  IF p_recovery_kind = 'denied' THEN
    IF p_expected_decision_id IS NULL THEN
      RETURN QUERY SELECT false, 'deny_decision_missing'; RETURN;
    END IF;
    IF v_decision.verdict <> 'deny' THEN
      RETURN QUERY SELECT false, 'not_a_deny'; RETURN;
    END IF;
    -- 🔴 人明确点过「不做」的永远不可恢复 —— 系统不替人改主意
    IF v_decision.decided_by = 'human' THEN
      RETURN QUERY SELECT false, 'human_reject_not_recoverable'; RETURN;
    END IF;
    IF v_decision.deny_code IS NULL OR NOT (v_decision.deny_code = ANY(v_recoverable)) THEN
      RETURN QUERY SELECT false,
        'deny_code_not_recoverable:' || COALESCE(v_decision.deny_code, 'null'); RETURN;
    END IF;
  END IF;

  -- ⑤ 步骤重置与状态转换在**同一个事务**里。
  --    只碰没跑成的那些；cost_actual_usd / output / verification 一概不动。
  -- 🔴 F1：恢复同样是**换人**，代际必须 +1 并推到所有步骤上。
  --    不推的话，恢复之前那个执行者醒过来还能拿着旧 step_id 写进来。
  --    已成功的步骤也要推代际（否则旧执行者能把它改回失败），
  --    但它们的 status / output / cost 一概不动。
  UPDATE public.action_run_steps
     SET status          = CASE WHEN status <> 'succeeded' THEN 'pending' ELSE status END,
         last_error      = CASE WHEN status <> 'succeeded' THEN NULL ELSE last_error END,
         next_attempt_at = CASE WHEN status <> 'succeeded' THEN NULL ELSE next_attempt_at END,
         finished_at     = CASE WHEN status <> 'succeeded' THEN NULL ELSE finished_at END,
         claim_generation = v_run.claim_generation + 1,
         updated_at      = now()
   WHERE run_id = v_run.id;

  UPDATE public.action_runs
     SET status = 'queued',
         authorization_decision_id = NULL,
         needs_human = false,
         last_error  = NULL,
         finished_at = NULL,
         -- 🔴 T1：放回 queued 的同时**把租约清干净**。
         --    恢复只是把这件事重新变成「可做」，并不代表恢复的那个进程
         --    一定能活到把它跑完 —— 恢复提交之后、重新授权之前崩掉，
         --    留着旧 owner 会让这条 run 再也没人接得走。
         --    清空之后它就是一条无主的 queued，谁先领租约谁推进。
         claimed_by       = NULL,
         claimed_at       = NULL,
         heartbeat_at     = NULL,
         lease_expires_at = NULL,
         -- 🔴 F1：恢复是**换人**，代际必须 +1（上面已经把它推到所有步骤上了）。
         --    不换代的话，恢复之前那个执行者醒过来还能继续写。
         claim_generation = claim_generation + 1,
         evidence = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
           'last_recovered_by',        p_actor,
           'last_recovered_at',        to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'recovery_reason',          p_reason,
           'recovery_kind',            p_recovery_kind,
           'recovered_from_deny_code', COALESCE(v_decision.deny_code, NULL)
         ),
         updated_at = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'claimed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_claim_run_recovery(uuid, uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_claim_run_recovery(uuid, uuid, text, text, text)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5e. kernel_claim_or_takeover_run —— 中间态 run 的运行所有权（租约 + 接管）
--
-- 🔴 要解决的问题：进程在真正执行之前崩掉。
--
--    run 已经落库成 queued / authorizing / authorized，但没有任何人在推进它。
--    相同业务请求再来一次，撞上 `UNIQUE(client_id, idempotency_key)`，
--    拿回同一条 run —— 于是调用方永远只得到「已经有人在做了」。
--    没有 worker、没有清扫器，幂等唯一键反而把这件事**永久锁死**。
--
--    所以「已经有人在做了」这句话必须有实质：**当前真的存在一个没过期的 owner**。
--    否则必须允许显式接管。
--
-- 🔴 为什么必须是一条 RPC 而不是「读一下再 update」：
--    两个调用方可以同时读到「租约已过期 / 无主」，然后各自把自己写成 owner，
--    再各自去授权 —— 同一条 run 出现两份 allow 决策、两个执行者。
--    这里锁的是 run 本身：一次只有一个人能把 owner 换成自己。
--
-- 🔴 只有**中间态**可以接管。succeeded / denied / dead_letter / running
--    一律不许 —— 前三个是终态（要动它们走 recovery 那条显式路径），
--    running 说明执行权已经被 kernel_begin_authorized_run 原子领走了，
--    接管它等于让 capability 跑第二遍。
--
-- 返回 run_status 和 decision_id 是给调用方判断**接下来怎么走**：
--    · authorized + 一份没被消费的 allow → 直接复用那份授权，**不要重新签**
--    · queued / authorizing               → 重新进授权（此时租约保证只有一个人在签）
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_claim_or_takeover_run(
  p_run_id              uuid,
  p_owner_id            text,
  p_lease_seconds       integer,
  -- 续租 / 再进一次时带上自己那一代。带了就必须对得上（防「旧调用复活」）；
  -- 第一次领取时不知道代际，传 NULL。
  p_expected_generation bigint DEFAULT NULL
)
RETURNS TABLE (
  ok               boolean,
  reason           text,
  run_status       text,
  decision_id      uuid,
  reclaimed        boolean,
  reclaim_count    integer,
  claim_generation bigint,
  reset_steps      boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run        public.action_runs%ROWTYPE;
  v_reclaimed  boolean := false;
  v_prev_owner text;
  v_next_gen   bigint;
  v_was_running boolean := false;
  v_status_out text;
  v_decision_out uuid;
BEGIN
  IF p_owner_id IS NULL OR length(btrim(p_owner_id)) = 0 THEN
    RETURN QUERY SELECT false, 'owner_required', NULL::text, NULL::uuid, false, 0, NULL::bigint, false; RETURN;
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 THEN
    RETURN QUERY SELECT false, 'lease_seconds_required', NULL::text, NULL::uuid, false, 0, NULL::bigint, false; RETURN;
  END IF;

  -- ① 锁住这一行。后面每一句都在这把锁之内。
  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::text, NULL::uuid, false, 0, NULL::bigint, false; RETURN;
  END IF;

  -- ② 状态白名单。
  --    🔴 `running` **也在里面**，但只有租约过期时才轮得到（见 ③）。
  --    早先把 running 一律排除是个更糟的洞：执行者崩在半路，这条 run
  --    就永远停在 running，没有任何人能接手，调用方永远只拿到 in_progress ——
  --    正是租约要修的那个「幂等键把这件事永久锁死」，只是换了个状态待着。
  IF v_run.status NOT IN ('queued','authorizing','authorized','running') THEN
    RETURN QUERY SELECT false, 'not_claimable:' || v_run.status,
                        v_run.status, v_run.authorization_decision_id, false,
                        v_run.reclaim_count, v_run.claim_generation, false;
    RETURN;
  END IF;

  -- ②b 代际 CAS（可选）：带了 expected 就必须还是那一代。
  --     防的是「旧调用复活之后拿着过期的代际来续租」——
  --     它一旦成功就会把租约续到未来，把真正的 owner 挡在门外。
  IF p_expected_generation IS NOT NULL AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text,
                        v_run.status, v_run.authorization_decision_id, false,
                        v_run.reclaim_count, v_run.claim_generation, false;
    RETURN;
  END IF;

  -- ③ 租约还活着，而且不是自己的 → 抢不走。
  --    这就是「in_progress」唯一有资格出现的场景。
  --    `running` 且租约还活着 → 同样抢不走（真的有人在跑）。
  IF v_run.claimed_by IS NOT NULL
     AND v_run.lease_expires_at IS NOT NULL
     AND v_run.lease_expires_at > now()
     AND v_run.claimed_by <> p_owner_id THEN
    RETURN QUERY SELECT false, 'already_owned:' || v_run.claimed_by,
                        v_run.status, v_run.authorization_decision_id, false,
                        v_run.reclaim_count, v_run.claim_generation, false;
    RETURN;
  END IF;

  -- ③b `running` 的租约必须**真的过期**才能接管。无主的 running（lease 为空）
  --     也算可接管 —— 那是老数据或异常写入，留着同样没人推得动。
  --     但同一个 owner 自己「再进一次」不算接管，直接续租即可。
  v_was_running := (v_run.status = 'running' AND v_run.claimed_by IS DISTINCT FROM p_owner_id);

  -- ④ 无主 / 租约过期 / 自己续租 → 原子写下新 owner。
  --    「从别人手里接走」才算 reclaim，自己续租不算 —— 两者是不同的故障信号。
  v_prev_owner := v_run.claimed_by;
  v_reclaimed  := (v_prev_owner IS NOT NULL AND v_prev_owner <> p_owner_id);

  -- 🔴 代际只在**换人**时 +1。自己续租保持原值 ——
  --    否则续租会把自己手里那一代作废，等于自己把自己 fence 掉。
  v_next_gen := v_run.claim_generation + CASE WHEN v_prev_owner IS DISTINCT FROM p_owner_id THEN 1 ELSE 0 END;

  -- ⑤ 接管一个 running 的 run = 把它放回可重新授权的状态。
  --    授权已经被上一代兑换掉了（append-only，改不了），所以必须重新签一份；
  --    没跑成的步骤放回待跑，**已成功的原样保留、cost_actual_usd 一概不碰**。
  --    这跟 kernel_claim_run_recovery 是同一套语义，只是触发方式不同。
  IF v_was_running THEN
    UPDATE public.action_run_steps
       SET status           = 'pending',
           last_error       = NULL,
           next_attempt_at  = NULL,
           finished_at      = NULL,
           claim_generation = v_next_gen,
           updated_at       = now()
     WHERE run_id = v_run.id
       AND status <> 'succeeded';
  END IF;

  -- 🔴 不管是不是 running，只要换了人就得把**所有**步骤的代际推上去 ——
  --    上一代握着的 step_id 从这一刻起写不进任何一行。
  --    （已成功的步骤也要推，否则旧执行者还能把它改回失败。）
  IF v_next_gen <> v_run.claim_generation THEN
    UPDATE public.action_run_steps
       SET claim_generation = v_next_gen,
           updated_at       = now()
     WHERE run_id = v_run.id;
  END IF;

  v_status_out   := CASE WHEN v_was_running THEN 'queued' ELSE v_run.status END;
  v_decision_out := CASE WHEN v_was_running THEN NULL ELSE v_run.authorization_decision_id END;

  UPDATE public.action_runs
     SET status              = v_status_out,
         authorization_decision_id = v_decision_out,
         claimed_by          = p_owner_id,
         claimed_at          = now(),
         heartbeat_at        = now(),
         lease_expires_at    = now() + make_interval(secs => p_lease_seconds),
         claim_generation    = v_next_gen,
         previous_claimed_by = CASE WHEN v_reclaimed THEN v_prev_owner ELSE previous_claimed_by END,
         reclaim_count       = reclaim_count + CASE WHEN v_reclaimed THEN 1 ELSE 0 END,
         last_reclaimed_at   = CASE WHEN v_reclaimed THEN now() ELSE last_reclaimed_at END,
         -- 接管一个 running 的 run 意味着上一次执行没跑完，得让人看得见
         needs_human         = CASE WHEN v_was_running THEN needs_human ELSE needs_human END,
         evidence            = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
           'last_claimed_by', p_owner_id,
           'last_claimed_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'last_claim_generation', v_next_gen,
           'last_takeover_from', CASE WHEN v_reclaimed THEN to_jsonb(v_prev_owner) ELSE 'null'::jsonb END,
           'took_over_running', v_was_running
         ),
         updated_at          = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true,
                      CASE WHEN v_reclaimed THEN 'taken_over' ELSE 'claimed' END,
                      v_status_out,
                      v_decision_out,
                      v_reclaimed,
                      v_run.reclaim_count + CASE WHEN v_reclaimed THEN 1 ELSE 0 END,
                      v_next_gen,
                      v_was_running;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_claim_or_takeover_run(uuid, text, integer, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_claim_or_takeover_run(uuid, text, integer, bigint)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5f. kernel_record_fenced_deny —— 落一条拒绝 + 推 run 状态，两件事一个事务
--
-- 🔴 为什么不能「先插决策、再 update run」：
--    授权前置校验（preflight）要读政策、读注册表，是有耗时的。A 卡在那儿的时候
--    租约可能已经过期、B 已经接管并把这件事跑完了。A 醒过来接着落拒绝 ——
--    无条件的 update 会把 succeeded 改成 denied，**当场毁掉一次已经成功的执行**。
--
--    先插后判还会留下孤立的 deny 决策（run 状态没跟着变，审计表里多一条
--    说不清归属的记录）。所以插入之前就在锁里把代际验掉。
--
-- p_expected_generation 为 NULL = 调用方没有围栏（直接调 authorizeRun 的测试路径）。
-- p_expected_status     为 NULL = 不要求 run 停在某个特定状态。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_record_fenced_deny(
  p_run_id              uuid,
  p_expected_generation bigint,
  p_expected_status     text,
  p_decision            jsonb,
  p_reason              text
)
RETURNS TABLE (ok boolean, reason text, decision_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run    public.action_runs%ROWTYPE;
  v_new_id uuid;
BEGIN
  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', NULL::uuid; RETURN;
  END IF;

  -- 🔴 代际闸：过期的执行者不许把别人已经推进的 run 写成 denied。
  IF p_expected_generation IS NOT NULL
     AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text, NULL::uuid;
    RETURN;
  END IF;

  -- 🔴 跨客户：决策必须属于这条 run 的客户，否则会往审计表里写一条串台的记录。
  --    kernel_ensure_run_steps 有这道闸，这里以前没有 —— 同一类漏洞要一起堵。
  IF (p_decision->>'client_id')::uuid IS DISTINCT FROM v_run.client_id THEN
    RETURN QUERY SELECT false, 'cross_client', NULL::uuid; RETURN;
  END IF;

  -- 状态闸（人工批准失败落地用）：只在仍停在那个状态时才写。
  IF p_expected_status IS NOT NULL AND v_run.status <> p_expected_status THEN
    RETURN QUERY SELECT false, 'not_' || p_expected_status || ':' || v_run.status, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.authorization_decisions
    (action_run_id, client_id, action_key, action_version, verdict, deny_code, reason,
     policy_snapshot, policy_id, policy_version, decided_by, decided_by_user,
     cost_cap_usd, cost_estimate_usd, idempotency_key, expires_at)
  VALUES
    (v_run.id,
     (p_decision->>'client_id')::uuid,
     p_decision->>'action_key',
     (p_decision->>'action_version')::integer,
     'deny',
     p_decision->>'deny_code',
     p_reason,
     COALESCE(p_decision->'policy_snapshot', '{}'::jsonb),
     NULLIF(p_decision->>'policy_id','')::uuid,
     NULLIF(p_decision->>'policy_version','')::integer,
     COALESCE(p_decision->>'decided_by','policy'),
     NULLIF(p_decision->>'decided_by_user',''),
     NULLIF(p_decision->>'cost_cap_usd','')::numeric,
     NULLIF(p_decision->>'cost_estimate_usd','')::numeric,
     p_decision->>'idempotency_key',
     NULL)
  RETURNING id INTO v_new_id;

  UPDATE public.action_runs
     SET status = 'denied',
         authorization_decision_id = v_new_id,
         needs_human = true,
         last_error  = p_reason,
         finished_at = now(),
         updated_at  = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'denied', v_new_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5h. kernel_park_for_human —— 把一条 run 原子地停到「等人处理」的终态
--
-- 🔴 为什么必须落库，而不是「返回一个 dead_letter 就完事」：
--
--    接管一条**正在跑**的付费 run 时（上一个执行者崩在 handler 中途），
--    如果 provider 不保证幂等重放，我们不敢自动重跑。但领取 RPC 这时**已经**
--    把 run 重置成 queued + 写了新租约 —— 只在内存里返回一个 dead_letter，
--    数据库里那条 run 仍然是「可以继续自动推进」的样子：
--    等这次的租约一过期，下一次同幂等键提交就会从 queued 重新授权、再调一次 handler。
--    也就是说那道安全闸是**装饰性**的，钱照样可能被扣第二次。
--
--    所以必须在**当前这一代**的围栏下，原子地把它钉死：
--      · status = dead_letter（终态，接管 RPC 的白名单里没有它 → 不可再被自动接管）
--      · needs_human = true（进今日待办，不许死在日志里）
--      · 租约清空（不留一个还能被自动推进的 owner）
--    之后只能走**显式的人工恢复**（kernel_claim_run_recovery）回到 queued。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_park_for_human(
  p_run_id              uuid,
  p_expected_generation bigint,
  p_reason              text,
  p_evidence_key        text DEFAULT 'parked_for_human'
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.action_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found'; RETURN;
  END IF;

  -- 🔴 代际围栏：过期的执行者不许把新 owner 正在推进的 run 钉成终态
  IF p_expected_generation IS NOT NULL
     AND v_run.claim_generation IS DISTINCT FROM p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text; RETURN;
  END IF;

  UPDATE public.action_runs
     SET status           = 'dead_letter',
         needs_human      = true,
         last_error       = p_reason,
         finished_at      = now(),
         -- 租约清空：不留一个「还能被自动推进」的 owner。
         -- dead_letter 不在接管白名单里，所以只能走显式人工恢复。
         claimed_by       = NULL,
         claimed_at       = NULL,
         heartbeat_at     = NULL,
         lease_expires_at = NULL,
         evidence         = COALESCE(evidence, '{}'::jsonb) || jsonb_build_object(
           p_evidence_key, jsonb_build_object(
             'reason',       p_reason,
             'at',           to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
             'generation',   v_run.claim_generation,
             'previous_status', v_run.status
           )
         ),
         updated_at       = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'parked';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_park_for_human(uuid, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_park_for_human(uuid, bigint, text, text)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5i. kernel_renew_lease —— handler 跑着的时候按 owner + 代际续租
--
-- 🔴 为什么代际围栏替代不了续租：
--    围栏能拦住旧 owner **回写**，拦不住它**已经做出去的业务写入**。
--    一个跑得比租约还久的 handler（默认 300 秒），会在自己还在跑的时候
--    被第二代接管并**再调一遍** —— 两代各自真的调了一次外部服务。
--    所以正确做法是：只要我还活着、还握着这一代，就把租约往后推。
--
-- 四项 CAS，缺一不可：run 存在 · owner 还是我 · 代际还是我这一代 · 状态还是 running。
-- 任何一项不成立 → 我已经失去了执行权（lost claim），调用方必须当场停手，
-- **不许再把执行结果当自己的提交**。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_renew_lease(
  p_run_id              uuid,
  p_owner_id            text,
  p_expected_generation bigint,
  p_lease_seconds       integer
)
RETURNS TABLE (ok boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run public.action_runs%ROWTYPE;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds <= 0 THEN
    RETURN QUERY SELECT false, 'lease_seconds_required'; RETURN;
  END IF;

  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found'; RETURN;
  END IF;

  IF v_run.claimed_by IS DISTINCT FROM p_owner_id THEN
    RETURN QUERY SELECT false, 'not_owner:' || COALESCE(v_run.claimed_by, '<none>'); RETURN;
  END IF;
  IF v_run.claim_generation IS DISTINCT FROM p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text; RETURN;
  END IF;
  -- 只有真的在跑才续。已经被推成别的状态 = 这次执行已经不算数了。
  IF v_run.status <> 'running' THEN
    RETURN QUERY SELECT false, 'not_running:' || v_run.status; RETURN;
  END IF;

  UPDATE public.action_runs
     SET lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         heartbeat_at     = now(),
         updated_at       = now()
   WHERE id = v_run.id;

  RETURN QUERY SELECT true, 'renewed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_renew_lease(uuid, text, bigint, integer)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_renew_lease(uuid, text, bigint, integer)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 5j. 业务副作用的数据库级幂等兜底
--
-- 🔴 续租把「被接管」的窗口压到很小，但压不到零（进程真死了就是会被接管）。
--    所以**每个 capability 的业务写入本身也要有数据库级的唯一身份**，
--    不能只靠「先 SELECT 再 INSERT」—— 那两句之间就是竞态窗口，
--    两代执行者可以各插一条。
--
--    v1 唯一上线的能力写 `production_packages`，它的自然唯一身份是
--    「哪一条 run 的哪一步产出的」。用**部分**唯一索引：
--      · 只约束带 `kernel_run_id` 的行（即执行内核造的），
--        现有历史数据一行都不带这个键 → 不可能因为历史数据建不上；
--      · 人工 / 其它管道造的包完全不受影响。
-- ────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_packages_kernel_run
  ON public.production_packages ((source_payload->>'kernel_run_id'))
  WHERE source_payload->>'kernel_run_id' IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 5g. kernel_ensure_run_steps —— 建步骤也要过代际闸
--
-- 🔴 少了这一道就有一个窗口：A 已经拿到授权，卡在建步骤之前，租约过期，
--    B 接管（代际 +1）。A 醒过来仍然能 INSERT 一批**带旧代际**的步骤行 ——
--    而步骤写入的守卫只看 step 自己那一列，于是 A 拿着自己造的行继续调 handler。
--    等于绕过了整套 fencing。
--
--    所以建步骤必须在锁里验代际，并且**用 run 当前的代际**写进去。
--    顺带把已存在步骤的代际也拉齐（接管时应该已经拉过，这里是第二道保险）。
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kernel_ensure_run_steps(
  p_run_id              uuid,
  p_client_id           uuid,
  p_step_keys           text[],
  p_expected_generation bigint
)
RETURNS TABLE (ok boolean, reason text, created integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run     public.action_runs%ROWTYPE;
  v_created integer := 0;
  v_idx     integer;
BEGIN
  SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'run_not_found', 0; RETURN;
  END IF;
  IF v_run.client_id <> p_client_id THEN
    RETURN QUERY SELECT false, 'cross_client', 0; RETURN;
  END IF;
  IF p_expected_generation IS NOT NULL
     AND v_run.claim_generation <> p_expected_generation THEN
    RETURN QUERY SELECT false, 'stale_generation:' || v_run.claim_generation::text, 0; RETURN;
  END IF;

  FOR v_idx IN 1 .. COALESCE(array_length(p_step_keys, 1), 0) LOOP
    INSERT INTO public.action_run_steps
      (run_id, client_id, step_key, step_index, status, claim_generation)
    VALUES
      (v_run.id, v_run.client_id, p_step_keys[v_idx], v_idx - 1, 'pending', v_run.claim_generation)
    ON CONFLICT (run_id, step_key) DO NOTHING;
    IF FOUND THEN v_created := v_created + 1; END IF;
  END LOOP;

  -- 已存在的步骤也拉齐到当前代际（接管时已经拉过，这里是第二道保险）
  UPDATE public.action_run_steps
     SET claim_generation = v_run.claim_generation,
         updated_at       = now()
   WHERE run_id = v_run.id
     AND claim_generation <> v_run.claim_generation;

  RETURN QUERY SELECT true, 'ok', v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.kernel_ensure_run_steps(uuid, uuid, text[], bigint)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.kernel_ensure_run_steps(uuid, uuid, text[], bigint)
  TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 6. flywheel_actions.action_run_id —— 补上 lineage 的最后一条边
--
-- 可空、无默认值、无触发器：对现有归因作业**零行为变化**。
-- 现有的 flywheel_actions.execution_item_id 保留不动。
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.flywheel_actions
  ADD COLUMN IF NOT EXISTS action_run_id uuid REFERENCES public.action_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_flywheel_actions_run
  ON public.flywheel_actions (action_run_id) WHERE action_run_id IS NOT NULL;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. kernel_action_lineage —— 一条 SQL 走通
--    goal → action_run → authorization_decision → step → verification → outcome
--
-- 审计里记着：问「上周那篇文章现在到哪一步了」要人手拼 5 张表。这条视图是答案。
-- ────────────────────────────────────────────────────────────────────────────
-- 🔴 security_invoker（C1）：视图按**调用者**的权限读底表，而不是按 owner。
--    没有它，anon/authenticated 可能借视图 owner 的身份越过底表 RLS，
--    把跨客户的目标、授权理由、操作人、步骤产物一锅端走。
CREATE OR REPLACE VIEW public.kernel_action_lineage
WITH (security_invoker = true) AS
SELECT
  r.id                       AS run_id,
  r.client_id,
  r.correlation_id,
  r.purpose,
  r.goal_id,
  g.title                    AS goal_title,
  r.execution_item_id,
  r.triggered_by,
  r.triggered_by_ref,
  r.action_key,
  r.action_version,
  r.status                   AS run_status,
  r.cost_cap_usd,
  d.id                       AS authorization_decision_id,
  d.verdict                  AS authorization_verdict,
  d.reason                   AS authorization_reason,
  d.decided_by,
  d.decided_by_user,
  d.policy_version,
  d.consumed_at              AS authorization_consumed_at,
  s.id                       AS step_id,
  s.step_key,
  s.step_index,
  s.status                   AS step_status,
  s.attempt                  AS step_attempt,
  s.cost_actual_usd          AS step_cost_actual_usd,
  s.verification             AS step_verification,
  s.output                   AS step_output,
  fa.id                      AS flywheel_action_id,
  fo.id                      AS outcome_id,
  fo.verdict                 AS outcome_verdict
FROM public.action_runs r
LEFT JOIN public.goals                    g  ON g.id  = r.goal_id
LEFT JOIN public.authorization_decisions  d  ON d.id  = r.authorization_decision_id
LEFT JOIN public.action_run_steps         s  ON s.run_id = r.id
LEFT JOIN public.flywheel_actions         fa ON fa.action_run_id = r.id
LEFT JOIN public.flywheel_outcomes        fo ON fo.action_id = fa.id;

-- 🔴 视图权限双保险（C1）：security_invoker 之外再显式收口 ——
--    不依赖「底表 RLS 恰好都配对了」这一层运气。
REVOKE ALL ON public.kernel_action_lineage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.kernel_action_lineage TO service_role;
