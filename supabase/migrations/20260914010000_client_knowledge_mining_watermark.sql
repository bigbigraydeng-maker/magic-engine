-- ============================================================================
-- Client Knowledge Base — step 3/6 (Issue #1645, depends on #1644)
--
-- 加两列支持增量萃取幂等（§9.14 D："同一批对话跑两次，候选数不翻倍，不重复
-- 付费"）：下一轮萃取只扫描上一轮成功跑之后的新消息。
--
-- 🔴 上生产库需 PM 显式 go，本 issue 只在本机 PG 沙盘重放验证。
-- ============================================================================

ALTER TABLE public.client_knowledge_mining_runs
  ADD COLUMN IF NOT EXISTS low_watermark_at timestamptz,
  ADD COLUMN IF NOT EXISTS high_watermark_at timestamptz;

COMMENT ON COLUMN public.client_knowledge_mining_runs.low_watermark_at IS
  '这一轮开始扫描的起点——上一次成功跑的 high_watermark_at（第一次跑该客户时为 NULL，即从头扫）。只存审计用途，不参与任何判断。';
COMMENT ON COLUMN public.client_knowledge_mining_runs.high_watermark_at IS
  '这一轮扫到的最新一条消息时间——只在 status 成功转为 succeeded 时才写。下一轮据此作为 low_watermark_at，只扫描更新的消息，不重复处理、不重复付费。';
