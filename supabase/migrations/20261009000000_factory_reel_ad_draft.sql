-- 本文件只随 PR 提交，不在 PR 内 apply；apply 前需 PM 本人点头。
--
-- 1) ad_strategy_configs 新增一列 factory_reel_ad_draft（jsonb）。
--    这一列存「工厂 Reel 自动起草广告」的开关（off / dry_run / on）和显式参数。
--    代码里没有任何默认参数：读不到、读坏、列还没建，一律当 off（fail-closed）。
--    这一列**不并进任何共享 loader** —— 代码先上线、本 migration 后 apply 的窗口里，
--    共享 loader 会因为「列不存在」而挂掉所有读那张表的调用。
--
-- 2) flywheel_actions 上的部分唯一索引：意图行去重闸门。
--    一个客户 + 一个工单 + 一个视频，只允许一行 ads.factory_reel_draft 意图。
--    写入代码必须用**普通 insert + 读回**处理 23505，**不能**用 upsert onConflict ——
--    部分唯一索引（带 WHERE）和 onConflict 不兼容。
--
-- 表上已有 RLS 策略，本文件不新增任何 RLS 语句。

ALTER TABLE public.ad_strategy_configs
  ADD COLUMN IF NOT EXISTS factory_reel_ad_draft jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS flywheel_actions_factory_reel_draft_idempotency
  ON public.flywheel_actions (client_id, action_type, (payload ->> 'idempotency_key'))
  WHERE action_type = 'ads.factory_reel_draft' AND payload ->> 'idempotency_key' IS NOT NULL;
