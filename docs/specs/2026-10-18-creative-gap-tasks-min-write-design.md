# 素材缺口任务：最小写入设计（只设计，没写代码）· 105 号 · 2026-10-18

统筹 10-18 定：**不打开旧的「营销计划派任务」那条路**（它批准后会自动建生产包，而生产包正被列为退役候选），
改成另起一条极小的写入，只往现有 `execution_items` 写「素材缺口任务」。本文回答统筹问的五件事。
闭环清单第 8 项，风险级 **B**。**本文没有写任何代码、没有动任何数据。**

---

## 0. 先更正一件事：这条路不用新起，系统里已经有了

子牙上一轮说「素材需求单要复用的派发路是关着的」——**对，但只说了一半**。我去读了代码：
**另有一条专门为推广计划开的写入路径，是开着的、带闸的、而且不会建生产包**：

`POST /api/clients/[id]/execution`，带 `marketing_plan_id` + `promo_ref: { phase_id, step_id }`。它现在就做四件事：
1. 校验 `promo_ref` 必填，且那个阶段那个步骤**真的存在于计划里**，否则 400；
2. 把 `promo_ref` 记进 `steps_json`；
3. **广告步骤的卡，落盘前重跑该阶段的硬门**（红或灰就拒绝）——批准时未到期的阶段只做提示，**这里才是真正拦住的地方**；
4. 不碰 `production_packages`。

**所以「另起一条极小的写入」= 复用这条，而不是新写一条。** 新增的只有「算缺口」那段纯函数和一个调用它的动作。
这也正好对上 CLAUDE.md 的「建前先查平台」：我上一版设计稿把旧派发路当成唯一通道，是没查到底。

## 1. 「关着」的具体机制：不是开关，是代码里显式断开

`src/app/api/clients/[id]/marketing-plan/[planId]/approve/route.ts` 第 104–107 行：

```ts
const isPromoPlan = hasPromoField(planRow.plan_data)
const dispatchResult = isPromoPlan
  ? { marketing_plan_id: planRow.id, tasks_created: 0, tasks_skipped: 0, task_ids: [], packages_created: 0, package_ids: [] }
  : await dispatchPlanTasks(planRow)
```

**不是环境变量、不是功能开关，就是一个 `if`**：计划里只要有 `promo` 字段，就直接给一个「派了 0 条」的空结果，**压根不调** `dispatchPlanTasks`。
旁边的注释写明了意图：带推广结构的计划不派老任务，工作改按推广步骤手工加卡。
**结论：旧路对推广计划已经是死路，不需要额外关；我们要做的是别去改这个 `if`。**
（数据侧也印证：`execution_items` 里 `source='marketing_plan'` 的 289 条，**最后一条停在 2026-06-08**；而整表 10-17 还在写，写的是诸葛 1070 条、诊断 263 条、主动信号 21 条。）

## 2. 写哪些字段

一条素材缺口任务 = 一条 `execution_items`，走上面那条已有路径，字段取值：

| 字段 | 填什么 | 为什么 |
|---|---|---|
| `client_id` | 计划所属客户 | 路由已校验归属 |
| `marketing_plan_id` | 计划 id | 走「营销计划任务」那一支 |
| `prescription_id` | **null** | 由现有 check 约束保证二选一 |
| `steps_json.promo_ref` | `{ phase_id, step_id }` | **必填**，路由会校验步骤存在 |
| `steps_json.kind` | `creative_gap` | 新取值，用来和别的卡区分；**不是新表、不是新字段** |
| `steps_json.angle` | 缺的角度（枚举，见 §5） | 让人知道缺的是哪一种片 |
| `title` | 「<团/步骤名>：缺 1 条<角度>」 | 一条缺口一张卡，不要「缺 3 条」这种合并卡，否则做完一条没法销 |
| `description` | 验收标准（固定三句：走视频工厂 / 过苏东坡与马良 / 首帧不得含占位价）+ 这张卡对应计划里哪个阶段哪一步 | 让接手的人不用问第二遍 |
| `dimension` | `social` | 沿用 `kindToDimension` 的既有映射 |
| `fix_type` | `fde_manual` | 人工生产内容 |
| `due_date` | 该阶段开始日往前推 N 天（N 放剧本，默认 7） | 阶段一开始就要有片可用 |
| `assigned_to` | 经营判断卡里的 `owner`；卡没填就留空 | **不编人名**；留空时在描述里写「负责人待指定」 |
| `phase` | 按 `due_date` 距今天数推（沿用既有规则） | 不另造 |
| `status` | 默认值（沿用既有） | 不另造 |

**不写的**：不建 `production_packages`、不碰 `content_posts`、不动 `plan_data.tasks`。

## 3. 幂等键：按「计划 + 步骤 + 角度 + 第几条」

旧派发器用的是 `planTaskKey(title, due_date, kind, platform, promo_ref.step_id)`——**对我们不够**：
截止日会随阶段日期变，标题会随团名改，一变就重复派。

**我们的幂等键（不建唯一索引，写入前先查）**：
`marketing_plan_id` + `steps_json.promo_ref.step_id` + `steps_json.angle` + `steps_json.gap_index`

- `gap_index`：同一步骤同一角度缺 2 条时，分别是 1 和 2。
- 写入前先按这四项查 `execution_items`（含已完成、已取消的），**查到就跳过**，返回 `skipped`。
- **为什么不建唯一索引**：建索引是 migration、是 A 级，而且这些卡允许人为复制再改；应用层查重 + 回执里写清 created/skipped 已经够。**代价要说清：两个人同时点会各写一张，和旧派发器同一档保证（应用层），PM 早前已接受这个强度。**

## 4. 失败回执：一条一条记，不整批吞

调用结果返回并写进台账式回执：

```
{ requested: n, created: [...ids], skipped: [{ reason: 'already_exists', step_id, angle, gap_index }],
  failed:  [{ reason: 'gate_blocked' | 'step_not_found' | 'db_error', step_id, angle, message }] }
```

- **任何一条失败不回滚已成功的几条**（它们是独立的待办，回滚反而让人看不到已经建好的）。
- `gate_blocked`：广告步骤的硬门红/灰 → 这条不建，回执里写清是哪一道门、怎么办（路由已经返回了这些信息，照抄不要改写）。
- **页面上必须显示 failed 列表**，不许只显示「成功 n 条」。
- 失败不重试、不排队：人看到原因后自己再点一次（这是人工动作，不是自动流程，**不需要 Inngest**）。

## 5. 算缺口的纯函数（新增的唯一业务逻辑）

`creativeNeeds(spec, playbook, approvedCreatives)` → 每阶段每个广告步骤缺几条、缺什么角度。
- 需要几条、角度词表放 `promo/playbooks.ts`（平台/行业层），目前只能标 `unvalidated_default`，**不替旅游写数字**。
- 角度封闭枚举：`price_reveal` / `story` / `real_footage` / `itinerary`。
- 已有素材只认 `ad_strategy_configs.creative_pool` 里 **status='approved'** 的（`candidate` 不算）。
- 缺口 = 需要 − 已批准。**读不到素材池 → 返回「未知」，不返回「全缺」**，页面显示未知。

## 6. 与旧路的隔离，和那条测试

- **不改** `approve/route.ts` 第 104–107 行那个 `if`；**不改** `task-dispatcher.ts`。
- **加一条测试**（PR3 里）：构造一个带 `promo` 字段的计划，调批准接口，断言
  ①`dispatchPlanTasks` **没有被调用**（用替身计数）；②`production_packages` **零新增**；③回执里 `packages_created` 为 0。
  这条测试的作用是：以后谁想顺手打开旧路，会先把这条测试弄红。
- 再加一条：素材缺口写入路径调用后，`production_packages` 仍然零新增。

## 7. 没核实的

- `execution_items.assigned_to` 实际存的是邮箱还是名字：**我没查准**，PR3 开工前要先读一遍现有数据再定（填错会让今日待办认不出人）。
- 今日待办与执行看板对 `steps_json.kind = 'creative_gap'` 这个新取值怎么显示：**未核实**，要先看它们的渲染逻辑会不会落进「默认分支」被显示成别的东西。
- 「阶段开始日往前推 7 天」没有任何证据，是占位默认值。
