---
id: 2026-09-28-wp3-circuit-breaker-runtime-caller
title: 熔断器运行时调用方接线完成 — cron 发事件、Inngest 判定并写 deny、Settings 页可解除
status: done
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-05
verify_how: 确认本 PR 新增的 ads_circuit_breaker_policy migration 已 apply + Inngest 已 Sync /api/inngest，手动把某客户 7 天花费造高、跑一次 pullback-daily，确认 client_automation_policies 写出 deny 行、pm-todo 出待办卡、Settings 页「解除熔断」按钮能解回 require_approval
done_on: 2026-09-28
done_ref: pr:2019
---
`google-data-pullback-daily` 拉完当天花费后对 bounded_auto 客户发 `ads.circuit_breaker.check_due`，新 Inngest 函数读 `ad_daily_insights` 判定，触发时调新 SQL 函数 `ads_trip_circuit_breaker_policy` 写 deny；Settings 页新增横幅 + 解除按钮调 `ads_release_circuit_breaker_policy`。

**范围决定**：v1 直接写 `client_automation_policies.mode=deny`（沿用 PR #2019 已有 pm-todo 契约），**不是** spec `2026-09-25-ads-impact-wp3-design-v1.md` §6 的 `ads_circuit_events` 事件表设计（per-account、sticky、5 条触发、admin release 表级约束）。只实现了 spec §6.3 的第 1 条触发（相对阈值），第 2-5 条（客户级总闸、回滚失败、Jev 连续低分、数据不全)和 sticky/事件溯源留待后续 PR，需要单独设计评审。

**2026-09-28 补充（Codex 复审第 4 轮）**：触发 #1 的判定改成按 `ad_account_id` 分别算，不按客户合计——多账户客户（CTS）原实现会让单账户异常被其它账户的稳定花费稀释掉。触发动作仍是客户级（写 deny 没有账户维度，跟 spec §6 的 per-account 事件表是两回事，没有做表结构变更）。另确认一个 Codex 顾虑不成立：`ads_trip_circuit_breaker_policy` 按 `effective_to IS NULL` 找当前策略行，理论上跟"未来生效行"竞态——但全仓没有任何写入者会创建 `effective_from` 在未来或 `effective_to` 非空的行（唯一写入口 `ads_sync_autonomy_policy` 永远原地 UPDATE），这条竞态今天不可达。
