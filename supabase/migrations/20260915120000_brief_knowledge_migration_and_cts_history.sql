-- ============================================================================
-- Issue #1647 — brief.ts 去 CTS 化（收尾） + CTS 历史事实迁移
--
-- 依赖：20260914000001_client_knowledge_facts_v1.sql（client_knowledge_facts /
-- client_automation_policies.metadata）、20260914020000（confirmers 表）。
--
-- 这个迁移做三件事：
--   1. `client_knowledge_facts` 新增 historical_confirmation_grandfather_until
--      —— CTS"历史未确认"宽限期的存储位，配一条只白名单一个固定 id 的 CHECK，
--      让"以后任何新写入都不能进入这个状态"是数据库本身拒绝的，不是应用层的
--      承诺（design doc §9.14 B "有条件接受" ①）。
--   2. 写入 CTS（client_id = c0000000-0000-0000-0000-000000000000）此前写死在
--      `src/lib/messenger/brief-client-facts.ts` 里的四条事实，并授予 CTS 客户
--      知识库读取的准入（否则 brief.ts 改走 getClientKnowledge 之后，CTS 会因
--      为没有 entitlement grant 而拿不到这些事实——那是行为倒退，不是"不受
--      准入限制"）。
--   3. `conversation_briefs` 新增 knowledge_status 列，供 brief.ts 在知识库
--      读取失败时打上 'read_failed' 标记，让下一轮判断"该不该重写"的逻辑
--      认得出这条卡需要重试（issue #1647 第 5 点）。
--
-- 🔴 PM 显式 go 之后才 apply；本次改动已在本机 PG 沙盘用
--    scripts/db-replay-and-verify.sh 从零重放验证过（见 PR 描述）。
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. 历史未确认宽限列 + 写一次性白名单
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.client_knowledge_facts
  ADD COLUMN IF NOT EXISTS historical_confirmation_grandfather_until timestamptz;

COMMENT ON COLUMN public.client_knowledge_facts.historical_confirmation_grandfather_until IS
  'Issue #1647 / design doc §9.14 B "CTS 历史未确认"有条件接受：这一列非空表示
   该事实在 customer_reply 读取时（read.ts isCustomerReplyEligible）可以跳过通常
   要求的客户确认（client_confirmed_at），直到这一列指定的截止时间——过期后自动
   落回正常双签判据（此时 client_confirmed_at 仍是 NULL，直接被挡住，不需要另一套
   过期检查）。哪一行可以填这一列由下面的 CHECK 约束锁定成固定 id 白名单：数据库
   本身拒绝任何其它行（含未来任何 INSERT/UPDATE）写入这一列，不是"应用层不会再
   写"这种承诺。';

ALTER TABLE public.client_knowledge_facts
  ADD CONSTRAINT client_knowledge_facts_historical_grandfather_allowlist
  CHECK (
    historical_confirmation_grandfather_until IS NULL
    OR id = 'c1000000-0000-0000-0000-000000000004'::uuid
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 2. CTS 历史事实迁移（迁移清单：brief.ts 原 :100 的 0800 电话与 info@ 邮箱、
--    :35-46 brief-client-facts.ts 的 25 年史 / "从不说 1928" / 免签政策）
--
-- 只有免签政策一条是 policy 类敏感度（需要客户确认才能进 customer_reply）；
-- 其余三条（营业年限、纠正 1928、支持联系方式）都是 general 类——按本 issue
-- 的任务说明，general 类跳过双签闸，只要 status='approved' 加对的 visibility
-- 就行,不需要宽限机制。
-- ────────────────────────────────────────────────────────────────────────────
-- 🔴 `WHERE EXISTS (SELECT 1 FROM clients ...)` 而非裸 VALUES：CTS 这一行客户
-- 只存在于生产库的历史数据里，不是由任何 migration 建的。从零重放全部
-- migration 的场景（本机沙盘/CI，见 scripts/db-replay-and-verify.sh）里没有
-- 这行，裸 INSERT 会撞 client_knowledge_facts_client_id_fkey 外键约束报错退
-- 出（本机实测踩过一次）。同一模式已用于 20260913000001_client_meta_ad_
-- accounts.sql / 20260728000001_leads_pipeline_stages.sql。生产库上 CTS 这
-- 行本来就在，行为不变。
INSERT INTO public.client_knowledge_facts (
  id, client_id, fact_key, scope, statement, structured_value,
  status, visibility, sensitivity,
  valid_from, valid_until,
  source_kind, evidence,
  approved_by_email, approved_at,
  historical_confirmation_grandfather_until
)
SELECT
  v.id, v.client_id, v.fact_key, v.scope, v.statement, v.structured_value,
  v.status, v.visibility, v.sensitivity,
  v.valid_from, v.valid_until,
  v.source_kind, v.evidence,
  v.approved_by_email, v.approved_at,
  v.historical_confirmation_grandfather_until
FROM (VALUES
  (
    'c1000000-0000-0000-0000-000000000001'::uuid,
    'c0000000-0000-0000-0000-000000000000'::uuid,
    'company.years_operating',
    '{}'::jsonb,
    'This business has operated in New Zealand for 25 years.',
    '{"years": 25}'::jsonb,
    'approved', 'customer_ok', 'general',
    now(), NULL::timestamptz,
    'manual',
    '{"note": "Issue #1647 迁移：此前写死在 src/lib/messenger/brief-client-facts.ts", "migrated_from": "brief-client-facts.ts"}'::jsonb,
    'migration:1647', now(),
    NULL::timestamptz
  ),
  (
    'c1000000-0000-0000-0000-000000000002'::uuid,
    'c0000000-0000-0000-0000-000000000000'::uuid,
    'company.founding_year_correction',
    '{}'::jsonb,
    'Never state that this business was founded in 1928 or is New Zealand''s oldest travel agency — 1928 refers to the China Travel Service group in China, unrelated to this New Zealand business.',
    '{"wrong": "\"since 1928\", \"in Auckland since 1928\", or \"New Zealand''s oldest\"", "insteadSay": "1928 belongs to the China Travel Service group in China, not this New Zealand business — never state it as this company''s own founding year."}'::jsonb,
    'approved', 'customer_ok', 'general',
    now(), NULL::timestamptz,
    'manual',
    '{"note": "Issue #1647 迁移：此前写死在 src/lib/messenger/brief-client-facts.ts neverClaim", "migrated_from": "brief-client-facts.ts"}'::jsonb,
    'migration:1647', now(),
    NULL::timestamptz
  ),
  (
    'c1000000-0000-0000-0000-000000000003'::uuid,
    'c0000000-0000-0000-0000-000000000000'::uuid,
    'support.escalation_contact',
    '{}'::jsonb,
    'For anything you should not attempt to resolve yourself, offer a human follow-up via 0800 287 888 / info@ctstours.co.nz.',
    '{"phone": "0800 287 888", "email": "info@ctstours.co.nz"}'::jsonb,
    'approved', 'customer_ok', 'general',
    now(), NULL::timestamptz,
    'manual',
    '{"note": "Issue #1647 迁移：此前写死在 src/lib/messenger/brief-client-facts.ts supportPhone/supportEmail", "migrated_from": "brief-client-facts.ts"}'::jsonb,
    'migration:1647', now(),
    NULL::timestamptz
  ),
  (
    'c1000000-0000-0000-0000-000000000004'::uuid,
    'c0000000-0000-0000-0000-000000000000'::uuid,
    'policy.visa_free_entry',
    '{}'::jsonb,
    'New Zealand passport holders can enter China visa-free for up to 30 days, until 31 December 2026. Do not state any other figure.',
    '{"days": 30, "valid_until": "2026-12-31"}'::jsonb,
    'approved', 'customer_ok', 'policy',
    now(), '2026-12-31T23:59:59+13:00'::timestamptz,
    'manual',
    '{"note": "Issue #1647 迁移：此前写死在 src/lib/messenger/brief-client-facts.ts；design doc §9.14 B 历史未确认，宽限至 2026-10-15，之后必须走正常客户确认", "migrated_from": "brief-client-facts.ts"}'::jsonb,
    'migration:1647', now(),
    '2026-10-15T23:59:59+13:00'::timestamptz
  )
) AS v(
  id, client_id, fact_key, scope, statement, structured_value,
  status, visibility, sensitivity,
  valid_from, valid_until,
  source_kind, evidence,
  approved_by_email, approved_at,
  historical_confirmation_grandfather_until
)
WHERE EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v.client_id)
ON CONFLICT (id) DO NOTHING;

-- CTS 知识库读取准入（否则上面四条事实对 getClientKnowledge 全部不可见——
-- entitlement 是第一道闸，fail-closed）。basis='fde_managed'：CTS 是 FDE 托管
-- 的现存付费客户（clients.plan_tier='growth'），不是走五档会员判定。
-- 同上：WHERE EXISTS 守卫，避免从零重放时撞 clients 外键。
INSERT INTO public.client_automation_policies (
  id, client_id, action_key, mode, updated_by, effective_from, metadata
)
SELECT
  'c1000000-0000-0000-0000-0000000000a1'::uuid,
  'c0000000-0000-0000-0000-000000000000'::uuid,
  'client_knowledge.read',
  'auto_approve',
  'migration:1647',
  now(),
  '{"basis": "fde_managed"}'::jsonb
WHERE EXISTS (SELECT 1 FROM public.clients c WHERE c.id = 'c0000000-0000-0000-0000-000000000000'::uuid)
ON CONFLICT (id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. conversation_briefs.knowledge_status —— read_failed 标记（issue #1647 第 5 点）
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.conversation_briefs
  ADD COLUMN IF NOT EXISTS knowledge_status text
  CHECK (knowledge_status IS NULL OR knowledge_status = 'read_failed');

COMMENT ON COLUMN public.conversation_briefs.knowledge_status IS
  'Issue #1647：brief.ts 读客户知识库失败时写 ''read_failed''（同时 draft_reply
   留空）。brief-cycle.ts 的 shouldGenerateBrief 把这个状态当"待重写"，即使这
   条对话没有新消息也会在下一轮尝试重新生成，直到读取成功或客户确认为止
   （仍受 MAX_REGENS_PER_DAY 每日上限约束）。NULL = 正常状态（知识库读取成功，
   或该客户本来就没有已批准的知识条目——两者都不需要重写）。';
