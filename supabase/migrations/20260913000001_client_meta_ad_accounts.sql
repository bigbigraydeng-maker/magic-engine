-- ============================================================================
-- 客户 ↔ 多个 Meta 广告账户（CTS 数据缺口修复）
--
-- ── 为什么需要 ───────────────────────────────────────────────────────────
-- `clients.meta_ad_account_id` 是单值列，只能记一个广告账户。CTS Tours 实际
-- 在跑两个 Meta 广告账户：
--   act_2775766642787274（"个人号"，登记在 clients.meta_ad_account_id）
--   act_2202695063810470（"CTStours 官方账户"，跑 ThruPlay 顶层认知广告）
-- 后者的数据（2026-09-13 实测：30天花费 $257.56、21,341次曝光、18,666次
-- ThruPlay）从未被同步进 ad_daily_insights，日常同步 cron、广告健康引擎、
-- 每日巡检闸门全部看不到这条账户上发生的任何事。
--
-- ── 设计取舍：新建关联表，不改 clients.meta_ad_account_id ─────────────────
-- `clients.meta_ad_account_id` 保持不变，继续作为"主账户"，供所有单账户语义
-- 的调用方使用（建广告、发广告草稿、写设置、评论自动回复等——这些本来就是
-- "选一个账户操作"的场景，不需要感知多账户）。
--
-- 新表 `client_meta_ad_accounts` 是「客户能看到哪些账户」的完整列表（含主
-- 账户），只给两类场景消费：① 每日数据同步 ② 安全/巡检类只读扫描。
-- 这样只需要改 3 个文件（同步 cron、campaign-ownership 归属校验、
-- readback-sweep 每日巡检），其余 10+ 个单账户调用点一行不用动。
--
-- ── 只留一个主账户 ─────────────────────────────────────────────────────────
-- 部分唯一索引保证每个客户最多一条 is_primary=true，与 clients.meta_ad_account_id
-- 语义对齐（该列改动仍由 meta-ad-account/route.ts 单一入口负责，本迁移不改
-- 那个路由——如需要"从设置页新增第二个账户"的界面，是本次范围之外的后续工作，
-- 见 PR 说明）。
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.client_meta_ad_accounts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid        NOT NULL REFERENCES public.clients(id),
  -- 存储格式沿用 clients.meta_ad_account_id 的既有习惯（可能带 act_ 前缀，
  -- 调用方各自用 normalizeAccountId 之类的函数去除前缀比较，本表不强制格式）。
  ad_account_id text        NOT NULL,
  -- 人看的标签，比如「官方账户」「个人号」。纯展示用，不参与逻辑判断。
  label         text,
  is_primary    boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_client_meta_ad_accounts_account UNIQUE (client_id, ad_account_id)
);

-- 每个客户最多一个主账户（部分唯一索引，允许多行 is_primary=false）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_client_meta_ad_accounts_one_primary
  ON public.client_meta_ad_accounts (client_id) WHERE is_primary;

CREATE INDEX IF NOT EXISTS idx_client_meta_ad_accounts_client
  ON public.client_meta_ad_accounts (client_id);

ALTER TABLE public.client_meta_ad_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  -- 🔴 必须写 TO service_role。漏掉 = 对匿名访客敞开读写（2026-08-03 实测教训）。
  CREATE POLICY "service_role_full" ON public.client_meta_ad_accounts
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 回填：每个已登记 meta_ad_account_id 的客户，生成一条主账户记录 ─────────
-- 这一步让新表从第一天起就跟老列语义一致：老列有值的客户，新表里刚好也有
-- 且只有这一条、标记为主账户，读新表和读老列在没有第二账户时结果完全相同。
INSERT INTO public.client_meta_ad_accounts (client_id, ad_account_id, label, is_primary)
SELECT id, meta_ad_account_id, '主账户', true
FROM public.clients
WHERE meta_ad_account_id IS NOT NULL
ON CONFLICT (client_id, ad_account_id) DO NOTHING;

-- ── CTS Tours 的第二个账户（本次修复的直接目标）─────────────────────────
-- act_2202695063810470，CTStours 官方账户，跑 ThruPlay 顶层认知广告。
-- 非主账户：不影响任何读 clients.meta_ad_account_id 的单账户调用点。
-- WHERE EXISTS 而非裸 VALUES：这条客户行只存在于生产库的历史数据里，不是
-- 由任何 migration 建的。从零重放全部 migration 的场景（本机沙盘/CI）里没有
-- 这行，裸 INSERT 会撞外键约束报错退出。生产库上 CTS 这行本来就在，行为不变。
INSERT INTO public.client_meta_ad_accounts (client_id, ad_account_id, label, is_primary)
SELECT 'c0000000-0000-0000-0000-000000000000', 'act_2202695063810470', 'CTStours 官方账户（ThruPlay）', false
WHERE EXISTS (
  SELECT 1 FROM public.clients WHERE id = 'c0000000-0000-0000-0000-000000000000'
)
ON CONFLICT (client_id, ad_account_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- apply 之后要人工跑一遍的自验（测试只扫 SQL 文本，证明不了运行时行为）
-- ============================================================================
-- 1. 匿名读被拒：用 anon key 调 PostgREST GET /client_meta_ad_accounts
--    → 期望 401/空，绝不能返回行。
-- 2. 回填正确：SELECT count(*) FROM client_meta_ad_accounts WHERE is_primary
--    应该等于 SELECT count(*) FROM clients WHERE meta_ad_account_id IS NOT NULL。
-- 3. CTS 两条账户都在：
--    SELECT ad_account_id, is_primary FROM client_meta_ad_accounts
--    WHERE client_id = 'c0000000-0000-0000-0000-000000000000';
--    期望两行：act_2775766642787274(true) 和 act_2202695063810470(false)。
-- ============================================================================
