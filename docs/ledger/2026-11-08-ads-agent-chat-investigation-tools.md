---
id: 2026-11-08-ads-agent-chat-investigation-tools
title: 项目鲁班只读广告调查工具（L2）
status: done
owner: agent
decided_on: 2026-11-08
source: session:cloud-agent
risk: B
---
## 是什么

为**项目级鲁班对话**增加 4 个只读工具（查已同步表，不调 Meta 写、不新开 Graph 写路径）：

| 工具 | 作用 |
|------|------|
| `ads_read_metrics` | 指定日期范围，按系列/组/广告的花费、展示、点击、CTR、CPM、留资/私信、主结果成本、频次 |
| `ads_compare_periods` | 两段时间对比（含 `this_week_vs_last_week`） |
| `ads_read_delivery_issues` | 拒审、WITH_ISSUES、学习受限、被上层暂停（最新快照） |
| `ads_read_funnel_stages` | 广告层漏斗读数（展示、链接点击、3s/完播、主结果） |

## 开关（每客户，非硬编码）

`clients.leads_config.ads_agent_investigation_tools === true` 时才注册工具并在 system prompt 里说明调查规则。

**启用 CTS（需 Ray / PM）**：对该客户 `leads_config` 写入 `"ads_agent_investigation_tools": true`（可用 SQL 或现有 clients JSON 维护入口）。

## 设计约束

- 模型只见名称 + 不透明 `entity_ref` / `account_ref`；平台对象 ID 不出现在工具 schema 与输出。
- 每条结果带 `evidence`（指标列表、日期范围、`data_freshness`、`could_not_read`）。
- 无 migration、无新表、未改 `boundaries.ts`。

## 代码

- `src/lib/ads-strategy/agent-chat/*`
- 接线：`src/lib/luban/project-tools.ts`（`buildProjectLubanToolsFull`）、`project-agent.ts`、`project-prompts.ts`
