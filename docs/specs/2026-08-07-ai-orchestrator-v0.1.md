# ME2 AI Orchestrator v0.1 — 架构 spec

> **状态**：inactive scaffold。默认不运行、不调模型、不写仓库、零费用。
> **Issue**：[#860](https://github.com/bigbigraydeng-maker/magic-engine/issues/860) · **只读上下文**：[#859](https://github.com/bigbigraydeng-maker/magic-engine/issues/859)
> **代码**：`tools/ai-orchestrator/` · **workflow**：`.github/workflows/ai-orchestrator-manual.yml`
> **日期**：2026-08-07

这不是 Magic Engine 产品运行时的一部分，是帮我们升级 Magic Engine 的**工程协作控制面**。
它不 import `src/` 下任何业务模块，不连 Supabase，不碰客户数据。

---

## 1. 一句话

让 API 版 GPT reviewer 和 Claude Code implementer 围绕一个 GitHub Issue 自动轮转，
在轮数 / 费用 / 时间 / 授权范围任一触顶时停下来找人 —— 且**永远不会自己 merge、部署、跑迁移或开生产开关**。

---

## 2. 边界（v0.1 做什么，不做什么）

| 做 | 不做 |
|---|---|
| 类型化领域模型 + 状态机 | 真的跑 GPT ↔ Claude 循环 |
| policy / 授权 / 幂等 / 上限 / kill switch | 定时触发、Issue 评论触发 |
| Issue comment 事件账本 | 新数据库表、新仓库 |
| mock provider 完整实现 | 调真实 OpenAI / Anthropic |
| **权威事实层**（git / GitHub / 执行日志） | 相信模型自报的 files_changed / tools_used |
| **预留式预算**（先扣后打，硬顶） | 事后对账式的软上限 |
| 真 provider **安全骨架**（缺 secret 即 fail closed） | 读写任何真实 API key |
| manual-only workflow（默认关） | merge / deploy / migration |
| 460 个测试 + 只读 CI + dry-run 证据 | 改任何 Magic Engine 业务代码 |

---

## 3. 领域模型

全部用 zod 定义在 `src/domain/schema.ts`，**没有一处状态靠自由文本推进**。

### OrchestrationRun

`run_id` · `repository{owner,repo}` · `issue_number` · `mode(DESIGN|IMPLEMENT|REVIEW)` ·
`state` · `work_package_id` · `current_round` / `max_rounds` ·
`cumulative_cost_usd` / `cost_cap_usd` · `invalid_output_count` ·
`last_processed_comment_id` · `target_branch` / `pr_number` · `deadline_at` ·
`stop_reason` · `created_at` / `updated_at`

> **一轮 = 一个 agent turn**，不是「GPT + Claude 一来一回」。
> 选这个定义是因为它无歧义、好测，而且 IMPLEMENT 模式从 Claude 开始时也不用特殊处理。

### 状态机（`src/domain/state-machine.ts`）

```
READY ──► GPT_TURN ◄──────────► CLAUDE_TURN
            │  │                    │
            │  └──► APPROVED_FOR_HUMAN_MERGE   (仅 REVIEW 模式 + 审查通过)
            │
            └──► WAITING_HUMAN ──(仅凭有效授权事件)──► GPT_TURN / CLAUDE_TURN / CANCELLED

任意非终态 ──► FAILED / BUDGET_EXHAUSTED / CANCELLED
终态出边 = 0
```

两条硬性质，各有专门测试：

1. **`WAITING_HUMAN` 不会自己醒，而且一次授权只开一道门。** 每次进入 WAITING_HUMAN 都会开一个带
   唯一 `wait_id` 的「等待」，授权必须**指名这个 wait_id**、**写在它之后**、来自白名单作者、未过期，
   且 `grants` 覆盖这次的 `blocking_reason`。离开时记录 `consumed_wait_id`，所以同一张批条用不了第二次 ——
   下一次违规会开一个**没人批准过的新 wait_id**。
2. **终态没有出边。** 停掉的 run 不能被再次 dispatch 唤醒。

### Verdict → 下一状态

| Verdict | DESIGN / IMPLEMENT | REVIEW |
|---|---|---|
| `CONTINUE_DESIGN` / `REQUEST_CHANGES` | `CLAUDE_TURN` | `CLAUDE_TURN` |
| `APPROVED_FOR_NEXT_STAGE` | `CLAUDE_TURN`（进下一阶段） | **`APPROVED_FOR_HUMAN_MERGE`** |
| `WAITING_HUMAN` | `WAITING_HUMAN` | `WAITING_HUMAN` |
| `STOP_POLICY_VIOLATION` | `WAITING_HUMAN` | `WAITING_HUMAN` |
| `FAILED` | `FAILED` | `FAILED` |

`STOP_POLICY_VIOLATION` 故意不映射到 `FAILED`：越界是安全事件，得停在一个**人必须来看**的状态，
而不是被埋进「失败」堆里。

**这两个 verdict 停下来时也必须开一道有编号的门。** 它们停在一个**成功完成**的 turn 上，
所以 wait 挂在 `turn_completed` 而不是 `turn_rejected` —— 而 `currentOpenWait` 原来只看
`turn_rejected` 和 `state_changed`。结果是「没有待批的门」，而人工授权**必须点名**一个 wait_id
才生效：这个 run 谁也放不出来了。比「一张批条开了两道门」更糟 —— 这是一道谁也开不了的门。

现在 `turn_completed` 带 `wait`，落到 `WAITING_HUMAN` 就开一个新编号，
`blocking_reason` 分成 `reviewer_waiting_human` / `reviewer_stop_policy_violation` 两种，
授权的 `grants` 必须点到对应那一条。`nextWaitId` 也要把 `turn_completed` 上的 wait 数进去 ——
漏数就会把已经用过的编号再发一次，**两道门共用一个编号 = 一张批条开两道**，
正是 wait_id 机制本身要防的事。

### WorkPackageAuthorization

`scope{allowed_paths[], denied_paths[], can_commit, can_push, can_open_draft_pr, can_merge, allowed_tools[], disallowed_tools[]}` ·
`prohibited_operations[]` · `side_effect_class(none|repo_local|outward)` ·
`expires_at` · `max_rounds` · `cost_cap_usd` · `authorized_by` · `authorization_source`

两条在**类型层**而不是运行时判断的约束：

- `can_merge: z.literal(false)` —— merge 不是配置项，是类型常量。`can_merge: true` 连 parse 都过不去。
- `prohibited_operations` 必须显式包含全部 7 条 `ALWAYS_PROHIBITED_OPERATIONS`
  （merge / deploy / apply_migration / enable_schedule / enable_issue_comment_trigger /
  write_secrets / call_customer_write_apis），漏一条 parse 失败。
  这样「授权文件写漏了」变成开工前的硬错误，而不是运行时才发现的缺口。

### AgentTurn / Verdict

`AgentTurn`：`turn_id · run_id · round · actor · input_refs[] · structured_output ·
provider / model · usage{input_tokens, output_tokens, cost_usd} · started_at / completed_at · idempotency_key`

Verdict 六值见上表。Reviewer 与 Implementer 的输出各有独立 schema
（`reviewerTurnOutputSchema` / `implementerTurnOutputSchema`），**provider 接口一律返回 `unknown`** ——
校验只在 runner 里发生一次，adapter 没法用自己的类型标注绕过去。

---

### AuthoritativeTurnFacts — 策略层唯一认的事实

`files_changed` · `tools_used` · `commit` · `pull_request` · `sources{workspace, telemetry}`

**来源，逐项**：

| 事实 | 来自哪 | 绝不来自 |
|---|---|---|
| `files_changed` | `git diff --name-status <base>...HEAD` **+ `git status --porcelain`** + `git hash-object`，或 **完整分页的** GitHub PR file list | 模型输出 |
| `pushed_this_turn` | 前后两次 `git rev-parse @{upstream}` 的差 | 模型输出 |
| `commit` / `branch` | `git rev-parse HEAD` / `--abbrev-ref`，或 GitHub PR head | 模型输出 |
| `pull_request` | `GET /repos/…/pulls/{n}` | 模型输出 |
| `tools_used` | provider 执行日志（Claude Code Action 的 execution log / API tool_calls） | 模型输出 |

为什么连 `git status` 也要读：**agent 改了文件但不 commit，文件照样改了**，只看 `diff base...HEAD` 会报告「什么都没动」。

**三个只读面都必须走完所有分页。** 它们共用同一个 `readAllPages`：三处需要同样的语义，
前两处各错了一次，所以只留一份实现，而不是三次忘记的机会。契约刻意很窄 ——
**要么完整列表，要么抛异常，永远不返回更短的数组**，因为部分答案是一个自信的错误答案。

| 读取面 | 之前的后果 |
|---|---|
| `listPullRequestFiles` | 120 文件的 PR 只报 100 个，排在第 101 位的受保护文件**根本不会被看见** |
| **`listIssueComments`** | **评论就是事件账本** —— 只读前 100 条会拿一段「中途截断的历史」重建 run：已经离开的状态、已经消费的授权、已经释放的租约、已经花掉的预算，全部可能复活 |
| **`listIssueLabels`** | kill-switch label 排到第 101 位就**看不见**，run 会认为没有急停并继续花钱 —— 这是所有截断方向里最坏的一个 |

comments 那一路额外要求 `sort=created&direction=asc`，这不是整洁而是**正确性**：
offset 分页在列表被追加时可能**跳过**条目（新项落到前面的页上），升序则把新项限制在末尾，
向前走的读取不会漏掉开始时就存在的条目。而且 fold 是**按位置读语义**的 ——
`resumeFromWaitingHuman` 用下标判断「授权是否晚于它的等待」，所以乱序会改变账本的含义，不只是外观。

读了几页几条写进 `LedgerReadResult` 和 preflight 报告：被静默截断的账本和本来就短的账本，
光看折叠出来的状态是分不出的。

**push 是远端动了，不是 HEAD 动了。** 之前 `can_push: false` 写在授权里而没有任何代码读它，
事实层只记 HEAD 有没有移动 —— 而本地 commit 也会移动 HEAD。现在前后各读一次 tracked upstream，
差异即 `pushed_this_turn`。`can_push` 已经降成 `z.literal(false)`（跟 `can_merge` 一样不是配置项），
所以**任何**远端移动都是违规；读不到远端 → `REMOTE_FACTS_UNAVAILABLE` → 停（「没看见」和「没法看」不是一回事）。
发布这件事属于 Enable 阶段的 deterministic publisher（§9b E1）。

### 每轮取快照做差，不是从 main 起算整条分支

v0.3 之前用的是 `git diff baseRef...HEAD` —— 那是**整条分支自离开 main 以来的累计值**。从第二轮起：

- 第一轮的文件会被算成第二轮干的；
- `commit` 永远非 null，因为 HEAD 总是存在；
- 已经存在的 PR 会被当成本轮新建；
- 老老实实只报本轮改动的 implementer，反而被判成撒谎。

现在 inspector 只负责**捕获状态**，runner 在每次 provider 调用**前后各捕获一次**，做差：

| 问题 | 用哪个 |
|---|---|
| 本轮干了什么（self-report 比对 · commit/PR 权限） | **delta** = after − before |
| 分支整体有没有越界（受保护路径 · scope） | **cumulative** = after |

差异按**内容指纹**算（`git hash-object`，或 GitHub PR 的 blob sha），不是按路径 ——
否则第一轮碰过、第二轮没碰的文件，会因为仍在累计 diff 里而被当成第二轮的动作。

模型的 `files_changed` / `tools_used` / `commit_evidence` 仍然收，但只用来跟记录**比对**：
对不上 → `self_report_mismatch` → `WAITING_HUMAN`。
policy 早就在权威事实上判完了；比对这一步是因为**一个连自己干了什么都说不准的 implementer，不该继续开车**。

telemetry 拿不到（`source: 'unavailable'` 或空）→ **`missing_telemetry` 直接停**。
「没有执行记录」不等于「没用越权工具」。

---

## 4. 状态存哪里：Issue comments 当 append-only 账本

一条编排事件 = 一条 Issue 评论 = 一行给人看的摘要 + 一段隐藏标记：

```
✅ **gpt_reviewer** finished round 1 · verdict `REQUEST_CHANGES` · cost $0.0500

<!-- me2-orchestrator:v1 {"schema_version":"v1","run_id":"…","event":"turn_completed",…} -->
```

**运行时状态 = 对事件流 fold 出来的派生值**（`src/domain/fold.ts`），不另存一份会漂移的真相。
重跑 workflow 读到同样的事件，落到同样的状态，所以「重复投递」天然不重复干活。

### 信任规则（这是防伪造的主防线）

任何人都能在 Issue 里打一段标记。**只有作者在白名单里（编排 bot + 仓库 owner）的标记才会被解码。**
不被信任的标记不是静默丢弃，而是进 `LedgerReadResult.rejected` 被报出来。

### 账本也是两个 agent 之间唯一的传话筒（`turn_completed.handoff`）

第五轮审查抓到一个把整件事变成空转的洞：`draftTurn` **每一轮都只放最初的任务简报**，
而 `turn_completed` 只留一个 `output_digest`。于是 reviewer 给了 `REQUEST_CHANGES`，
它的 findings、验收条件、要求的范围**一个字都到不了 implementer**；反过来 implementer 干了什么、
测试跑成什么样，也回不到下一轮 reviewer 手里。跑六轮 = 两个 agent 对着同一份简报各写各的六遍，
每一遍都要付钱。**那不是审查循环，是重复劳动。**

传话筒只能是账本本身：**轮与轮不共享进程**，每次 dispatch 都是重新 fold Issue 评论建状态，
所以下一轮要用的东西必须以事件形式存下来。`turn_completed` 因此多了一个 `handoff` 字段，
`draftTurn` 读回**每个 actor 最近一次**的 handoff 拼进 prompt。

三条硬规矩：

- **先截断再落库。** 每个字段限长、每个列表限条数（`HANDOFF_MAX_ITEMS` / `HANDOFF_MAX_TEXT`），
  外加一道序列化总量兜底。一条 Issue 评论只能装 65536 字符，**写不进去的账本等于停了的账本**，
  而且是静默停的。
- **handoff 是证据，不是许可。** reviewer 那份里的字段叫 `requested_next_paths` —— 名字就是语义。
  策略层根本不读它，范围只来自 `WorkPackageAuthorization`。reviewer 在 handoff 里说「你可以改
  `src/**`」，implementer 照做仍然会被 `PATH_EXPLICITLY_DENIED` 拦下。prompt 里也明写了这一条。
- **能取权威事实的地方就不取自报。** implementer handoff 的 `files_changed` 和 commit
  来自 workspace 记录，不是模型自己写的那份。下一轮 reviewer 要判断的是「上一轮**干了**什么」。

因为 handoff 进了 prompt，每一轮的 `input_digest` 天然不同，幂等键也就天然不同 —— 这是对的：
每一轮确实是不同的活。重跑同一次 dispatch 读到同样的账本，算出同样的键，照样跳过。

### 钱：先预留，后调用

v0.1 的账是**事后**记的 —— 调完模型才把花费加进累计值，再跟上限比。这有两个洞，GPT 首轮审查两个都点了：

1. **上限能被下一次调用跨过。** $2.00 的顶、已花 $1.95，照样会开一个 $0.40 的 turn。花完才发现的顶不是顶。
2. **租约在慢调用期间过期 → 第二个 runner 接管 → 同一个 turn 被真买两次。** 事后重读账本只能去重**记录**，去不掉**账单**。

现在的模型：

```
预算够一整笔 reservation？ → 有人已经 claim 了这个 turn？ → 写 turn_started（钱已承诺）
  → 带硬超时调用 → 用实际 usage 对账 → 写 turn_completed
```

承诺的钱分三类，**全部计入上限**：

| 类别 | 含义 |
|---|---|
| settled | turn 结束了，实际花费已知 |
| outstanding | claim 还活着，调用可能正在飞 |
| **orphaned** | claim 过期且没有完成记录 —— **不知道有没有被扣，一律当扣了** |

orphaned **故意永不释放**。释放它等于让崩溃循环无限花钱，而这正是它要挡的事。

配套的配置不变式（`checkTimingInvariant`，preflight 阶段就查，不过就一次调用都不发）：

- `lease_ttl ≥ provider_timeout + lease_margin` —— 租约不可能在调用飞行期间过期
- `max_turn_cost_usd ≤ cost_cap_usd`，且 `> 0`

超时或 provider 抛错 → **按满额 reservation 结算**。不知道对方扣没扣，往对自己有利的方向猜就是把顶变成建议。

### 超时必须真的取消，取消不了就把租约放大

`Promise.race` **不是** hard timeout —— 输掉竞速只是放弃本地 `await`，HTTP 请求照跑照计费。
现在：runner 建 `AbortController`，超时 `abort()`，signal 进 `TurnRequest`，adapter 契约上必须往下传。

而且「能不能取消」是**声明出来的能力**，不是假设：

```ts
provider.cancellation = { supported: boolean, server_max_timeout_ms: number }
```

`supported: false` 时，我们的 timeout 什么都框不住，所以**租约和 claim 按 `server_max_timeout_ms` 算**，
`checkTimingInvariant` 用两个 provider 里更长的那个窗口。当前两个真 adapter 都声明 `false`：
OpenAI 的 transport 还没接，Claude Code Action 是独立进程 —— 掐掉我们的 `await` 掐不死那个进程。
**在能证明「杀掉子进程 + 请求确实被拆掉」之前，这两个值不许改成 true。**

#### 把窗口算大了，收尾时又提前松手，等于没算（`lease_retained`）

第五轮审查抓到的：上面那套按 `server_max_timeout_ms` 放大租约的功夫，**在收尾时被自己抵消掉了**。
runner 跑完无条件写 `lease_released`，Actions 的 concurrency 组随着 job 退出一起消失 ——
此刻那个不可取消的调用还可能在写仓库、还在计费，而人只要批一下条子就能立刻开下一轮，
两个 implementer 并排跑。

现在：一旦是「停等了但对方可能还活着」（`cancellation.supported === false`，
超时和抛错都算 —— promise 被拒说明**我们**放弃了，不说明**对方**停了），
就不写 `lease_released`，改写一条 `lease_retained`：

- 租约**不释放**，并且把到期时间推到本轮 claim 的 `claim_expires_at`（= 那个服务端最大窗口的末端）；
- 只往后推，从不缩短；
- 跟 release 用同一条 fencing 规则 —— lock_key + holder + `lease_id` 三者全对才认，
  所以一个已经被顶掉的持有者晚到的事件动不了现在这把锁；
- 评论正文写人话：**「租约按住到 X，在那之前不许开下一轮」**，不是只留给开发看的日志。

对照组同样重要：provider 声明 `supported: true` 时，同一个超时照旧正常 `lease_released` ——
那种情况下确实没有东西还在跑，多按住十几分钟是白白挡住合法重跑。

### 预留额 = provider 自己报的最坏成本，不是拍脑袋的固定值

固定 `$0.50` 对一个我们不知道单价的模型来说不是上界，是猜。现在由 adapter 出价：

```ts
maxCostFor({system, user, max_output_tokens, now}) -> { max_cost_usd, model, pricing_version,
                                                        input_tokens_estimate, breakdown }
```

三项里两项往高了算，一项**没有**：output 一律按**满额 `max_output_tokens`** 计价 ·
有 cache-write / tool surcharge 就加上 · **但 input token 估算不是安全上界**。

`CHARS_PER_TOKEN_OPTIMISTIC = 3` 这个数来自英文散文，对英文是高估；**对中文是低估** ——
一个 UTF-8 三字节的汉字在多数分词器里约等于 1 token，这里却按 1/3 个算。代码、JSON、emoji 也同样偏。
低估是危险的那个方向：预留不足，顶就不再是顶。这条是 **Enable blocker E2**（§9b），
在它修掉之前，reservation 是一个合理数字，**不是一个已证明的天花板**。

留着这个错的算法、只把它标出来，是因为 scaffold 不调真实模型 —— 这里花不出钱；
换一个只是「看起来更安全」的猜测反而会把 blocker 藏起来。

**报不出价就不调用**（`cost_estimate_unavailable` → `WAITING_HUMAN`）：价目表缺失 · 过期
（`valid_until`）· 输入超过 `max_input_tokens`。**没有安全的默认单价可以兜底。**

**实际花费超过预留 → `cost_overrun` → `WAITING_HUMAN`**，按实际金额入账。
超了说明价格模型错了，不是上限有弹性。

竞态真的发生了（对方无视我们的 claim、或我们读到的是旧账本）→ 写一条
`duplicate_spend_recorded`：**不带状态**（赢家的 transition 照旧），只把这笔无法避免的钱记进账本和上限。
GPT 的要求是「证明最多一个真实调用被接受，或明确记录无法避免的 duplicate spend」—— 两条我们都做了。

### 幂等，三层

| 层 | 挡什么 | 可测性 |
|---|---|---|
| **fold** | 普通的重复 dispatch —— 读到相同事件，落到相同状态，不重跑 | ✅ 集成测试 |
| **turn 事件自带 `next_state`** | 「turn 写进去了、状态没写进去」的崩溃窗口。两件事**同一条事件**，中间没有缝 | ✅ 集成测试 |
| **调用前查 live claim** | 别人正在买同一个答案 → 我们不调。这是**省下钱**的那一层，不是事后去重 | ✅ 集成测试 |
| **写前重读账本（compare-and-set）** | 上一层漏掉的竞态。发现被抢 → 丢弃结果，但**把已花的钱记成 `duplicate_spend_recorded`** | ✅ 集成测试（注入竞态 client） |

`idempotency_key = sha256(run_id | round | actor | input_digest)[:32]`，
`input_digest = sha256(system prompt + user prompt)`。
对象键在 hash 前做稳定排序，否则同一个 turn 在两个进程里会算出两个 key。

### 锁：唯一真正的排他来自 GitHub Actions，不是账本

**之前这一节把账本租约当成锁写，那是错的。** 追加一条 Issue 评论不是 compare-and-set：
两个 runner 同时读到空账本，都会算出 `acquired: true`，都追加 `lease_acquired`，然后都去付费调用。
事后检测只能把重复花费记下来 —— 钱已经花了。

现在的分工：

| 机制 | 负责什么 |
|---|---|
| **GitHub Actions `concurrency`** | **真正的排他。** 在两个进程启动之前由 GitHub 强制，这是唯一能强制的地方 |
| `policy/exclusivity.ts` | 要求**证明**这份排他覆盖本 Issue，拿不到证明就一次调用都不发 |
| 账本租约（`domain/lease.ts`） | 审计轨迹（谁持有过）+ 崩溃持有者的过期回收。**不是锁** |

证明的形式：workflow 把自己的 `concurrency.group` 原样导出成 `ME2_CONCURRENCY_GROUP`，
runner 校验 `GITHUB_ACTIONS === 'true'` · `GITHUB_RUN_ID` 存在 · 该 group **恰好等于**本 Issue 的组名。
本地跑、组名对不上、workflow 忘了写 `concurrency` —— 三种情况全部 fail closed。
`workflow-supply-chain.test.ts` 断言 workflow 里那两处表达式逐字相同。

**租约携带 fencing token（`lease_id`）**：`lease_released` 只有在 lock_key + holder + lease_id
三者全对时才关闭当前租约。之前只比 lock_key，于是「A 过期 → B 接管 → A 醒来写 release」会把
**B 的**租约释放掉，让第三个 runner 以为锁空着。

> 为什么不上数据库：MVP 每次运行只有个位数轮次、每轮一条评论，而 Issue 账本还额外满足一个更重要的性质 ——
> **PM 不用登录任何后台就能看见全过程**。真到了 Issue 账本撑不住的时候，最小替代是一张 `orchestrator_runs` 表，
> 不在本次范围。

---

## 5. Provider 选型

### Claude 侧：`anthropics/claude-code-action@v1`（Enable 阶段），不是自己写 SDK 循环

Issue #860 的硬要求是「可限制 allowed/disallowed tools、max turns、timeout、输出 JSON、保留 session、能在 GitHub runner 内工作」。
Action 原生提供 `allowed_tools` / `disallowed_tools` / `max_turns` / `timeout_minutes`，
并且在 runner 内自己处理 git 身份与 token 交换 —— **这些恰恰是最不该我们手写的部分**。
走 SDK / headless 就要自己实现工具沙箱、凭据生命周期、分支与 PR 创建。

代价是 Action 的返回不是严格 schema，默认工具集也包含我们必须禁掉的项。
所以：**Action 只是 `ImplementerProvider` 接口的一种实现**。内核只认接口 + zod 校验后的结果。
将来要换 SDK 或 headless，改一个文件（`src/adapters/claude/implementer.ts`）。

### GPT 侧：OpenAI API + 版本化 persona

`src/prompts/reviewer-system.v1.ts` 把 Issue #859 的架构原则固化成**代码里的版本化常量**：
D→A→P→Authorization→E→V→L · Capability ≠ Authorization · policy envelope ·
Action Contract / stable registry · AI 判断软件记账 · 单体 + Postgres · vertical slice ·
no automatic merge/deploy/migration/enablement。

**不假装能恢复某个 ChatGPT 会话的隐藏状态。** 需要 reviewer 知道的事，写在这个文件里，改一次版本号加一。

### 真 adapter 的 fail-closed 顺序

```
createOpenAIReviewer / createClaudeImplementer:
  1. enabled === false            → ProviderDisabledError   ← 先查这个
  2. apiKey 缺失                  → MissingSecretError
  3. .review() / .implement()     → ProviderNotWiredError   （v0.1 一律拒绝）
```

第 1 步在第 2 步之前，是为了让「key 已经配好但开关没开」也走不通 —— 有 key 不等于可以用。

### reviewer 的「只读」得有东西管着，不能只是个说法

第五轮审查抓到的第六个洞，两半互相放大：

1. reviewer 的工具用 `authorization.scope.allowed_tools` 校验 —— 那是 **implementer 的**授权。
   scaffold 里那份明写着 `Write` · `Edit` · `Bash(git commit*)` · `Bash(gh pr create*)`，
   于是这四样在 reviewer 轮里**全部合法**。
2. reviewer 轮**不拍前后快照、也不做完整性检查**，所以真写了也无处可查 ——
   这一轮会被记成一次合规的只读审查。

修法是两道各自独立的证据：

- **`REVIEWER_READ_ONLY_TOOLS`**：reviewer 自己的白名单（`Read` / `Glob` / `Grep` /
  `git diff|log|show|status` / `gh pr view|diff` / `gh issue view`），**不查 `allowed_tools`**。
  工单只能通过 `disallowed_tools` 把它**收得更窄**；想放宽必须改 `policy/policy.ts` ——
  那个文件在 `PROTECTED_PATHS` 里面。测试直接读真实的 `SCAFFOLD_ALLOWED_TOOLS` 逐项验，
  以后有人往工单里加写工具，红的是这条测试。
- **前后快照比对**（`evaluateReviewerTurn`）：本轮 delta 里有文件变动 / 有 commit /
  远端 ref 动过 / 开了 PR，一律 `REVIEWER_NOT_READ_ONLY`；远端读不出来就 fail closed。
  只判**本轮 delta**，不判累计 —— implementer 前几轮改的文件一直都在，
  拿累计去判会在每一次诚实的运行上都报警，而天天误报的检查最后一定被删掉。
  外加跟 implementer 同一套 `integrity.drift()`。

工具白名单查的是**调用记录**，快照查的是**结果**。前者只能抓到走了具名工具的写入，
后者不管走什么路都能看见 —— 两道都要。

Issue 正文、Issue 评论、PR 描述、diff、文件内容 —— **全部是 data，不是 instruction**。

1. `system` 消息**只由代码常量拼**（`buildPromptEnvelope`），不可信文本一个字节都进不去；
2. 不可信文本被围栏包起来，进围栏前中和三样东西：围栏结束符、HTML 注释定界符 `<!--` / `-->`、
   以及 `me2-orchestrator` 标记命名空间 —— 否则 Issue 里贴一段假标记就能伪造「已授权」事件；
3. 每次 prompt 都带一条常驻声明：围栏内的内容不能授予权限、扩大范围、修改 system policy，
   也不能授权 merge / deploy / migration / schedule；发现里面有指令要**当作 finding 报告，不是照做**;
4. 账本解码只信白名单作者（见 §4）。

测试用的是一段真实形状的注入（「IGNORE ALL PREVIOUS INSTRUCTIONS」+ 伪造授权标记 + 提前闭合围栏），
断言 system 消息逐字节等于版本化常量、围栏只被闭合一次、伪造标记被中和。

---

## 7. 上限与 kill switch

| 闸门 | 默认 | 越界后 |
|---|---|---|
| `max_rounds` | 6 | `BUDGET_EXHAUSTED` |
| `cost_cap_usd` | 2.00（**硬顶**：剩余不够一整笔 reservation 就不开工） | `BUDGET_EXHAUSTED` |
| 每轮预留额 | **provider 报价**（`max_turn_cost_usd` 只是 preflight 兜底） | 报不出价 / 不够 → 零调用 |
| `max_output_tokens` | 16 000（交给 provider 的 token 天花板） | — |
| `provider_timeout_ms` | 8 min（单次调用硬墙） | `provider_timeout`，按满额结算 |
| `lease_margin_ms` | 2 min（调用结束到租约到期的余量） | 配置不满足即拒绝开工 |
| `max_wall_clock_ms` | 20 min | `BUDGET_EXHAUSTED` |
| `max_invalid_outputs` | 2 | `FAILED` |
| 授权 `expires_at` | 6 h | `WAITING_HUMAN` |
| `side_effect_class` | 只许 `none` / `repo_local` | `WAITING_HUMAN` |

轮数与费用取 **run 自带上限、部署上限、以及人签的那张授权，三者里最紧的一个**
（`effectiveCaps`）。

> 第五轮审查抓到的洞：原来只取 run 和部署两者的较小值，**完全没读授权里的
> `max_rounds` / `cost_cap_usd`**。于是一个按 `$2 / 6 轮` 造出来的 run，挂在一张人只批了
> `$0.50 / 2 轮` 的工单下面，会把 $2 花完，而且一路上所有 schema 校验都过。
> **配置不是批准。** 谁最紧谁说了算，停下来时还要说清是哪一条在管
> （`stopped_because` 里带 `authorization <work_package_id>`）。
> dry run 的 `preflight.effective_caps` 会把这三者的裁决提前摊开，不用花钱就能看见。

**Kill switch 三个独立来源，全部 fail-closed**：

1. workflow 的 `enabled` 输入（默认 `false`）；
2. `ME2_ORCHESTRATOR_ENABLED` 必须**恰好等于字符串 `"true"`** —— `1` / `yes` / `TRUE` 都不算；
3. Issue 上的 `me2-orchestrator:stop` 标签，最高优先级，其它两个说 go 也停。

任一触发 → `CANCELLED`，且**在调用任何 provider 之前**。

### 会变的闸门，每一次付费调用前都要重新读

急停标签和授权有效期原来**只在进循环之前读一次**，而这个循环会连着跑到 `max_rounds` 轮。
后果很具体：第 1 轮跑着的时候有人贴上 `me2-orchestrator:stop`，第 2..6 轮照跑照花钱；
授权在第 1 轮之后到期，也一样。**中途拉不动的急停不叫急停。**

现在 `recheckMutableGates` 在**每一轮开工前**重新做四件事：

| 重查项 | 越界后 |
|---|---|
| 三源 kill switch（重新拉 Issue 标签） | `CANCELLED` |
| 授权 `expires_at` | `WAITING_HUMAN` · `authorization_expired` |
| 轮数上限（三源取最紧） | `BUDGET_EXHAUSTED` |
| 费用上限（三源取最紧，且要盖得住本轮报价） | `BUDGET_EXHAUSTED` |

标签**读不出来**（GitHub 502 之类）不当成「没有急停标签」，而是停下等人 ——
「没看到」和「没去看」是两个答案，只有一个能安全地往下花钱。

---

## 8. active workflow 不能被运行中的 agent 改写

按「机械上做不到」→「做了会被抓住」排序：

| # | 机制 | 当前可用？ |
|---|---|---|
| 1 | `GITHUB_TOKEN` 无 `workflows:` 权限 → 含 `.github/workflows/**` 的 push 被 **GitHub 自己**拒绝 | ✅ 不依赖付费计划 |
| 2 | 只有 `workflow_dispatch`，而 dispatch 需要仓库 write 权限 → **agent 无法自我唤醒** | ✅ |
| 3 | `PROTECTED_PATHS` 拒绝：turn 的 `files_changed` 命中受保护路径 → `WAITING_HUMAN` | ✅ 有测试 |
| 4 | policy 完整性校验：run 开始时对控制面文件取 sha256，每轮复算，漂移即停 | ✅ 有测试（含正对照） |
| 5 | branch protection + 强制 CODEOWNERS review | ❌ **本仓库开不了，见 §9** |

受保护路径：**`.github/**` · `CODEOWNERS` · `tools/ai-orchestrator/**`（整个目录）**

v0.1 只列了 `policy/` · `prompts/` · `state-machine.ts`，把 `runner.ts` · `schema.ts` · ledger ·
全部 adapter · `config/` · `digest` · `fold` · `lease` 留在可写状态 —— 这些里面**随便哪一个都能把闸门拆干净**。
「全都保护」比「维护一张清单」更容易保持正确。

**代价是刻意的：orchestrator 不能自我升级。**
`workPackageScopeSchema` 会拒绝解析任何 `allowed_paths` 跟受保护面重叠的授权（用双向 witness 做 glob 相交判定），
所以「让 agent 改自己」这种工单**连构造都构造不出来**。改这个工具只能走独立的、人发起、人审的流程 ——
这次修复本身就是这么进来的。

第 3 层挡「自己申报改了控制面」——**而且用的是 git 的输出，不是模型的申报**；
第 4 层（`GitControlPlaneIntegrityChecker`，同样问 git）挡「改了但哪儿都没说」。

### 要不要拆独立 control-plane 仓库

**v1 不拆。** 理由是证据而不是偏好：

- 跨仓写权限必须建 GitHub App 或 PAT，**在闭环还没被验证之前先把凭据爆炸半径扩大了**；
- Free 计划上新建的私有仓库**同样没有** branch protection，拆完并不获得想要的那层保护；
- 迁移成本已经预先压低：orchestrator 全部代码自包含在 `tools/ai-orchestrator/`，
  GitHub adapter 以 `{owner, repo, issue_number}` 为参数、不引用 `src/**`，
  将来迁仓 = `git mv` 一个目录 + 换 token 来源。

---

## 8b. 只读 CI（`.github/workflows/ai-orchestrator-ci.yml`）

**这不是 orchestrator 的触发器，是普通只读 CI。** 它让 GitHub 真的跑这 460 个测试，
而不是只有本地证据。

| 项 | 值 |
|---|---|
| 触发 | **只有 `pull_request`，且不带任何 paths / branches 过滤** —— 每个 PR 都报状态 |
| 权限 | `contents: read` |
| secrets | **一个都不引用**（`secrets.` 在可执行内容里不出现，有测试断言） |
| 模型 | 不调 OpenAI / Anthropic，不写 Issue，不 commit / push / merge，零费用 |
| Action | 全部 pin 到完整 commit SHA |
| **required status check 名** | **`ai-orchestrator-tests`** |

跑三件事：模块级 `tsc -p tools/ai-orchestrator/tsconfig.json`（全仓基线约 180 条红，
且**随 main 漂移** —— 写死任何一个准数都会过期，所以必须收窄到本目录才有意义，
这里的标准是 0）· `npx vitest run tools/ai-orchestrator` · 结束时断言工作区没被改动。

### 为什么**不**加 paths 过滤

第一版加了 `paths:` 限定到本模块 —— 看着像顺手的优化，实际是**全仓合并死锁**：

> GitHub 对被过滤掉的 PR **根本不跑这条 workflow**，所以那个 required check 永远不会报告状态，
> 一直挂在 Pending，把一个跟本模块毫无关系的 PR 也堵死。

这个 job 只读、无 secret、约 1 分钟。在无关 PR 上白跑一分钟，比把所有人的 PR 卡住便宜得多。
`tests/workflow-supply-chain.test.ts` 现在断言这条 workflow **不许**出现
`paths` / `paths-ignore` / `branches` / `branches-ignore` / `tags` / `tags-ignore`，防止再犯。

架构检查和 workflow 供应链检查都在那次 vitest 里（`--reporter=verbose` 会把每条断言名打出来）。

> `ai-orchestrator-manual.yml` 不受影响：仍然只有 `workflow_dispatch`，仍然默认关闭。

---

## 9. Enable checklist（全部是人工作业，本次一件都没做）

> ⛔️ **阻塞项在最前面。** 在 PM 就第 0 条给出决定之前，Enable 阶段保持 `WAITING_HUMAN`。

### 0. branch protection —— ✅ 已生效；审批数暂时保持 0（有意）

PM 已升级 GitHub Pro 并建好 ruleset。实测 `gh api`：

| 探测 | 结果 |
|---|---|
| `user.plan.name` | **pro** |
| ruleset `Protect main` (id 20550157) | **active**，`bypass_actors: []` |
| 规则 | `deletion` · `non_fast_forward` · `pull_request` |
| `required_review_thread_resolution` | `true` |
| `allowed_merge_methods` | `["merge"]` |
| 旧的两条 ruleset | 都已 `disabled` |
| `default_workflow_permissions` | `read` |

**`required_approving_review_count` 现在是 0，暂时不要改成 1。**
仓库里的 Claude PR 仍然显示为 owner 自己创建，而 GitHub 不允许自己批准自己的 PR ——
现在设 1 会把流程锁死。等 Enable 版用独立 bot/App 身份开 PR，或加入第二位真人 reviewer 之后，
再一次性做三件事：审批数设 1 · CODEOWNERS 指向真人 reviewer · **实测一次**
（开一个 bot 创建的、改 `tools/ai-orchestrator/` 的 PR，确认没有人工批准合不进去）。

现阶段的保证是：无 bypass + 必须走 PR + 禁 force push + 未解决对话阻止合并 +
orchestrator 永不 auto-merge —— **merge 仍然是人手动完成的**。

合进来的下一步是把 **`ai-orchestrator-tests`** 设为 required status check（见 §8b）。
**加之前先确认它没有任何事件过滤** —— 有过滤的 required check 会把无关 PR 永久卡在 Pending。

### 1. Secrets（仓库 Settings → Secrets and variables → Actions）

| 名称 | 用途 | 备注 |
|---|---|---|
| `ME2_ORCHESTRATOR_OPENAI_API_KEY` | GPT reviewer | 本次**必须不配**；配了 workflow 会主动报错退出 |
| `ME2_ORCHESTRATOR_ANTHROPIC_API_KEY` | Claude implementer | 同上 |

两个 key 建议单独开、单独设支出上限，不复用 Magic Engine 生产用的 key ——
爆炸半径要跟业务 key 分开。

### 2. Variables

| 名称 | 值 |
|---|---|
| `ME2_ORCHESTRATOR_ENABLED` | `true`（Enable 时才设；必须恰好是这个字符串） |

### 3. GitHub permissions（Enable 时按 job 拆）

```yaml
reviewer-job:     { contents: read,  issues: write }
implementer-job:  { contents: write, pull-requests: write }
```

两个 job 都**永不**给：`actions` · `workflows` · `administration` · `deployments` · `packages` ·
`security-events` 的 write。`workflows: write` 尤其不能给 —— 它是 §8 第 1 层的全部依据。

**必须是 job-scoped `GITHUB_TOKEN`。** 不接受用一个权限更宽的 GitHub App installation token
顶替：App token 的实际权限不在这个文件里，审查者读 workflow 读不出来，等于把最小权限变成口头承诺。

### 3b. 第三方 Action 一律 pin 到审过的完整 commit SHA

tag 是所有者随时可以重新指向的指针；今天的 `@v4` 和明天的 `@v4` 不是同一份代码，
而这个 job 手里有仓库内容。当前已 pin：

| Action | SHA | tag |
|---|---|---|
| `actions/checkout` | `11d5960a326750d5838078e36cf38b85af677262` | v4.3.0 |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4.4.0 |

Enable 时新增的 `anthropics/claude-code-action` 同样必须 pin，且**升级 SHA 要走一次人工 diff review**。

这条不是靠 checklist 维持的：`tests/workflow-supply-chain.test.ts` 解析 workflow，
任何未 pin 的 `uses:`、任何被禁的 write 权限、任何新增触发器都会让测试变红。

### 4. CODEOWNERS（建议内容，本次未创建）

创建 CODEOWNERS 会立刻影响整个仓库的 review 指派，属于治理变更，交 PM 拍：

```
/.github/                                   @bigbigraydeng-maker
/tools/ai-orchestrator/src/policy/          @bigbigraydeng-maker
/tools/ai-orchestrator/src/prompts/         @bigbigraydeng-maker
/tools/ai-orchestrator/src/domain/state-machine.ts  @bigbigraydeng-maker
```

### 5. 费用上限

- OpenAI / Anthropic 控制台各设**月度硬上限**（建议 US$20 起步）；
- `SCAFFOLD_LIMITS.cost_cap_usd` 单次运行上限（当前 2.00）由 PM 确认；
- 第一周每天看一次实际花费，跟 `cumulative_cost_usd` 对账。

### 6. 手动验收步骤（按顺序，任一步不过就停）

1. 在一个**测试 Issue**（不是 #859 / #860）上 dispatch，`enabled=false` → 确认走 dry-run、零调用、零评论；
2. 配 secrets，`enabled=true` 跑一次 **DESIGN 模式、max_rounds=2、cost_cap=$0.50**；
3. 人工核对：Issue 上出现的评论数量、每条的 verdict、`cumulative_cost_usd` 与控制台账单是否一致；
4. 故意在 Issue 里贴一段注入文本，确认 reviewer 把它当 finding 报告而不是照做；
5. 打上 `me2-orchestrator:stop` 标签，再 dispatch 一次，确认立即 `CANCELLED`；
6. 让 implementer 故意越界（改 `src/**`），确认停在 `WAITING_HUMAN` 且没有 commit；
7. 以上全过，才把 Enable 扩到 #859 的真实 work package。

---

## 9b. 转入独立 Enable Work Package 的四项（本 PR 不实施）

GPT-5.6 第三轮定的边界：**#861 是安全骨架 PR，不是 Enable PR。**
下面四项都是真问题，但都需要独立设计、独立审查、独立 dry run，塞进这个 PR 只会让它既不是骨架也不是 Enable。
**它们不阻塞这个 inert scaffold 合并；它们阻塞 Enable。**

### E1. Claude 不能在 policy 判定前 commit / push / 开 PR

推送已经收回了（`can_push` 是 `z.literal(false)`，push 工具进了黑名单），但 `allowed_tools`
里仍有 `Bash(git commit*)` / `Bash(gh pr create*)`。事后能从真实 diff 抓到越权是真的，
但**副作用已经落在分支和 PR 上了** ——
抓到的是既成事实，不是拦住。

Enable 版要改成：

```
Claude 只在隔离 worktree 里 edit / test（无 git 写工具）
  → runner 读真实 delta，跑 policy + 完整性检查
  → 通过：deterministic publisher 统一 commit、push、开 draft PR
  → 不通过：丢弃 / reset worktree，什么都没发生过
```

也就是本仓库那条老规矩的同一形状：**AI 负责判断，软件负责写入。**
做这件事要动 `scope.allowed_tools`、加一个 publisher 模块、改 worktree 生命周期 —— 独立 PR。

### E2. 真实模型成本上界还没证明

现在的 `CHARS_PER_TOKEN_CONSERVATIVE = 3` **对中文和任意 Unicode 不是安全上界** ——
而 Magic Engine 的上下文本身大量是中文。一个 UTF-8 三字节的汉字按 3 字符/token 会被算成 ~1 token，
真实分词往往更多。这是**低估**，方向正好错了。

Enable 前必须：

- 换成模型自己的 tokenizer，或用 **UTF-8 byte length** 做保守硬上界（字节数 ≥ token 数，方向是安全的）；
- 验证 `pricing.model` 与 adapter 实际使用的 model **完全一致**（现在只是字符串对上了没人查）；
- 对价目表做 **runtime schema 校验**（zod），而不是相信常量文件写对了；
- **Claude Code 是多轮 agent session**：一次 `implement()` 背后是 `maxTurns` 轮模型调用 +
  工具输出回灌 + 上下文逐轮增长。按「一次 prompt + 一次 output」计价是数量级级别的低估。
  报价必须覆盖整个 session 的最坏情况；
- 证明不了 worst case 就零调用（这条机制已经有了，缺的是正确的数）。

### E3. 不要把通用 `github-actions[bot]` 当唯一机器身份

`TRUSTED_LEDGER_AUTHORS` 里的 `github-actions[bot]` 是**所有** workflow 共用的 login ——
仓库里任何一个拿到 `issues: write` 的 workflow 发的评论都是这个作者。
只按 login 信任 marker，**证明不了事件来自 orchestrator**。

Enable 版二选一（或都做）：

- 专用 GitHub App / bot 身份，只有 orchestrator workflow 能以它发言；
- 对 ledger marker 加签名：用 orchestrator 独占的 secret 做 HMAC，解码时验签。

还要明确处理**评论被编辑或删除**时的账本完整性 —— 现在的模型假设 Issue 评论是 append-only，
而 GitHub 上它不是。

### E4. Claude Code Action 不能被 TypeScript 当函数调用

这是 v0.1 那句「Action 只是 `ImplementerProvider` 接口的一种实现」的漏洞：
**GitHub Action 是 workflow step，不是 TS 里能 `await` 的函数。** 当前 adapter 骨架的形状
（`implement(request): Promise<Result>`）跟 Action 的真实运行方式对不上。

Enable 前必须写 ADR 二选一，并做真实 dry run：

| 方案 | 形状 |
|---|---|
| **A. 三段式静态 workflow** | preflight job（TS：读账本 / policy / 报价 / 写 claim）→ pinned Claude Action step → postflight job（TS：读 delta / 校验 / 记账） |
| **B. SDK / headless / CLI** | Claude Code 作为 provider adapter 能真正启动和杀掉的进程，`implement()` 保持现在的形状 |

无论选哪个，都必须证明这五样在**真实路径**上拿得到：
telemetry（真实工具列表）· AbortSignal / child kill 真的生效 · usage 里的真实成本 ·
tool allowlist 真的被 Action 尊重 · 输出符合 schema。

**方案 A 会改变本 spec §5 的选型结论**，所以它是 ADR，不是实现细节。

---

## 10. 测试

`npx vitest run tools/ai-orchestrator` —— **532 passed / 0 failed**，全部 mock，零网络、零费用。

| Issue #860 要求 | 覆盖位置 |
|---|---|
| 状态机合法 / 非法迁移 | `state-machine.test.ts` |
| 重复 delivery 不重复处理 | `runner.test.ts` › duplicate delivery（3 个场景） |
| 并发 run 只有一个获锁 | `lease.test.ts` + `runner.test.ts` › concurrency |
| max rounds 停止 | `runner.test.ts` › budget stops |
| cost cap 停止 | 同上 |
| kill switch 停止 | `policy.test.ts` + `runner.test.ts` › kill switch |
| secrets 缺失 fail closed | `providers.test.ts` |
| untrusted 文本改不了 system policy | `untrusted.test.ts` |
| Claude 越权工具被拒 | `runner.test.ts` › policy violations |
| GPT schema 不合法不推进 | `runner.test.ts` › schema-invalid provider output |
| WAITING_HUMAN 不自行恢复 | `state-machine.test.ts` + `runner.test.ts` › WAITING_HUMAN |
| dry-run 不调用 / 不评论 / 不 commit | `dry-run.test.ts`（每条都带正对照） |
| active workflow / policy 同轮不可改 | `runner.test.ts` + `policy.test.ts`（申报的 + 没申报的两种） |
| **模型谎报 files_changed 仍被真实 diff 抓到** | `authoritative-facts.test.ts` |
| **模型漏报越权工具仍被执行日志抓到** | `authoritative-facts.test.ts` |
| **改 runner/schema/ledger/config 任一文件都违规** | `policy.test.ts` › protected paths（17 条路径逐一） |
| **lease takeover 不产生未入账的重复费用** | `spend-control.test.ts` |
| **剩余预算不够下一轮时零 provider 调用** | `spend-control.test.ts` |
| **owner 能真的唤醒 WAITING_HUMAN（用真实 scaffold config）** | `human-authorization.test.ts` |
| **伪造 `authorized_by` 唤不醒**（外人冒充 · bot 代签 · owner 冒充他人） | `human-authorization.test.ts` |
| **第 2 轮不把第 1 轮的文件/commit 算成本轮动作** | `authoritative-facts.test.ts` |
| **本轮没 commit 时，仓库已有 HEAD 不算本轮 commit** | `authoritative-facts.test.ts` |
| **超时真的 abort 到 adapter** | `cancellation-and-pricing.test.ts` |
| **不支持取消的 provider fail closed / 放大租约** | `cancellation-and-pricing.test.ts` |
| **价目表缺失 / 过期 / 输入超限 → 零调用** | `cancellation-and-pricing.test.ts` |
| **actual > reserved → WAITING_HUMAN** | `cancellation-and-pricing.test.ts` |
| **workflow 未 pin / 越权 / 加触发器 → 测试红** | `workflow-supply-chain.test.ts`（两条 workflow 都管） |
| **CI 引用 secret / 给写权限 / 改 check 名 → 测试红** | `workflow-supply-chain.test.ts` |
| **required check 的 workflow 加任何事件过滤 → 测试红** | `workflow-supply-chain.test.ts` |
| **模块 import 了 `src/` / supabase / next / 未声明依赖 → 测试红** | `architecture.test.ts` |
| **文件超 800 行 / 出现 `any` → 测试红** | `architecture.test.ts` |
| **reviewer 的 findings / 验收条件 / 要求范围进得了下一轮 implementer 的 prompt** | `turn-handoff.test.ts` |
| **implementer 的结论 / 测试结果 / 真实改动文件回得到下一轮 reviewer** | `turn-handoff.test.ts` |
| **换一个进程（重新 fold 账本）loop 上下文不丢** | `turn-handoff.test.ts` |
| **handoff 只是证据：reviewer 要更宽的路径不能放宽 implementer 的范围** | `turn-handoff.test.ts` |
| **handoff 有界，写不进 65536 字符的评论之前先降级** | `turn-handoff.test.ts` |
| **reviewer 判 `WAITING_HUMAN` / `STOP_POLICY_VIOLATION` 时开出可授权的 wait_id** | `human-authorization.test.ts` |
| **连着两个 reviewer 阻塞不复用同一个 wait_id** | `human-authorization.test.ts` |
| **急停标签中途贴上，下一轮零 provider 调用** | `mid-run-gates.test.ts` |
| **授权中途到期，下一轮零 provider 调用** | `mid-run-gates.test.ts` |
| **标签读不出来 = 停，不是「没有急停标签」** | `mid-run-gates.test.ts` |
| **不可取消的 provider 超时后不释放租约（含 fencing / 只延不缩）** | `mid-run-gates.test.ts` |
| **授权的 `max_rounds` / `cost_cap_usd` 真的是硬顶** | `spend-control.test.ts` |
| **reviewer 拿不到 implementer 的 `Write` / `Edit` / `git commit` / `gh pr create`** | `reviewer-read-only.test.ts` |
| **reviewer 轮改了工作区 / commit / push / 开 PR，即使 telemetry 干净也被抓** | `reviewer-read-only.test.ts` |

**关于「零调用」这类断言**：每一条都配了正对照（同一套 harness 关掉 dry-run 再跑一遍，
断言 provider 确实被调用、评论确实被写、commit 副作用确实被记录）。
只断言「等于 0」的测试，在实现整个坏掉、什么都不做的时候也会绿。

**变异验证**（改坏源码看测试是否变红，已全部还原）：

> 变异脚本每次都**先断言那段搜索字符串真的存在**再替换。少了这一步，一个打错的搜索串会
> 「没改动 → 测试全绿 → 记成通过」—— 正是这套验证本身要抓的那种静默失效。

**最新一轮（针对 Codex 复审的六个 P1 blocker，23 组，23/23 变红）**

| 破坏 | 变红 |
|---|---|
| handoff 到不了下一轮的 prompt | 4 |
| reviewer 不往账本写 handoff | 4 |
| implementer 不往账本写 handoff | 2 |
| handoff 报模型自报的 files 而非真实记录 | 1 |
| handoff 列表不再截断 | 1 |
| 超限的 handoff 原样写出去 | 1 |
| reviewer 判 `WAITING_HUMAN` 不开 wait | 7 |
| `currentOpenWait` 退回只看 `turn_rejected` | 5 |
| `nextWaitId` 不数 reviewer 的 wait（编号撞车） | 1 |
| 循环里不再重查急停 | 1 |
| 循环里不再重查授权到期 | 1 |
| 闸门整体退回「每次 dispatch 查一遍」 | 4 |
| 标签读不出来当成「没有急停标签」 | 1 |
| 租约无条件释放 | 3 |
| 不可取消的 provider 不算「可能还在跑」 | 3 |
| 租约延期忽略 fencing token | 2 |
| 租约延期允许缩短 | 1 |
| 授权的 `cost_cap_usd` 被忽略 | 2 |
| 授权的 `max_rounds` 被忽略 | 2 |
| reviewer 工具退回查 implementer 的 allowlist | 11 |
| reviewer 的工作区证据一律放行 | 6 |
| reviewer 轮不做完整性检查 | 1 |
| reviewer 轮不拍前后快照 | 1 |

**第一轮（8 组，全部仍有效）**

| 破坏 | 变红 |
|---|---|
| kill switch 永不停 | 12 |
| 受保护路径不检查 | 8 |
| dry-run 照样写评论 | 1 |
| runner 忽略 dry-run 早退 | 3 |
| 工具白名单形同虚设 | 4 |
| 租约永远发放 | 3 |
| 账本信任任意作者 | 3 |
| `WAITING_HUMAN` 自行恢复 | 5 |

**第四轮（只读 CI 与架构闸门，11 组）**

| 破坏 | 变红 |
|---|---|
| CI 拿到写权限 | 1 |
| CI 的 action 退回 moveable tag | 3 |
| CI 接上模型 secret | 2 |
| required check 名被改 | 1 |
| CI 加回 `paths` 过滤 | 3 |
| CI 加 `paths-ignore` | 3 |
| CI 加 `branches` 过滤 | 3 |
| 源文件 `import '@/...'` 打进 src | 2 |
| 源文件 import supabase client | 1 |
| 混进一个 `any` | 1 |
| import 了 package.json 里没有的包 | 1 |

**第三轮（针对 GPT 第二轮审查的五个 blocker，12 组）**

| 破坏 | 变红 |
|---|---|
| `authorized_by` 不再绑定评论真实作者 | 1 |
| bot 可以代签人工授权 | 1 |
| `files_changed` 退回累计分支 diff | 1 |
| 仓库已有 HEAD 就算本轮 commit | 11 |
| 超时不再 abort 底层调用 | 3 |
| 不支持取消的 provider 不再放大租约 | 1 |
| 过期价目表照样接受 | 2 |
| 实际花费超预留被容忍 | 1 |
| 预留退回固定常数 | 1 |
| workflow 的 action 退回 moveable tag | 4 |
| 给了 `workflows: write` | 2 |
| 加了 schedule 触发器 | 2 |

**第二轮（针对上一批四个 blocker，9 组）**

| 破坏 | 变红 |
|---|---|
| policy 改用模型自报的 files/tools | 6 |
| self-report 对不上也放行 | 2 |
| telemetry 一律当可信 | 2 |
| 受保护面缩回 v0.1 的 `policy/` 子集 | 17 |
| timing invariant 跳过 | 5 |
| 别人的 live claim 视而不见 | 2 |
| orphaned reservation 释放而非计费 | 4 |
| cost cap 退回事后 tripwire | 6 |
| 超时不结算预留 | 2 |

---

## 11. 剩余风险

1. **审批数暂时保持 0，CODEOWNERS 未建** —— 有意的（见 §9.0）。这期间「必须有人看过」靠人工纪律，不靠机器。
2. **真 provider 未接线。** `ProviderNotWiredError` 是刻意的：接线本身要单独 PR、单独审。
   接线时**必须**做到两件事，否则本次的两个修复会退化成摆设：
   `tools_used` 取自 Action 的执行日志（不是模型输出），`usage.cost_usd` 取自 API 返回。
3. **`provider_timeout_ms` 8 分钟是估的。** 真跑起来要按 Claude Code Action 的实际时长调，
   调的时候必须同步调 `lease_ttl`，否则 `checkTimingInvariant` 会直接拒绝开工（这是设计如此）。
4. **成本仍依赖 provider 自报 usage。** reservation 挡住了「一轮花超」，但如果 provider 报的
   `cost_usd` 系统性偏低，累计值就偏低。Enable 第一周必须拿控制台账单跟 `cumulative_cost_usd` 对账。
5. **`git status --porcelain` 看不见被 `.gitignore` 忽略的文件。** 一个把产物写进 ignored 路径的 turn
   不会出现在 `files_changed` 里。当前 scope 都是被跟踪的源码路径，先记着。
5. **Issue 账本不适合高频。** 每轮一条评论，长跑会把 Issue 撑长。到那时再谈换存储。
6. **`docs/ROADMAP.md` 没登记这条线** —— Issue #860 明确禁止本窗口改 ROADMAP，留给 PM 或下一个窗口补。
