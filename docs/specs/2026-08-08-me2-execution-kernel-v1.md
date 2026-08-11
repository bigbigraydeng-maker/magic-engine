# Magic Engine 2.0 · Execution Kernel v1

> Issue [#859](https://github.com/bigbigraydeng-maker/magic-engine/issues/859) · ADR-001 / ADR-002 / ADR-004
> 状态：**已实现，未启用**。建表迁移写好了但**没跑**；没有任何 cron 调用它；
> 没有任何现有代码路径经过它。合并 + apply migration + 启用各需要 PM 单独 `go`。
> migration 版本号是 `20260808000003` —— 原本用 000001，跟并行的 PR #862 撞了。
> 第三轮（Codex review）：视图权限收口 · 授权绑定政策行身份 + 模式复核 ·
> 可恢复 deny 的显式重授权 · Goal 跨客户双层防护 · 政策时间窗。
> 第四轮（Codex review 2）：人工批准/拒绝原子化（`kernel_resolve_pending_approval`）·
> capability 装配运行时校验 · 幂等命中重建历史结果 · 政策时间窗过滤下推到数据库。
> 第五轮（Codex review 3）：恢复权原子领取（`kernel_claim_run_recovery`）·
> executionItem 跨客户双层防护 · 死信前先落 cost/verification + 成本累计语义。
> 第六轮（Codex review 4）：中间态 run 的租约 / 接管（`kernel_claim_or_takeover_run`）·
> 开跑前的预算闸结合「下一步要花多少」· 花费金额的合法性双层校验。
> 第七轮（Codex review 5）：**stale-worker fencing（单调代际）** · `running` 也可接管 ·
> 成本声明改成**硬上限** · step 级外部幂等键。
> 第八轮（Codex review 6）：`running` 接管的**真正入口** · 落拒绝 / 建步骤也进围栏 ·
> **provider 收了钱才抛错**的安全规则 · 政策变了立刻重判 · 领不到租约时说真话。
> 第九轮：同步最新 main，基线全部重测。
> 第十轮（Codex review 7）：转人工**真的落库** · handler 跑着时**续租** ·
> 业务副作用的库级唯一兜底 · 待办不再假装有审批入口（KERNEL-E7-APPROVAL-SURFACE）。
> 第十一轮（Codex review 8）：**失去执行权之后连「落死信」都不许写** ——
> 人工处置写下的原话不会被旧执行者覆盖；另两条登记为 Enable 前硬前提
> （KERNEL-E8-ACTIVE-BRIEF-SELECTION · KERNEL-E9-IDEMPOTENCY-LINEAGE-SEMANTICS）。

---

## 1. 这个 PR 做了什么（一句话）

把 `content_work_orders` 里**已经跑对过**的执行模式抽出来，变成一个域无关的执行内核：
**没有授权就执行不了任何东西**，而且第一条真实动作（做发布包）从头到尾真跑通了一遍。

## 2. 不做什么

- ❌ 不发布客户网站 / 不提交谷歌收录 / 不发社媒 / 不改广告 —— v1 **零对外副作用**，
  且这一条是**代码级硬闸**（`sideEffect: 'outward'` 的动作在授权层和 Gateway 各被拒一次）
- ❌ 不迁移 `content_work_orders`，不重载 `execution_items`（它继续是人看的意图卡）
- ❌ 不接 cron、不改 `render.yaml`
- ❌ 不动那 500 多个 `supabaseAdmin` 调用点

---

## 3. `content_work_orders → Kernel` 提取矩阵（落地版）

ADR-001 要求的 field-by-field 矩阵，这里只列**实现结果**（完整论证见 Issue #859 的 DESIGN-SUPPLEMENT-1 §2）。

| 源 | 判定 | 落到哪 |
|---|---|---|
| `id` / `client_id` / 时间戳 | KEEP | `action_runs` 同名 |
| `goal_id NOT NULL` | **ADAPT** | `purpose` + 可空 `goal_id` + 双向 CHECK |
| `signal_id`（只能指一张表） | ADAPT | `triggered_by` + `triggered_by_ref` |
| `brief jsonb`（无校验） | ADAPT | `input` + `ActionDefinition.inputSchema` 校验 |
| `angle` / `angle_source` / `rationale_one_liner` | ADAPT（保形状换词汇） | `rationale` + `evidence` |
| `budget_cap_usd DEFAULT 2.00` | ADAPT（去掉默认值） | `cost_cap_usd`，授权时从政策快照下来 |
| `actual_cost_usd` | ADAPT（下移） | `action_run_steps.cost_actual_usd` |
| 16 态 `status` | **SPLIT** | 通用状态留 `action_runs.status`（10 态）；域阶段进 `step_key` |
| `claimed_by/at` · `heartbeat_at` · `attempt_count` · `reclaim_count` | KEEP（下移到 step） | `action_run_steps.*` |
| `max_attempts` 存在行上 | ADAPT（移出行） | `ActionDefinition.retryPolicy.maxAttempts` |
| `factory_claim_work_order` RPC | **原样提取** | `kernel_claim_run_step()`（同样 `SECURITY DEFINER` + `FOR UPDATE SKIP LOCKED` + 客户白名单 + REVOKE 收口） |
| `review_ref jsonb` | ADAPT | `authorization_decision_id` FK → append-only 决策表 |
| `master_brief_id NOT NULL` · `winner_structure_id` · `order_type` · `published_ad_id` · `reject_category` 枚举 · `publish_attempt_count` | **REJECT** | 内容域语义，不进通用内核 |

### 为什么 `goal_id` 必须可空

仓库已经因为「强制挂 Goal」造过一个假 Goal：`strategy/goals.ts` 里有个
`[Migration] Unassigned Backlog` 占位目标，每个查询还得把它过滤掉。
所以 `action_runs` 用的是**双向** CHECK：

```sql
CONSTRAINT goal_matches_purpose CHECK ((purpose = 'growth') = (goal_id IS NOT NULL))
```

- `growth` 没挂目标 → 拒绝（防「增长动作不挂目标」）
- `maintenance` / `compliance` / `recovery` / `housekeeping` 挂了目标 → **也拒绝**（防伪造 Goal）

这条约束在数据库层就让「给维护任务编个目标」不可能，不靠人自觉。

---

## 4. 状态机

```
queued → authorizing → { authorized | pending_approval | denied }
         authorized  → running → { succeeded | dead_letter }
         pending_approval → (人点同意) → authorized | denied
         dead_letter → (人点重跑) → queued → …             ← 断点续跑
生命周期旁支：superseded
```

**重跑走的是跟第一次完全相同的授权路径**（回到 `queued` 重新授权），
不是「人点了所以直接放行」—— 死信之后世界可能已经变了（客户改了规则、契约升版）。
已经成功的步骤连同产物原样保留，只把没跑成的放回待跑；谁发起的重跑记进 `evidence`。

**阶段不在这里。** 阶段是 `action_run_steps.step_key`（`build` / `persist` / `verify` / 将来的
`publish` / `measure`）。接新域不用往这个枚举里加值。

---

## 5. 三层契约

| 层 | 住哪 | 谁能改 |
|---|---|---|
| `ActionDefinition` | **代码**（`src/lib/kernel/registry.ts`） | 走 PR。agent 运行时改不了 |
| `client_automation_policies` | **数据库** | PM / FDE |
| `authorization_decisions` | **数据库，append-only** | 谁都不能改（触发器强制） |

### 默认 deny 的实现方式

**「查不到政策行」= 拒绝**，不是给 `mode` 一个默认值。
默认值会让「忘了配」和「明确配成自动」在库里长得一模一样。

### 未知动作

AI 可以**提出**任何动作，但注册表认不出的一律 deny，**并落一条 `deny_code='unknown_action'` 的决策记录**。
不是静默跳过 —— 否则「AI 提了个我们没实现的动作」这件事没人看得见。

### 🔴 恢复权是原子领取的（S1）

`denied` / `dead_letter` 的恢复走 `kernel_claim_run_recovery`：
`FOR UPDATE` 锁 run → **状态 CAS**（必须仍是那个可恢复的终态）→
**指针 CAS**（必须仍指着调用方看到的那条决策）→ （denied 还要查白名单 + 挡人工拒绝）→
**步骤重置和状态转换在同一个事务里**。

要防的形状跟人工批准同类：两人（或双击）都看到 denied/dead_letter，
A 抢先恢复并开跑，B 晚到的无条件 update 把 running/succeeded 拽回 queued 并再签一份 allow
→ capability 做第二遍。

为什么步骤重置必须在同一个事务：先 reset steps 再 update run 会留下
「步骤已经放回待跑、run 却还是 dead_letter」的半恢复态 —— 崩在中间就再也说不清了。
已成功的步骤原样保留（断点续跑），**且不碰 `cost_actual_usd`**（见下）。

可恢复拒绝码白名单在**两处**：`runner.ts` 的 `RECOVERABLE_DENY_CODES`（说人话）和
RPC 里的 `v_recoverable`（真强制）。有一条架构测试盯着两边一字不差。

### 🔴 中间态 run 必须能被安全接管（T1）

**「已经有人在做了」这句话必须有实质。**

进程在 `queued` / `authorizing` / `authorized` 崩掉之后，run 停在那儿，
而 `UNIQUE(client_id, idempotency_key)` 让相同请求再也插不进来 ——
调用方永远只拿到 `in_progress`，实际却没有任何人在推进它。
一个本来用来**防重复执行**的约束，把这件事**永久锁死**。

所以 `action_runs` 上有一份运行所有权（租约），沿用 `action_run_steps` 那套词：
`claimed_by` / `claimed_at` / `heartbeat_at` / `lease_expires_at` +
接管审计 `previous_claimed_by` / `reclaim_count` / `last_reclaimed_at`。

`kernel_claim_or_takeover_run(run_id, owner_id, lease_seconds)`，一个事务里：

1. `FOR UPDATE` 锁 run；
2. 状态必须在 `{queued, authorizing, authorized, running}` —— 终态一律 `not_claimable`。
   `running` **也在里面**，但只有租约过期才轮得到（租约还活着 = 真的有人在跑）；
   接管一个 `running` 的 run = 放回 `queued` + 清决策指针 + 没跑成的步骤放回待跑
   （授权已被上一代兑换掉，必须重新签），已成功的步骤和 `cost_actual_usd` 一概不动；
3. 租约还没过期且不是自己的 → `already_owned`（**这才配叫 in_progress**）；
4. 无主 / 已过期 / 自己续租 → 原子写下新 owner + 新到期时间；
5. 从别人手里接走才算 `reclaim`（自己续租不算 —— 两者是不同的故障信号）；
6. 回报**领到那一刻**的 `status` 和 `authorization_decision_id`。

调用方按第 6 步的回报决定下一步：

| 领到时的状态 | 怎么走 |
|---|---|
| `authorized` + 一份没被消费的 allow | **复用那份授权**，绝不重新签（否则审计表里同一件事有两个「谁批的」） |
| `authorized` + 授权已过期 | 走完整的重新授权（过期的授权本来就该重新判） |
| `queued` / `authorizing` | 走完整授权 —— 此时租约保证**只有一个人在签** |
| `running`（租约已过期） | 已被放回 `queued`，走完整授权；已成功的步骤不重跑 |

**owner 是每一次推进的身份，不是机器的身份。** 用 `workerId`（`kernel@<instance>`）当 owner
的话，同进程的两个并发调用会互相被当成「自己续租」而同时放行 —— 租约那道锁形同虚设
（实测：四路并发提交会签出四份授权）。所以 owner = `<deps.ownerId>#<第几次领取>`，
其中 `ownerId` 带一次性 boot nonce，进程重启后也不会跟崩溃前那份租约撞上。

**交接必须清租约。** 批准 / 拒绝（`kernel_resolve_pending_approval`）、
恢复（`kernel_claim_run_recovery`）、挂起等审批（`authorizeRun`）——
这四处转换的共同点是「推进这条 run 的人到此为止」。不清的话会留下一份
owner 早就走了的僵尸租约，把真正要来推进的人挡成「已经有人在做了」。

于是有一条严格的不变量：**在四个可接管状态里，租约活着 ⟺ 真的有人在推进。**
（终态上的租约只是取证信息：最后是谁在推。）

**围栏必须覆盖每一处推进性写入，漏一处就等于没有。** 第八轮补上了两处：

- **落拒绝**（`recordDeny`）：授权前置校验要读政策、读注册表，是有耗时的。
  A 卡在那儿的时候租约可能已经过期、B 已经接管并跑完了 ——
  A 醒来落一条 deny，无条件的 update 会把 `succeeded` 改成 `denied`，
  **当场毁掉一次已经成功的执行**。现在走 `kernel_record_fenced_deny`：
  锁 run → 验代际 → 插决策 → 推状态，**一个事务**。
  先插后判的话，代际对不上时会留下一条孤立的 deny 决策。
- **建步骤**（`ensureSteps`）：A 卡在建步骤之前被接管，醒来仍能插一批**带旧代际**
  的步骤行 —— 而步骤写入的守卫只看 step 自己那一列，整套 fencing 被绕过。
  现在走 `kernel_ensure_run_steps`：锁 run → 验代际 → 用 run 当前代际建行。

**`running` 的接管还要有真正的入口。** 第七轮在 SQL 里放开了「租约过期的 running
可以接管」，但 `runAction` 在进入接管判断**之前**就把 `running` 直接答成
`in_progress` —— 入口形同虚设，崩在执行中的 run 依然永久卡死。
现在 `running` 跟其他三个中间态走同一条路：租约还活着才答 `in_progress`。

🔴 本 PR **不做** scheduler / cron / worker —— 只提供接管 primitive。

### 🔴 光有租约不够：旧执行者必须被真正隔离（F1）

**光有 owner 字符串挡不住任何东西。** 危险时序：

1. A 领到租约和授权；2. A 开始推进某一步但卡住；3. A 的租约到期；
4. B 接管；5. **A 醒过来**；6. A 手里的 `step_id` / `run_id` / `decision_id`
**在接管之后依然有效** —— 任何「按 id 更新」的语句它照写不误。

所以 `action_runs.claim_generation`（bigint，单调递增，**只在换人时 +1**）是 fencing token。
每一次**推进性写入**都要出示它：

| 写什么 | 怎么挡 |
|---|---|
| step 的状态 / 产物 / 花费 / 验证 | `UPDATE … WHERE id = ? AND claim_generation = ?` → 影响 0 行 |
| run 的 `authorizing` / `authorized` / `pending_approval` / `succeeded` / `dead_letter` | 同上（`updateRunFenced`） |
| **兑换授权**（`kernel_begin_authorized_run`） | RPC 里的代际 CAS —— 兑换是**不可逆**的，尤其不能让过期的执行者用掉 |
| 续租 / 再领一次 | `kernel_claim_or_takeover_run` 的 `p_expected_generation` CAS |

影响 0 行**必须当失败**（抛 `STALE_CLAIM`），不能当「没什么好写的」——
那正是这个仓库反复踩的静默失效形状。

**为什么是代际而不是只比 owner 字符串**：owner 相等只能说明「名字一样」。
代际单调递增 ⇒ **不存在 ABA**：A 那一代一旦被跳过就永远回不来
（哪怕 A 后来重新领到，那也是更大的一代）。`action_run_steps` 上也有同一列，
换人时由 RPC 在**同一个事务**里统一改写 —— 包括已经成功的步骤，
否则旧执行者还能把它改回失败。

**`running` 也必须可接管。** 早先把 `running` 一律排除，理由是「执行权已经被原子领走」。
那是个更糟的洞：执行者崩在半路，这条 run 就永远停在 `running`，
没有任何人能接手，调用方永远只拿到 `in_progress` —— 正是租约要修的那个
「幂等键把这件事永久锁死」，只是换了个状态待着。
现在 `running` 在白名单里，但**只有租约过期才轮得到**；接管一个 `running` 的 run
= 放回 `queued` + 清掉决策指针 + 没跑成的步骤放回待跑（授权已被上一代兑换掉，
必须重新签），已成功的步骤和 `cost_actual_usd` 一概不动。

### 🔴 收费步骤失败、而结果未知时，能不能自动重试（P1-4）

这是硬预算最难的一条边界：provider **已经扣了款**，然后网络超时 / 响应解析失败。
handler 抛异常、没有 `CapabilityStepResult`，于是 `costActualUsd` 没机会返回 ——
Kernel 记 0 元并重试，provider 不认幂等键的话**每次重试都再收一遍**。

Kernel 不能凭空知道 provider 扣了多少。所以契约被写成可执行的安全规则：

| 情况 | 处置 |
|---|---|
| 异常带着已扣金额（`RetryableCapabilityError` / `KernelError` 的 `costActualUsd`） | **先落库再判定**（跟成功路径同一个顺序），金额同样过 finite / 非负校验 |
| 收费步骤 + 结果未知 + `providerIdempotency !== 'supported'` | **不自动重试**，直接死信（`UNSAFE_RETRY`）让人判断 |
| 收费步骤 + 结果未知 + provider 保证幂等重放 | 可以按**同一把 step 幂等键**重试 |
| 零成本步骤（契约 `estimate` 为 0 / 每步上限 0） | 不受影响，照常重试 |

`ActionDefinition.providerIdempotency` 是新增的必填契约字段
（`not_applicable` / `supported` / `unsupported`）。声明 `not_applicable`
却又声明了正的每步上限 = 契约自相矛盾，运行时按最保守的处置。
v1 唯一上线的能力零外部调用，填的是 `not_applicable`。

另外：**这一步自己的预算花完了就不再开跑。** 声明总共最多 $2、已经花到 $2 的步骤，
再跑一次只可能违约 —— 一个守规矩的 provider 不会白干活。（零成本步骤不在此列。）

### 🔴 「转人工」必须真的落库，不能只返回一个内存值（R10-1）

接管一条**正在跑**的付费 run、而 provider 不保证幂等重放时，我们不敢自动重跑。
但领取 RPC 这时**已经**把 run 重置成 `queued` 并写了新租约 ——
只在内存里返回一个 `dead_letter`，数据库里那条 run 仍然是「可以继续自动推进」的样子：
**等这次租约一过期，下一次同幂等键提交就会从 `queued` 重新授权、再调一次 handler。**
那道安全闸就是**装饰性**的，钱照样可能被扣第二次。

`kernel_park_for_human` 在当前这一代的围栏下原子地：
`status = dead_letter` + `needs_human = true` + **清空租约** + 留痕。
`dead_letter` 不在接管白名单里，所以之后**只能走显式的人工恢复**回到 `queued`。

### 🔴 handler 跑着的时候要续租（R10-2）

代际围栏能拦住旧 owner **回写**，拦不住它**已经做出去的业务写入**。
一个跑得比租约还久的 handler（默认 300 秒）会在自己还在跑的时候被第二代接管 ——
两代各自真的调了一次外部服务，围栏对此无能为力。

所以 handler 调用期间按 `kernel_renew_lease` 周期续租（间隔 = 租约的 1/3），
**四项 CAS 缺一不可**：run 存在 · owner 还是我 · 代际还是我这一代 · 状态还是 `running`。
任何一项不成立 = 我已经失去执行权，handler 返回后由 `assertStillOwner()`
把它变成一次显式失败 —— **绝不把执行结果当自己的提交**。

> 续租失败**不在定时器回调里抛** —— 那里没人接得住（会变成 unhandled rejection），
> 而且 handler 还在跑，抛也停不掉它。记下来，等 handler 返回时再判。

> ⚠️ **心跳只覆盖 handler 调用那一段窗口。** 步骤之间、重试退避（`deps.sleep`）、授权 / 读步骤这些阶段**不续租**。默认 300 秒租约下这些窗口都很短，问题不大；但把 `leaseSeconds` 调小 + 指数退避拉长时，可能在无心跳的窗口里被接管 —— 那时靠的是代际围栏和 `assertStillOwner`，结果不会被重复提交，只是白跑一趟。

**续租把窗口压小，压不到零**（进程真死了就是会被接管）。所以每个 capability 的
业务写入自己也要有**数据库级唯一身份**，不能只靠「先 SELECT 再 INSERT」——
那两句之间就是竞态窗口。v1 的能力用部分唯一索引
`uq_production_packages_kernel_run`（只约束带 `kernel_run_id` 的行；
生产实查 25 行里 **0 行**带这个键，所以不可能因历史数据建不上，人工造的包也不受影响）。

### 🔴 我们到底保证什么（不要把 at-least-once 说成 exactly-once）

| 层面 | 保证 | 靠什么 |
|---|---|---|
| **数据库记账** | **at-most-once** —— 过期的执行者一个字都写不进去 | 代际 fencing |
| **授权兑换** | **exactly-once** —— 一份 allow 只能换一次执行 | `consumed_at` + run 行锁 + 代际 CAS |
| **capability handler 的调用** | **at-least-once** —— 崩溃后接管者会重跑那一步 | 断点续跑（已成功的步骤不重跑） |
| **外部 provider 的副作用** | **取决于 provider** —— 见下 | step 级幂等键 |

**外部副作用这一格必须说清楚。** fencing 拦得住「把结果记进库」，
拦不住 A **已经发出去**的那个 provider 调用。所以 Kernel 能做的是：
每次调用都出示**同一把 step 级幂等键**

```
`${run.client_id}:${run.idempotency_key}:${stepKey}`
```

它**跨重试、跨死信重跑、跨接管都不变**（刻意不含 attempt、不含代际）。

- provider 认这把键 → 端到端 **effectively-once**；
- provider 不认 → 端到端只有 **at-least-once**，重跑可能产生第二次外部副作用。

**这一条不能靠「租约已经解决了」糊过去。** v1 唯一上线的能力
（`seo.build_publish_package`）是纯内部写、零外部调用、零成本，所以这个缺口
现在**不会**造成任何真实影响。但**接第一个真正调外部 provider 的能力之前**，
必须逐个 provider 确认它支不支持幂等键；不支持的，要么不接，
要么在契约里显式标注「这个动作只能保证 at-least-once」并让授权层按此判风险。
这是一条 Enable 前的硬前提，见 §7.2 E7。

### 🔴 执行卡片必须属于同一个客户（S2）

跟 Goal 完全同一个洞。应用层查 `execution_items.client_id`；
数据库层复合外键 `(client_id, execution_item_id) → execution_items(client_id, id)`，
前置 `CREATE UNIQUE INDEX idx_execution_items_client_id_id` ——
`execution_items.id` 本身是主键，这个索引不可能因历史数据冲突而失败。

### 🔴 已经发生的事实必须先落库，再决定成败（S3）

handler 返回的那一刻，钱已经花了、验证结论也已经有了。
早先是先判「超预算 / 没验过」再抛错 —— 这些事实永远进不了库：

- 数据库以为钱没花 → 死信重跑时 `spent` 从低估的数字起算 → 再调一次 handler →
  **真正突破预算上限**；
- 失败的验证结论丢失 → lineage 里查不到「它到底是怎么没做成的」。

现在 handler 一返回就先写 `{output, verification, cost_actual_usd}`，**然后**才判定。

`cost_actual_usd` 是**累计**语义（在这一步已有的基础上加），重试 / 死信重跑 / 恢复
都不许让历史已花的钱变小 —— 变小 = 同一笔预算可以被反复消费。
run 层的 `spent` 从各步骤已持久化的花费之和起算。

预算上限判**两次**，缺一不可：

| 时机 | 拦的是什么 |
|---|---|
| **开跑前**（每一步进 handler 之前） | 剩下的钱不够这一步花 → 根本不开跑 |
| 跑完之后（handler 返回、事实落库之后） | 估得进、实际超了 → 停手且不重试 |

只有后者的话，死信重跑会**先再花一次钱**才发现超了 —— 原来那条上限对重跑完全失效。

### 🔴 成本声明是**硬上限**，不是预测值（T2 / T2b）

`costModel.stepCeilingUsd[stepKey]` 的语义是：**这一步（含全部重试）最多花多少**。
两端同时成立，硬上限才成立：

| 时机 | 判据 |
|---|---|
| 开跑前 | `remaining >= declaredMax − 这一步已经花掉的` —— 装不下就**不开跑** |
| 跑完后 | `这一步的累计 <= declaredMax` —— 超了就是 `COST_CONTRACT_VIOLATION` |

两条一起给出不变量：`spent + 这一步还会花的 <= cap`，**恒成立**。
所以那条事后的 `spent > cap` 检查现在是**兜底断言** —— 前两道闸完好时它永远不触发，
留着是因为「不变量被打破」必须停手而不是继续跑。

三个容易写错的点：

1. **口径是「这一步的总花费」，不是「每次尝试最多花多少」。** 按每次算的话，
   重试 N 次就能花到 N × max，硬上限当场失效。
2. **预检要扣掉这一步已经花掉的**（`declaredMax − stepSpentSoFar`），
   否则合法的断点续跑会被误拦，这条动作永远跑不完。
3. **声明值本身也要是真实金额**（finite 且 >= 0）。NaN / Infinity / 负数一律当成
   「没声明」—— 否则一条烂声明就能把整道闸绕过去。

**说不出上界的付费步骤一律 fail closed**，不管还剩多少钱。
「还有余额就先跑、跑完再看超没超」等于承认预检不是硬上限。
契约既然声明这个动作会花钱，就必须说清每一步最多花多少；说不清就别开跑。
（整个动作 `estimate` 为 0 的，每一步上界就是 0 —— 当前唯一上线的能力属于这一类。）

**实际花费超出声明上限时，钱照样记账。** 不记账才是危险方向：
库里少记一笔，重跑就从低估的数字起算，同一笔预算能被再花一次（正是 S3 修的洞）。
多记只会让后面的闸更严。

### 🔴 政策变了就别再复用旧授权（P2-1）

接管一条停在 `authorized` 的 run 时会复用它那份没被消费的 allow。
但复用前必须复核**当前政策**：存在 / 行身份 / 版本 / 模式 / 时间窗，缺一不可。

早先这一层交给 Gateway（反正它开跑前会重查）。那样只是「拿旧授权去撞一堵墙」——
Gateway 抛错之后 run 仍停在 `authorized`、接管者的租约也还在，于是后续请求
先被答成 `in_progress`，租约过期后又重复同一个错，**一直卡到授权 TTL 自己到期**。
现在政策一变就直接认定「不可复用」，走完整重新授权 ——
那条路会如实落一条 deny / require_approval，而不是反复抛错。

### 🔴 领不到租约时要说真话（P2-2）

领不到分两类，处置完全不同：

- `already_owned:*` → 真的还有一个活着的 owner，答 `in_progress` 是对的；
- `not_claimable:<终态>` → 期间已经跑完 / 死信 / 被拒了。这时答「正在做」
  等于告诉调用方事情还在进行，而它其实已经结束 —— 成功的产物和失败的原因都拿不到。

`runAction` 和 `approveAndRun` 走**同一个** `outcomeForFailedClaim`。
两处各写一份必然分家（`approveAndRun` 早先就是无条件 `in_progress`）。

### 🔴 开跑前那道闸必须结合「下一步要花多少」（T2）

只判 `spent > cap` 有个洞：已花 $2、上限 $2、下一步要花 $1 —— 照跑，
花成 $3 之后才发现。钱已经出去了，事后判没有意义。
但也**不能**简单改成 `spent >= cap`：`cap = 0` 是正常值（零成本能力），
那样会把它们全部拦死。所以判据是 `remaining = cap - spent` 对上「下一步最多花多少」：

| 下一步的成本上界 | 判据 |
|---|---|
| 契约里显式声明（`costModel.stepCeilingUsd[stepKey]`） | `ceiling > remaining` → 拦 |
| 没声明，但整个动作的 `estimate` 是 0（契约说它根本不花钱） | 上界视为 0 → 只有已经超支才拦 |
| 都没有 = **成本未知** | 只在 `remaining <= 0` 时 fail closed |

未知成本时**不编一个数字**顶上 —— 编出来的数会让「拦住了」和「放过了」都失去依据，
比不判更危险。还有余额就放行（否则等于把所有没声明成本的动作全废掉），
真花超了由事后那道闸接住（那时钱已经落库）。

判据里带 1e-9 的容差：`0.4 * 3 = 1.2000000000000002` 这类浮点噪音会把
「刚好花完」变成「差一点点负数」，从而把零成本步骤误判成超预算。

### 🔴 花费必须是一个真实金额，两层都拦（T3）

`costActualUsd` 是**运行时输入**，TypeScript 的 `number` 拦不住
`NaN` / `±Infinity` / 负数。负数最危险：它能把「已花金额」减回来，
让同一笔预算被反复消费，等于绕开上限。

- **应用层**：`Number.isFinite(v) && v >= 0`。不合法 → `INVALID_COST` 死信，
  而且**这个数字不进账本**（产物和验证结论照旧落库 —— 东西可能真写出去了）。
- **数据库层**：`action_run_steps.cost_actual_usd` 上的 CHECK，绕开应用直接写库也写不进去。

numeric 的坑全部在生产库（PostgreSQL 17.6）实测过，不是照猜：

| 表达式 | 实测结果 | 含义 |
|---|---|---|
| `'NaN'::numeric >= 0` | **true** | 只写 `>= 0` **拦不住 NaN** |
| `'NaN'::numeric <> 'NaN'` | false | 所以 `<> 'NaN'` 能拦住它 |
| `'Infinity'::numeric >= 0` | true | 要靠 `< 'Infinity'` 拦 |
| `'-Infinity'::numeric >= 0` | false | `>= 0` 就拦住了 |

（numeric 从 PG 14 起支持 ±Infinity，所以这两条不是理论问题。）

### 🔴 两条复合外键的删除语义是**不一样**的，而且是故意的

| 外键 | 删父行时 | 为什么 |
|---|---|---|
| `(client_id, goal_id) → goals` | **NO ACTION**（删不掉） | growth 的 run 置空 `goal_id` 会当场违反 `goal_matches_purpose`。有执行台账的目标就是删不掉，要删先归档记录 —— 这比留一条半残记录诚实。选 NO ACTION 而不是 RESTRICT，是因为它推迟到语句结束才查，删客户时两边各自 CASCADE，整条 DELETE 照样成功 |
| `(client_id, execution_item_id) → execution_items` | **`ON DELETE SET NULL (execution_item_id)`** | 看板卡片会被例行删掉（撤回营销计划批量删 pending 卡片），但执行台账要留下，只把指针置空 |

两条硬约束：

1. **每列只能有一条外键。** 早先是「列上单列 FK + 表级复合 FK」两条并存 —— 同一次 DELETE
   会排队两个 RI 触发器，触发顺序按约束 OID（= `CREATE TABLE` 里的文本顺序）决定。
   谁先谁后能决定删得掉删不掉，等于把正确性押在书写次序上（真机复现过：交换两行的位置，
   `DELETE FROM execution_items` 从报错变成成功）。
2. **SET NULL 必须带列清单。** 不带清单会去置空 `client_id`（NOT NULL），整条 DELETE 当场炸。
   列清单形式需要 PG ≥ 15，生产实测 PostgreSQL 17.6，可用。

内存假件把**删除侧**也建模了（不只是插入侧）—— 只建模插入侧的话，SQL 和复刻在删除这一路上
分家的那天不会有任何测试变红。

### 🔴 人工批准 / 拒绝是数据库原子转换（R1 / P2-1）

批准和拒绝都走 `kernel_resolve_pending_approval`（`SECURITY DEFINER`，EXECUTE 已收权）：
`FOR UPDATE` 锁 run → **status 必须仍是 `pending_approval`** →
**run 当前指着的必须还是这份审批请求** → 锁 pending decision 并核对身份 →
（批准时）政策三连 + run/pending 身份逐项比对 → 原子签新决策 + 推状态。

要防的形状：两人（或双击）同时批准 → 各签一份放行 → A 开跑推进 running →
B 的无条件 update 把 run 拽回 authorized 换上自己那份 → B 再领执行权 →
**capability 执行两次**。现在批准/拒绝/另一次批准抢**同一把 run 行锁**，
输家拿到机器可读原因（not_pending / decision_not_current），绝不覆盖赢家。

拒绝额外规则：只能拒**仍在等审批**的 run（running / succeeded / denied 不许覆盖）；
拒绝不查政策 —— 政策删了变了，人依然有权说「不做」。
应用层失败落地（recordDeny）在人工路径带状态守卫（`onlyIfStatus='pending_approval'`）：
迟到批准人的「批不了」不许把赢家已经跑完的 run 拽回 denied。

### 🔴 capability 装配必须对得上契约（P2-2）

授权按注册表契约签，执行的却是 `deps.capabilities` 里**分开装配**的实现。
注册表升 v2、装配还插着 v1 时：领执行权之前运行时校验
`capability.actionKey === definition.actionKey && capability.version === definition.version`，
不一致 fail closed 且**不消费授权**（修好装配还能跑）。不信 TS 类型 —— 这是装配不变量。

### 🔴 幂等命中返回第一次的真实结果（P2-3）

同一把幂等键重试，返回**跟第一次等价的结果**（产物 + 验证），只是 capability 不再执行。
重建按 `ActionDefinition.steps` 契约顺序（不是「数组最后一条」）；
run 标着成功但历史步骤缺产物 / 缺验证 / 产物不合契约 → fail closed 抛错，
**不返回假的 success + null**。

### 🔴 政策时间窗过滤在截断之前（P2-4）

`getActivePolicy` 把时间窗下推到数据库（`lte(effective_from) + or(to.is.null, to.gt.now)` +
`ORDER BY effective_from DESC LIMIT 1`）。早先「先取 20 行再内存过滤」：
客户排 20+ 条未来定时政策时，真正生效的那条被截掉 → 应用层报没政策、RPC 却查得到 ——
两边口径分家。现在应用层与两个 RPC 三处同口径，架构测试锁定。

### 🔴 人工批准盖不过当前政策（P1-1）

`approveRun` 跟自动放行**走同一套闸**（`preflight`）。人点同意能做的只有一件事：
把「当前仍是 `require_approval`、而且跟当初挂起时同一版」的政策，从「等你点头」变成「可以做」。

它**不能**覆盖：没有政策 / 政策改成禁止 / 政策换了版本 / 契约升版 / 输入已不合法 /
purpose 不符 / 对外副作用 / 超预算。任何一项变了一律 fail closed，
并落一条说清「变了什么」的拒绝记录。

最阴的那条路是政策**被删掉**：早先会签出 `policy_version = null` 的放行，
Gateway 重读也拿到 null，`null === null` 直接过。现在「没有生效政策」在
授权层和数据库 RPC 里都是硬拒。

### 🔴 授权绑定的是「那一行政策」，不只是版本号（C2）

决策表记 `policy_id`（签发依据的具体那一行）。版本号只在同一行政策内有意义：
「auto v1 → 删掉 → 重建 deny v1」时两条政策版本号完全一样，只有行身份分得开。

执行前（Gateway 与 `kernel_begin_authorized_run` 两层各查一遍）**政策三连**：

1. 当前必须存在生效政策（被删 = 拒，不是「两边都是 null 所以对得上」）；
2. `当前政策.id === decision.policy_id`（行身份）；
3. `policy_version` 一致；
4. **模式复核**：`decided_by='policy'` 的放行要求当前仍是 `auto_approve`；
   `decided_by='human'` 的放行要求当前仍是 `require_approval` ——
   这一条兼任版本触发器失灵时的最后防线。

### 🔴 可恢复的 deny 能显式重新授权（C3）

「客户没配规则 → 被拒 → 人配好了规则 → 同样输入永远命中旧 denied」是死路。
`recoverDeniedRun(runId, 谁, 为什么)`：

- **普通重复提交不会偷偷恢复** —— 恢复必须是显式动作；
- 白名单（只这四个）：`no_policy` / `policy_expired` / `policy_changed_since_request` / `over_cost_cap`；
- 不可恢复：`invalid_input` / `unknown_action` / `unknown_action_version` /
  `outward_side_effect_blocked` / `purpose_not_allowed` / **人明确点过「不做」的**（系统不替人改主意）；
- 旧 deny 决策原样保留（append-only），run id / 幂等键不变，恢复人 / 原因 / 时间记进 `evidence`，
  然后回到 `queued` 走**跟第一次完全相同**的授权路径。

### 🔴 Goal 必须属于同一个客户（C4）

双层：提交层查 `goals.client_id === run.client_id`（说人话的安全告警）；
数据库层复合外键 `FOREIGN KEY (client_id, goal_id) REFERENCES goals (client_id, id)`
（前置 `CREATE UNIQUE INDEX idx_goals_client_id_id` —— `goals.id` 本身是主键，
这个索引不可能因历史数据冲突而失败）。MATCH SIMPLE 语义下非 growth 任务（goal_id NULL）不受影响。

### 🔴 政策生效判据是时间窗（C5）

`effective_from <= now AND (effective_to IS NULL OR effective_to > now)` ——
带结束时间但没到期的政策一样生效。应用层 `store.isPolicyActive` 与 RPC 的 SQL 完全一致，
有架构测试盯着两边不许分家。到期的政策拒绝时说「过期了，去续一条」，
从没配过的说「去新配一条」—— 两句话引导人做的事不一样。

### 🔴 lineage 视图按调用者权限读底表（C1）

`kernel_action_lineage` 带 `WITH (security_invoker = true)` + 显式
`REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT SELECT ... TO service_role`。
没有 security_invoker 的话，视图以 owner 权限读底表 —— anon 经 Data API 查视图
就能把跨客户的目标 / 授权理由 / 操作人 / 步骤产物一锅端走。**不赌底表 RLS 恰好都配对。**

### 🔴 政策版本由数据库强制演进（P1-3）

Gateway 的 stale-policy 防护完全建立在「政策一变，`policy_version` 就变」上。
这条不变量**不能靠调用方自觉** —— 将来任何一个忘了 bump 的写入方，都会让
「客户刚把自动改成禁止」对已签发的授权完全没有效果。

所以 `client_automation_policies` 带一个 `BEFORE UPDATE` 触发器：
授权相关字段（`mode` / 两个花钱上限 / `spend_cap_period` / `decision_ttl_seconds` /
生效窗口）任何一项变化 → `policy_version = OLD + 1`，**无视调用方传进来的值**；
没变则版本原样保持（防止有人靠改号码批量作废或复活授权）。
`client_id` / `action_key` 是身份字段，**不许原地改** —— 要换就新建一条。

---

## 6. 写操作绕不过授权层（L1 + L2）

ADR-002 裁定 v1 只做 L1 + L2，L3（DB 角色隔离）单独做安全评估。

### L1 —— 静态边界

只管 **provider write module**（10 个模块，34 个 importer），**完全不碰 `supabaseAdmin`**（500+ importer）。
「怎么避免一次打爆 500 多个 import」的答案是：不去动那 500 多个。真正会伤到客户的是对外写。

- `.eslintrc.json` 的 `no-restricted-imports`（可以被 `// eslint-disable` 关掉）
- `src/lib/kernel/__tests__/architecture.test.ts` 的文件系统扫描（**关不掉**，跑在 `npm test` 里）
- 两处清单的唯一真相源是 `src/lib/kernel/boundaries.ts`，有一条测试专门盯着 ESLint 配置跟它对不对得上

历史 importer 用**精确路径**豁免（26 条），不是通配目录 —— 这样新文件默认撞规则，清单只会变短。
`execution_items` 的 15 个直接写入方同理。

### L2 —— 运行时门面

`AuthorizedExecutionContext` 用一个**只声明不导出**的 `unique symbol` 打标，模块外写不出满足该类型的对象。
唯一的绕过是 `as unknown as …`，那是一行显式代码，架构测试会扫出来。

但真正兜底的不是类型：**Gateway 把 ctx 只当索引**，执行前把每一条授权事实从
append-only 的决策表里重读一遍再逐项比对：

| 检查 | 失败行为 |
|---|---|
| 跨客户（ctx / run / decision 三方不一致） | 抛错 + 安全告警，**排在所有检查最前面** |
| verdict 不是 allow | 抛错 |
| action_key / action_version 对不上 | 抛错 |
| 幂等键对不上 | 抛错 |
| 已被兑换（重放） | 抛错 |
| 授权过期 | 抛错 |
| 政策版本变过（stale） | 抛错 |
| run 状态不对 | 抛错 |

所以就算伪造一个字段齐全的 ctx，也过不了第二步。
而且这一层**在去领执行权之前**就拒了 —— 有测试直接断言此时
`kernel_begin_authorized_run` 一次都没被调用（不然「两道闸各自都在」这句话就没有证据）。

### 🔴 原子领取执行权（P1-2）

上面那套重读比对是为了**说清楚为什么不让跑**（给人看的理由）。
真正的并发正确性在 `kernel_begin_authorized_run` 这一个 RPC 里：

```
锁 run（FOR UPDATE）→ 锁 decision → run 必须停在 authorized
→ run.authorization_decision_id 必须正好是这条 decision（双向绑定）
→ 客户 / action_key / version / 幂等键 / verdict / 未消费 / 未过期 逐项校验
→ 当前政策必须存在且版本仍匹配
→ 一次性：consume decision + run → running + started_at
```

**不能拆成「先兑换 decision、再把 run 改成 running」**：那两句之间有窗口，
而且兑换的是决策、不是执行权 —— 同一个 run 若存在两份 allow 决策，
「各自原子地兑换各自那条」照样能让两个 capability 同时开跑。

提交侧同理：`SELECT → INSERT` 不是原子幂等。真正的闸是
`UNIQUE(client_id, idempotency_key)` + **撞了就回读赢家**
（把正常竞争当 500 抛出去也是错的）。已存在且还在推进中的 run
一律返回 `in_progress`，**绝不再签第二份授权**。

---

## 7. Safe capability：`seo.build_publish_package`

**真跑，不是 no-op。** 三步：

| step | 做什么 | 失败即 |
|---|---|---|
| `build` | 读真稿子 → 算内容指纹 → 跟提交时的指纹比对 → 取品牌底稿 → 组装 | 读炸了可重试；稿子被改过 / 不存在 → 不重试 |
| `persist` | 写 `production_packages`（**永远 `draft`**，带 kernel 标记） | 写炸了可重试 |
| `verify` | 回读 + 指纹比对 + 必填断言 + **外键可解析断言** | **不重试**，直接死信 + 下发人工任务 |

### 为什么它没有对外副作用

- 只写 `production_packages`，且**永远是 `draft`**。
  `flywheel/package-publish.ts` 的发布钩子只在 `status='published'` 上触发。
- 后台首页的「待审」计数只数 `ready_for_review`（已核对 `src/app/dashboard/page.tsx`），
  所以 Kernel 造的行**不会**混进 PM 的待审数字。
- 测试里把 `globalThis.fetch` 打了桩，跑完断言它一次都没被调用。

### 污染缓解 / 一键清理

每一行都带 `source_payload.produced_by = 'execution_kernel'` + `kernel_run_id`：

```sql
DELETE FROM production_packages
WHERE source_payload->>'produced_by' = 'execution_kernel'
  AND status = 'draft';
```

⚠️ 已知且刻意保留的可见性：客户production 列表接口
（`/api/clients/[id]/production`）不按 status 过滤，所以 FDE 在那一页**会**看到这些草稿包。
这是对的 —— 系统做了什么，FDE 该看得见。

---

## 8. Lineage

```
goals.id
  → action_runs.goal_id
  → action_runs.authorization_decision_id → authorization_decisions
  → action_run_steps.run_id → steps → steps.verification
  → flywheel_actions.action_run_id  (本迁移新增的一列，可空，对归因作业零行为变化)
  → flywheel_outcomes.action_id
```

两个等价实现：
- SQL：`kernel_action_lineage` 视图（一条 SQL 走通，给运维和 PM）
- TS：`loadActionLineage(sb, runId)`（给应用），带一句人话摘要

---

## 9. 管道不许断头

死信 / 等审批 / 被规则挡下 → `action_runs.needs_human = true` →
`kernel/handoff.ts` 捞出来 → 接进**今日待办**（`pm-todo/manual-items.ts` 的
`kernel_needs_human`），三件套齐全（what 带影响 / how 具体到点哪里 / href 直达）。

没有这一环，一次死信就只是 `action_runs` 里一行状态 —— 没有人会去翻。

---

## 10. 运维手册

### Apply migration（需要 PM `go`）

`supabase/migrations/20260808000003_me2_execution_kernel_v1.sql`

**Preflight**（应该都是 0 / 不存在）：

```sql
SELECT to_regclass('public.action_runs'),
       to_regclass('public.action_run_steps'),
       to_regclass('public.authorization_decisions'),
       to_regclass('public.client_automation_policies');
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'flywheel_actions' AND column_name = 'action_run_id';
```

**Apply 之后自验**：

```sql
-- 1. 四张新表 RLS 都必须写了 TO service_role（漏掉 = 对匿名访客敞开）
SELECT tablename, policyname, roles FROM pg_policies
 WHERE tablename IN ('action_runs','action_run_steps',
                     'authorization_decisions','client_automation_policies');
-- 期望：roles = {service_role}

-- 2. 认领 RPC 的执行权限必须收口
SELECT proname, proacl FROM pg_proc WHERE proname = 'kernel_claim_run_step';
-- 期望：不含 anon / authenticated

-- 3. append-only 触发器在
SELECT tgname FROM pg_trigger WHERE tgrelid = 'authorization_decisions'::regclass;

-- 4. 双向目标约束真的挡得住（两条都必须报错）
INSERT INTO action_runs (client_id, purpose, triggered_by, action_key, action_version, idempotency_key)
VALUES ('<某个真客户>', 'growth', 'human', 'seo.build_publish_package', 1, 'probe-1');   -- 期望：违反 CHECK
INSERT INTO action_runs (client_id, purpose, goal_id, triggered_by, action_key, action_version, idempotency_key)
VALUES ('<某个真客户>', 'maintenance', '<某个真目标>', 'human', 'x', 1, 'probe-2');       -- 期望：违反 CHECK
```

### 回滚

新表无数据、无调用方，可直接 drop：

```sql
DROP VIEW IF EXISTS public.kernel_action_lineage;
DROP FUNCTION IF EXISTS public.kernel_claim_run_step(text, uuid[]);
DROP TABLE IF EXISTS public.action_run_steps;
DROP TABLE IF EXISTS public.authorization_decisions CASCADE;
DROP TABLE IF EXISTS public.action_runs CASCADE;
DROP TABLE IF EXISTS public.client_automation_policies;
ALTER TABLE public.flywheel_actions DROP COLUMN IF EXISTS action_run_id;
```

代码侧 revert commit 即可 —— 没有任何现有路径依赖它。

### 启用（**本 PR 不做**，需要单独授权）

1. 给**一个**客户插一条政策（灰度）：
   ```sql
   INSERT INTO client_automation_policies
     (client_id, action_key, mode, spend_cap_per_run_usd, updated_by)
   VALUES ('<client>', 'seo.build_publish_package', 'require_approval', 0, '<你的邮箱>');
   ```
   —— 首轮建议 `require_approval` 而不是 `auto_approve`：先看它排出来的东西对不对。
2. 接一个调用方（cron 或后台按钮），**同一个 PR 内**加 `render.yaml` + `cron/registry.ts` 条目。
3. 观察两轮，确认 `action_runs` / `authorization_decisions` 的行长得对，再考虑放开 `auto_approve`。

---

## 11. 已知缺口（留给下一个 PR）

| # | 缺口 | 影响 |
|---|---|---|
| 1 | 注册表还没反向注入 agent prompt | `zhuge/conductor.ts` 仍要求模型「action_type 是一个 snake_case 短词」，生成端还是开放词汇表。不补的话，注册表会从「36 种自由文本」变成「36 种自由文本 + 一张对不上的表」 |
| **2b** | 🔴 **`KERNEL-E7-APPROVAL-SURFACE`（Enable 前硬前提）** | 全仓**没有任何页面 / 接口读 `action_runs`**，也没有任何地方调 `approveAndRun` / `rejectPendingRun`。所以「等人点头」这条路现在**根本没有入口**。接真实调用方 / apply 迁移 / 启用**任何可能产生 `pending_approval` 的动作**之前，下面七件必须先有：① 认证过的操作者身份（不能信请求体里的 `approvedByUser`）；② 真能读到 `action_run` + 当前那条 pending 决策的 UI 或 API；③ 同意 → `approveAndRun`；④ 不做 → `rejectPendingRun`；⑤ 已结束 / 已被别人处理（settled / stale）如实反馈；⑥ 客户归属与授权校验；⑦ 审批操作留审计。**本 PR 不实现它，也不假装它存在** —— 待办文案已改成如实说「入口还没上线、这条已经安全停住、不会自动执行」，**不给假的 action URL**；渲染器在没有 href 时也不再画出「去做这件事」按钮。两条守卫测试盯着不许回退 |
| **2c** | 🔴 **`KERNEL-E8-ACTIVE-BRIEF-SELECTION`（接第一个真实调用方 / Enable 前硬前提）** | `build-publish-package` 现在读 `master_briefs` 是**无状态过滤、无排序的 `limit(1)`** —— 客户留着历史版本时可能挑到 archived 或旧版；客户压根没有 active 底稿时，动作照样"成功"生成一个挂错底稿的包，而当前 verification 只查外键解得开，看不出选错版本。启用前必须：① 只选 active（跟仓库其它品牌底稿读取路径同一口径）；② 多版本按 version 倒序确定性选择；③ **没有 active 底稿必须 fail closed**，不许静默用旧的。**本 PR 不改** —— 生产实测每个客户只有一条 active 底稿，且 #863 没有调用方、没有 Enable，构不成当前风险 |
| **2d** | 🔴 **`KERNEL-E9-IDEMPOTENCY-LINEAGE-SEMANTICS`（接第一个真实调用方前必须先定产品语义）** | 幂等键**不含** `goal_id` / `execution_item_id`。同一客户拿同一份物理内容换一个 Goal / 换一张执行卡片再提交时，会命中第一条 run 并按幂等成功返回，但库里的归因仍只指向第一次提交 —— 第二个目标的执行 lineage 就没了。两条路都成立、语义不同，必须先由产品拍板：**A** 归因对不上就拒绝；**B** 物理产物保持唯一、另外记一条 lineage 关联。**语义没定之前不许偷偷改幂等键** —— 改了等于把「同一份内容只做一次」这条保证悄悄换掉。当前没有任何调用方能造出这个场景 |
| **2e** | 🟡 **`KERNEL-E10-ATOMIC-AUTO-DECISION`（接第一个真实调用方前补）** | 自动放行 / 转人工审批这两条路目前是「先插决策行，再做带代际的 run 写入」两句。owner 在这两句之间崩溃或被接管时，run 的状态写入会被围栏正确拒绝，但那条 allow 决策已经永久留在 append-only 审计表里 —— 它**从来没有成为过这条 run 的当前授权**，也永远不会被兑换（`kernel_begin_authorized_run` 要求 `run.authorization_decision_id` 指着它）。所以这**不是**越权、不是重复副作用、不是错误消费授权、不突破成本上限，run 自身的状态和 lineage 都是对的；坏的是审计表里多一条误导人的「放行」。修法跟 fenced deny / 人工审批 RPC 一样：同一事务里先锁 run、验代际，再插决策 + 改指针 + 推状态。**本 PR 不做** —— 需要再加一个 RPC（迁移尚未 apply，可以合进去，但那是架构扩张），且 #863 零接线，没有调用方能制造这个窗口 |
| 2 | 没有政策的 Settings UI | 现在只能写 SQL 插政策行。按 CLAUDE.md「FDE/PM 要填的字段必须连 Settings UI 一起做完」，启用前必须补 |
| 3 | 没有调用方 | 内核建好了但没人提交动作。这是刻意的（v1 = 零运行时接线） |
| 4 | **`spend_cap_per_period_usd`：RESERVED · NOT ENFORCED · 设置页先别暴露** | 只有列，没有任何判定逻辑。单次上限（`spend_cap_per_run_usd`）已生效。在 enforcement 落地之前，任何 UI 把它显示成「已生效的安全上限」= 给人一个假的安全感 |
| 5 | `kernel_claim_run_step` 建好了但当前执行路径是进程内直跑，还没走认领 | 多 worker 并发时才需要。RPC 先建好，免得将来又要一轮 migration |
| 6 | L3（受限 Postgres 角色）未评估 | ADR-002 已裁定不阻塞 v1，单独出 Security ADR |
| 7 | **`approvedByUser` 现在只是一个字符串参数** | 真正接 API / UI 时**必须**从认证过的会话 / 操作者身份取，绝不能信任请求体。现在没有调用方，所以还没有可被伪造的入口 |
| 8 | **`effective_to` 的完整时间窗语义还没做** | `getActivePolicy` 目前只取 `effective_to IS NULL` 的行，然后在授权层判过期。有限期政策的完整 UX 留给 Settings UI PR |
| ~~9~~ | ~~卡在 `queued` 的孤儿 run 没有回收~~ | ✅ **已解决**（第六 / 第七轮）：租约 + `kernel_claim_or_takeover_run` + 代际 fencing，四个中间态（含 `running`）都能被安全接管。**仍不做主动清扫（cron / worker）** —— 接管由下一次同键提交触发；将来要加清扫，查询条件是 `status IN (四个中间态) AND lease_expires_at < now()`，`idx_action_runs_lease` 就是为它建的 |
| 11 | 🔴 **外部副作用的 exactly-once 取决于 provider，Kernel 给不了** | Kernel 保证：数据库记账 at-most-once、授权兑换 exactly-once、每次调用出示**同一把 step 级幂等键**。provider 认这把键 → effectively-once；不认 → **at-least-once**，重跑可能产生第二次外部副作用。v1 唯一上线的能力是纯内部写、零外部调用，所以现在没有实际影响。**接第一个真正调外部 provider 的能力之前必须逐个确认**：不支持幂等键的，要么不接，要么在 `ActionDefinition` 里显式标注「只能保证 at-least-once」并让授权层按此判风险。不许用「租约已经解决了」糊过去 —— 租约拦得住记账，拦不住已经发出去的那个调用 |
| 10 | **仓库里已有 23 组重复的 migration 版本号** | 查重时发现的旧账（`origin/main` 上就有，多的一组 3 个文件）。本 PR 不改存量（改已 apply 过的文件名会打乱生产账本），只加了 CI 查重保证**不再新增**，存量冻结在 `boundaries.ts` 的清单里 |
