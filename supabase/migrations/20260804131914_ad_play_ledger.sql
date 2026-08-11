-- 打法账本 —— 给 ad_creative_links 加三列，记「这条广告用的是哪个打法」
--
-- ✅ 2026-08-04 PM 显式 `go apply` 后已上线，版本号 20260804131914（文件名与 DB 账本一致）。
--
-- ── 为什么加在 ad_creative_links 而不是新建表 ──────────────────────────────────
-- 子牙架构审的结论：这张表粒度已经对（一行一条广告）、唯一键已经有
-- (client_id, platform, ad_id)、RLS 已经在。新建一张表只会因为同样的理由同样是
-- 0 行 —— 那张表现在 0 行，不是因为设计不好，是因为**建广告根本不走 ME**。
-- 所以真正的修复是把建广告收进 ME（PM 已 `go 收口`），这几列是它的落点。
--
-- ── 为什么记「打法」不记「变量」──────────────────────────────────────────────
-- PM 2026-08-04 第 2 问拍板：学「打法」+ 学「坑」，砍掉「单变量 A/B」。
-- 魏征实算：当天中英差异真实值 1.84 倍、p ≈ 0.22（掷硬币级），要测出显著性需
-- $1,835，而一个楼盘的总预算是 $2,000 —— 这个业务形态下永远测不出。
-- 打法账本不做统计，只做记账：跑过、花了多少、结果如何。判断留给人。
--
-- ── 这几列要解决的真实损失 ────────────────────────────────────────────────────
-- CTS 在 2026-07-08~21 花 $232.62 跑过 ThruPlay 攒池，ME 里零记录。8/4 给 Roman
-- 建了同一个打法时，完全不知道上一次是成功还是失败。

ALTER TABLE ad_creative_links
  ADD COLUMN IF NOT EXISTS play         text,
  ADD COLUMN IF NOT EXISTS play_source  text,
  ADD COLUMN IF NOT EXISTS play_context jsonb;

COMMENT ON COLUMN ad_creative_links.play IS
  '打法 key，取值见 src/lib/ads-strategy/play-vocabulary.ts 的 PlayKey（封闭 union）。'
  'NULL = 认不出，如实留空 —— 硬猜会让账本学出反的结论。';

COMMENT ON COLUMN ad_creative_links.play_source IS
  '怎么记上的：declared_at_creation（建广告那一刻声明，高可信）/ '
  'parsed_from_name（事后从名字解析，低可信 —— 名字有多套规范且会被事后改写）/ '
  'human_backfill（人工补录，高可信）。';

COMMENT ON COLUMN ad_creative_links.play_context IS
  '描述性标签（语种/角度等），只做展示与筛选，**不做统计比较**。'
  '做统计就退回成被否掉的「单变量 A/B」提案了。';

-- 取值约束。刻意不做成 enum：新增打法在 TS 侧是改一个 union + 补一条目录说明，
-- 走 enum 要再来一次 migration，而 CLAUDE.md 明确说过「加 enum 新值必同步前端
-- type + UI fallback」是踩过事故的地方。text + CHECK 改起来是一次 migration，
-- 但至少不会出现「DB 有值、TS 不认识」的漂移。
DO $$ BEGIN
  ALTER TABLE ad_creative_links
    ADD CONSTRAINT ad_creative_links_play_source_check
    CHECK (play_source IS NULL OR play_source IN
      ('declared_at_creation', 'parsed_from_name', 'human_backfill'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE ad_creative_links
    ADD CONSTRAINT ad_creative_links_play_check
    CHECK (play IS NULL OR play IN (
      'thruplay_pool_build',
      'lead_form_harvest',
      'messenger_direct',
      'warm_pool_retarget',
      'reach_awareness',
      'boost_organic_post'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 账本的主要查法是「这个打法跑过几次、结果如何」，所以按 play 建索引。
-- 部分索引：play IS NULL 的行（认不出的）不参与打法统计，不占索引。
CREATE INDEX IF NOT EXISTS ad_creative_links_play_idx
  ON ad_creative_links (play, client_id)
  WHERE play IS NOT NULL;

-- RLS：这张表已 ENABLE + 有 service_role_full 策略，此处不动。
-- （新建表才需要按 CLAUDE.md 的 service_role 模板补策略；改列不涉及。）
