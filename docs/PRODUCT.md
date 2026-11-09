# Magic Engine — 产品总览

> 更新于 2026-10-24。本文是产品定义的简明说明；如有冲突，以[冻结版产品定义 v1.0](./strategy/ME_PRODUCT_DEFINITION.md)为准。产品定义冻结于 2026-08-22，不代表其中列出的能力都已实现或已在生产运行。

相关规格：[功能地图与人机分工 v1（2026-10-16）](./specs/2026-10-16-feature-map-and-human-ai-division-v1.md) · [闭环工作流骨架（2026-10-18）](./specs/2026-10-18-me-closed-loop-skeleton-min-cost.md)。实现与运行证据见[系统状态](./STATE.md)。

## 产品定义

Magic Engine 是**数字营销增长智能系统**。它持续理解企业的市场、渠道、内容、客户旅程和营销结果，发现机会并排序，选择下一步最有价值的数字营销动作，通过受治理的 Connector 执行，验证结果，再把可靠经验带入下一轮决策。

产品价值来自可解释、可验证并能从 Outcome 中学习的营销智能；执行能力服务于这条闭环。

## 唯一端到端闭环：IMPACT

| 阶段 | 要回答的问题 | 主要产出 |
|---|---|---|
| **Inspect** | 目标、市场、渠道、内容和客户旅程现在是什么状态？ | 有来源的业务与营销证据 |
| **Measure** | 当前基线是什么，怎样公平比较结果？ | Baseline、Metric、Cohort、验证窗口和归因方案 |
| **Prescribe** | 哪个机会最值得处理，下一步做什么？ | 证据、预期价值、成本与风险可说明的排序建议 |
| **Act** | 怎样在授权范围内执行？ | 经审批的动作、执行记录和 Connector 回执 |
| **Check** | 动作带来了什么真实结果？ | 可核验的 Activation、Outcome 和归因结论 |
| **Tune** | 下一轮判断怎样改进？ | 有作用域、有证据的策略、Playbook 或 Memory 更新 |

没有 Check 和 Tune 的闭环，只能称为动作已执行，不能称为 IMPACT 已完成。

### DAPE 与 IMPACT

DAPE 是 ME 内部的工作方法：Discovery → Analysis → Prescription → Execution。它支持 IMPACT 前半段的一部分，不是第二条产品闭环，也不能代替 Check 或 Tune。

## 六个共享支柱

- **SEO**：搜索需求、网站内容和有机搜索表现。
- **AI Visibility / GEO**：品牌在 AI 搜索与回答中的可见度。
- **Social**：社媒内容、互动和发布结果。
- **Ads**：付费广告表现、机会与受治理的优化动作。
- **Reputation**：评价、口碑和本地商家表现。
- **Competitor Intelligence**：竞品、市场和渠道变化。

六个支柱共用 IMPACT、Measurement、Verification、Attribution、Kernel、Connector 与学习机制；支柱之间不各自复制一套执行底座。

## 目标、计划与人机分工

[功能地图 v1](./specs/2026-10-16-feature-map-and-human-ai-division-v1.md)确定了核心对象的分工：

| 对象 | 职责 |
|---|---|
| **Goal** | 描述希望达到的业务结果和期限，是营销判断的目标尺度 |
| **Marketing Plan** | 表示一轮营销活动及其草稿 / 批准状态 |
| **推广计划（`promo`）** | 描述为 Goal 采取的分阶段营销动作，并持续对照目标检查 |
| **每日计划** | 组织社媒每天要准备的内容 |
| **`execution_items`** | Agent 自己读取和消费的工作队列，不作为真人待办页面 |
| **今日待办** | 只呈现必须由真人处理的预算、审核和授权事项 |

AI 承担研究、分析、起草、日常核验和授权范围内的工作。真人负责资金预算审核、必要的内容 / 业务审核与授权；对外发布、花费和其他受控动作仍须经过对应授权闸。

## Connector 与外部系统

Connector 是 ME 感知外部状态、执行获准动作并接收结果的边界：

- **API** 用于稳定读取、同步和明确的动作调用。
- **Webhook / Event** 用于接收外部状态与结果变化。
- **MCP** 用于 Agent 在明确权限范围内按需查询和调用外部工具。
- 文件导入或人工确认只作缺少可靠接口时的受控备用路径。

CRM、预约、排班、库存、支付、财务和正式订单等经营系统仍由各自系统作为业务事实源。ME 只保存决策、验证和归因所需的最少引用、上下文、授权证据与结果，不复制完整业务系统。

## 共享平台与行业版本

- **平台层**：IMPACT、Measurement、Verification、Connector、Capability、Kernel、Governance、Attribution、Memory 与可复用 Intelligence。
- **行业层**：Playbook、Profile、Policy、Benchmark 和 Configuration。
- **客户层**：客户配置、已批准证据、外部账户连接及私有记忆。

复用要求见[平台化原则](./roadmap/2026-08-19-me2-platformization-principle.md)。新能力开发前应先判断它属于 IMPACT 哪一段、能否通过成熟 Connector 获取，以及自建是否真正增强 ME 的营销智能。

## 怎样衡量产品进展

优先衡量基线完整率、动作定义验证的比例、建议接受与授权执行情况、Activation 成功率、可比较 Outcome 比例、Outcome 回到下一轮决策的闭环率、从机会发现到拿到证据的时间，以及每客户人工投入。

产品应能在真实目标和外部系统上重复完成真实、可审计的 IMPACT 闭环，并证明上一轮 Outcome 改善了下一轮决策。具体实现状态与未完成工作分别见[系统状态](./STATE.md)和[路线图](./ROADMAP.md)。