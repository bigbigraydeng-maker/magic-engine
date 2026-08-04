-- listing_briefs.ad_reference —— 「我们自己投过的，实际跑出来是什么样」
--
-- 🔴 尚未 apply,等 PM 拍板。文件在仓里 ≠ 库里加好了。
--    apply 之后请把这一行改成「✅ 已 apply(日期, PM 显式 go apply)」,
--    并用 SQL 核对 supabase_migrations.schema_migrations 里确实有这个版本号。
--
-- ⚠️ 这个 PR 天生两步合(CLAUDE.md「带 migration 的 PR 天生两步合」):
--    先 apply 这一列，再 merge 代码。顺序反了，生成档案时写 ad_reference 会报
--    「column does not exist」,把当前已经能跑的档案生成打断。
--
-- WHY
-- ---
-- 2026-08-01 的一次真实判断错误:2/30 Kiteroa 的档案出来后，有人拿实测数据去
-- 质疑 AI 的卖点排序，「英文学区版每次对话 $27.83，全场最贵」——换算过去是
-- **1 次对话**。PM 当场纠正:这套房主要卖的就是学区,AI 判断是对的,现有几个
-- 样本不能当决策依据。而「同类攒够 6 套才算规律」这条闸(lib/listings/
-- pattern-promotion.ts)本来就定好了,是拿数据的人自己违反了它。
--
-- 所以这一列的设计目的是**把实测摆到人眼前，同时挡住机器拿三条数据自作主张**:
--   · 它跟 buyer_segments / angle_ranking **分开存**,不是混进去。AI 的排序永远
--     按房子本质来,实测单独成一块给人看(应用层 applyAdReferenceToDraft 是
--     这条纪律的物理位置)。
--   · 每个数字都跟**样本量**存在一起(sample.conversations / ads / days /
--     listings / clients),不许出现孤零零的「每次对话 $27.83」。
--   · pattern 那一栏记的是「这算不算规律」,判定复用 pattern-promotion.ts 的
--     6 套阈值,本列不另立一个数。
--
-- 为什么是 JSONB 而不是拆成一堆列
-- ------------------------------
-- 这一块是**快照**:生成档案那一刻的实测长什么样。它不参与跨房子聚合(真要聚合
-- 就直接查 ad_daily_insights,那才是真相源),只需要跟这一版档案一起冻在这儿,
-- 将来才答得出「当初摆在人面前的是哪几个数」。拆成列会诱使别人拿它做聚合,
-- 而快照做聚合是错的。
--
-- 为什么可空
-- ---------
-- 没投过广告、取数失败、同类判不了 —— 全都是正常情况,一律 NULL。
-- 存量的两版档案(2/30 Kiteroa)不回填:当初生成时人面前确实没有这一块,
-- 事后补进去等于篡改「当初看到的是什么」。

ALTER TABLE listing_briefs
  ADD COLUMN IF NOT EXISTS ad_reference JSONB;

COMMENT ON COLUMN listing_briefs.ad_reference IS
  '生成这一版档案时，我们自己投放的实测快照(整体数字 + 样本量 + 够不够格叫规律)。只给人看，绝不参与 angle_ranking / buyer_segments 的计算。NULL = 没投过 / 没取到。';
