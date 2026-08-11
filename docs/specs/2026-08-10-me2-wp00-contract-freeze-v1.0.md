# Magic Engine 2.0 · WP00 契约冻结 v1.0

> Issue [#873](https://github.com/bigbigraydeng-maker/magic-engine/issues/873) · 父史诗 [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872)
> 状态：**只有文档。** 本文不授权任何代码、schema、migration、配置、依赖、部署、生产写入或对外调用。
> 依据：2026-08-10 对 `origin/main`（`71e2e909`）与生产库做的**只读**勘查。
> 配套文档：
> · [GEO 测量契约 v1.0](./2026-08-10-me2-geo-measurement-contract-v1.0.md)
> · [页面优化共享能力 v1.0](./2026-08-10-me2-page-optimization-capability-v1.0.md)
> · [Roman GEO 参考闭环范围 v1.0](../clients/roman-hu/2026-08-10-geo-reference-loop-scope-v1.0.md)
> 前置事实来源：[执行内核 v1](./2026-08-08-me2-execution-kernel-v1.md)（PR #863，已合并）

---

## 1. 这份文档是什么 / 不是什么

**是**：Roman GEO 参考闭环（#872）动手之前，把边界、契约形状、治理规则和依赖顺序一次性钉死的那份文档。后面每一个 WP 都从这里取自己的边界，不再重新讨论。

**不是**：
- 不是实施计划（每个 WP 自己出）
- 不是架构提案（提案阶段已过，这里是冻结结果）
- 不是 schema 设计（WP03 才碰表；本文连列名都不定）
- 不是把已有系统重写的授权

**冻结的含义**：写进 §3–§13 的每一条，后续 WP 只能引用与实现，要改必须回到 #872 并留下改动理由。写进 §15 的每一条是未决，**必须以未决形态存在**，任何 WP 把它当成既定假设直接实现就是违约。

---

## 2. 真相源与证据优先级

同一件事有多个说法时，按下表取信，**高的赢**：

| 级别 | 来源 | 说明 |
|---|---|---|
| 1 | **生产库对象存在性**（`to_regclass` / `information_schema` / `pg_proc`） | 表在不在、列在不在、函数在不在，只有它说了算 |
| 2 | **`origin/main` 的代码** | 合并进主线的实现。分支上的代码不算 |
| 3 | **`origin/main` 的 migration 文件** | 说明**意图**。**不代表已 apply** —— 见 §9.1 |
| 4 | **仓库文档**（`docs/**`） | 会过时。与 1–3 冲突时以 1–3 为准，并就地修文档 |
| 5 | **GitHub issue / PR 正文** | 决策记录，但不是运行时事实 |
| 6 | **对话记忆 / agent 记忆** | 只作线索，不作证据。任何一条要落地都得先回到 1–3 核实 |

三条附加规则：

1. **「查不到」不等于「不存在」。** 查询返回空必须先排除「查错了表 / 查错了客户 / 被错误吞掉」，才能当结论。
2. **migration 文件名与版本号不能当 apply 证据。** 仓库账本会在 apply 时重编号（实测：仓库文件 `20260808000001_flywheel_outcomes_identity_expand.sql` 在生产账本里记成 `20260809020105`）。判定 apply 只认**对象存在性**。
3. **本文引用的每一个仓库路径、符号、表名都在 2026-08-10 逐个核对过。** 后续 WP 引用本文之前若发现某个对象已不存在，以对象为准并回来改本文。

---

## 3. 七层边界冻结

ME2 只有下面七个角色。**没有第八个。**

### 3.1 Agent（AI 推理）

| | |
|---|---|
| **拥有** | 用自然语言推理、提出假设、写解释、给排序建议 |
| **不拥有** | 执行权 · 授权权 · 定义动作身份的权 · 直接写库或写外部系统的权 |
| **红线** | **本史诗不新增任何 Agent。** 特别是不新增 Website Growth Agent / GEO Agent / SEO Agent / Page Agent（见 §12） |

Agent 可以**提出**任何动作；注册表认不出的一律 deny 并落一条 `deny_code='unknown_action'` 的决策记录（`src/lib/kernel/registry.ts` 已实现）。

### 3.2 Domain Module（域模块，负责推理）

| | |
|---|---|
| **拥有** | 把证据变成发现、把发现变成处方、把处方变成 **ActionCandidate**；给出 VerificationDefinition |
| **不拥有** | 执行 · 自我授权 · 直接改页面 · 直接改执行队列 · 直接调 provider |
| **红线** | Domain Module **永远不能自我授权**。它产出的是候选，不是命令 |

GEO Module（#879）是第一个 Domain Module。它是**模块，不是 Agent** —— 没有自己的人设文档、没有自己的执行循环、没有自己的对外出口。

### 3.3 Measurement（测量）

| | |
|---|---|
| **拥有** | 采集身份与解释身份 · 证据保全 · 可比性判定 · 覆盖率与成本的如实记录 |
| **不拥有** | 处方 · 执行 · 归因结论 |
| **红线** | 采集身份或解释身份对不上时必须产出 `not_comparable`，**不许降级成一个能比的数字** |

**身份分两层，不许混**：
- **采集身份** = 我们当时怎么问出来的（QuerySetVersion · query_key · engine family · model/version · locale · market · sample）。
- **解释身份** = 我们怎么把原始回答读成结构化指标的（parser 版本 · 指标 / 归类规则版本）。
- **parser 置信度不是身份，是质量信号与阈值** —— 它决定一条观测够不够格进统计，不决定它是不是「另一次观测」。

结构化指标可比的三条判据（缺一不可）：① 采集身份匹配；② 解释身份一致，**或**两侧都从不可变的原始回答用同一个 parser / 规则版本重新解析过；③ 置信度、覆盖率与失败率达到阈值。

详见 [GEO 测量契约 v1.0](./2026-08-10-me2-geo-measurement-contract-v1.0.md) §3、§6。

### 3.4 Shared Capability（共享能力，负责精确干活）

| | |
|---|---|
| **拥有** | 把一份请求准备成可评审的具体改动，并在被授权之后真的写出去、能验证、能撤回 |
| **不拥有** | 决定要不要做 · 决定什么时候做 · 绕过 Kernel 直接对外写 |
| **红线** | **`src/lib/capabilities/**` 之外不许存在任何 provider write import**（由 `.eslintrc.json` + 架构测试机器强制，详见 [页面能力契约 §7](./2026-08-10-me2-page-optimization-capability-v1.0.md)）；**apply / rollback 只能经 Kernel / Gateway 在授权之后执行** |

**「整个共享能力只能由 Kernel 调用」是错的**，授权之前本来就得先把东西准备出来给人看。正确的切法是**按有没有对外副作用切**：

| 段 | 谁能调 |
|---|---|
| **provider-neutral、non-write preparation workflow**（resolve 的路由判断 · draft · diff · deterministic validate） | **应用编排层可以直接调** —— 不产生 provider 写入 / 对外副作用 |
| snapshot / provider 侧读取 / 内部草稿落库 | **留在共享能力边界内**，生产启用前要先接上成本与政策治理；会花钱的读取必须有声明好的预算上限，**上限建立不起来就 fail closed** |
| apply / rollback（provider 写入入口） | **只能经 Kernel / Gateway，在拿到所需授权之后执行** |

🔴 **`non-write` 的准确含义（别读成「纯函数」）**：

- **`non-write` 只保证一件事** —— 不产生 provider 写入 / 对外副作用。
- **它不等于**零计算、不等于零模型调用、不等于零内部落库。
- **`draft` 可以是生成式的，也可能花钱**，同样输入两次的结果**可以不一样** —— 它是 `non-write`，但**不纯、也不必然确定性**。
- **`resolve` / `diff` / `deterministic validate` 在输入固定时是确定性的。**
- **`draft` 或 `snapshot` 期间用到的任何模型 / provider 调用，在生产启用之前都必须接上显式成本治理并声明上限**；上限建立不起来就 fail closed。「它只是准备阶段」不构成免于成本治理的理由。

Domain Module 可以产出 `PageOptimizationRequest`，但**不许自己调 provider 适配器，也不许自己读写页面**。详见 [页面优化共享能力 v1.0](./2026-08-10-me2-page-optimization-capability-v1.0.md) §1.1 与 §1.1.1。

### 3.5 Kernel（执行内核，负责治权）

| | |
|---|---|
| **拥有** | 授权 · ActionKey 政策 · 幂等 · 租约与代际 fencing · 成本上限 · 重试 · 审计 · lineage |
| **不拥有** | 业务判断 · 域语义 · 「这件事该不该做」的意见 |
| **红线** | 没有授权就执行不了任何东西；对外副作用**永远** per-action 授权，**永远没有全局开关** |

现状（`origin/main`）：代码已合并（PR #863），**生产 migration 未 apply**（§9.1），零调用方。

### 3.6 Attribution / Flywheel（归因飞轮）

| | |
|---|---|
| **拥有** | 分析投影：某个动作有没有把某个指标在某个窗口内推动 |
| **不拥有** | **执行权** · 授权权 · 决定动作生死的权 |
| **红线** | 归因是**分析投影，不是执行权威**。任何「归因说好就多做点」的自动放大回路本史诗不建 |

仓库现状可直接继承的三条：
- 自然键 `(action_id, metric_key, window_days)`，`evaluator_key` **不在键里**
- 每个 metric family **只有一个 evaluator 有写权**，非 owner 拒写而不是竞争（库层 `flywheel_outcomes_evaluator_owns_metric` 强制）
- `src/lib/flywheel/attribution/dual-window-gate.ts` 在生产**关着**，理由是 `src/lib/memory/learning-rollup.ts` 与 `src/lib/memory/extractor.ts` 仍按行数数 outcome 且不分页。**本史诗不打开它**

### 3.7 Operating Brief（注意力投影）

| | |
|---|---|
| **拥有** | 「现在该看什么」的排序与呈现 |
| **不拥有** | 业务真相 · 授权状态 · 执行权威 |
| **红线** | 生产者失败 ≠ 已解决 · 没有执行+验证就没有 AUTO_HANDLED · 关键失败永不静默 · **不许为了让条目数变少而藏起没做完的活** |

仓库现状：**没有叫 Operating Brief 的东西**。对应的现成载体是 `src/lib/pm-todo/`（`daily-todo.ts` / `manual-items.ts` / `action-link.ts` / `attribution-items.ts` / `auto-run-items.ts`），它已经实现了上面几条不变量（`dropBrokenLinks` 不把「没链接」当「链接坏了」；没有 href 时渲染器不画「去做这件事」按钮）。Operating Brief 本身是 **#886 backlog**，本史诗不开工。

---

## 4. Growth Module 五段契约

任何 Domain Module（GEO Module 是第一个）都按同一条五段链推理。**这是概念契约，不是类名清单**；WP01 负责把它落成纯类型与纯校验器。

```
observe  →  diagnose  →  prescribe  →  propose  →  verify
```

| 段 | 输入 | 输出 | 硬约束 |
|---|---|---|---|
| **observe** | Measurement 的观测与证据 | `Evidence[]` | 只读。不推断、不补值。拿不到数据要如实说「拿不到」，不能返回空当「没有」 |
| **diagnose** | `Evidence[]` | `Finding[]` | 每条 Finding 必须能指回至少一条 Evidence。指不回去的不许产出 |
| **prescribe** | `Finding[]` + 客户上下文 | `Prescription` | 说清做什么、不做什么、为什么现在。不含 provider 细节 |
| **propose** | `Prescription` | `ActionCandidate[]` + `VerificationDefinition` | **候选，不是命令。**不带授权、不落执行队列、不调 provider |
| **verify** | `VerificationDefinition` + 执行后的测量 | 验证结论 | 判据在**动作发生之前**就定死，不许事后挑一个好看的指标 |

三条通用红线：

1. **推理与执行分离。** 五段里没有任何一段可以写外部系统。
2. **propose 段的产物进 Kernel，不进看板。** 见 §7。
3. **verify 的判据必须先于执行确定。** 事后选指标 = 自证。

---

## 5. 五个概念结构

WP01（#877）负责把下面五个落成**纯类型 + 纯校验器 + 确定性适配器**，不碰数据库、不碰 UI、不碰 Kernel 调用方。

### 5.1 Evidence（证据）

一条可追溯的观测事实。至少要能回答：**哪来的**（观测身份 / 数据源）· **什么时候**（观测时刻）· **原始形态在哪**（原始响应或快照的定位）· **可信度**（parser 版本与置信度，或「不适用」）。

红线：Evidence **不可变**。重新解析产生的是**新的** Evidence，不是覆盖旧的。

### 5.2 Finding（发现）

一条有证据支撑的问题或机会陈述。至少要能回答：**是什么** · **凭哪几条 Evidence** · **有多严重 / 多值得** · **属于哪个支柱**。

红线：**没有 Evidence 引用的 Finding 不许存在。** 仓库既有的 `DiagnosticFinding`（`src/types/diagnostic.ts`）带 `evidence` 字段但**不强制**，ME2 侧强制。

### 5.3 Prescription（处方）

一段时间内「做什么、不做什么、资源怎么分」的说明。至少要能回答：**目标是什么** · **覆盖哪些 Finding** · **刻意不做什么** · **凭什么这么排**。

仓库既有 `prescriptions` 表（`src/types/diagnostic.ts` 的 `Prescription`）带 `goal_id` / `version` / `supersedes_id` / `supplements_id`。ME2 概念结构与它**语义相容**，但 WP01 **不得**沿用诸葛亮那套破坏性 supersede 语义（把旧的直接置 superseded），因为 ME2 的处方要能与 Kernel 的 append-only 授权账本对齐。

### 5.4 ActionCandidate（动作候选）

Domain Module 能产出的最强东西。它是**一个请求**，不是一次执行。至少要能回答：**想做的动作身份**（候选，尚未映射到 ActionKey）· **输入**（provider 中立）· **凭哪些 Finding / Evidence** · **预期影响与代价** · **配套的 VerificationDefinition**。

三条红线：
1. ActionCandidate **不带授权**。授权只能由 Kernel 依据客户政策签发。
2. ActionCandidate **不进 `execution_items`**（§7）。
3. ActionCandidate 的动作身份要经 §8 的治理才能变成 ActionKey；映射不上的**必须拒绝并留痕**，不许静默丢弃。

### 5.5 VerificationDefinition（验证定义）

在动作发生**之前**写下的判据。至少要能回答：**看哪个指标** · **在哪个窗口** · **拿什么做对照** · **什么算成功 / 失败 / 无法判定**。

红线：必须允许「**无法判定**」这个结论。只有成功和失败两档的验证定义会逼着系统在证据不足时编一个答案。

---

## 6. 为什么 `PriorityAction` 不是 ME2 的规范类型

这是一条**冻结的否定**，理由可举证：

| 证据 | 位置 |
|---|---|
| `action_type` 是**自由文本 `string`**，不是封闭词汇表 | `src/lib/zhuge/types.ts` 的 `interface PriorityAction` |
| 生成端仍是开放词汇表：prompt 只要求「`action_type` 是一个 snake_case 短词」 | `src/lib/zhuge/conductor.ts`；Kernel spec §11 缺口 #1 已登记 |
| 现实后果：36 种自由文本里已经出现同义重复（`diversify_meta_ad_creatives` 与 `diversify_meta_creatives`） | Kernel spec `src/lib/kernel/types.ts` 顶部注释 |
| 它的载体 `execution_items` 是**人看的意图卡 / 看板**，不是执行台账 | `src/lib/kernel/boundaries.ts` 的 `EXECUTION_ITEMS_WRITERS_GRANDFATHERED` 注释 |
| 它已被看板显示逻辑绑死（`source` 字段决定分组与跳过） | `src/app/dashboard/clients/[id]/execution/execution-view-model.ts` |

把 `PriorityAction` 抬成平台规范类型，等于把「AI 现编的字符串」抬成执行身份 —— 那正是 Kernel 的封闭 `ActionKey` 要解决的问题。

**允许的做法**：WP01 可以写**单向、确定性**的兼容适配器（legacy 形状 → ME2 概念结构），且只在语义完整时才映射；语义缺失的字段**必须标为未知**，不许补默认值。

**不允许的做法**：让 ME2 类型 `extends PriorityAction`；把 ME2 的动作身份存成 `action_type` 字符串；把 `source='proactive_signal'` 当成 ME2 核心契约的一部分（它是历史看板标签，已被 `execution-view-model.ts`、`src/lib/execution/endorsement.ts` 与 migration `20260604000003` 的 CHECK 分支三处绑死）。

---

## 7. 为什么 `writeExecutionItems` 不是 WP01 的执行路径 + legacy auto-run 的冻结规则

### 7.1 `writeExecutionItems` 不做 ME2 执行路径

| 理由 | 证据 |
|---|---|
| `execution_items` 的定位是**意图卡**，不是执行引擎 | `src/lib/kernel/boundaries.ts` 注释（ADR-001 裁定） |
| 直接写入方已被冻结成 15 人白名单，**只准变短** | `EXECUTION_ITEMS_WRITERS_GRANDFATHERED`（`src/lib/kernel/boundaries.ts`） |
| 写进去的东西没有授权记录、没有幂等键、没有成本上限、没有验证、没有 lineage | 对比 `action_runs` / `authorization_decisions` 的字段集 |
| 它承载破坏性 supersede 语义（系统把旧 pending 卡置 `superseded`） | `src/types/diagnostic.ts` 的 `ExecutionItemStatus` 注释 + `src/lib/zhuge/action-persister.ts` |

**冻结**：WP01 不 import `writeExecutionItems`，不 import `persistZhugeActions`，不产生任何 `execution_items` 行。ME2 要让系统做事只有一条路 —— 提交一个 `action_run`。

### 7.2 `src/lib/execution/auto-run.ts` —— 既有的、活着的、不经过 Kernel 的执行路径

这是本史诗最容易被忽略的一条既有事实，必须写下来：

- 位置：`src/lib/execution/auto-run.ts`（PR #854，`[P22.E.S19]`），配套 `src/lib/execution/auto-run-policy.ts` / `endorsement.ts` / `src/lib/pm-todo/auto-run-items.ts`
- 它做什么：cron 驱动，认领 `execution_items` 里的候选，**真的调用** `generateWeeklyBlogForClient` 写出 `blog_posts.status='draft'`
- 现有护栏：一轮最多 3 件（`MAX_ITEMS_PER_RUN`）、每客户最多 1 件（`MAX_ITEMS_PER_CLIENT`）、失败 3 次停手（`MAX_ATTEMPTS`）并下发今日待办、只跑白名单动作类型、产物只到草稿
- 它**不经过** Kernel 的授权、政策、幂等键、成本上限与 lineage

**冻结规则（五条，全部是「不做」）**：

1. **WP00 不修改、不禁用、不降频它。** 它是现有生产行为，ME2 的契约工作不许悄悄改变它。
2. **WP01 与任何新的 ME2 Domain Module 不得扩展它** —— 不加新的 action type、不加新的调用方、不改它的判定逻辑。
3. **新的 ME2 ActionCandidate 不得进入它。** 两条执行路径并存是过渡态，不是可以互相灌数据的通道。
4. **它的迁移或下架需要单独立 issue 与单独 PR**，不许夹带在 ME2 的任何 WP 里。
5. **本史诗结束时它仍然应该在跑。** 如果某个 WP 让它停了或改了行为，那就是这个 WP 越界了。

---

## 8. ActionCandidate → ActionKey 治理

归属：**K-WP02（#882）**。本节冻结它的规则。

### 8.1 ActionKey 是封闭的、代码内的、类型层的

```
// src/lib/kernel/types.ts —— 现状
export type ActionKey = 'seo.build_publish_package'
```

**这是一个只有一个成员的 TypeScript 封闭联合类型。** 结论：

- 新增一个 GEO / Page 动作是**类型层改动**，必须走 PR，agent 运行时改不了，PM 在库里也改不了
- 「注册表里加一行配置」这个说法不成立 —— 定义在 `src/lib/kernel/registry.ts` 的代码里
- 未知 key 一律 deny 并落 `deny_code='unknown_action'` 的决策记录（已实现）

### 8.2 CAN / SHOULD / AUTHORIZED 三分

三个问题必须由三个不同的层回答，任何一层都不许替另一层回答：

| 问题 | 谁答 | 载体 | 答「否」的后果 |
|---|---|---|---|
| **CAN** —— 平台**有没有**这个能力，它长什么样、多大风险、副作用在哪 | 平台（代码） | `ActionDefinition`（`src/lib/kernel/registry.ts`） | 认不出 → `unknown_action` deny |
| **SHOULD** —— 这个客户**要不要**做这类事，自动还是要人点头，花钱上限多少 | 客户政策（数据库） | `client_automation_policies` | 查不到政策行 = **deny**，不是给个默认值 |
| **AUTHORIZED** —— 这一次**准不准**做 | Kernel 每次判定 | `authorization_decisions`（append-only） | 落一条带机器可读 `deny_code` 的记录 |

**Domain Module 三个都不答。** 它只产出候选。

### 8.3 映射规则

1. ActionCandidate 的动作身份是**候选身份**，必须经过一次显式映射才能成为 ActionKey。
2. **映射不上 = 拒绝 + 留痕**，不是静默跳过。理由：「AI 提了个我们没实现的动作」这件事必须有人看得见。
3. **不许有自由文本旁路。** 任何允许「传一个字符串当动作身份」的接口都等于把封闭词汇表作废。
4. **注册表要反向注入生成端 prompt。** 归 K-WP02。不补的话，注册表只是从「36 种自由文本」变成「36 种自由文本 + 一张对不上的表」（Kernel spec §11 缺口 #1）。
5. 契约变更即 `version` +1；新旧版本**不许互相兑换授权**。

### 8.4 per-action 副作用政策

现有分级（`src/lib/kernel/types.ts` 的 `SideEffectClass`）：

| 值 | 含义 | Kernel v1 现状 |
|---|---|---|
| `none` | 无副作用 | 允许 |
| `internal_write` | 只写 ME 自己的库 | 允许（v1 唯一上线能力属于这一档） |
| `external_read` | 读外部（会花钱，不改对方状态） | 允许 |
| `outward` | 会作用到客户自有资产之外 / 改客户线上资产 | **授权层与 Gateway 各拒一次** |

**冻结**：
- 让 GEO / Page 动作能真正对外执行，必须由 K-WP02 引入**逐个动作**的对外副作用授权，**永远不设全局开关、不设环境变量旁路、不设 `if (process.env.X) skipCheck` 之类的口子**。
- 每一个对外动作在授权之前必须逐条确认 `providerIdempotency`（`not_applicable` / `supported` / `unsupported`）。**不支持幂等键的 provider，要么不接，要么在 `ActionDefinition` 里显式标注「只能保证 at-least-once」并让授权层按此判风险**（Kernel spec §11 缺口 #11）。不许用「有租约了所以没事」糊过去 —— 租约拦得住记账，拦不住已经发出去的那个调用。
- 收费动作必须在契约里说清每一步的成本上界；**说不出上界的付费步骤一律 fail closed**。

---

## 9. Kernel readiness gates

### 9.1 生产 migration 未 apply（2026-08-10 只读勘查结论）

**结论：`supabase/migrations/20260808000003_me2_execution_kernel_v1.sql` 在生产未 apply。**

判定用的是**对象存在性 preflight**，不是文件名 / 版本号比对：

```sql
-- 期望：全部返回 null / 0，才叫「未 apply」
SELECT to_regclass('public.action_runs'),
       to_regclass('public.action_run_steps'),
       to_regclass('public.authorization_decisions'),
       to_regclass('public.client_automation_policies'),
       to_regclass('public.kernel_action_lineage');
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'flywheel_actions' AND column_name = 'action_run_id';
SELECT count(*) FROM pg_proc WHERE proname LIKE 'kernel!_%' ESCAPE '!';
```

2026-08-10 实测：四张表与 lineage 视图**全部不存在**，`flywheel_actions.action_run_id` 列**不存在**，`kernel_*` RPC **一个都没有**。

**为什么不能只看版本号**：账本会在 apply 时重编号 —— 仓库文件 `20260808000001_flywheel_outcomes_identity_expand.sql` 在生产账本里记成 `20260809020105`。所以「账本里查不到这个版本号」既可能是没 apply，也可能是被重编号了。**只有对象存在性是硬证据。**

**由此直接推出的三条现状**：
- `src/lib/kernel/lineage.ts` 的 `loadActionLineage()` 与 SQL 视图 `kernel_action_lineage` 在生产**都跑不起来**
- 任何读 `action_runs` 的界面今天都会拿到「表不存在」错误
- Kernel 目前是**完全空转**：零调用方、零 cron、零现有路径经过它

### 9.2 migration 的应用规则（冻结）

**核心区分：生产 apply 是「启用闸门」，不是「写代码 / 合代码的前置」。**

1. **apply 是一次单独授权的运维动作**，必须 PM 显式 `go`。
2. **绝不藏在 PR 里。** 任何代码 PR 都不许在合并时自动 apply。
3. **apply 不是 K-WP01 / K-WP02 写代码或合代码的前置。** 两者都可以用仓库现成的内存假件（`src/lib/kernel/__tests__/fake-supabase.ts`）与本地测试设施开发并合并。
4. **apply + apply 后自验是下面这些事的前置**，缺一不可：
   - 启用审批入口
   - 建任何真实的客户政策行
   - 让系统产生任何 `pending_approval`
   - 跑生产端到端验证
5. apply 前跑 §9.1 的 preflight；apply 后必须跑 Kernel spec §10 的自验（四张表 RLS 都写了 `TO service_role` · 认领 RPC 权限已收口 · append-only 触发器在 · 双向 Goal 约束真的挡得住）。
6. 回滚脚本已在 Kernel spec §10 写好；新表无数据、无调用方，可直接 drop。
7. 🔴 **如果某项验证在 apply 之前跑不了，就如实说「这一项要等 apply 之后才能验」** —— **绝不为了让一个测试变绿而提前 apply**。提前 apply 换来的绿灯是假的，而且它把一次需要单独授权的运维动作偷偷变成了 PR 的副产品。
8. **本次编辑阶段不再做任何生产查询。**

### 9.3 Enable 前的硬前提（原样继承 Kernel spec §11）

| 编号 | 内容 | 归属 |
|---|---|---|
| `KERNEL-E7-APPROVAL-SURFACE` | 认证过的操作者身份（不信请求体里的 `approvedByUser`）· 真能读到 run + 当前 pending 决策的界面或接口 · 同意走 `approveAndRun` · 不做走 `rejectPendingRun` · settled / stale 如实反馈 · 客户归属与授权校验 · 审批操作留审计。**七件缺一不可** | **K-WP01（#881）** |
| `KERNEL-E8-ACTIVE-BRIEF-SELECTION` | `build-publish-package` 读 `master_briefs` 是无状态过滤、无排序的 `limit(1)`；启用前必须只选 active、多版本确定性排序、**没有 active 必须 fail closed** | 接第一个真实调用方之前 |
| `KERNEL-E9-IDEMPOTENCY-LINEAGE-SEMANTICS` | 幂等键不含 `goal_id` / `execution_item_id`；同一份内容换一个 Goal 再提交会命中第一条 run，第二个目标的 lineage 就没了。A（归因对不上就拒绝）与 B（产物唯一、另记 lineage 关联）两条路都成立。**语义没定之前不许偷偷改幂等键** | **未决 · PM 拍板**（§15 U6） |
| `KERNEL-E10-ATOMIC-AUTO-DECISION` | 自动放行 / 转人工是「先插决策行、再做带代际的 run 写入」两句；owner 在两句之间崩溃会在审计表留下一条从未生效的 allow。**不是越权、不是重复副作用**，但审计表会误导人 | 接第一个真实调用方之前 |
| 政策 Settings UI | `client_automation_policies` 既没有表也没有界面。CLAUDE.md 铁律 8：FDE/PM 要填的字段必须连 Settings UI 一起做完 | **K-WP01（#881）** |
| `spend_cap_per_period_usd` | RESERVED · NOT ENFORCED · **设置页先别暴露**（只有列没有判定逻辑，显示出来 = 假的安全感） | 沿用现状，不在本史诗解决 |

### 9.4 审批的最低要求（冻结）

- **审批必须来自认证过的会话**，不许从请求体读操作者身份。
- **不许有假的审批入口。** 没有真实可达的界面时，待办文案必须如实说「入口还没上线、这条已经安全停住」，并且**不给 action URL**（`src/lib/kernel/handoff.ts` 已经这么做了，两条守卫测试盯着不许回退）。
- **pending 不等于可执行。** 一条挂在 `pending_approval` 的 run 在有人真的点头之前，不许被任何界面呈现成「已安排」「进行中」或「已处理」。
- 已结束 / 已被别人处理的必须如实反馈（`not_pending` / `decision_not_current`），不许假装还在等。

---

## 10. Lineage —— 概念生命周期 ↔ 仓库现状映射

#872 写的那条链是**概念生命周期**，**不是**「这八个 ID 都已经存在」的事实声明。下表是逐个核对后的真实对应关系。

| 概念阶段 | 仓库原生标识 / 结构 | 状态 | 缺什么 | 谁来决 |
|---|---|---|---|---|
| `goal_id` | `goals.id` | ✅ 存在（生产有数据） | — | — |
| `loop_run_id` | **无对应物** | ❌ 仓库里没有「一次完整闭环」这个概念 | 需要它才能把「同一轮 D→A→P→E」串起来 | **Build Control Room**（U4） |
| `action_instance_id` | `action_runs.id` | ⚠️ 代码已合并，**表在生产不存在** | 先 apply migration | 运维（单独授权） |
| `authorization_decision_id` | `authorization_decisions.id` | ⚠️ 同上 | 同上 | 同上 |
| `execution_attempt_id` | `action_run_steps.id` + `action_run_steps.attempt`（整数） | ⚠️ 是「步骤行 + 尝试序号」，**不是独立的 attempt 实体** | 要不要把 attempt 提成一等实体 | **Build Control Room**（U4） |
| `verification_id` | `action_run_steps.verification`（内嵌 JSON，`VerificationResult`） | ❌ **不是一等 ID** | 没有可被外部引用的验证标识 | **Build Control Room**（U4） |
| `outcome_id` | `flywheel_outcomes.id`（自然键 `action_id, metric_key, window_days`） | ✅ 存在（生产有数据） | — | — |
| `learning_record_id` | 分散在 `client_proven_patterns` / `client_failed_experiments` / `global_learned_lessons` **三张表** | ❌ **没有单一学习记录 ID** | 统一身份或明确放弃统一 | **Build Control Room**（U4） |

**冻结**：
1. **WP00 不发明 `loop_run_id`、`verification_id` 或统一的 `learning_record_id`。** 本文只做映射与登记。
2. 后续任何 WP 想引入其中任何一个，都要单独说明它解决什么问题、落在哪张表、谁写谁读，并接受它是 schema 改动（需 WP03 或单独 issue + 单独授权的 migration）。
3. 在这三个概念落地之前，**文档与代码里不许把它们写成已存在**。
4. Kernel 已提供的一条真实 lineage 边是 `flywheel_actions.action_run_id`（migration 新增的可空列，**当前生产不存在**）。它是 `action_run` 与归因之间唯一的桥。

---

## 11. WP 依赖顺序与合并门槛

### 11.1 依赖图

**代码依赖**（谁必须先合，别人才能写）：

```
WP00 #873  契约冻结（本文，docs-only）
  │
  └─ WP01 #877  纯 Growth Module 契约类型 / 校验器 / 适配器
       │
       ├─ K-WP02 #882  ActionCandidate→ActionKey 治理 + 副作用政策 + 注册表反向注入
       │      │        （纯代码；合并不启用调用方 / 政策 / pending）
       │      │
       │      └─ K-WP01 #881  认证审批 / 拒绝界面 + 政策 Settings UI
       │                      （用仓库假件与本地测试设施开发并合并，
       │                       **不以生产 apply 为写代码或合代码的前置**）
       │
       ├─ WP02 #876  GEO 测量运行时契约 + legacy 映射
       │      └─ WP03 #875  不可变测量存储（含 migration；apply 单独授权）
       │            └─ WP04 #874  测量执行 + 成本 / 覆盖率控制
       │                  └─ WP08 #883  Roman 查询集批准 + 基线（★ 不依赖 WP07）
       │
       ├─ WP05 #879  GEO Module v1（需 WP01 + WP02 + 本文的 Page 请求契约）
       │
       └─ WP06 #878  共享 Page 能力：resolve / snapshot / draft / diff / validate
              └─ WP07 #880  Kernel 授权的 apply / verify / rollback
                            （需 WP06 + K-WP01 + K-WP02 全部合并）

WP09 #884  Roman 首次 1–3 页优化   ← 需 WP05 + WP07 + K-WP01 + K-WP02 + WP08
  └─ WP10 #885  T+7 / T+14 / T+28 复测与学习记录

独立并行（不并入本链）：
  #886  Operating Brief 注意力投影（backlog，参考闭环架构稳定前不开工）
  #887  广告安全 + 在服客户正确性泳道（与 GEO 架构无关，不许夹带进 WP00/WP01）
```

**启用闸门**（跟上面那张图是**两回事**，不要混）：

```
★ 单独授权的运维动作：apply 20260808000003（PM go · 不进任何 PR）
     ↓ 它是下面这些事的前置，不是写代码 / 合代码的前置
   · 启用审批入口
   · 建任何真实客户政策行
   · 让系统产生任何 pending_approval
   · 跑生产端到端验证
```

### 11.2 K-WP 排序（冻结）

**契约 / 设计顺序：WP00 → WP01 → K-WP02 → K-WP01。**
**生产 apply 是横切的启用闸门，不排在这条代码链里。**

理由：

1. **审批界面要展示的正是 K-WP02 定义的词汇** —— 副作用等级、CAN 与 AUTHORIZED 的差别、成本上限、机器可读的 deny 码。先做界面会把一套还没定义的决策词汇写死，K-WP02 再改就是返工。**这是 K-WP02 在前的主要理由。**
2. **K-WP02 是纯代码**：产物全部落在注册表与策略类型里，用仓库现成的内存假件（`src/lib/kernel/__tests__/fake-supabase.ts`）就能完整验证。
3. **K-WP01 同样可以用仓库假件与本地测试设施开发并合并。** 它的服务端路径、租户校验、stale 处理、审计写入都能对着假件验。**不要把「生产表还不存在」写成「K-WP01 不能写、不能合」** —— 那会把一个运维授权变成代码进度的人质。
4. **K-WP02 合并不违反 `KERNEL-E7`。** E7 拦的是「Enable 任何可能产生 `pending_approval` 的动作」。K-WP02 只注册契约：没有调用方、没有政策行，**产生不出任何 pending**。

**两条合并门槛（冻结）**：
- **K-WP02** 可在不启用调用方、不插政策行、不产生任何 pending 审批行为的前提下合并。
- **K-WP01** 可在用假件 / 本地测试设施验证的前提下合并；**但它交付的审批入口在生产 apply 与 apply 后自验完成之前不许启用**。

**诚实性要求**：K-WP01 的生产端到端验证在 apply 之前跑不了。**这个限制要如实写进 PR 里**（「这几项待 apply 后补验」），**不许为了让它变绿而提前 apply**（§9.2 第 7 条）。

**归属澄清**：
- **注册表→prompt 的动作词汇表强制** 属于 **K-WP02**。
- **认证审批 / 拒绝界面 + 必需的政策 Settings UI** 属于 **K-WP01**。
- **#881 原文里「Verify production Kernel migration status」这一步 WP00 已经做完了（未 apply，见 §9.1）**；#881 应改为「申请授权、执行 apply、并在 apply 后完成自验与启用」，不要重复验证，也不要把 apply 写成它的合并前置。

### 11.3 合并门槛（继承 #872 并补两条）

- WP00 必须先合，其余实施 PR 才能开工
- WP01 必须先合，域运行时工作才能开工
- WP02 与 WP06 在 WP01 之后、各自依赖满足时可并行
- K-WP01 / K-WP02 必须先合，WP07 / WP09 的真实执行才能开
- **生产 apply 是启用闸门，不是代码合并前置**（§9.2）。反过来，**启用审批入口 / 建政策行 / 产生 pending / 跑生产端到端，一律要等 apply 与 apply 后自验完成**
- Roman WP08 → WP09 → WP10 严格串行
- 每个 WP 都要能独立评审、独立合并
- **任何 PR 都不许静默 apply 生产 migration**
- **PR #844 不许合并**（§12）
- 【补】**任何 PR 都不许改变 `src/lib/execution/auto-run.ts` 的现有生产行为**（§7.2）
- 【补】**任何 PR 都不许引入全局对外副作用旁路**（§8.4）

### 11.4 每个后续 issue 的边界与依赖

| Issue | 边界（**只做这些**） | 明确不做 | 依赖 | 冻结出处 |
|---|---|---|---|---|
| **#877 WP01** | Evidence / Finding / Prescription / ActionCandidate / VerificationDefinition 的纯类型 + 纯校验器 + 确定性适配器；Kernel-ready 的动作身份形状 | 不建表 · 不改 schema · 不做 UI · 不调 Kernel · 不实现域逻辑 · 不调 provider · **不 import `writeExecutionItems`** · 不 extends `PriorityAction` · 不摘 PR #844 的 planner · 不新增 Agent | WP00 | §4 §5 §6 §7 |
| **#876 WP02** | **采集身份七项 + 三层 sample 概念 + 解释身份** · 不可变类型 · **七个指标**（owned-domain 与 owned-page 两档分离）· **三条可比性判据**与 `not_comparable` · legacy 保守映射 | 不做 migration · 不跑真实外部测量 · 不碰 Page · 不新增 Agent · 不把 sample 写成一个含混字段 · 不把置信度当身份维度 | WP00 + WP01 | GEO 契约 §3–§8 |
| **#875 WP03** | 版本化查询集 / 批次 / 观测 / 证据 / **域名归属与页面关联（分开）** / 解释身份元数据的**新增式**存储；租户隔离与 lineage | 不静默 apply · 不跑测量 · 不写页面 · 不改历史观测 | WP02 | GEO 契约 §4 §9 |
| **#874 WP04** | 合约内批量执行 · 覆盖率记录 · 解释身份与置信度的如实落库 · 预算估计 / 上限 / 停手 · 诚实的部分覆盖结果 · 外部调用的重试与幂等 | 队列身份不同的结果不许当可比 · 成本 / 覆盖失败不许静默转成功 · 不许超出授权额度 | WP02 + WP03（跑真实测量需要 WP03 的 migration 已 apply） | GEO 契约 §6 §7 |
| **#879 WP05** | Evidence→Finding→Prescription→ActionCandidate；产出 provider 中立的 `PageOptimizationRequest`；附观测 lineage 与 VerificationDefinition；保留 own / defer / unattributable | **不写页面** · **不自我授权** · 不建独立 Agent · 不直接改执行队列 | WP01 + WP02 + 本文的 Page 请求契约 | §3.2 §4 §5 · Page 契约 §2 |
| **#878 WP06** | resolve（**路由决策**与**规范页面身份**分开）→ snapshot → draft → diff → validate；不可变 before 快照；语义与 provider 校验；人可读 diff；乐观并发元数据；现有 CMS 客户端走适配器；**draft 与 snapshot 的模型 / provider 调用都要声明成本上限** | **non-write（无 provider 写入 / 无对外副作用）** · facade 先行不搬现有 generator · 普通页面不用 Google Indexing API · `publish_geo_snippet` 不做主干预 · non-write preparation workflow 不 import 任何 provider write module · **不把 `non-write` 说成「纯」或「免费」** | WP00（WP01 之后可与 GEO 运行时并行） | Page 契约 §1.1 §1.1.1 §3–§7 |
| **#880 WP07** | ActionKey 映射 · per-action 副作用政策 · provider 感知的幂等与 stale-snapshot 检查 · 执行回执 · **两类验证失败的分流处置** · 回滚记录 · GitHub PR 优先、WordPress 草稿审核优先 | 无全局对外旁路 · 无假审批链接 · 无假成功 · lineage 不许缺段 · **绝不为了「验证一下」而再写一次** | WP06 + K-WP01 + K-WP02 | Page 契约 §3.8 §4 §8 §9 |
| **#881 K-WP01** | 认证过的审批 / 拒绝界面与服务端路径 · 租户授权 · 决策审计 · stale 提案处理 · pending / rejected / expired 安全态 · **政策 Settings UI** | 不信请求体身份 · 不跨客户 · 生产者 / 通知失败不当已解决 · 不造假入口 · **不许为了跑通端到端而提前 apply** | **代码依赖：K-WP02**（用仓库假件 / 本地测试设施即可开发与合并）· **启用依赖：生产 apply + apply 后自验** | §9.2 §9.3 §9.4 §11.2 |
| **#882 K-WP02** | ActionCandidate→ActionKey 治理映射 · 首批 GEO/Page 动作的注册表政策 · CAN/SHOULD/AUTHORIZED 分离 · 幂等 / 租约 / 重试 / 审计语义 · per-action 对外副作用分级 · 外部调用前的成本上限 · **注册表反向注入 prompt** | 未知 / 自由文本身份不可执行 · Domain Module 不能自我授权 · **全局对外旁路仍然禁止** · 合并时不启用调用方 / 政策 / pending 行为 | WP00 + WP01 | §8 §11.2 |
| **#883 WP08** | 确认 Roman 的规范业务 / 实体 / 页面集合 · PM 批准不可变查询集版本 · 定引擎 / 模型 / 语言 / 市场 / **样本计划** · 定**测量计划**（节奏、预算）· 只走受治理的测量路径跑基线 · 记录证据 / 覆盖 / 成本 / 采集身份 / 解释身份 | 不做页面优化 · 不做线上内容写入 · **不把节奏当成观测身份的一部分** · 页面台账缺失时不许把 owned-page citation 报成 0 | WP02 + WP03 + WP04（**不依赖 WP07**） | Roman 文档 §4 |
| **#884 WP09** | 选 1–3 个规范页面 · GEO Module 出 findings / 处方 / ActionCandidate / `PageOptimizationRequest` · Page 能力出可评审 diff · 人工授权 · Kernel 授权的 apply + 回执 + 回滚路径 | 不做无关 SEO / 平台重构 · 变更范围不超过 3 页 | WP05 + WP07 + K-WP01 + K-WP02 + WP08 | Roman 文档 §5 |
| **#885 WP10** | T+7 / T+14 / T+28 同队列测量 · 归因前的**三条**可比性闸 · 结果分类（含 own / defer / unattributable）· 关联干预 / 验证 / 测量 · 落学习记录 | 不许用不匹配队列宣称提升 · 覆盖 / 成本 / 解释身份差异必须可见 · **不许只升级 parser 就直接比新旧数字** · 学习记录**不授予自主执行权** | WP09 | Roman 文档 §6 §7 |
| **#886 Backlog** | Operating Brief 注意力投影 | **参考闭环架构稳定前不开工**；WP00–WP01 期间不碰 | — | §3.7 |
| **#887 安全泳道** | 广告 boost 护栏 · `new_ad_default_status` 的只读生产审计 · 博客 / reel 草稿只对在服客户生成 | **不许夹带进 WP00 / WP01**；发现所有权或风险不同就拆成独立 PR | 与本链无依赖 | §13 |

---

## 12. PR #844 的 supersession

**结论：[PR #844](https://github.com/bigbigraydeng-maker/magic-engine/pull/844) 不合并、不改造、不摘取其 planner。**

状态（2026-08-10 实读）：OPEN / **DRAFT**，6 文件 / +782 行，未合并。

理由，逐条可举证。⚠️ 下表「证据」列里的 `src/lib/website-agent/**` 与 `docs/agents/60-website-growth.md` **只存在于 PR #844 的分支上，主线没有这些文件** —— 引用它们是为了说明这个 PR 会引入什么，不是描述仓库现状：

| # | 冲突 | 证据（PR #844 分支内，**非主线**） |
|---|---|---|
| 1 | 它建的是一个**独立 Agent** | 新增 `docs/agents/60-website-growth.md`（顺带与主线已占位的 `docs/agents/60-maliang.md` 撞号） |
| 2 | 它把 `PriorityAction` 当规范类型 | `src/lib/website-agent/types.ts`：`export interface WebsiteGrowthAction extends PriorityAction` |
| 3 | 它的执行路径就是 `writeExecutionItems` | `src/lib/website-agent/service.ts`：`queueWebsiteGrowthPlan()` → `return writeExecutionItems(...)` |
| 4 | 它自带排序与放行判断，等于 Domain Module 自我授权 | `src/lib/website-agent/planner.ts` 直接决定排名与是否入队，不经过任何授权层 |
| 5 | 它绕过 Kernel 的幂等 / 成本 / 验证 / lineage | 全程不接触 `action_runs` / `authorization_decisions` |

**要保留的想法**（可以在 ME2 的正确位置重新实现，但**不许从 #844 摘代码**）：
- 「排序时考虑客户既往证据与已被否掉的建议」→ 属于 Domain Module 的 prescribe 段
- 「GEO 权重刻意低于技术 SEO 与商业意图缺口」→ 属于处方的排序策略，需要写成显式判据
- 「没有具体来源引用的建议不许进计划」→ 与 §5.2「没有 Evidence 引用的 Finding 不许存在」同义，已冻结

**处置建议**：在 #844 上留一条指向 #872 与本文的说明并关闭，不要让它长期以 draft 状态留着 —— 一个未关闭的 draft 会被下一个人当成「还在讨论的方案」。

---

## 13. 独立的安全 / 正确性泳道（#887）

**冻结：#887 与 Roman GEO 架构无依赖关系，不许夹带进 WP00 / WP01 或任何 GEO / Page 的 WP。**

它包含三件互不相干的事（`SAFE-ADS-01` boost 护栏 · `SAFE-ADS-02` `new_ad_default_status` 的**只读**生产审计 · `CORRECTNESS-01` 草稿生成只对在服客户）。

理由：这三件事的所有权、风险面与回滚方式都跟 GEO 契约不同。混进来的后果是一个 PR 同时改广告安全与测量契约，评审时没人能说清哪一半出了问题。发现所有权或风险不同就继续拆。

**特别注意**：`SAFE-ADS-02` 是**只读审计**；任何生产变更需要单独的显式授权。规划 issue 本身**不授权任何动作**。

---

## 14. 禁令清单（继承九条 + 本文新增五条）

### 14.1 继承自 #872 / #873 的九条

| # | 禁令 | 现状依据 |
|---|---|---|
| 1 | **不新增 Website / GEO / SEO / Page Agent** | §3.1 · §12 |
| 2 | **不设全局对外副作用旁路** | §8.4；现状是授权层与 Gateway 双拒 |
| 3 | **普通页面不用 Google Indexing API** | `src/lib/gsc/indexing-client.ts` 顶部已记 2026-05-29 实测：官方只支持 JobPosting / BroadcastEvent，其它页面 HTTP 200 但后台静默丢弃；替代是 `src/lib/gsc/sitemap-ping.ts` |
| 4 | **`publish_geo_snippet` 不做 Roman 的主干预** | `src/app/api/clients/[id]/cms/publish-geo-snippet/route.ts` 建的是标题写死 `GEO Directive (Magic Engine)` 的隐藏页；且它在 `PROVIDER_WRITE_GRANDFATHERED` 豁免名单里 |
| 5 | **`source='proactive_signal'` 不进核心契约** | 已被 `execution-view-model.ts`（分组 / 跳过）、`src/lib/execution/endorsement.ts`（背书判定）、migration `20260604000003`（CHECK 分支）三处绑死，是历史看板标签 |
| 6 | **Domain Module 不能自我授权** | §3.2 · §8.2 |
| 7 | **不造假的审批入口** | §9.4；`src/lib/kernel/handoff.ts` 已有两条守卫测试 |
| 8 | **不藏生产 migration** | §9.2 |
| 9 | **不许用不匹配队列宣称提升** | GEO 契约 §6 |

### 14.2 本文新增的五条

| # | 禁令 | 出处 |
|---|---|---|
| 10 | **`PriorityAction` 不做 ME2 规范类型** | §6 |
| 11 | **`src/lib/execution/auto-run.ts` 不改、不扩、不灌数据、不悄悄改变其生产行为** | §7.2 |
| 12 | **确定性验证断言失败绝不触发第二次 apply**；瞬时读取失败只许有界只读重试，重试耗尽落「未解决 / 待人工复核」而不是成功 | Page 契约 §3.8 §4 |
| 13 | **绝不为了让端到端测试变绿而提前 apply 生产 migration** —— 跑不了就如实说跑不了 | §9.2 第 7 条 |
| 14 | **页面台账缺失时，`direct owned-page citation` 的结论是「不可算」，绝不是 0** | GEO 契约 §5 |

---

## 15. 未决决策登记表

**每一条都必须以未决形态存在到有人拍板为止。任何 WP 把它当既定假设直接实现，就是违反 WP00。**

| # | 未决 | 为什么现在决不了 | 谁来决 | 卡住谁 |
|---|---|---|---|---|
| **U1** | Roman 的发布通道是什么 | ME 里 Roman 没有任何 CMS 连接记录；既不是已连接的 WordPress 也不是已连接的 GitHub 仓 | PM（提供通道与凭据）+ Build Control Room（定适配顺序） | WP09 |
| **U2** | Roman 的**规范页面身份**从哪来（可信页面记录 vs 确定性规范化规则） | Roman 的站点页面台账为空，站点抓取从未对他跑过。⚠️ 这**不影响** owned-domain 层的引用判定（那只需要一份经核实的自有域名 / 别名清单） | Build Control Room | **WP09 必需**（apply 与页面级 lineage）· **WP08 条件性必需**（本轮要测「具体自有页面被引用」或要固定一个规范页面队列时） |
| **U3** | Roman 的增长 Goal 由谁建、建成什么 | Roman 名下 0 个 Goal；Kernel 的 `goal_matches_purpose` CHECK 要求 `purpose='growth'` ⇒ `goal_id NOT NULL` | PM | WP09 |
| **U4** | `loop_run_id` / `verification_id` / 统一 `learning_record_id` 要不要真造 | 三者在仓库里都不存在；造 = 加表加迁移，不造 = 改 #872 的措辞 | Build Control Room | WP03（若要造）· 全链 lineage 表述 |
| **U5** | `execution_attempt_id` 要不要提成一等实体 | 现状是「步骤行 + attempt 整数」 | Build Control Room | WP07 的回执结构 |
| **U6** | `KERNEL-E9` 幂等键语义：A 拒绝 vs B 另记 lineage | Kernel spec 明写「产品没拍板之前不许偷偷改幂等键」 | PM | 接第一个真实调用方 |
| **U7** | `src/lib/execution/auto-run.ts` 最终怎么处置（迁移 / 下架 / 长期并存） | 它在跑、在写草稿、不经过 Kernel | Build Control Room | 需单独 issue，不卡本史诗 |
| **U8** | 各 provider 的幂等键支持情况 | GitHub / WordPress / Roman 站点通道都还没逐个确认过 | WP07 实施时逐个验证 | WP07 · 任何对外动作 |
| **U9** | Kernel 缺口 `KERNEL-E8`（active brief 选取）归哪个 WP | 与 GEO / Page 无关，但属于同一个 Enable 门槛 | Build Control Room | 接第一个真实调用方 |
| **U10** | Kernel 缺口 `KERNEL-E10`（自动决策原子化）归哪个 WP | 需要再加一个 RPC；migration 尚未 apply，可以合进去，但那是架构扩张 | Build Control Room | 接第一个真实调用方 |
| **U11** | `docs/STATE.md` 与 `docs/ROADMAP.md` 缺 ME2 / Kernel 条目 | 真相源已落后于主线；CLAUDE.md 铁律 6 禁止在功能分支顺手改这两份 | Build Control Room | 需另开独立小 PR，不卡本史诗 |
| **U12** | ADR-001 / ADR-002 / ADR-004 的正式落位 | 被 Kernel spec 引用，但内容只在 Issue #859 里；**Build Control Room 已裁定本史诗不建 ADR 目录**，本文与三份配套文档就是 WP00 的仓库原生决策记录。ADR 本身的长期归宿仍未定 | Build Control Room | 不卡任何 WP |

---

## 16. 明确不在范围内

- 任何平台级重写
- 任何 Agent 群集 / 多 agent 自主执行
- 打开 `dual-window-gate`
- 改动 `src/lib/memory/**`
- 改动或下架 `src/lib/execution/auto-run.ts`
- 建立 Operating Brief（#886）
- 广告安全泳道（#887）
- 迁移 `content_work_orders`
- 重载 `execution_items`
- 动那 500 多个 `supabaseAdmin` 调用点
- L3（受限 Postgres 角色）—— ADR-002 已裁定不阻塞，单独出 Security ADR
- 存量 23 组重复 migration 版本号（`boundaries.ts` 已冻结清单，只保证不再新增）
