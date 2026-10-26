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

---

# ⚠️ 本稿核心主张已被两位复审推翻（2026-10-18）

**子牙：改完才行。魏征：不通过。** 两人独立查实后结论一致：
**「复用已有写入路、只新增算缺口纯函数」这个前提不成立。** 开工前必须按下面重写，**上面 §0–§7 不要照着做**。

## A. 为什么不成立（逐条查实，行号见两人的 PR 评论）

1. **要写的字段有四个落不了库。** `execution/route.ts` 的 POST body 只认固定十个键，`steps_json` 是服务端白名单现拼的，insert 里**既没有 `due_date` 也没有 `assigned_to`**。
   `angle`、`gap_index` 会被**静默丢弃**。→ 要写就得改这条共享路由的入参契约，**风险级要重估，不能再说「零写入路改动」**。
2. **幂等键作废**：它的后两半正是被丢弃的那两个；而且这条路由**自身零查重**，把查重放调用方等于没有查重。
3. **硬门自锁（最狠）**：路由只对广告步骤重跑硬门，而 `landing.item_live`（没人核实就是灰）、`ads.budget_within_caps`（读不到就是灰）都是硬门，灰即拒绝。
   缺口卡的建卡时点是「阶段开始前 7 天」，**那时硬门几乎必然是灰的 → 409**。这个功能会在最需要它的时候建不出卡。
   **不许在路由里给 `creative_gap` 开豁免**（那是动安全闸，A 级）。出路两条：挂到非广告步骤，或改建卡时点。
4. **「不碰别的写入」不属实**：每建一张卡会往 `execution_logs` 插一条 `author:'fde'`、内容「FDE 手动新增执行项」——机器算出来的卡会被记成人工加的。
5. **退回草稿会无声删卡**：`revokePlanTasks` 按 `marketing_plan_id` + `pending` **硬删**。计划一退回草稿，所有缺口卡消失且无提示。
6. **按角度算缺口算不出来**：素材池条目**不带角度**；唯一的角度来源是自由文本（线上实际值里连整段品牌文案都有）。
   差集结果恒等于「全缺」。→ 要么先改素材池契约（另一刀），要么本稿降级成**不分角度的条数缺口**。
7. **我提的两条隔离测试是永远绿的假测试**：一条已存在；一条里 dispatcher 被替身换掉，「生产包零新增」根本不可观察；断言的还是源码里写死的字面量 0。
   真正该守的口子是**页面上的批量生成**（会建生产包），不是批准接口。

## B. 两条「未核实」现在有确定结论了

- **`steps_json.kind = 'creative_gap'` 不是落进无害的默认分支，而是被改写成「图文帖子生成卡」**：未知 kind 不返回 null，而是按模式猜成 `social_post`；
  **并且「打开抽屉」这个纯查看动作就会自动建一条 `content_posts` 草稿并绑上去**，不用点任何按钮。直接违反本稿「不碰 content_posts」。
  修法：显示分支与 kind 解析都加**显式分支**，对 `creative_gap` 返回 null，两处各钉一条测试。
  （反证：库里已有的 `near_miss` / `ctr_gap` 没事，因为它们走的是 SEO 维度，碰不到这套社媒兜底。）
- **`assigned_to` 存的是自由文本的角色名/人名，一个邮箱都没有**：线上 1674 条里仅 41 条非空（`FDE` 23、`PM-content` 12 等），
  **没有任何生产代码写入非空值**，唯一消费者是 Word 导出。**今日待办根本不读它**（只按客户数 pending 卡的条数）。
  → 本稿担心的「今日待办认不出人」**不存在**；真实风险是反的：**这一列是装饰性的，填了也没人会收到活**。
  想让人真的收到，要走「🙋 需要你动手」那条管道，**那是另一刀的事**。

## C. 下一稿要先回答的（不回答不开工）

1. 缺口卡**挂在哪**：挂广告步骤会被硬门锁死；挂非广告步骤要先定挂哪个。
2. 要不要改 `execution/route.ts` 的入参契约：改 → 风险级重估、要两审；不改 → 砍掉 `due_date` / `assigned_to` / `angle` / `gap_index`，幂等键重新设计。
3. 角度维度：先改素材池契约，还是本刀降级成「不分角度的条数」。
4. 退回草稿硬删缺口卡：接受，还是把缺口卡排除在 `revokePlanTasks` 之外。
5. 「谁来做这张卡」走哪条管道（`assigned_to` 不通）。

**定稿前本功能不开工。** 这一段是 PR #2802 合并后补的更正。

