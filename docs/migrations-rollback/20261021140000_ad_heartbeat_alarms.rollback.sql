-- =============================================================================
-- DRAFT — 回滚草稿（不在 supabase/migrations 下，永不自动执行）
-- 对应迁移：supabase/migrations/20261021140000_ad_heartbeat_alarms.sql
--
-- ⚠️ 仅 PM 明确授权时手工执行；本文件不是迁移，不会被 supabase db push 拾取。
-- ⚠️ 破坏性：会删除 ad_heartbeat_alarms 全部数据（心跳状态行 + 告警行）。执行前先备份。
-- 先把 Render 的 AD_HEARTBEAT_MODE 改回 off 并手动重新部署，否则心跳函数会因表不存在而报错。
--
-- 顺序 = 迁移的逆序。整体包在一个事务里；失败即回滚。
-- 覆盖清单：触发器 ad_heartbeat_alarms_touch_updated_at、触发器函数
--           ad_heartbeat_alarms_touch_updated_at()、表 ad_heartbeat_alarms
--           （索引、约束、策略随表一起消失）。
-- =============================================================================
BEGIN;

DROP TRIGGER IF EXISTS ad_heartbeat_alarms_touch_updated_at ON public.ad_heartbeat_alarms;
DROP FUNCTION IF EXISTS public.ad_heartbeat_alarms_touch_updated_at();
DROP TABLE IF EXISTS public.ad_heartbeat_alarms;

COMMIT;
