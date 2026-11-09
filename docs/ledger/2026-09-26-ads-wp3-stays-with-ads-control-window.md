---
id: 2026-09-26-ads-wp3-stays-with-ads-control-window
title: 广告 WP3 继续由原「ME 广告构建控制」窗口做，其他窗口不接手；草稿 PR 2019 跟已批设计有三处对不上，要按设计改完再审
status: decided
owner: pm
decided_on: 2026-09-26
source: pr:2019
verify_by: 2026-10-02
verify_how: 3.1a 那份数据库改动在生产是否已执行有明确结论（执行过或已下发待 PM go）；PR 2019 按设计稿 §6 与 §12 改完并过子牙+魏征复审，或关闭后由原窗口重开 3.1b
---
PM 2026-09-26 回「交给原窗口」。3.1a 已合并（pr:2011），但它那份 `ads_autonomy_sync` 数据库改动是否已 apply 本会话查不到；没 apply 时设置页改 autonomy_mode 会因缺 `autonomy_mode_updated_by` 列报错。
PR 2019 与设计稿 v2.1 的三处出入：①熔断写 deny 策略，违反 §4.7「v1 无 deny 写入者」；②止损路由列进 grandfathered 放行，§12 要求 3.1b 收编进 Kernel；③没有 §6.2 的 append-only `ads_circuit_events`。
设计稿 `docs/specs/2026-09-25-ads-impact-wp3-design-v1.md`；原设计批准卡 `2026-09-25-ads-wp3-design-v21-approved`。
