---
id: 2026-09-26-ads-d3-migration-applied-to-prod
title: D3 自动暂停 migration 补 apply 到生产（每日广告巡察此前每晚被静默跳过）
status: verified
owner: agent
decided_on: 2026-09-26
source: doc:docs/PITFALLS.md
done_on: 2026-09-26
done_ref: doc:docs/ledger/2026-09-25-ads-d3-auto-pause-review-fixes.md
verify_by: 2026-09-27
verify_how: 9/27 05:00 NZ 后查 cron_run_logs job_name=google-data-pullback-daily 最近一次：不再有「column ad_strategy_configs.autopilot_enabled does not exist」、巡察不再被跳过；再查 ad_health_narratives insight_date 2026-09-26 两客户 email_status 应为 sent（非 pending），CTS 那条应带广告级新规则命中（v4 表单）。任一未满足 = 没修好
last_checked: 2026-09-28
check_note: 原报错消失，narrative正常生成发送，CTS带D11/D8/D5广告级规则命中；另发现3账号Meta token读取失败，与本卡无关未处理
verified_ref: doc:docs/ledger/evidence/2026-09-26-ads-d3-migration-applied-to-prod--2026-09-28.md
---
PM 2026-09-26 在卫青窗口亲自「上」。

**背景**：D3 自动暂停功能的代码 9/25 已上线，但建两个开关列的 migration（文件 supabase/migrations/ 下、日期前缀 0922 的 ads_d3_auto_pause_v1）从没在生产 apply。导致 loadAdStrategyConfigWithSource 每次读 config 报「column autopilot_enabled does not exist」→ 退化成 fallback → `snapshotsReady && adConfigSource !== 'fallback'` 这个闸永远为假 → **每日广告巡察（含 9/25 新合的广告级规则 D2/D10）每晚对全部 6 客户静默跳过**。9/23–9/25 三晚的 google-data-pullback-daily 都是 failed，ad_health_narratives 9/25 两客户停在 pending 未发。

**改前证据（只读查得）**：ad_strategy_configs 无 autopilot_enabled / autopilot_dry_run 两列；表权限已是正确 service_role_full TO service_role（RLS 修复那条 migration 不需重跑）；client_automation_policies 表在、约束允许 require_approval、CTS 无 D3 行。

**执行**：apply_migration 应用原文（与仓库文件一字一致），已记入 schema_migrations（版本号 0926 前缀，名 ads_d3_auto_pause_v1）。

**改生产库的可回查记录**（2026-09-27 按 PM 铁律「每一次改动都要留可回查记录」补全）：
- **谁改的**：卫青（广告支柱审查窗口，session e78010ff），用 Supabase MCP 的 apply_migration 对生产项目执行。
- **谁授权的**：PM 本人在该窗口内亲自回「上」。⚠️ 在此之前，小秘书窗口曾转达过一次 PM 的「上」，**我拒绝执行并要求 PM 在本窗口亲自确认**——改生产库不接受转达授权（防一个窗口替另一个窗口放行）。
- **什么时候**：schema_migrations 记录的版本号时间戳对应 2026-09-26 01:42 UTC 前后（= 新西兰 9/26 下午）。当晚 17:00 UTC 那次运行（新西兰 9/27 早 6 点）即恢复正常，见本卡 verify_how。
- **依据**：migration 文件早已在仓库里（日期前缀 0922），只是从没在生产 apply；应用的是文件原文、一字未改。
- **救火背景**：不是计划内变更，是止血。D3 代码 9/25 上线后，配置读取因缺字段报错退化成兜底，导致**每日广告巡察、D 码诊断、内部日报三件事被整块静默跳过**（六客户全中，9/23–9/25 三晚）。当时已连续几晚无人发现，PM 是通过「广告体检怎么没动静」才察觉。根因与静默机制详见 [[2026-09-27-growth-states-missing-0925-root-cause]]。
- **影响面**：只动 ad_strategy_configs 两列 + client_automation_policies 一行（CTS 的 D3 策略 require_approval）。**CTS 当时即处于 rehearsal（autopilot_dry_run=true），不会真暂停任何广告。**
- **回滚**：见下方回滚段，语句当时即已备好。

**改后回读**：两列建上（autopilot_enabled NOT NULL default false、autopilot_dry_run NOT NULL default true）；CTS pilot=true dry=true（rehearsal，只记录不真停广告）；另 3 家 pilot=false 不受影响；CTS 得到 ads.auto_pause_on_d3 = require_approval / ttl 七天；config 8 字段 select 全部读通、不再报错。

**回滚（如需）**：删 client_automation_policies 里那条 D3 策略行（updated_by 带 migration 前缀）+ ALTER TABLE ad_strategy_configs DROP COLUMN autopilot_enabled, DROP COLUMN autopilot_dry_run。

CTS autopilot_dry_run 何时改 false（才会真的自动暂停广告）由 PM 另行拍板，不在本次。
