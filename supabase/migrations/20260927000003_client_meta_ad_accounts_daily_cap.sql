-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ ⚠️ 本文件只随 PR 提交，**不在 PR 内 apply**。apply 需 PM 明确授权。        ║
-- ║                                                                          ║
-- ║ 账户级日预算上限（v2.2 §3.9 / §11.11）。                                  ║
-- ║ PM 2026-09-25：CTS 主账户 100 / 另一个账户 50，客户级 150 为总闸。        ║
-- ║ 🔴 具体哪个 act_ 号填 50 尚未确定（库里没有叫「个人账户」的行），           ║
-- ║    这份 migration 只加列、不填值；填值由 PM 在绑定面板上做。               ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE public.client_meta_ad_accounts
  ADD COLUMN IF NOT EXISTS daily_budget_cap_cents integer NULL;

DO $do$
BEGIN
  ALTER TABLE public.client_meta_ad_accounts
    ADD CONSTRAINT client_meta_ad_accounts_daily_cap_positive
    CHECK (daily_budget_cap_cents IS NULL OR daily_budget_cap_cents > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $do$;

COMMENT ON COLUMN public.client_meta_ad_accounts.daily_budget_cap_cents IS
  '这个广告账户的日预算上限（该账户币种的最小单位）。NULL = 未配置。'
  '客户绑 ≥2 个账户且本列为 NULL 时，信封事实解析器返回 unavailable(''facts:账户级日上限未配置'') → Kernel 拒。'
  '🔴 币种隐含：本表没有 currency 列，币种只存在 ad_entity_snapshots.currency。'
  '所以「不同账户的上限直接相加」是错的，见下方那段注释与 ROADMAP 欠账。';

-- ────────────────────────────────────────────────────────────────────────────
-- 🔴 一处已知设计缺口，本轮刻意不补，但必须让它不能被静默踩到
--
-- 统筹 2026-09-27 查实：`client_meta_ad_accounts` 只有 7 列，**没有 currency**。
-- 币种只存在 `ad_entity_snapshots.currency` 里，所以「这个上限是多少钱」的币种
-- 是**隐含的、要靠快照反查**。
--
-- 今天不出问题纯粹因为**碰巧**：CTS 两个账户 + NAL 一个账户实测全是 NZD。
-- 但：
--   · 快照拉不到 / 新账户还没快照 → 上限的币种**无从得知**
--   · 以后接一个 AUD 账户，`daily_budget_cap_cents = 10000` 到底是 NZ$100 还是
--     AU$100，表上答不出来
--   · §3.9 那条 PATCH 校验「sum(账户上限) ≤ 客户总闸」**不同币种直接相加就是错的**
--
-- 本轮不加 currency 列的理由：加列要同时决定「谁写它、值从哪来、跟快照冲突时谁赢」，
-- 那是一次独立设计，而本轮范围已经很大。
--
-- 🔴 但「相加」这个错不许留在代码里。PATCH 校验（`api/clients/[id]/ad-accounts/…`）
--    必须显式处理两种情况并**拒绝 + 说清原因**，不许默默相加：
--      ① 任一账户取不到币种           → 拒（读不到就不判，不猜）
--      ② 各账户币种不一致             → 拒（跨币种相加没有意义）
--    这条跟熔断 #2 的保险丝同源（v2.2 §6.9 第 2 条：账户币种不一致 → undeterminable，
--    不熔不放）。
--
-- 🔴 那两条分支**真实数据永远走不到**（全 NZD），所以它们的测试必须用**合成 fixture**
--    （造一个 AUD 账户 + 一个 NZD 账户），不能靠「跑起来没报错」当验证。
--    没被真实数据走过的 fail-closed 分支，跟没写一样 —— 本轮已经在 `learning_stage`
--    上吃过这个亏（CTS+NAL 46/46 全 NULL，用理想值写的测试全绿、真客户 100% 失败）。
--
-- 欠账已进 ROADMAP：client_meta_ad_accounts 缺 currency 列，多币种客户接入前必须补。
-- ────────────────────────────────────────────────────────────────────────────

NOTIFY pgrst, 'reload schema';
