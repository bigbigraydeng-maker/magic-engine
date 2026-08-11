-- DAPE E 段自动执行循环 —— 机器认领 / 失败退避的记账列
-- ============================================================================
-- 背景（2026-08-05 生产库实测）：
--   execution_items 里 281 件待办，最后一件「完成」是 7-21（15 天前）。
--   看板上排好的动作没有任何自动化在跑 —— judgeAutoRun 那两道闸
--   （背书 + 白名单）2026-08-04 就写好了，零调用方。
--
-- 这个 migration 只加「机器跑这件事」需要的记账列，不改任何既有语义。
--
-- 🔴 为什么不复用 generation_started_at / generation_error：
--   那一对列是 **FDE 在看板上手点「生成这条内容」** 的路径（20260624000001），
--   UI 拿它渲染「制作中 / 失败 [重试]」。cron 往里写，会让看板把机器的活
--   显示成「FDE 正在做」——PM 看到的进度条从此说不清是谁在干。
--   所以机器自己一套列，两条路径互不污染。
--
-- 🔴 判别式（排查僵尸卡时用）：
--     generation_started_at IS NOT NULL  → 有人在界面上点过「生成」
--     auto_run_started_at   IS NOT NULL  → 本 cron 认领的
--     两个都是 NULL 的 in_progress       → 人手把卡拖过去的，机器从没碰过
--   库里现存 20 件卡在 in_progress（最老的 6-02 起没动过）两列全是 NULL，
--   也就是全部属于第三种。**本 PR 一件都不碰** —— 它们既不是机器造成的，
--   也没有一件属于自动跑白名单，混进来只会把「我们的锅」和「人的锅」搅在一起。
-- ============================================================================

ALTER TABLE public.execution_items
  ADD COLUMN IF NOT EXISTS auto_run_attempts   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_run_next_at    timestamptz,
  ADD COLUMN IF NOT EXISTS auto_run_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_run_error      text;

COMMENT ON COLUMN public.execution_items.auto_run_attempts IS
  '自动执行失败过几次。失败第 n 次后下次最早 2^n 天再试；到 3 次停手并下发今日待办。'
  '没有这个计数，失败的动作会每天重试、每天烧一次钱。';

COMMENT ON COLUMN public.execution_items.auto_run_next_at IS
  '本条最早什么时候可以再被自动执行选中。NULL = 随时可选。'
  '失败退避、以及「这周已经有文章了」这种正常跳过，都往这里写。';

COMMENT ON COLUMN public.execution_items.auto_run_started_at IS
  '本 cron 认领这条的时刻。NULL = 当前没被机器持有。'
  '跟 generation_started_at 是两码事：那个是 FDE 在界面上点生成，这个是机器。';

COMMENT ON COLUMN public.execution_items.auto_run_error IS
  '最近一次自动执行的失败原因原文。成功或重新认领时清空。';

-- 选行用：status='pending' 的行才是候选，其余不进索引（281 件里绝大多数是 pending，
-- 但这张表会一直长，partial index 让它不跟着长）。
CREATE INDEX IF NOT EXISTS idx_execution_items_auto_run_pending
  ON public.execution_items (client_id, created_at)
  WHERE status = 'pending';

-- 找回自己掉在半路的认领用（进程被杀 / 部署重启）。只有机器认领过的行进索引。
CREATE INDEX IF NOT EXISTS idx_execution_items_auto_run_claimed
  ON public.execution_items (auto_run_started_at)
  WHERE auto_run_started_at IS NOT NULL;
