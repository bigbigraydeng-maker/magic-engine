# Magic Engine

> **Digital Marketing Growth Intelligence System**（数字营销增长智能系统）
>
> Magic Engine 持续理解企业的市场、渠道、内容、客户旅程与营销结果，选择有价值的数字营销动作，通过连接器受控执行，验证真实结果，并让下一轮决策更好。

产品定位、责任边界和术语以冻结的[产品定义](./docs/strategy/ME_PRODUCT_DEFINITION.md)为准。产品定义说明产品应当是什么；[系统状态](./docs/STATE.md)记录代码、配置和带日期的运行证据。

## 产品闭环

IMPACT 是唯一的端到端产品闭环：

`Inspect → Measure → Prescribe → Act → Check → Tune`

DAPE 是内部发现、分析、处方和执行的方法，不替代 IMPACT 的 Check 与 Tune。

Magic Engine 面向六个共享数字营销支柱：SEO、AI Visibility / GEO、Social、Ads、Reputation 和 Competitor Intelligence。

## 从这里开始

| 文档 | 用途 |
|---|---|
| [产品定义（冻结 v1.0）](./docs/strategy/ME_PRODUCT_DEFINITION.md) | 产品定位、IMPACT、责任边界、Connector 和 Build vs Connect 的最高优先级定义 |
| [功能地图与人机分工 v1](./docs/specs/2026-10-16-feature-map-and-human-ai-division-v1.md) | Goal、Marketing Plan、每日计划、Agent 工作队列及真人职责 |
| [ME 闭环工作流骨架](./docs/specs/2026-10-18-me-closed-loop-skeleton-min-cost.md) | IMPACT 如何落到广告、社媒、出片和客户业务线 |
| [Agent 标准化流程 v1.0](./docs/specs/2026-10-18-me-agent-standard-process-v1.0.md) | 后台 Agent 的立项、规则、接线、试跑和巡检 |
| [产品总览](./docs/PRODUCT.md) | 产品定义的简明导读 |
| [技术架构](./docs/ARCHITECTURE.md) | 共享平台的逻辑分层与代码入口 |
| [系统状态](./docs/STATE.md) | 仓库快照、配置事实和各项运行证据的核验日期 |
| [未完成事项](./docs/ROADMAP.md) | 尚未完成的工程任务 |
| [单项规格](./docs/specs/) | 按功能保存的设计文档；截至 2026-10-24 没有完整目录索引 |
| [决策记录](./docs/DECISIONS.md) · [文档归档规则](./docs/FILING.md) | 已定决策与文档放置规则 |

## 本地开发

```bash
npm install
npm run dev
```

```bash
npm run build
npm test
npm run type-check
npm run test:e2e
```

具体环境和服务状态以对应文档及其核验日期为准；仓库配置不能单独证明生产服务当前正在运行。