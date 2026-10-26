# Magic Engine — 技术架构总览

> 更新于 2026-10-24。本文描述逻辑架构，不是生产运行清单。产品语义以[冻结版产品定义](./strategy/ME_PRODUCT_DEFINITION.md)为准；代码路径和运行证据见[系统状态](./STATE.md)。

主要产品规格：[功能地图与人机分工 v1](./specs/2026-10-16-feature-map-and-human-ai-division-v1.md) · [ME 闭环工作流骨架](./specs/2026-10-18-me-closed-loop-skeleton-min-cost.md)。模块细节见[`docs/specs/`](./specs/)中的单项规格。

## 1. 总体结构

```mermaid
flowchart LR
  G[业务目标与客户上下文] --> C[受治理的 Connector]
  C --> IM[Inspect 与 Measure]
  IM --> P[六个营销 Intelligence 支柱]
  P --> N[机会排序与 Next Best Action]
  N --> R[Prescribe]
  R --> A[审批、授权与受控执行]
  A --> X[Act：Kernel / Agent / Connector]
  X --> V[执行回执、Activation 与 Outcome]
  V --> CK[Check：验证与归因]
  CK --> T[Tune：Memory、Playbook 与下一轮判断]
  T --> IM
```

这是一条产品级 IMPACT 闭环。用户界面、API、Agent、Cron 和事件工作流是承载它的运行入口，不是另一套产品闭环。

## 2. 架构层

| 层 | 责任 | 主要对象或代码入口 |
|---|---|---|
| **目标与营销计划** | 保存目标、活动和阶段性营销动作 | Goal、Initiative、Marketing Plan、`plan_data.promo` |
| **数据接入** | 读取渠道状态、接收事件、在获准范围内执行动作 | API、Webhook / Event、MCP、Connector 与 Adapter |
| **Growth State 与 Measurement** | 形成有来源的当前状态、Baseline、Metric 与比较窗口 | 支柱数据、Measurement / Verification 合约 |
| **Intelligence** | 发现并比较六个支柱中的机会 | SEO、AI Visibility / GEO、Social、Ads、Reputation、Competitor |
| **处方与编排** | 把排序后的机会变成下一步动作和受控任务 | DAPE、Agent、Inngest、`execution_items` |
| **Governance 与执行** | 检查权限、授权、预算和风险，记录动作与回执 | Kernel、审批闸、`action_runs` / lineage、Connector |
| **Check 与 Tune** | 核验结果、归因、沉淀有边界的学习 | Outcome、Attribution、Flywheel、Memory、Playbook |

### IMPACT 和 DAPE

IMPACT 是产品、数据、执行和验收共同遵守的端到端 Operating Contract：Inspect → Measure → Prescribe → Act → Check → Tune。DAPE（Discovery → Analysis → Prescription → Execution）是内部工作方法，只服务其中一部分；没有 Check 和 Tune，不能宣称闭环完成。

## 3. 六个支柱共用底座

SEO、AI Visibility / GEO、Social、Ads、Reputation 和 Competitor Intelligence 可以定义各自的证据、指标和动作语义，但共用同一套目标、测量、验证、治理执行、归因和学习边界。不得为每个支柱另建平行 Kernel、Connector、Measurement 或 Memory。

## 4. 当前代码入口

以下路径在本文件所记录的 `main` 仓库快照中存在。路径存在只证明代码组织，不代表能力已接线、可用或在生产运行。

| 产品域 | 仓库代码入口 |
|---|---|
| SEO | `src/lib/seo/` · `seo-agent/` · `seo-intelligence/` · `keywords/` · `site-audit/` · `seo-meta/` |
| AI Visibility / GEO | `src/lib/ai-tracker/` · `geo/` · `geo-baseline/` · `geo-measurement*/` · `industry-ai-visibility/` |
| Social 与内容 | `src/lib/social/` · `content/` · `campaign/` · `reels/` · `factory/` · `content-factory/` |
| Ads | `src/lib/ads/` · `ads-strategy/` · `meta/` · `google-ads/` · `tiktok-ads/` |
| Reputation | `src/lib/reputation/` · `local-reviews/` · `gbp/` · `review/` |
| Competitor Intelligence | `src/lib/competitors/` · `market-intel/` · `dataforseo/` |
| 共享策略与执行 | `src/lib/strategy/` · `marketing-plan/` · `execution/` · `kernel/` · `kernel-approval/` · `action-bridge/` |
| 接线与学习 | `src/lib/inngest/` · `cron/` · `mcp/` · `flywheel/` · `memory/` · `ledger/` |

模块状态、API 路由与调度配置的数量，以及哪些事实有生产证据，统一记录在[系统状态](./STATE.md)并附核验时间。

## 5. 数据与治理边界

- **外部业务系统保有业务真相**：CRM、预约、订单、库存、支付、财务等系统通过 Connector 供 ME 获取必要事实或执行获准动作；ME 不复制它们的完整流程或数据集。
- **保存最少必要证据**：保存稳定外部对象引用、授权快照、动作 / 审批 / 回执、可比较 Outcome 和明确作用域的学习。
- **共享、行业、客户三层分离**：平台共用通用能力；行业差异放入 Playbook / Profile / Policy / Benchmark；客户差异放入配置、批准证据、账户连接和私有 Memory。
- **动作必须可审计**：Act 通过治理边界记录授权、执行者、执行结果和后续验证；产品规格不等于生产接线已经完成。

## 6. 规格与实现证据

- [产品定义](./strategy/ME_PRODUCT_DEFINITION.md)：产品职责、闭环、Connector、Build vs Connect 和行业边界。
- [功能地图](./specs/2026-10-16-feature-map-and-human-ai-division-v1.md)：Goal、营销计划、Agent 队列与人机职责。
- [闭环工作流骨架](./specs/2026-10-18-me-closed-loop-skeleton-min-cost.md)：各业务线连接 IMPACT 的检查结果和断点。
- [ME2 Kernel 契约](./specs/2026-08-08-me2-execution-kernel-v1.md)及相关规格：执行治理的细节。
- [系统状态](./STATE.md)：精确代码提交、仓库配置快照、生产证据日期和未知项。