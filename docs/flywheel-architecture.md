# Flywheel 数据闭环架构

> Phase 12.A 飞轮数据闭环的工程参考。读这一篇就能搞懂：数据怎么流、新 adapter 怎么加。

---

## 1. 系统目标

每一次「执行」（不论 Magic Engine 自研、编排第三方、还是 FDE 人工外部完成）都要：

1. 落一条 **action** 到统一表 → 知道做了什么。
2. 拉一条 **metric** 到统一表 → 知道做完之后效果。
3. 归因生成一条 **outcome** 卡片 → 告诉客户「这件事确实有用 / 没用 / 反向了」。

这三步组成飞轮数据闭环。所有 vendor（自研 / 第三方 / FDE）都必须把数据回流到 Magic Engine，这是核心护城河。

---

## 2. 四飞轮 × 三执行形态

| 飞轮 (`FlywheelName`) | 含义 |
|----|----|
| `seo` | SEO 内容引擎 |
| `geo` | AI 可见度 / GEO |
| `ads` | 多平台广告 |
| `social` | 社媒内容矩阵 |

| 执行形态 (`ExecutionMode`) | 含义 | 谁来跑 |
|----|----|----|
| `in_house` | Magic Engine 内自研工作台 | adapter 直接执行 |
| `third_party` | 编排第三方平台 | adapter 调外部 API + 记账 |
| `external_manual` | FDE 完全外部完成 | adapter 只记账 |

> 6 维度诊断 (`seo` / `ai_visibility` / `ads` / `social` / `reputation` / `competitor`) → 4 飞轮的映射见 [src/lib/flywheel/execution-target.ts](../src/lib/flywheel/execution-target.ts)：`reputation → geo`、`competitor → seo`。

---

## 3. 数据库三张表

迁移：[supabase/migrations/20260517000001_flywheel_data_skeleton.sql](../supabase/migrations/20260517000001_flywheel_data_skeleton.sql)

| 表 | 角色 | 关键列 |
|----|----|----|
| `flywheel_actions` | 谁、什么时候、做了什么 | `flywheel`, `action_type`, `execution_mode`, `vendor`, `expected_metric`, `expected_delta`, `executed_at` |
| `flywheel_metrics` | 可测量信号的时间序列 | `flywheel`, `metric_key`, `metric_value`, `source`, `measured_at` |
| `flywheel_outcomes` | action × metric 的归因结果 | `action_id`, `baseline_value`, `after_value`, `delta`, `verdict` |

`action_type` 和 `metric_key` 是受控词表 → 见 [src/lib/flywheel/vocabulary.ts](../src/lib/flywheel/vocabulary.ts)。Phase 12.A 只填了 GEO，其它飞轮 Phase 12.B 补。

---

## 4. 端到端数据流

```
                       ┌──────────────────────────────┐
   prescription action │  execution_items 表          │
   带 execution_target │  ↑ (P12.A.11/12 回填)        │
                       └──────────────┬───────────────┘
                                      │
                       ┌──────────────▼────────────────┐
       UI 点击「执行」 │  FlywheelDrawer.tsx           │
                       │  POST /api/flywheel/execute   │
                       └──────────────┬────────────────┘
                                      │ getAdapter(flywheel)
                       ┌──────────────▼────────────────┐
                       │  FlywheelAdapter.execute()    │ → INSERT flywheel_actions
                       └───────────────────────────────┘

   定时拉指标          ┌───────────────────────────────┐
   (cron / 手动触发)    │ FlywheelAdapter.pullMetrics() │ → INSERT flywheel_metrics
                       └───────────────────────────────┘

   定时归因            ┌────────────────────────────────────────┐
   /api/cron/         │  runAttributionJob()                   │
   attribution        │  扫 actions × 找前后 metric × 算 verdict│ → INSERT flywheel_outcomes
                       └────────────────────────────────────────┘

   执行看板            ┌──────────────────────────────┐
   显示 outcome chip   │  ClientExecutionPage         │  ← 读 flywheel_outcomes
                       └──────────────────────────────┘
```

核心组件位置：

- 接口契约：[src/lib/flywheel/adapters/types.ts](../src/lib/flywheel/adapters/types.ts)
- 注册中心：[src/lib/flywheel/adapters/registry.ts](../src/lib/flywheel/adapters/registry.ts)
- 执行 API：[src/app/api/flywheel/execute/route.ts](../src/app/api/flywheel/execute/route.ts)
- 归因 Job：[src/lib/flywheel/attribution/job.ts](../src/lib/flywheel/attribution/job.ts)
- 归因 Cron：[src/app/api/cron/attribution/route.ts](../src/app/api/cron/attribution/route.ts)
- UI 抽屉：[src/app/dashboard/clients/\[id\]/execution/_components/FlywheelDrawer.tsx](../src/app/dashboard/clients/[id]/execution/_components/FlywheelDrawer.tsx)

---

## 5. FlywheelAdapter 契约

每个 adapter 必须实现两个方法：

```ts
interface FlywheelAdapter {
  readonly flywheel: FlywheelName

  // 用户点「执行」时调用：必须写一行 flywheel_actions 并返回
  execute(input: ExecuteActionInput): Promise<FlywheelActionRow>

  // 定时 cron 调用：拉信号、写 flywheel_metrics
  pullMetrics(clientId: string, since?: Date): Promise<FlywheelMetricRow[]>
}
```

参考实现：[src/lib/flywheel/adapters/GeoComposerAdapter.ts](../src/lib/flywheel/adapters/GeoComposerAdapter.ts)。

---

## 6. 如何加一个新 adapter（10 步）

以加一个 `MetaAdsAdapter`（`ads` 飞轮，`third_party` 模式）为例：

### Step 1 — 扩词表
在 [vocabulary.ts](../src/lib/flywheel/vocabulary.ts) 填 `ADS_ACTION_TYPE` 和 `ADS_METRIC_KEY` 占位 const，并加上 `isValidAdsActionType` / `isValidAdsMetricKey` 校验函数。命名约定：

- `action_type` → `<flywheel>.<verb>_<noun>` （例：`ads.pause_keyword`）
- `metric_key`  → `<flywheel>.<noun>.<measure>` （例：`ads.campaign.cpa`）

### Step 2 — 更新 union 类型
把新 enum union 进 `FlywheelActionType` / `FlywheelMetricKey`，让 TS 在 switch 处暴露未处理分支。

### Step 3 — 写 adapter 文件
新建 `src/lib/flywheel/adapters/MetaAdsAdapter.ts`，`implements FlywheelAdapter`，`readonly flywheel = 'ads' as const`。

### Step 4 — 实现 `execute()`
最少做三件事：
1. 校验 `executionMode` 和 `actionType` 是否本 adapter 处理（不处理就 throw）。
2. 调真实 vendor API（third_party 模式）／本地工作台（in_house）／纯记账（external_manual）。
3. `INSERT INTO flywheel_actions` 拿到的 row 转成 `FlywheelActionRow` 返回。

### Step 5 — 实现 `pullMetrics()`
- 从 vendor API / 内部表读最近 N 天数据。
- 调 `writeXxxFlywheelMetrics()` 助手（参考 [writeTrackerMetrics.ts](../src/lib/flywheel/metrics/writeTrackerMetrics.ts)）写 `flywheel_metrics`。
- 不准备做的飞轮可临时 `return []` 占位，但必须留 TODO。

### Step 6 — 自注册
文件末尾加一行：
```ts
registerAdapter(new MetaAdsAdapter())
```

### Step 7 — 在 execute API 导入
在 [src/app/api/flywheel/execute/route.ts](../src/app/api/flywheel/execute/route.ts) 顶部加副作用 import：
```ts
import '@/lib/flywheel/adapters/MetaAdsAdapter'
```
（registry 是单例 Map，import 一次就够。）

### Step 8 — 更新 execution-target 映射
在 [execution-target.ts](../src/lib/flywheel/execution-target.ts) 的 `deriveExecutionTarget` 里，给新 flywheel + action_type 组合补 hint，让华佗处方能直接落 `execution_target`。

### Step 9 — 加单测
在 `src/lib/flywheel/adapters/__tests__/MetaAdsAdapter.test.ts` 覆盖：
- 拒绝错误的 `executionMode`
- 拒绝未知 `actionType`
- 成功路径写库 + 返回正确 row
- `pullMetrics` 至少一个 happy path

参考 [GeoComposerAdapter 测试](../src/lib/flywheel/adapters/__tests__/)。

### Step 10 — 接 cron（可选）
若该 adapter 的 `pullMetrics` 要自动跑，在 `src/app/api/cron/` 下加一条路由，定时调 `getAdapter('ads').pullMetrics(...)`，并在 `vercel.json` 注册 schedule。归因 job 不需要改，它自动覆盖所有飞轮。

---

## 7. 设计原则（不要偏离）

1. **统一表，不分库**。所有飞轮共用 3 张表 + 受控词表，跨飞轮归因才能工作。
2. **执行形态决定 vendor 调用，不影响落库格式**。`in_house` / `third_party` / `external_manual` 三种模式都写同样的 `flywheel_actions` 行。
3. **adapter 不许直接读 outcome**。outcome 是归因 job 产出物，adapter 只管 action + metric。
4. **action_type / metric_key 必须先进词表才能用**。`isValidXxxActionType` 在 `execute()` 入口卡住，防止脏数据。
5. **UI 不暴露 vendor 真名**。adapter 内部可用 `markisfact` / `meta`，呈现层用封装名（见 CLAUDE.md）。

---

## 8. 相关文档

- 数据库 schema：[supabase/migrations/20260517000001_flywheel_data_skeleton.sql](../supabase/migrations/20260517000001_flywheel_data_skeleton.sql)
- 整体路线图：[ROADMAP.md § Phase 12](../ROADMAP.md)
- 产品定位：[CLAUDE.md](../CLAUDE.md)
- 架构总览：[ARCHITECTURE.md](../ARCHITECTURE.md)
