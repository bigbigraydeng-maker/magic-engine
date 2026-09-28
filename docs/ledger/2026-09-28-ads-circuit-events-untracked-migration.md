---
id: 2026-09-28-ads-circuit-events-untracked-migration
title: 生产库里有 ads_circuit_events 表和对应 migration 历史记录，但仓库（含最新 origin/main）里找不到对应的 migration 文件
status: decided
owner: agent
decided_on: 2026-09-28
source: session:dcc2476b
verify_by: 2026-10-12
verify_how: 找到当时是谁/哪个工具直接对生产库跑的这个 migration（问 PM，或查 Supabase 项目的操作审计日志，如果有留存）；确认之后要么补一份对应的 migration 文件到仓库让 git 和生产状态对齐，要么记录清楚这是一次性探索性操作、决定要不要连表一起清掉
---
在给 PR #2019 的 `ads_circuit_breaker_policy` migration 做 apply 前的例行核实（查 `client_automation_policies` schema、順带看了一眼 `list_migrations`）时发现：生产库（Supabase 项目 `glbdnayojixmexgofbsd`）的 migration 历史里有两条记录——名字分别是 `ads_circuit_events` 和 `ads_circuit_events_v2`，版本号（迁移应用时间戳）分别对应 2026-09-26 13:40 和 2026-09-27 11:15 前后（精确版本号台账不抄，见 Supabase 项目 `list_migrations` 结果本身）——但本地仓库和刚 fetch 到的最新 `origin/main`（`784b37a2`）的 `supabase/migrations/` 目录下都搜不到任何同名文件。

**已核实的事实**：
- 生产库里确实存在 `ads_circuit_events` 表，列结构（`id, seq, client_id, ad_account_id, kind, trip_event_id, reason, sticky, evidence, actor, created_at`）跟 PR #2019 描述的 spec §6 完整设计（`ads_circuit_events` 事件表、per-account 粒度、sticky 状态、事件溯源）高度吻合，但 PR #2019 自己的 body 明确写着"没有实现，留给未来 PR"。
- 表是空的：`select count(*) from ads_circuit_events` = 0，`min/max(created_at)` 都是 null——从来没有任何一行被写入过。
- 唯一关联对象是一个防篡改用的 `ads_circuit_events_append_only()` 触发器函数；`grep` 全仓（含 `routine_definition`）没有找到任何代码路径会往这张表写数据或从它读数据——不是"接上了但没人用"，是"表和函数造出来了但从来没跟任何执行代码接线"。
- 跟 PR #2019 这次 apply 的 `client_automation_policies` 无关：两张表完全独立，没有外键或触发器互相引用，apply 我这次的 migration 不会跟这个既有的空表产生任何冲突。

按 CLAUDE.md §11：频率低（一次性历史痕迹，不是持续发生的模式）· 收入关联低（表是空的、没有代码路径用它，不产生任何实际影响）→ 三维里已经两项低，按规则直接 **P3**，记入 ROADMAP 待认领，不因 IMPACT 维度另外加权。

**为什么值得记一笔而不是忽略**：这不是代码 bug，是一个治理/流程缺口——生产数据库的 schema 状态跟 git 仓库不完全一致，意味着"读 git 历史"不能 100% 还原"生产库现在长什么样"。当前这个具体实例无害（空表、无引用），但这个模式本身（有人/某个工具绕开"migration 文件进 git → PR 审 → 授权 apply"这条路径，直接对生产库跑了 DDL）如果发生在一张会被写入真实数据的表上，会是更严重的问题。

**下一步**：不需要现在处理（P3，无实际影响），但建议找机会确认这两次操作的来源——如果是某次探索性会话直接连了生产 Supabase 项目手跑的，值得提醒相关工具/会话以后即使是探索性 DDL 也要先建 migration 文件走仓库；如果是残留的半成品，PM 决定要不要把这张空表也清掉、或者反向把它补登记成正式 migration 文件（即使暂不使用）。
