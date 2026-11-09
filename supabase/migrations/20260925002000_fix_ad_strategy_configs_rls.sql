-- 修复 ad_strategy_configs 的 RLS：原 20260722000001 漏了 TO service_role，
-- 等于 anon / authenticated 也能读写这张表。autopilot_enabled / autopilot_dry_run
-- 两个开关如果被外部改掉，系统会真的去暂停客户广告——必须锁死。
--
-- 先 DROP 旧策略再建新的，IF EXISTS 保幂等。

DROP POLICY IF EXISTS "service_role_full" ON ad_strategy_configs;

CREATE POLICY "service_role_full"
  ON ad_strategy_configs
  FOR ALL
  TO service_role
  USING (true);
