---
id: 2026-09-25-ads-d3-auto-pause-review-fixes
title: 广告 D3 自动暂停 PR 代码审查四项修复落地（RLS 安全漏洞 + 合并冲突 + dry_run 保护 + 实时读配置）
status: verified
owner: agent
decided_on: 2026-09-25
source: pr:2010
done_on: 2026-09-25
done_ref: pr:2010
verify_by: 2026-10-02
verify_how: PR 合并后 ad_strategy_configs 表的 RLS 策略含 TO service_role；autopilot_dry_run 手动改后不被 migration 覆盖；processD3Hit 执行前重读配置
last_checked: 2026-11-02
check_note: 11-02：生产库 pg_policies 仅 service_role_full(roles=service_role)；迁移 ON CONFLICT 不碰 autopilot_dry_run(生产4行均true)；processD3Hit 提交前 loadConfig 重读且读失败 fail closed
verified_ref: doc:docs/ledger/evidence/2026-09-25-ads-d3-auto-pause-review-fixes--2026-11-02.md
---
代码审查发现四项问题，本次全部修复并推送：
1. RLS 漏洞：原 migration 漏 TO service_role，anon 可读写 autopilot 开关，新建修复 migration
2. 合并冲突：main 合入 autonomy mode 等新字段，解决全部 9 个文件的冲突
3. ON CONFLICT 保护：不再覆盖 PM 手动设的 autopilot_dry_run
4. 实时配置：processD3Hit 在暂停决策前重新读取最新 dry_run 状态
