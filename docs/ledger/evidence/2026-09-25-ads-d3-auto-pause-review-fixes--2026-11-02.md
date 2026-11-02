# 证据 · 2026-09-25-ads-d3-auto-pause-review-fixes · 2026-11-02
fetched_at: 2026-11-02T22:30:00+13:00
查了什么：verify_how 的三项
数字：
1. 生产库（CrazyContent 项目 glbdnayojixmexgofbsd）pg_policies where tablename='ad_strategy_configs' → 只有 1 条 service_role_full，roles={service_role}，cmd=ALL（无 anon/authenticated 策略）。迁移 20260925002000_fix_ad_strategy_configs_rls.sql 也写了 TO service_role。
2. 迁移 20260922100000_ads_d3_auto_pause_v1.sql 第35-37行 ON CONFLICT DO UPDATE 只改 autopilot_enabled、updated_at，不碰 autopilot_dry_run；生产表 4 行 autopilot_dry_run 全为 true，与迁移写法一致。
3. src/lib/inngest/functions/ads-d3-auto-pause.ts processD3Hit 提交前 `deps.loadConfig` 重读配置（约第369行），读失败 fail closed 记 failed，dry_run 为真则只记演练。
来源/命令：Supabase 只读 SQL；grep/sed 上述文件；gh pr view 2010 → MERGED 2026-09-25T02:35Z
结论：成。三项均有实证。
