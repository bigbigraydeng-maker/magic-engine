# WP3.2（韩信编排）实施方案 v0.2 · 119 号 · 2026-10-18

> # ⛔ 第二轮复审：**不能照本文件动手。事实底座错了，错在我。**
>
> ## 错在哪（2026-10-18，魏征二审查出，我已查库确认）
>
> 本文件 §1 / §5 反复写「**4 个客户全是 `observe`**」—— **这是错的**。生产库实查：
>
> | 客户 | `autonomy_mode` | `client_automation_policies` 里 9 个 `ads.*` 键 |
> |---|---|---|
> | **CTS Tours NZ** | **`bounded_auto`** | **全是 `auto_approve`** |
> | **New Asian Logistics** | **`bounded_auto`** | **全是 `auto_approve`** |
> | Roman HU / 30 Kiteroa | `observe` | 0 行 |
>
> **更要紧的是这个错怎么来的**：我今天早些时候**自己查过这张表、拿到的就是上面这个答案**，
> 后来写方案时却照权威稿 9 月那句「目前 4 个客户全是 observe」写成了相反的话。
> **我拿文档里的旧说法盖掉了自己的一手证据** —— 这是我今天第三次犯同一类错
> （前两次：把熔断的按计划半成品说成坏闸、把一段讲旧问题的注释当现状）。
>
> ## 连带作废的结论
>
> 1. **「WP3.2 依赖 Kernel WP07」这条（v0.2 当成推翻 v0.1 的两条之一）建在错事实上。**
>    对 CTS / NAL 走的是 bounded 分支（`authorize.ts:383` 起），**不是人工审批队列**。
>    所以 §2 PR B 的验收「提交后落 `pending_approval` 并出待办」**对这两个客户不成立** ——
>    而那正是唯一会让人安心的说法。NAL（账户上限 NULL → 回落客户上限、信封事实可读）
>    **可能真的自动打到 Meta**。
> 2. **§8 的时机论证也要重写**：魏征一轮算的「$180 vs CTS 10/03 的 $197 会命中判据 #2」
>    **实际不会发生** —— CTS 次账户 09-22 起没有系列级花费行、而快照里仍有 3 个 ACTIVE 系列
>    → `facts:account_data_stale` → **判据 #2 对 CTS 永远「判不了」**。
> 3. **我对魏征一处说法的更正**：他说 `auto_pause_on_d3` 的注册表(`human_only`)与策略表(`auto_approve`)
>    错配「今天就在发生、该当场查 denied run」。我查了：**45 天内 `ads.*` 一条授权决定都没有**，
>    因为所有客户 `autopilot_dry_run=true`，D3 只记日志、**从没提交过**。
>    所以是**装好了没扣扳机**，不是已经响了。
>
> ## 新做法：改按魏征的 A0 切（比本文件的 A 更小，且不靠开关）
>
> **A0 = 只读评估器 + 回执 + 待办。不建两张批次表、不发事件、不碰孔明出口、
> 代码里根本没有写 `ads_circuit_events` 的路径**（比「默认关的开关」强一个量级 ——
> 没有「哪天有人打开」这件事）。按 CTS/NAL 真数据跑 7–10 天，拿**真实分布**定硬顶倍数、
> 看清「判不了」的量级，再决定要不要接写入。
>
> ## v0.3 必须改掉的（两审二轮合计 8 条）
>
> 1. **事实底座**：§1 / §5 改成上表；PR B 验收重写（bounded 分支，不是审批队列）。
> 2. **红线 3（人工止损豁免）按本文件写法落不了地**：解析器拿不到 `triggeredBy`
>    （`kernel/deps.ts:97-104` 入参里没有），而熔断那一刀在人工信封分叉**之前**
>    （`authorize.ts:412-427` vs `:448`）。要实现就得改 Kernel 公开契约 ——
>    与 §7「不改 Kernel 一行」直接冲突，而 A1–A8 没为它留任何工作量。
>    → 要么**降级成明确的已知缺口**（写明 trip 期间 PM 止损会被拒、解除按钮是唯一出路，
>    并把解除按钮提到 A），要么单独立项改契约并声明为第 8 处偏离。**不许做成假防线。**
> 3. **硬顶倍数错了**：×3 = CTS 主账户 $120，而近 14 个有数日里 **4 天超过**（29%）→ 约三天一次必 trip。
>    更根本：那个 $40 上限**本身已被日常花费长期突破**（在投预算合计 $115/天），
>    拿一个被突破 2.9 倍的数再乘 3 当安全硬顶，**基准是假的**。
>    7 个登记账户里 **5 个这一列是 NULL** → 判据 #1 对它们压根不存在。
>    → 倍数要按真实分布定（A0 就是为这个跑的）；NULL 账户单列一类「未配上限」，不混进「判不了」。
> 4. **休眠账户要能排除**：CTS 次账户会每天产出一条 `facts:` 待办，A7 的「连续 N 天全判不了」永远亮红。
> 5. **B2 的冲突判据写错了方向**：同一父子链上**两条收类同日落地是常态**
>    （降系列预算 + 关掉系列里最差的组），而且它们**根本不冲突、应当都执行**。
>    本文件却说「理论上不该发生」。→ 要分「真冲突」（同一实体同一字段相反方向）与
>    「父子链上两条收类」（不冲突、都执行）；真互斥时给明确优先序（暂停 > 降预算 > 降组预算）。
> 6. **A7 的回看窗口不够**：`pm-daily-todo` 是 `0 19 * * 0-4`（新西兰周一–周五），
>    而 A7 只回看一天 → **新西兰周五、周六的评估失败永远不会被报**。窗口至少 3 天。
> 7. **`kernel_needs_human` 的车道是 `dev`**（`five-kinds.ts:176`）→ B「出待办」落开发欠账栏、**PM 看不到**。
>    拿它当 B 的交付价值要重写。
> 8. **落点换了，白名单语义也跟着变**：韩信落 `action-submission/` 而
>    `HUMAN_TRIGGER_ALLOWED_DIRS = ['src/lib/action-submission/']` ——
>    韩信因此进了「可以自称人按的」目录。v0.2 没声明这件事。
>
> ## 子牙二轮另外 4 条（也要进 v0.3）
>
> 开关落点未定且环境变量做不到「只对 DEMO 打开」（进程级）；评估器**回执没有落点**
> （`ads_action_batches` 没有 verdict 列，而 §7 又写「不建第三张表」）；
> 绝对硬顶排在中位数判据之前、**把相对判据吃成死代码**；偏离 6 扩 CHECK 归哪个 PR 没说。
>
> **状态：本文件停在这里。v0.3 按上面 12 条改，先做 A0。一行代码都不写。**

---

> **v0.2 = v0.1 + 子牙与魏征两轮复审的结论已全部并进正文。**
> v0.1（`…-v0.1.md`）作废，只留作审查轨迹；**实现者照本文件做。**
> 两审挑出 13 条必改、其中 2 条推翻了 v0.1 的结论 —— 轨迹在 §9。

- **性质**：实施方案，**不是新设计**。权威设计是
  `docs/specs/2026-09-25-ads-impact-wp3-design-v1.md`（v2.x）的 §2 / §3 / §5 / §11.6 / §11.7 / §17
  与 `docs/ROADMAP.md`「WP3.2 链条」。**凡偏离权威稿的地方在 §3 逐条声明**，没声明的以权威稿为准。
- **授权**：PM 2026-10-18 当面「开，做编排层那一包」。
- **风险级：A**（新表 + 决定何时禁止系统自动动手）。三个 PR **全部草稿**、正文第一行写「风险级别：A」、
  **PM 本人回「合 N」才合**；migration 的 apply **要 PM 单独点头一次**，不被「合 A」顺带带过。
- **状态**：本文件要先过第二轮复审，**审回来才写第一行代码**。

---

## 0. 它在广告工作流里堵哪一环

广告工作流七段：**经营判断 → 预算 → 受众/素材/实验 → 出片审核 → 素材入账户 → 建广告/开投 → 投后与回写**。

**WP3.2 堵第 6 段前面那一截：「决定了要做」到「真的去做」中间那一段。**
今天孔明能出处方，但**没有任何程序把处方排队、去冲突、提交内核**，也没有任何程序在动手前查熔断。
工作流在「该动手」这一步断开，后面的 Check/Tune 自然接不上。

它**不负责**第 1–2 段（经营判断卡 / 总预算，105 号那条线）、不负责第 4–5 段（出片与素材入账户），
也**堵不住**「PM 批准完没人执行」（Kernel WP07，另一包 —— 见 §5 已核实 1）。

---

## 1. 现状（2026-10-18 查实，不是回忆）

| 件 | 现状 |
|---|---|
| `ads_action_batches` / `ads_action_batch_items` | **生产库都不存在** |
| `ads.impact_cycle.due` 事件 | 全仓**搜不到**这个名字 |
| 韩信 | **零代码**；`docs/agents/12-hanxin.md` 不存在 |
| 孔明侧预检 | `isWithinEnvelope` 只被 Kernel 的 `authorize` 与 `outward-authorization` 用，**无预检调用点** |
| 熔断五条判据 | **写好了、有测试、零调用方**；`circuit-cap-facts.ts` / `circuit-spend-window.ts` 两个取数层同样是孤儿 |
| `ads_circuit_events` | 表在，**0 行**；执行前那道闸因此恒放行（**解析器早就挂好了**，`kernel/index.ts:49-51`，不是没装） |
| `pushAdsCircuitItems` / `pushAdsSyncItems`（实名 `pushAdsAutonomySyncItems`） | **已存在且已挂**（`manual-items.ts:387,395`）→ **不用做** |
| `pushAdsBatchDeferredItems` / `pushAdsCycleLivenessItems` | **新写**（§17 五个里只缺这 2 个） |
| `prescription_evaluations`（判据 #4 数据源） | 不存在，按权威稿是 WP3.3 → **#4 继续打桩** |
| 四个客户的 `autonomy_mode` | **全是 `observe`** → 映射成 `require_approval`（见 §5 已核实 1） |

---

## 2. 三个叠着的 PR（决定已经焊进内容里，不另列）

顺序 **A → B → C**，各自独立合并与回滚。**三个都合了才算 WP3.2 完成**，不许 C 掉队。

### PR A —— 让熔断判得出来（默认**不拦**）

| # | 内容 | 谁写 |
|---|---|---|
| A1 | migration：两张批次表。DDL 以权威稿 §11.6/§11.7 为底，**按 §3 偏离 1/2/3 改**：显式 `REVOKE/GRANT`、成员表改 `subject_level`+`subject_id`、加成员幂等唯一键、`kernel_run_id` 外键、`ads_action_batches.updated_at` 挂仓库现成的 `update_updated_at_column()` 触发器。**items 表不做 append-only**（`kernel_run_id` 是提交后回填的） | 我（A 级 schema） |
| A2 | `docs/agents/12-hanxin.md`（职责照权威稿 §3.4 四点，不自创）+ `00-architecture.md` 权限矩阵加 `agent:hanxin`，**并写明它是署名、不构成授权**（§4 红线 7） | 我 |
| A3 | 韩信 Inngest 函数骨架：消费 `ads.impact_cycle.due` → **step 1 = 熔断评估器** → `INSERT … ON CONFLICT DO NOTHING RETURNING id` 建/复用批次行（撞唯一键 = 今天已跑过，回执记 `already_ran`，**不停不死信**）。**空处方日也建批次行（0 成员）** | 我（A 级） |
| A4 | **熔断评估器**：调判据 #1/#2（#3 在 B、#4 打桩、#5 见下），**只对 `autonomy_mode='bounded_auto'` 的客户写**。三件硬要求：①`undeterminable` 的三件处置（§4 红线 2）；②trip 幂等（同 client+账户+reason 且无 release 就不重写）；③**写入者文件里只许出现 `'trip'` 字面量**，出现 `release` 会把 `architecture.test.ts` 那条「`src/lib` 下不许有 release 写入者」搞红 | 我（A 级） |
| A5 | **判据 #5（数据不全）接上**：读当天 `ads_growth_states`。`partial` 与「当天根本没有行」**分开记**（`data_partial` / `growth_state_missing`），两者都**不写** circuit event，本轮冻结、#1/#2 答「判不了」 | 我 |
| A6 | 日 cron 末尾每客户发 `ads.impact_cycle.due`，`try/catch` 兜住、结果进 result JSON（事件发失败不许拖垮采数） | 我（接线进大文件） |
| A7 | `pushAdsCycleLivenessItems`（昨天有启用客户却没批次行）**+ 熔断自身的成色检查**（某启用账户昨天评估回执缺失，或连续 N 天全「判不了」）→ 出待办。两个新 kind 都要进 `five-kinds.ts` 车道表，**「闭环没跑」不归 dev 车道** | DeepSeek + 我审 |
| A8 | 测试 + 架构测试断言：**为两张新表各写一条 `REVOKE/GRANT` 断言**（现有那条是按文件硬编码的，不会自动覆盖新表）；`agent:hanxin` 字面量只许出现在韩信那个模块 | 我 |

**🔴 A 的开关（这是 A 能安全落地的关键）**：评估器带一个具名开关，**默认关**。
关着时它**只写回执、不写 `ads_circuit_events`** → 闸看不见 trip、**执行结果一个字不变**，
但「判得出来 / 判不出来」被真实暴露。**打开 = 真正启用熔断，要 PM 本人单独点头一次。**

**A 合并后立刻成立的事（只有这三句，不许多说）**：
①评估器每天跑并留回执；②「判不了」会出待办、带账户 id 和 `facts:` 原因码；③活性与成色检查开始盯它自己。
**不成立的**：闸开始拦（要开开关）、旁路被罩住（`meta-ads/execute` / `boost-post` / `winner-reel-sync` 不经 Kernel，熔断对它们**完全无效**）。

### PR B —— 处方排队并提交内核

| # | 内容 |
|---|---|
| B1 | 孔明处方出口发 `ads.action_batch.ready` + `isWithinEnvelope` 预检。🔴 **不许挂进 `persistZhugeActions`**（它有 5 个非测试调用方、**3 个是 SEO 的**），必须挂在广告专属那一段并**按动作是不是 `ads.*` 过滤**。预检要**直接**调 `isWithinEnvelope`/`selectEnvelopeVerdict`，别包一层转发把架构测试的命中藏掉 |
| B2 | 韩信：分组（`client_id, ad_account_id`）→ **先排序再去冲突** → 提交 Kernel。🔴 **同一实体同日收类优先**：收类（暂停 / 降预算）留下、加类一律 defer；被 defer 的若是收类（理论上不该发生），文案**不许**是「72 小时后再评估」。去冲突按**实体及其父子关系**判（系列级暂停 + 组级加预算必须能互相看见） |
| B3 | 判据 #3（回滚失败 → **sticky** trip + 中止本批剩余成员，标 `deferred_kind='circuit_tripped'`） |
| B4 | 批次成员落 `ads_action_batch_items`。🔴 `ads.budget_move_plan` **不进 Kernel**，直接标 `manual_only`（权威稿 §6.1 末尾） |
| B5 | §4.8 的同步漂移闸：提交前比同步回执版本 vs `ad_strategy_configs.updated_at`，不一致 → 整批 `held_sync_drift` + `step.sleep(60s)` 重查 ≤3 次（**不是 `setTimeout`**，PITFALLS F10），仍不一致才出一条批次级待办 |

**🔴 B 的验收不许写成「处方能执行」**：现在 4 个客户全是 `observe`，提交后落 `pending_approval`、
进人工队列，而那个队列**没有执行者**。验收写成「**提交后落 `pending_approval` 并出待办**」。
B2/B3/B5 我自己写（编排判据 = A 级核心），B1/B4 可派 DeepSeek。

### PR C —— denied 恢复入批 + 待办

| # | 内容 |
|---|---|
| C1 | 补查询：按 client + `deny_code='outside_autonomy_envelope'` + 晚于 `policy_version` 变更列 denied run（`deny_code` 在 `authorization_decisions` 不在 `action_runs`，**要 join**；现有 `listDeadLetterRuns` 只按 `needs_human`）。过滤按 **reason 的机器前缀**（`envelope:` / `circuit:` / `facts:`），**不按中文子串** |
| C2 | **只恢复幂等键完全相同的**（input 不同就提交新处方，不许拿昨天的意图打今天的账户），每轮封顶 20 |
| C3 | `pushAdsBatchDeferredItems`：🔴 **`deferred_kind` 定档位、`deferred_reason` 存带前缀的原文**，待办文案**按 kind 分**（两套分类不同构，按前缀去匹配 kind 会永远零命中）。要按 `run_id` 跟 handoff 待办去重 |

C1/C2 我自己写，C3 派 DeepSeek。

**韩信碰 Kernel 的代码只能落 `src/lib/action-submission/hanxin/`** —— `kernel/boundaries.ts:217-221`
的白名单只有三个目录，`ads-strategy/` **不在内**（权威稿 §12 那句跟代码不一致，见 §3 偏离 4）。
编排判据（分组/去冲突/排序的纯函数）可以留 `ads-strategy/`。

---

## 3. 对权威稿的 7 处偏离（不声明不许改）

| # | 偏离 | 理由 |
|---|---|---|
| 1 | 建表 DDL 加显式 `REVOKE/GRANT` | 09-27 那份熔断 migration 自述的标准更严，`architecture.test.ts` 把它写成明文断言。**但那条断言是按文件硬编码的、不覆盖新表**，所以要为两张新表各补一条 |
| 2 | 成员表 `adset_id NOT NULL` → `subject_level` + `subject_id` | 9 个 `ads.*` 键里 `pause_campaign` / `cut_campaign_budget` / `budget_move_plan` **没有 adset_id**；而且系列级暂停与组级加预算不共享 adset_id → 去冲突看不见 → 可能同一天「停系列 + 给系列内某组加钱」 |
| 3 | 成员表补幂等唯一键 + `kernel_run_id` 外键 | 权威稿 §2.5 要求成员幂等，§11.7 的 DDL 里却没有这个唯一键；没外键会攒出指向不存在 run 的脏行 |
| 4 | 韩信落点 = `action-submission/hanxin/` | 权威稿 §12 写「`ads-strategy/` 与 `capabilities/` 之外禁 import」，而代码白名单里**没有** `ads-strategy/`。以代码为准 |
| 5 | 判据 #1 的 `absoluteCapCents` = 该账户信封上限 × 具名常量（初值 3），**NULL → 判不了** | 权威稿**没定义这个值的来源**，而它是必传参数。直接拿账户上限当硬顶会每天必 trip（CTS 主账户上限 $40、实际日花费 $70–197）；`?? 0` 会让任何一分钱都 trip |
| 6 | 成员 `deferred_kind` 扩一个 `facts_unavailable` 档 | 「读不到事实」在现有五个枚举值里没有档位可落 |
| 7 | 判据 #4 继续打桩 | 数据源 `prescription_evaluations` 按权威稿 §12 是 WP3.3 才建，生产库确实没有 |

---

## 4. 必守红线（每条都是今天踩过或查实过的，不是泛泛注意事项）

1. 🔴 **不许碰 `ad_strategy_configs.updated_at`** —— 它是自治同步的幂等键（`autonomy/sync-policy.ts:17-19`）；
   顶它会让次日 reconcile 的去重失效、白写一遍策略表。**今天我自己的一刀就栽在这里。**
2. 🔴 **「判不了」的处置写死三件**：①**不写** circuit event；②成员标 `facts_unavailable`；
   ③出待办、**必须带账户 id 和 `facts:` 原因码**。三件齐了才算接上 ——
   否则交付物是一个「看起来接上了、实际恒放行」的评估器。
3. 🔴 **熔断不许拦人踩刹车**：解析器里给 `triggeredBy === 'human'` 且属**收类**的动作放过熔断。
   不做这条，一条 trip 会把 PM 在看板上按的止损和降预算一起挡成死信 —— **效果上就是继续花钱**。
4. 🔴 **解除要有按钮**：现在解除只有一个 API 路由、**零个界面调用**，待办文案是让 PM
   「告诉开发帮你调接口」—— 正是铁律 3 禁止的人工 SOP。按钮排在广告门之后做，但 A 的开关先兜住误写。
5. 🔴 **新增/改 Inngest 函数后要去后台对 `/api/inngest` 手动 Sync 一次**，否则安静地不跑
   （`docs/STATE.md:174`）。这是**人工动作**，写进 PR 正文的上线步骤，**当场试跑要在 Sync 之后做**。
6. 🔴 **`step.run` 里不许 `setTimeout` 轮询**，用 `step.sleep`（PITFALLS F10）。
7. 🔴 **`agent:hanxin` 是署名，不是授权**：`TriggeredBy` 枚举本来就有 `'agent'`，韩信用的是它；
   这个字符串只落在审计自由文本里，**无校验、谁都能冒充**。方案与 `00-architecture.md` 都要这么写，
   否则下一个人会以为有保证。字符串由常量提供 + 架构测试锁住出现位置。

---

## 5. 动手前要核实的三件 —— **已全部核完**

1. **「WP3.2 是否依赖 Kernel WP07」→ 依赖。** bounded 自治只在 `policy.mode === 'auto_approve'`
   分支里跑（`authorize.ts:383`）；`require_approval` → `pending_approval` + `needs_human`（`:568`）；
   `observe → require_approval`（`sync-policy.ts:36-39`），**4 个客户全是 `observe`**；
   批准之后也没人执行（`kernel-approval/service.ts:613`、`kernel/handoff.ts:16`）。
   → **不改 PR 顺序**（A 跟 WP07 无关），但 **B/C 的验收标准按 §2 改写**。
   > 顺带开一张卡：`sync-policy.ts:43` 会把**全部** `ads.*` 键一起翻成 `auto_approve`，
   > 而 `ads.auto_pause_on_d3` 在注册表里是 `human_only` —— 哪天有客户翻成 `bounded_auto`，
   > **D3 自动暂停会立刻被整条拒掉**。3.1a 埋的，恰在 WP3.2 投用那一刻才咬人。
2. **孔明处方出口在哪 → 不能挂在共享写入函数里。** `persistZhugeActions` 有 5 个非测试调用方，
   **3 个是 SEO 的**（`seo-meta/cycle/runner.ts:188,538`、`seo-patrol/job.ts`）。见 B1。
3. **两张表的 `updated_at` → 挂仓库现成的 `update_updated_at_column()`**
   （样例 `20260812100000_memory_supersession_v1.sql:84-86`）。`items` 表没有这一列（只增不改），不需要。

---

## 6. 验证计划（PM 2026-09-26 硬规矩：交付前必须当场试跑；单测绿不算）

🔴 **试跑一律挂 DEMO 客户 + 假 `ad_account_id`**：trip 行写进只增账本**删不掉**，
落在真客户身上会冻住那个账户 24 小时（sticky 则直到有人解除）。
库里现成的 DEMO：Harbourline Physio (DEMO)、Kiwi Silk Road (DEMO)、【测试】可删。
**PR 正文要附 `select count(*) … where client_id in (CTS, NAL)` 的回执，证明生产客户零 trip 行**，
并说明留在账本里的那几条测试行（账本只增，这点要说出来）。

| PR | 当场试跑 |
|---|---|
| A | 手动发一次 `ads.impact_cycle.due`（DEMO 客户）→ 批次行建出来、评估器留回执、`already_ran` 复用路径也走一遍；**开关关着 → 确认 `ads_circuit_events` 零新增** |
| A | 把开关打开（仅 DEMO）→ 人为造一次超上限 → trip 真写进去 → 执行前闸真拦住 → PM 待办真出现一条 → **再按一次人工止损，确认它没被拦**（红线 3） |
| A | 造一天数据缺失 → 确认走「判不了」、不写 event、出待办且原因码是 `growth_state_missing` 而不是 `data_partial` |
| B | 造一批假处方（含同一实体一条止损 + 一条加预算）→ 确认**留下止损**、加预算标 `conflict` 并出待办 |
| C | 造一条 denied run → 只有幂等键相同的被恢复；键不同的走新提交 |

每个 PR 正文必须有「## 当场试跑」一段：触发方式、时间、退出码/运行状态、输出摘要。

---

## 7. 不做

不改 Kernel 一行判据；不新增 ActionKey（本包是接线，不是加能力）；
不碰那十条绕开授权闸的旁路（另案，缺口稿 G3）；不改授权口径；不建第三张表；
不替 PM 点任何授权；不碰 Google / TikTok；**不在 CTS 开投稳定满一周之前合 A**（§8）。

---

## 8. 合并时机

**两审一致：A 不该在 10/22 前后合。**
魏征算清了两件：①「花费从 0 跳到 101」**不会**命中 3 倍中位数（重开投时非零花费天数 < 5 → 判不了）；
②真正会在 10/22 命中的是**绝对硬顶**（偏离 5），以及判据 #2 —— 客户总闸 $150 × 1.2 = **$180**，
而 CTS 10/03 单账户就花了 **$197**，**不是理论值**。

**定**：代码/迁移/测试照写照审，**A 合并排在 CTS 开投稳定满一周之后**；
若要提前合，**必须带 §2 那个开关且默认关着**（那样 A 落地只产生回执和待办、不改变任何执行结果）。

---

## 9. 审查轨迹（两审挑出的 13 条，去哪了）

| 来源 | 结论 | 并进哪里 |
|---|---|---|
| 子牙 | 韩信落点与白名单冲突 | §2 末尾 + §3 偏离 4 |
| 子牙 | **WP3.2 确实依赖 WP07**（推翻 v0.1） | §5 已核实 1 + §2 PR B 验收 |
| 子牙 | DDL 三缺陷（NOT NULL / 幂等键 / 外键） | §3 偏离 2、3 |
| 子牙 | **PR A 会拦住人工止损**（推翻 v0.1） | §4 红线 3 |
| 子牙 | 评估器缺 6 处接线（硬顶来源 / 账户时区目标日 / truncated / #5 / trip 幂等 / release 字面量） | §2 A4、A5 + §3 偏离 5 |
| 子牙 | 我没声明的 6 处偏离 | §3 全表 + §2 B4、B5 + §2 A2 |
| 魏征 | 硬顶无来源会每天必 trip（算了 CTS 真实花费） | §3 偏离 5 |
| 魏征 | 「判不了」之后动不动手没定；实测今天 CTS 四条判据三条判不了 | §4 红线 2 + §2「A 合并后成立的三句」 |
| 魏征 | 评估器自己挂了无人知 | §2 A7 |
| 魏征 | 误写 trip 的止损路径 PM 碰不到 | §4 红线 4 + §2 的开关 |
| 魏征 | 试跑会往生产写不可撤回的 trip | §6 |
| 魏征 | 去冲突与排序顺序写反了（会留下加预算、推掉止损） | §2 B2 |
| 魏征 | `deferred_kind` 与三种前缀不同构 | §2 C3 + §3 偏离 6 |

两位的其余建议（只对 `bounded_auto` 写 trip、车道归属、「闸恒放行不是解析器没装」、
migration apply 规矩）也已分别并进 §2 A4、A7 与 §1、§全文。

---

## 10. Reuse Statement

- **复用**：`circuit-detectors.ts` 五条判据（**已写好且有测试，一行都不重写**）、
  `circuit-cap-facts.ts`（产出**完全对得上**判据 #2 的四个入参，`AccountSpendFact` 由它组装，
  **判据 #2 一行不用写**）、`circuit-spend-window.ts`、`circuit-state.ts`、`ads_circuit_events`、
  Kernel 的 `authorize` / `isWithinEnvelope` / 信封、`pushAdsCircuitItems` 与
  `pushAdsAutonomySyncItems`（已存在已挂）、Inngest、`resolveClientEvaluationDate` /
  `accountDayKey`、`update_updated_at_column()`、`cron_run_logs` 回执范式。
- **平台共享**：编排层、熔断评估器、批次两张表、去冲突与排序判据 —— 任何有 Meta 广告账户的客户都成立。
- **行业层 / 客户层**：无。阈值（3 倍中位数、硬顶倍数、72h 冷却、每轮 20 条）是**平台默认**；
  真要按行业分化再下沉 Playbook，**不在共享代码里加 `if 客户名`**。
- **有没有客户事实进共享代码**：没有。CTS 只出现在验证证据与时机论证里。
- **落点与 tier-gate 判定是否一致**：一致。不新增能力线 / capability / 支柱；
  这是既有广告支柱 + 既有平台基础设施（Kernel / Measurement）内部的接线。
