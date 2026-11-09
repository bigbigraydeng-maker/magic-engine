-- ============================================================================
-- Magic Engine · 成交/咨询回写外部广告平台 v1（Issue #1397）
--
-- ⚠️ **本文件只提交代码与测试，尚未 apply。** apply 是单独授权的运维动作，
--    绝不夹带进任何 PR（CLAUDE.md 铁律 2 的不可逆操作例外）。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 这两张表为什么必须拆开（子牙 v2 复审 BLOCK-2）
-- ────────────────────────────────────────────────────────────────────────────
--
--   me_sale_outcomes        —— **事实**：这个客人在这一天付了这么多钱 / 来问过一次。
--                              与"发给谁"无关。L1 平台原语，挂既有 Attribution & Flywheel。
--   me_conversion_writebacks —— **每个目的地各自的发送状态**。
--
-- 合成一张的话，同一笔成交要同时发 Meta + Google + TikTok 时，
-- status / attempts / receipt / last_error 全部冲突 —— 它们本来就是 per-destination 的。
-- 今天只有 'meta_capi' 一种，但契约现在就立好，第二个目的地进来不用改数据模型。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 状态机（魏征三轮复审的核心产物；异步队列砍掉后保留的部分）
-- ────────────────────────────────────────────────────────────────────────────
--
--   queued → sending → confirmed | expired_no_send | failed_permanent | in_doubt
--            ↑    ↓
--            └─ failed（限流/5xx 退避后重来）
--
-- 🔴 **终态**：confirmed · failed_permanent · expired_no_send · redacted · dry_run · in_doubt
--    任何自动路径的 UPDATE 都必须写 `AND status = ANY(<期望的起始状态>)`（CAS）。
--    只有 rowCount=1 才算迁移成功；=0 表示别人已经改过，本次放弃并读回真值。
--    应用层"先读再写"必然有窗口，只有数据库的条件更新才拦得住并发。
--
-- 🔴 **in_doubt = "不知道 Meta 收没收"**。自动路径永不重发。
--    Meta 的 Conversions API **服务端事件之间没有去重**（官方原文：
--    "If you send us two consecutive server events with the same information,
--     we do not discard either."），且**没有删除端点** —— 重发一次就是
--    永久多记一笔成交，撤不回。PM 2026-09-05 明令："定金算成交，坚决不能记成 2 笔。"
--    所以宁可停下来让人去 Events Manager 核对，也不赌。
--
-- 🔴 **post_started_at**：发 HTTP 之前先把它从 NULL 抢成 now()，抢不到就不发。
--    挡的是"同一条被发两次"：按钮连点、请求重试、进程崩了重来，都靠这一列拦住。
--    DB 写必须在 HTTP 之前 —— 反过来就等于先发了再记账，中间那一瞬崩掉就会重发。
--
-- ────────────────────────────────────────────────────────────────────────────
-- 刻意**没有**的东西（PM 2026-09-05 审"有没有过度开发"后砍掉）
-- ────────────────────────────────────────────────────────────────────────────
--
-- · 熔断表：同步发送下，令牌坏了就是那一次操作报个错，不会有队列反复重试刷屏。
-- · 独立的 opt-out 名单表：`contacts.do_not_contact` 已经是同一件事，够用。
-- · 异步队列：CTS 平均一天不到 6 条（每周 1-2 笔成交 + 10-40 个咨询），
--   一个请求同步发完即可。队列的重放语义反而是双发 bug 的主要来源。
--
-- 需要时再加。表结构留在这里的只有"以后拆代价大 10 倍"的那部分（见上面两张表的拆分理由）。
-- ============================================================================


-- ── 事实表 ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.me_sale_outcomes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid        NOT NULL REFERENCES public.clients(id),
  -- 关联到统一联系人（可空：手工录入时可能还没建联系人）。
  -- 🔴 contacts 已有 do_not_contact 列 —— 审核放行前必须查，见 §自验 3。
  contact_id       uuid        REFERENCES public.contacts(id),

  -- purchase = 收到定金（PM 定义：收到定金即真实用户，与出发日无关）
  -- balance  = 尾款到账（发自定义事件 BalancePaid，**不计入 Meta 成交数**）
  -- lead     = 有效咨询（对话过或邮件过即 qualified，无金额）
  outcome_kind     text        NOT NULL CHECK (outcome_kind IN ('purchase','balance','lead')),

  -- 客户身份（明文；PM 2026-09-05 拍板暂不做列级加密，靠 RLS + 审计日志）。
  -- 哈希只在发送前于内存中做，不落盘。
  customer_email   text,
  customer_phone   text,
  customer_first   text,
  customer_last    text,

  order_ref        text,                   -- CTS 内部单号，如 '84191'
  amount_minor     bigint,                 -- 分/仙，避开浮点；lead 为 NULL
  currency         text,
  occurred_at      timestamptz NOT NULL,   -- 到账日 / 首次接触日（**不是**出发日）

  -- 人工审核闸（撤不回的动作，前 30 天 100% 人工过）
  review_status    text        NOT NULL DEFAULT 'pending_review'
                   CHECK (review_status IN ('pending_review','approved','rejected')),
  reviewed_by      text,
  reviewed_at      timestamptz,
  reviewed_ip      inet,                   -- 只有 reviewed_by 邮箱不够：会话被劫也是同一个邮箱
  reviewed_ua      text,
  review_request_id uuid,
  reject_reason    text        CHECK (reject_reason IS NULL OR reject_reason IN
                                ('customer_opted_out','not_real_sale','duplicate','other')),
  reject_note      text,

  -- 客人要求删除个人信息（AU/NZ Privacy Act）。
  -- 🔴 只能删 ME 这一侧 —— CAPI 没有删除端点，已发出的匿名哈希无法撤回。
  --    UI 上必须如实这么说，不许暗示"能从 Meta 撤回"。
  redacted_at      timestamptz,
  redaction_reason text,

  -- 这条事实是怎么进来的。crm_hubspot 预留给外部 CRM 同步（PM 2026-09-05：一个月内上 HubSpot）。
  source_kind      text        NOT NULL CHECK (source_kind IN
                                ('manual_seed','inbox_extract','web_form','meta_lead_form','api','crm_hubspot')),
  -- 来源系统里的原始编号：HubSpot 的交易 id、M365 的邮件 id、'artifact:bd773505' 等。
  -- 🔴 它跟下面那条唯一索引一起，构成「同一笔外部交易只能进来一次」的保证。
  source_ref       text,

  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- 币种必须是规范的 ISO 4217 三字母大写（小写会让下游对账对不上）
  CONSTRAINT me_sale_outcomes_currency_iso CHECK (
    currency IS NULL OR (currency = upper(currency) AND length(currency) = 3)
  ),
  -- 🔴 除 lead 外都必须有金额与币种。少了金额的 purchase 发给 Meta 等于告诉它
  --    "有人买了但不知道多少钱"，价值优化直接失效。
  CONSTRAINT me_sale_outcomes_amount_required CHECK (
    outcome_kind = 'lead' OR (amount_minor IS NOT NULL AND currency IS NOT NULL)
  ),
  -- 金额挡 0 与负数（退款不走这张表）
  CONSTRAINT me_sale_outcomes_amount_positive CHECK (
    amount_minor IS NULL OR amount_minor > 0
  ),
  -- 拒绝必须给理由：将来客人问"我的数据去哪了"、或复盘为什么没回写，靠这一列
  CONSTRAINT me_sale_outcomes_reject_reason_required CHECK (
    review_status <> 'rejected' OR reject_reason IS NOT NULL
  ),
  -- 🔴 脱敏后 PII 必须真的没了。只写 redacted_at 不清列 = 假脱敏。
  CONSTRAINT me_sale_outcomes_redacted_is_empty CHECK (
    redacted_at IS NULL OR (
      customer_email IS NULL AND customer_phone IS NULL
      AND customer_first IS NULL AND customer_last IS NULL
    )
  ),
  -- 至少要有一个匹配键，否则发给 Meta 100% 匹配不上，纯属浪费额度与暴露面
  CONSTRAINT me_sale_outcomes_needs_match_key CHECK (
    redacted_at IS NOT NULL OR customer_email IS NOT NULL OR customer_phone IS NOT NULL
  )
);

-- 今日待办用：捞某客户待审的行
CREATE INDEX IF NOT EXISTS idx_me_sale_outcomes_pending
  ON public.me_sale_outcomes (client_id, review_status);
-- 审核卡片上的"同单号已有 N 条"提示（幂等键改用行 id 后，重复录入只能靠这个提醒人）
CREATE INDEX IF NOT EXISTS idx_me_sale_outcomes_order_ref
  ON public.me_sale_outcomes (client_id, order_ref) WHERE order_ref IS NOT NULL;

-- 🔴 同一笔外部记录只能进来一次。
--
--    发送侧那三道闸防的是「**同一行**被发两次」。它们挡不住另一个方向：
--    外部同步跑两遍，建出**两行不同 id** 指向同一笔交易 —— 那是两个不同身份，
--    三道闸一道都不认识，结果照样是广告平台记两笔成交，而且撤不回。
--
--    这条索引把「同一个来源的同一个编号只许有一行」变成数据库保证，
--    同步端就算写得再糙也灌不进重复。手工录入（source_ref 为空）不受影响。
CREATE UNIQUE INDEX IF NOT EXISTS uq_me_sale_outcomes_source
  ON public.me_sale_outcomes (client_id, source_kind, source_ref)
  WHERE source_ref IS NOT NULL;

ALTER TABLE public.me_sale_outcomes ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写
  --    （2026-08-03 实测泄露 118 条策略覆盖的数据）。这张表里全是客户真名真邮真电话。
  CREATE POLICY "service_role_full" ON public.me_sale_outcomes
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 每目的地发送状态 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.me_conversion_writebacks (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_id       uuid        NOT NULL REFERENCES public.me_sale_outcomes(id),
  destination      text        NOT NULL CHECK (destination IN ('meta_capi','meta_custom_audience')),
  -- 幂等键 = 事实行的 uuid（不可变）。
  -- 🔴 不能用 SHA256(client||order_ref||event_time)：改一次付款时间哈希就变，
  --    同一笔会被发两次（魏征 v2 复审）。
  event_id         text        NOT NULL,

  status           text        NOT NULL DEFAULT 'queued' CHECK (status IN
                     ('queued','sending','in_doubt','dry_run','confirmed',
                      'failed','failed_permanent','expired_no_send','redacted')),
  attempts         int         NOT NULL DEFAULT 0,
  -- 发送前由同一条 CAS 写入。卡在 sending 的行靠它判断"卡了多久"，
  --    据此转 in_doubt 交人工核对 —— 不写这一列，卡住的行没人认得出来。
  last_attempt_at  timestamptz,
  last_error       text,
  last_error_code  text,
  next_attempt_at  timestamptz,
  -- 🔴 发 HTTP 之前抢的标记（NULL → now()，CAS）。抢不到就绝不发。
  --    每一轮重试由 mark 步清回 NULL。见文件头说明。
  post_started_at  timestamptz,

  -- 只存白名单字段（events_received / fbtrace_id / messages）。
  -- 原样存整个响应会把 Meta 回显的 user_data 一起沉淀下来，等于二次拉平 PII。
  receipt          jsonb,
  -- dry-run 给人看的打码版（ros***@example.com），不是哈希 —— PM 看一堆 sha256 什么都验不了
  payload_preview  jsonb,
  latency_ms       int,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- 一个事实 × 一个目的地 只允许一条发送记录。这是防重复的最后一道数据库硬闸。
  CONSTRAINT me_conversion_writebacks_once UNIQUE (destination, event_id)
);

CREATE INDEX IF NOT EXISTS idx_me_conversion_writebacks_outcome
  ON public.me_conversion_writebacks (outcome_id);
-- 找卡在发送中的行（请求中途断了，需要人工核对 Meta 到底收没收）
CREATE INDEX IF NOT EXISTS idx_me_conversion_writebacks_sending
  ON public.me_conversion_writebacks (last_attempt_at) WHERE status = 'sending';

ALTER TABLE public.me_conversion_writebacks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.me_conversion_writebacks
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- ── 审计（只增不改不删）─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.me_conversion_audit (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  outcome_id    uuid        REFERENCES public.me_sale_outcomes(id),
  writeback_id  uuid        REFERENCES public.me_conversion_writebacks(id),
  action        text        NOT NULL,    -- 'created' | 'approved' | 'rejected' | 'sent' | 'redacted' | 'doubt_resolved' | ...
  actor         text,
  ip            inet,
  ua            text,
  request_id    uuid,
  detail        jsonb,
  at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_me_conversion_audit_outcome
  ON public.me_conversion_audit (outcome_id, at DESC);

ALTER TABLE public.me_conversion_audit ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON public.me_conversion_audit
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 🔴 只增不改**必须靠触发器**，不能靠"只写 INSERT policy"。
--    service_role 带 BYPASSRLS，RLS 策略对它根本不生效（子牙 v2 复审）。
CREATE OR REPLACE FUNCTION public.me_conversion_audit_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'me_conversion_audit 是只增日志：% 被拒绝', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS me_conversion_audit_append_only_trigger ON public.me_conversion_audit;
CREATE TRIGGER me_conversion_audit_append_only_trigger
  BEFORE UPDATE OR DELETE ON public.me_conversion_audit
  FOR EACH ROW EXECUTE FUNCTION public.me_conversion_audit_append_only();

-- 行级触发器对 TRUNCATE 不触发，单独挡一道
DROP TRIGGER IF EXISTS me_conversion_audit_no_truncate ON public.me_conversion_audit;
CREATE TRIGGER me_conversion_audit_no_truncate
  BEFORE TRUNCATE ON public.me_conversion_audit
  FOR EACH STATEMENT EXECUTE FUNCTION public.me_conversion_audit_append_only();


-- ── 客户级配置（L4）─────────────────────────────────────────────────────────
-- dry_run → live 的切换要留痕，不能靠"把 env 里的值删掉"这种不可审计的操作。
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS conversion_stage text NOT NULL DEFAULT 'dry_run';
DO $$ BEGIN
  ALTER TABLE public.clients ADD CONSTRAINT clients_conversion_stage_check
    CHECK (conversion_stage IN ('dry_run','live'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 电话转 E.164 要知道默认国家码。
-- 🔴 clients 表原本没有这一列（v2 spec 误以为有，子牙复审查实：那列在 local_serp_rankings）。
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS default_phone_country text;


-- 🔴 不发这一句，PostgREST 的 schema 缓存里没有这些表，第一次读写会拿到
--    「relation does not exist」—— 那个报错看起来像「migration 没 apply」，能把人带偏很久。
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- apply 之后要人工跑一遍的自验（本 PR 的测试只扫 SQL 文本，证明不了运行时行为）
-- ============================================================================
-- 1. 匿名读被拒：
--      用 anon key 调 PostgREST GET /me_sale_outcomes → 期望 401/空，绝不能返回行。
-- 2. 审计不可改：
--      INSERT 一行 me_conversion_audit 后 UPDATE 它 → 期望报
--      「me_conversion_audit 是只增日志：UPDATE 被拒绝」。
-- 3. do_not_contact 联动：
--      找一个 contacts.do_not_contact = true 的联系人，建一条关联的 outcome，
--      走审核接口 approve → 期望被拒（这条闸在应用层 PR3，此处记录预期）。
-- 4. 脱敏约束：
--      UPDATE 一行 SET redacted_at = now() 但不清空 customer_email
--      → 期望被 me_sale_outcomes_redacted_is_empty 拒。
-- 5. 重复发送闸：
--      同一 (destination, event_id) 插第二条 → 期望被 me_conversion_writebacks_once 拒。
-- ============================================================================
