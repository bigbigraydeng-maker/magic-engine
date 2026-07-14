-- P21.J P0.1 publish-worker — content_work_orders 发布阶段字段
-- 状态机:approved →(cron 原子领取)→ publishing → published / publish_failed
-- 目标:原子领取防双发 + 超时回收锚 + 重试退避 + 发布回执(幂等对账锚 + measure 数据源)
-- 复用已有 claimed_at/claimed_by(渲染 worker 用),发布阶段用独立字段避免跨阶段混淆。

ALTER TABLE content_work_orders
  ADD COLUMN IF NOT EXISTS publishing_started_at timestamptz,              -- 发布领取时间(publish-sweeper 超时回收锚)
  ADD COLUMN IF NOT EXISTS publish_claimed_by    text,                    -- 领取的 cron 实例(调试并发/双发)
  ADD COLUMN IF NOT EXISTS publish_attempts      integer NOT NULL DEFAULT 0, -- 发布重试计数(terminal 前上限)
  ADD COLUMN IF NOT EXISTS next_retry_at         timestamptz,             -- 下次重试时间(publish_failed 指数退避)
  ADD COLUMN IF NOT EXISTS published_ref         jsonb;                   -- 发布回执 {platform,page_id,post_id,video_id,published_at,permalink}

COMMENT ON COLUMN content_work_orders.published_ref IS
  'P0.1 发布回执:幂等对账锚(防"发出去没记上"重发)+ P1 measure-pullback 拉表现的入口。一次存全字段免回头改表。';

-- 发布队列扫描索引:cron 捞 approved(新发)+ 到期重试的 publish_failed;含 publishing 供 sweeper 扫超时
CREATE INDEX IF NOT EXISTS idx_cwo_publish_queue
  ON content_work_orders (status, next_retry_at)
  WHERE status IN ('approved', 'publish_failed', 'publishing');

-- RLS:content_work_orders 沿用既有 service_role 策略(本次仅加列,无需新 policy)。
