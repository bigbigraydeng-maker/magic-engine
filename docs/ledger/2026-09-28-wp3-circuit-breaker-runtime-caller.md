---
id: 2026-09-28-wp3-circuit-breaker-runtime-caller
title: 熔断器运行时调用方——migration 已 apply，Inngest 未 Sync + 未跑真实端到端一轮，不算"已验证在生产触发"
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-05
verify_how: Inngest Sync /api/inngest，手动把某客户 7 天花费造高、跑一次 pullback-daily，确认 client_automation_policies 写出 deny 行、pm-todo 出待办卡、Settings 页「解除熔断」按钮能解回 require_approval——这一步做完、拿到真实回执之后才能把本卡状态改成 done
---

**2026-09-28 13:2x UTC 补充（PM 明确授权 "可以 apply migration"）**：`ads_circuit_breaker_policy` 迁移已 apply 到生产库（Supabase 项目 `glbdnayojixmexgofbsd`），`mcp__Supabase__apply_migration` 调用返回成功；已核实 `ads_trip_circuit_breaker_policy_batch` / `ads_release_circuit_breaker_policy` 两个函数都存在、`SECURITY DEFINER = true`、`can_execute` 只有 `service_role`（`anon`/`authenticated`/`public` 都没有执行权限），符合 CLAUDE.md 铁律 7 的 service-role 模板。**没有做的**：没有调用这两个函数做任何写入测试（没有对任何真实客户产生副作用），没有同步 Inngest，没有跑端到端一轮——这些仍需要下一步明确授权才做。apply 前顺带核实了目标表 `client_automation_policies` 的 schema 跟 migration 假设一致（`policy_version`/`updated_by`/`effective_to` 等列齐全）。

**2026-09-28 子牙 + 魏征独立复审均指出（互不知情，各自发现）**：本卡此前 `status: done`/`done_on: 2026-09-28` 与实际情况不符——`verify_how` 那一段本身就是待办清单的措辞（"手动把某客户 7 天花费造高、跑一次 pullback-daily，确认…"），不是"已经跑过、输出是 X"的实测记录。migration 文件头明写"不在 PR 内 apply"，Inngest 也还没手动 Sync，两个新 SQL 函数至今没有在任何真实数据库上执行过一次。按 CLAUDE.md「当场试跑」硬性要求，`status: done` 会让后续读台账的人误以为"熔断器已验证在跑"，已改回 `decided`——代码写完、单测绿、两个独立 agent 复审都没找到 BLOCKER 级代码问题，但**没有实测证据支撑"生产环境真的能自动触发"这句话**，这正是本 PR 最初的任务目标，不能只凭单元测试通过就宣称达成。
`google-data-pullback-daily` 拉完当天花费后对 bounded_auto 客户发 `ads.circuit_breaker.check_due`，新 Inngest 函数读 `ad_daily_insights` 判定，触发时调新 SQL 函数 `ads_trip_circuit_breaker_policy` 写 deny；Settings 页新增横幅 + 解除按钮调 `ads_release_circuit_breaker_policy`。

**范围决定**：v1 直接写 `client_automation_policies.mode=deny`（沿用 PR #2019 已有 pm-todo 契约），**不是** spec `2026-09-25-ads-impact-wp3-design-v1.md` §6 的 `ads_circuit_events` 事件表设计（per-account、sticky、5 条触发、admin release 表级约束）。只实现了 spec §6.3 的第 1 条触发（相对阈值），第 2-5 条（客户级总闸、回滚失败、Jev 连续低分、数据不全)和 sticky/事件溯源留待后续 PR，需要单独设计评审。

**2026-09-28 补充（Codex 复审第 4 轮）**：触发 #1 的判定改成按 `ad_account_id` 分别算，不按客户合计——多账户客户（CTS）原实现会让单账户异常被其它账户的稳定花费稀释掉。触发动作仍是客户级（写 deny 没有账户维度，跟 spec §6 的 per-account 事件表是两回事，没有做表结构变更）。另确认一个 Codex 顾虑不成立：`ads_trip_circuit_breaker_policy` 按 `effective_to IS NULL` 找当前策略行，理论上跟"未来生效行"竞态——但全仓没有任何写入者会创建 `effective_from` 在未来或 `effective_to` 非空的行（唯一写入口 `ads_sync_autonomy_policy` 永远原地 UPDATE），这条竞态今天不可达。
