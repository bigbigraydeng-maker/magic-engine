> # ⛔ 本文件已作废，照 v0.2 做
>
> 两审的结论已全部并进 **`2026-10-18-wp32-hanxin-implementation-plan-v0.2.md`**，
> 那份才是实现者要照着做的。本文件只留作审查轨迹（v0.1 原文 + 两审意见的原始记录）。

# WP3.2（韩信编排）实施方案 v0.1 · 119 号 · 2026-10-18

- **性质**：实施方案，**不是新设计**。权威设计是 `docs/specs/2026-09-25-ads-impact-wp3-design-v1.md`（v2.x）
  的 §2 / §3 / §5 / §11.6 / §11.7 / §17，以及 `docs/ROADMAP.md`「WP3.2 链条」那条。
  **凡我偏离权威稿的地方，下面逐条写明并说理由**；没写明的地方以权威稿为准。
- **授权**：PM 2026-10-18 当面回「开，做编排层那一包」。
- **风险级：A**（新表 + 给机器发新身份 + 决定什么时候禁止系统动手）。
  三个 PR 全部**保持草稿**，正文第一行写「风险级别：A」，**PM 本人回「合 N」才合**。
- **本方案本身要先过审**（铁律 4：设计阶段审一次、动手前）：子牙 + 魏征。**审回来再写第一行代码。**

---

## ⚠️ v0.2 · 子牙复审结论：**不能按 v0.1 动手**（2026-10-18）

子牙审出 **5 条必改 + 6 条我没声明的偏离**。其中**两条推翻了 v0.1 的结论**，必须先说：

### 🔴 推翻一：PR A 按 v0.1 合并，会把 PM 自己的止损按钮一起拦掉

`capabilities/ads/envelope-facts.ts:358-371` 的熔断检查在解析器**最前面**，trip 就直接 `unavailable`，
**没有任何「人按的收类动作」豁免分支**；而止损路由现在已经走 Kernel
（`ad-health/stop-loss/route.ts:153`），`kernel/outward-authorization.ts:169-171` 的 pre_provider 闸
对**任何** bounded 对外动作都生效，**不看 policy mode、不看是不是人按的**。

连起来：**判据 #1/#2 一 trip，PM 想点止损、想批 D3 自动暂停，全被同一道闸挡成死信。**
而熔断触发那一刻恰恰是最该让人踩刹车的时候 —— **拦住降预算/暂停，效果上就是继续花钱，方向是 fail-open。**

今天不发生，纯粹因为没有 trip 写入者。**PR A 就是那个写入者 —— 它一合并，这个行为当场生效。**

**定下来的做法**：按「熔断是禁止**系统自动**动手，不是禁止**人**踩刹车」（权威稿 §6.7 原意），
在解析器里给 `triggeredBy === 'human'` 且属**收类**（pause / 降预算）的动作放过熔断。
这改的是 3.1b 交付的解析器，**算第 4 处偏离，要在 PR 正文显式声明**。

### 🔴 推翻二：v0.1 §5 待办 1 的判断是错的 —— WP3.2 **确实依赖** Kernel WP07

我原来推「韩信走 bounded 自动放行，不进人工审批队列」。逐行核完是错的：
- `kernel/authorize.ts:383`：bounded 信封判据**只在 `policy.mode === 'auto_approve'` 分支里跑**；
- `:568`：`require_approval` → `pending_approval` + `needs_human`，直接进人工队列；
- `autonomy/sync-policy.ts:36-39`：`observe → require_approval`，而**现在 4 个客户全是 `observe`**；
- 批准之后也没人执行（`kernel-approval/service.ts:613`、`kernel/handoff.ts:16`）。

**所以 PR B/C 的产出只能停在「等人批准」，而那个队列今天没有执行者。**
**B/C 的验收条件改成**「提交后落 `pending_approval` 并出待办」，
**不许宣称「处方真的能执行」**。要让处方落地，得先解 WP07，或先把某个客户翻成 `bounded_auto`。

> 顺带一张要开的卡：`sync-policy.ts:43` 会把**全部** `ads.*` 键一起翻成 `auto_approve`，
> 而 `ads.auto_pause_on_d3` 在注册表里是 `human_only` —— 哪天有客户翻成 `bounded_auto`，
> **D3 自动暂停会立刻被整条拒掉**。这是 3.1a 埋的，恰好在 WP3.2 投用那一刻才咬人。

### 其余必改（动手前全部要并进本方案）

| # | 必改 | 要点 |
|---|---|---|
| 1 | **韩信碰 Kernel 的代码只能落 `src/lib/action-submission/hanxin/`** | `kernel/boundaries.ts:217-221` 的白名单只有三个目录，`ads-strategy/` 不在内；权威稿 §12 那句跟代码**不一致**，我照抄了没核。编排判据（分组/去冲突/排序纯函数）可留 `ads-strategy/` |
| 3 | **两张表 DDL 三个硬缺陷** | ①`adset_id NOT NULL` 装不下系列级动作（`pause_campaign` / `cut_campaign_budget` / `budget_move_plan` 三个键没有 adset_id）→ 改 `subject_level` + `subject_id`，**第 5 处偏离**；②缺成员幂等唯一键（权威稿 §2.5 要求 `(batch_id, subject_id, action_key)`，DDL 里没有）；③`kernel_run_id` 加指向 `action_runs` 的外键；`items` 表**不要** append-only（run_id 是回填的） |
| 5 | **熔断评估器缺三处接线** | ①`absoluteCapCents` **全仓没有来源**，`detectSpendSpike` 必填；②#1 的目标日必须是**账户时区**的完整前一天（`account-timezone.ts` 有现成函数），不能拿 `circuit-cap-facts` 的客户级参考日喂它；③`truncated === true` 必须当「判不了」；④**判据 #5（数据不全）v0.1 通篇没提**，不接它会在数据缺失那天拿不全的花费去判 #1/#2，正好踩反我自己立的红线；⑤**trip 幂等**（同 client+账户+reason 且无 release 就不重写）；⑥写入者文件里**只许出现 `'trip'` 字面量**，出现 `release` 会把 `architecture.test.ts:2610-2648` 那条测试搞红 |

**复用那块子牙确认了好消息**：`circuit-cap-facts.ts:186` 的 `loadClientCapFacts` 产出**完全对得上**
`detectClientSpendOverCap` 的四个入参，`AccountSpendFact` 由它自己组装，**判据 #2 一行不用写**。

### 我没声明的 6 处偏离（子牙点出，已补进上表或下列）

1. 韩信落点与白名单冲突（必改 1）；2. 判据 #5 整条没接（必改 5）；3. DDL 两处（必改 3）；
4. **`ads.budget_move_plan` 不进 Kernel、直接标 `manual_only`**（权威稿 §6.1 末尾），PR B 漏了这条规则；
5. **§4.8 的「提交前比同步回执版本、不一致整批 `held_sync_drift` + sleep 60s 重查 ≤3 次」没落成任何交付项** ——
   不做的话 `deferred_kind='held_sync_drift'` 这个枚举值永远没人写；
6. **系统身份 `agent:hanxin` 要写进 `docs/agents/00-architecture.md` 的权限矩阵**（v0.1 只建 `12-hanxin.md`）。
   另两条小的：`pushAdsBatchDeferredItems` 要按 `run_id` 跟 handoff 待办去重；A1 要照「migration 先 apply 再合并代码」硬门走、PR 正文附 apply 回执。

### PR A「立刻成立的事」要收窄的三句

1. 只有两条判据会 trip（#3 在 B、#4 打桩、#5 要补）；
2. 闸只罩**进 Kernel 的路径** —— `meta-ads/execute` / `boost-post` / `winner-reel-sync` 三条旁路不经 Kernel，
   **熔断对它们完全无效**，别让 PM 以为熔断能挡住所有花钱动作；
3. 它会连人工止损一起挡（除非按推翻一那条做豁免）。

---

## ⚠️ v0.2 · 魏征复审 + 两审并起来的决定（2026-10-18）

魏征另外审出 8 条必改。**两位独立得出同一个结论：PR A 不该在 10/22 前后合。**
下面是我据两审做的决定 —— **不是把意见列一遍，是逐条定死做法**。

### 决定 1 · 判据 #1 的绝对硬顶：**不许现场挑一个值**（魏征 M1）

`absoluteCapCents` 是 `detectSpendSpike` 必传参数（`circuit-detectors.ts:47`），而**全仓没有任何来源**。
魏征算了一遍后果：若图省事拿 `client_meta_ad_accounts.daily_budget_cap_cents` 当它，
**CTS 主账户上限 $40、实际日花费 $70–197（中位 ~$112）→ 第一次跑就 trip，而且每天重写一条，
非 sticky 的 24 小时过期永远等不到 → 事实上的永久冻结**；NAL 那一列是 NULL，若 `?? 0` 兜底，
**任何一分钱花费立刻 trip**（判据是严格大于 0）。

**定**：`absoluteCapCents = 该账户信封上限 × 一个具名平台常量（初值 3）`，并且
**该账户上限为 NULL 时一律 `undeterminable`，禁止 `?? 0`**。
「NULL → 0」要写成一条**必红的变异测试**。这是**第 6 处偏离**（权威稿没定义这个值的来源），
下一轮复审专门看它。

### 决定 2 · 「判不了」之后到底动不动手：三件齐了才算接上（魏征 M2）

魏征实测今天的 CTS：**4 条判据 3 条答「判不了」，零 trip** ——
#1 目标日无行（数据停在 10-10）、#2 两个账户数据都落后于参考日而快照里仍有在投实体、#4 打桩。
**所以 v0.1 §2 里「A 合并后熔断立刻真生效」那三句，对今天的 CTS 一条都不成立。**

**定**：`undeterminable` 的处置写死为三件 ——
①**不写** circuit event；②本批成员标 `facts_unavailable`（**要扩 CHECK，第 7 处偏离**）；
③出一条待办，**必须带账户 id 和 `facts:` 原因码**。三件齐了才算接上。
并把 PR A 的验收从「熔断生效」改成「**熔断判得出来 / 判不出来都看得见**」。

### 决定 3 · PR A 带「只写不拦」开关，默认**关**（魏征 M4 + 建议的折中）

**定**：评估器有一个具名开关；关着时它**只写回执、不写 `ads_circuit_events`**，
于是闸看不见任何 trip、执行结果一个字不变，但「判得出来吗」这件事被真实暴露。
开关打开 = 真正启用熔断，**要 PM 本人单独点头一次**，不被「合 A」顺带带过。

理由：这同时解决了「10/22 时机」和「误写无法止损」两件事 —— A 可以照写照合，风险面近似为零。

### 决定 4 · 熔断期间**不许拦人踩刹车** + 解除要有按钮（子牙推翻一 + 魏征 M4）

魏征查实：解除的唯一入口是一个 API 路由，**全仓零个页面/按钮调用它**，
而现有待办文案原话是让 PM「告诉开发帮你调用后台接口」—— **这正是铁律 3 禁止的人工 SOP**。

**定两件**：①解析器里给 `triggeredBy === 'human'` 且属**收类**（暂停 / 降预算）的动作放过熔断；
②广告门「等你点头」标签里加**解除熔断按钮**（走同一条 `requireGlobalAdmin` 路由），
待办的 `how` 从「告诉开发」改成「点这里」。②排在广告门第二步之后做。

### 决定 5 · 流水线顺序反了，必须**先排序再去冲突**，且**收类优先**（魏征 M6）

v0.1 写的是「去冲突 → 排序」，于是去冲突时**还没有优先级可用**，实现者最顺手的是按
`expected_impact` 挑一条留下 —— 而「加预算」的 impact 通常比「暂停」大。
**后果：同一天同一实体既有止损又有加预算时，留下加预算、把暂停推到 72 小时后 ——
亏钱的广告组没停，还被加了钱。**

**定**：判据写死成「**同一实体同日收类优先**：收类留下、加类一律 defer」，写成断言；
被 defer 的若是收类（理论上不该发生），文案**不许**是「72 小时后再评估」——那是在说「这笔钱先烧着」。

### 决定 6 · 成员表按**实体层级**存，不是按 adset（两审同一条，子牙必改3 / 魏征 M8）

权威稿 §11.7 的 `adset_id text NOT NULL` 装不下三个系列级动作，
而且**系列级暂停 + 该系列内某组加预算两条不共享 adset_id，去冲突看不见** ——
系统可能同一天「停系列 + 给系列内某组加钱」。
**定**：成员表改 `subject_level`(`adset|campaign|plan`) + `subject_id`，
去冲突按**实体及其父子关系**判；加 `(batch_id, subject_level, subject_id, action_key)` 唯一键；
`kernel_run_id` 加指向 `action_runs` 的外键；`items` 表**不做** append-only。

### 决定 7 · 当场试跑只在 DEMO 客户上做（魏征 M5）

v0.1 §6 第 2 行会往**只增账本**里写一条**真客户**的不可撤回 trip，还会冻住那个账户 24 小时。
**定**：试跑一律挂 DEMO 客户 + 假 `ad_account_id`；PR 正文附
`select count(*) … where client_id in (CTS, NAL)` 的回执证明**生产客户零 trip 行**，
并说明留在账本里的那几条测试行（账本只增，删不掉，这点要说出来）。

### 决定 8 · 合并时机：**A 避开 10/22**

两审一致。魏征把我担心的那件算清了：**「花费从 0 跳到 101」不会命中 3 倍中位数**
（重开投时前 7 天非零花费天数 < 5 → 判不了）；真正会在 10/22 命中的是**绝对硬顶**（决定 1），
以及 #2 —— 客户总闸 $150 × 1.2 = $180，而 CTS 10/03 单账户就花了 $197，**不是理论值**。
**定**：A 的代码/迁移/测试照写照审，**合并排在 CTS 开投稳定满一周之后**；
若要提前合，**必须带决定 3 那个开关且默认关着**。

### 决定 9 · `agent:hanxin` 是**署名**不是授权，不许写成一道闸（魏征 Q3）

魏征查实：`TriggeredBy` 枚举里本来就有 `'agent'`，韩信用的是它；`agent:hanxin` 只落在
`triggered_by_ref` 这类**纯审计自由文本**里，**无校验、无白名单、谁都能冒充**。
**定**：方案和 `00-architecture.md` 都要写明它是署名、不构成授权；
字符串由一个常量提供，并加一条架构测试：`src/lib/` 里只有韩信那个模块能出现这个字面量。

### 决定 10 · 评估器自身要有活性检查（魏征 M3）

评估器挂了 → 没有 trip → 闸放行，而 `pushAdsCycleLivenessItems` 只查「有客户却没批次行」，
批次行先建、评估单步失败时它会说一切正常。
**定**：加一条**熔断自身**的成色检查（某启用账户昨天评估回执缺失，或连续 N 天全 `undeterminable`）→ 出待办，范式照 `pushCronHealthItems`。

### 另外采纳的小决定

- **只对 `autonomy_mode='bounded_auto'` 的客户写 trip**（魏征 S1）：`observe` 的客户本来不会自动动手，给它们写 trip 只是噪音。
- `deferred_kind` **定档位**、`deferred_reason` **存带前缀的原文**，待办按 kind 分话（魏征 M7：两套分类不同构，按前缀匹配 kind 会永远零命中）。
- 新待办 kind 要进 `five-kinds.ts` 的车道表，且**「闭环没跑」不归 dev 车道**（魏征 S2：归 dev 会只剩一行数字，PM 看不见）。
- PR 正文要写清「闸恒放行是因为账本 0 行、**不是解析器没装**」（解析器 `kernel/index.ts:49-51` 早装好了），免得下一个人去再挂一遍（魏征 S4）。
- migration 照 `ads_circuit_events` 那份的规矩：**先 apply 再合代码、PR 附 apply 回执、apply 要 PM 本人单独点头**（魏征 S5）。

**状态：两审并完，v0.2 的决定全部定死。下一步按决定重写 §2–§6，再送一次复审（实施完还要再审一次，铁律 4），之后才动手。**

---

## 0. 它在广告工作流里堵哪一环（统筹 10-18 要求开头先说清）

广告工作流七段是 **经营判断 → 预算 → 受众/素材/实验 → 出片审核 → 素材入账户 → 建广告/开投 → 投后与回写**。
**WP3.2 堵的是第 6 段到第 7 段之间那一截，也就是「决定了要做，到真的去做」中间那一段**：
今天孔明能出处方（第 3 段的判断有了），但**没有任何程序把处方排队、去冲突、提交内核**，
也没有任何程序在动手前查熔断。所以工作流在「该动手」这一步断开，后面的 Check/Tune 自然也接不上。

它**不负责**第 1–2 段（经营判断卡、总预算，那是 105 号那条线）、不负责第 4–5 段（出片与素材入账户）、
也**堵不住**「PM 批准完没人执行」那一处（那是 Kernel WP07，另一包）。

## 0b. 为什么做它（一句话）

广告闭环后半段有两处断口是**同一个根因**：没有编排层。
- **熔断今天完全不生效**：五条判据写好了没人调用，生产库 `ads_circuit_events` **0 行**，
  执行前那道闸恒放行，PM 的「熔断了」待办恒为空。写 trip 的人就是韩信 step 1
  （权威稿 §2.2 第 1 行原话：「韩信（step 1 = 熔断评估器：#1/#2/#4 的 trip 在这里写）」）。
- **处方没有执行者**：孔明出的处方今天没有任何程序把它排队、去冲突、提交内核。

**它堵不住「批准完没人执行」那一处** —— 那是 Kernel WP07，另一包（韩信走 bounded 自动放行，不走人工审批队列）。
这一点我在工作量估算里标过「推的、没逐行核」，**本方案第一步就要把它核实**（见 §5 待办 1）。

---

## 1. 现状核实（2026-10-18 查实，不是回忆）

| 件 | 现状 |
|---|---|
| `ads_action_batches` / `ads_action_batch_items` | **生产库都不存在** |
| `ads.impact_cycle.due` 事件 | 全仓**搜不到**这个名字 |
| 韩信 | **零代码**；`docs/agents/12-hanxin.md` 也不存在 |
| 孔明侧预检 | `isWithinEnvelope` 只被 Kernel 的 `authorize` 用，**没有预检调用点** |
| `pushAdsCircuitItems` | **已存在且已挂**（`pm-todo/ads-circuit-items.ts`，`manual-items.ts:49,395`）→ trip 一开始写就自动有待办，**这块不用做** |
| `pushAdsSyncItems` | **已存在**，叫 `pushAdsAutonomySyncItems`（`ads-autonomy-items.ts`，已挂 `:387`）→ **不用做** |
| `pushAdsBatchDeferredItems` | **新写** |
| `pushAdsCycleLivenessItems` | **新写** |
| `prescription_evaluations`（判据 #4 Jev 的数据源） | **不存在**，按权威稿是 WP3.3 才建 → **#4 继续打桩，不在本包** |

> 所以 §17 那五个拉取函数里，WP3.2 实际只需新写 **2 个**，比我 10-18 给 PM 的估算少。

---

## 2. 三个叠着的 PR

顺序 **A → B → C**，每个独立合并、独立回滚。**三个都合了才算 WP3.2 完成**，不许 C 掉队变成下一轮。

### PR A —— 熔断真的生效（本包最该先落地的一刀）

| # | 内容 | 谁写 |
|---|---|---|
| A1 | migration：两张批次表（DDL 抄权威稿 §11.6/§11.7）**+ 显式 REVOKE/GRANT**（见 §3 偏离 1） | 我（A 级 schema） |
| A2 | `docs/agents/12-hanxin.md`（职责照 §3.4 四点，不自创） | 我 |
| A3 | 韩信 Inngest 函数骨架：消费 `ads.impact_cycle.due` → **step 1 = 熔断评估器** → 建/复用批次行 | 我（A 级：决定何时禁止系统动手） |
| A4 | 熔断评估器：调 `circuit-detectors.ts` 的判据 #1/#2（#3 在 B，#4 打桩），trip 写 `ads_circuit_events` | 我（A 级） |
| A5 | 日 cron 末尾每客户发 `ads.impact_cycle.due`（try/catch 兜住，不拖垮采数，§2.7） | 我（接线进大文件） |
| A6 | `pushAdsCycleLivenessItems`：昨天有 enabled 客户却没批次行 → 待办 | DeepSeek + 我审 |
| A7 | 各自测试 + 架构测试断言 | DeepSeek 写，我补变异 |

**A 合并后立刻成立的事**：超上限 / 花费暴涨会真写 trip → 执行前那道闸真开始拦 → PM 的熔断待办真开始有东西。

### PR B —— 处方排队并提交内核

B1 孔明处方出口发 `ads.action_batch.ready` + `isWithinEnvelope` 预检；
B2 韩信：分组（`client_id, ad_account_id`）→ 去冲突（同 adset 一天 1 次，其余写待办说「72 小时后再评估」）→ 排序（**收类先、加类后**，同级按 `expected_impact` 降序）→ 提交 Kernel；
B3 判据 #3（回滚失败 → sticky trip + 中止本批剩余成员）；
B4 批次成员落 `ads_action_batch_items`（含 `deferred_kind`）。
B2/B3 我自己写（编排判据 = A 级核心），B1/B4 可派 DeepSeek。

### PR C —— denied 恢复入批 + 待办

C1 补查询：按 `client` + `deny_code='outside_autonomy_envelope'` + 晚于 `policy_version` 变更列 denied run
（`deny_code` 在 `authorization_decisions` 不在 `action_runs`，**要 join**；现有 `listDeadLetterRuns` 只按 `needs_human`）；
C2 只恢复**幂等键完全相同**的（§5.3.1：input 不同就提交新处方，不许拿昨天的意图打今天的账户），每轮封顶 20；
C3 `pushAdsBatchDeferredItems`（按 `circuit:` / `facts:` / `manual_only:` 三种前缀分三种话，不混成「读不到」）。
C1/C2 我自己写，C3 派 DeepSeek。

---

## 3. 我对权威稿的三处偏离（逐条说明，不说明不许改）

1. **建表 DDL 加显式 `REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT ALL … TO service_role`。**
   权威稿 §11.6/§11.7 的 DDL（09-25 写的）只有 `ENABLE ROW LEVEL SECURITY` + service-role 策略。
   但 09-27 那份熔断 migration 自述标准更严：「`architecture.test.ts` 把标准写成明文：anon/authenticated
   必须被显式 REVOKE、service_role 显式 GRANT —— 不赌底表 RLS 恰好都配对」。**按新的来。**
2. **判据 #4（Jev）继续打桩，不在本包。** 权威稿 §12 把 `prescription_evaluations` 划给 WP3.3，
   生产库也确实没有这张表。打桩返回「判不了」而不是「没问题」（现有 `detectJevLowScoreStreak` 已经是这样）。
3. **`pushAdsSyncItems` / `pushAdsCircuitItems` 不新写**，复用已存在的两个（见 §1 表）。

---

## 4. 五条我今天踩过或查过、这一包必须守住的（不是泛泛的注意事项）

1. 🔴 **不许碰 `ad_strategy_configs.updated_at`。** 它是自治同步的幂等键
   （`autonomy/sync-policy.ts:17-19`）；顶它会让次日 reconcile 的去重失效、白写一遍策略表。
   **今天我自己的一刀就栽在这里，子牙挑出来的。**
2. 🔴 **「判不了」和「没超」必须分开。** `circuit-detectors.ts` 已经把 `undeterminable` 和
   `no_trip` 严格分开了（读不到花费、样本不足、币种不一致都是「判不了」）。
   评估器**不许把判不了当成没问题**，那个方向是 fail-open。
3. 🔴 **新增 / 改 Inngest 函数后，要去 Inngest 后台对 `/api/inngest` 手动 Sync 一次，否则安静地不跑**
   （`docs/STATE.md:174`）。这是**人工动作**，必须写进 PR 正文的上线步骤，并且当场试跑要在 Sync 之后做。
4. 🔴 **`step.run` 里不许用 `setTimeout` 轮询**（PITFALLS F10），要用 `step.sleep`。
   §4.2 的「同步漂移 → sleep 60s 重查 ≤3 次」正好是这个形状。
5. 🔴 **撞 `UNIQUE (client_id, ad_account_id, date)` 不是失败，是「今天已经跑过」**：
   `INSERT … ON CONFLICT DO NOTHING RETURNING id`，无返回就 `SELECT` 既有批次继续，回执记 `already_ran`。
   **空处方日也要建批次行（0 成员）**，否则「没跑」和「跑了但没处方」分不开（§2.5、§2.6）。

---

## 5. 动手前还要核实的三件（我自己做，只读）

1. **「WP3.2 不依赖 Kernel WP07」这个判断**：我是按「韩信走 bounded 自动放行」推的，**没逐行核**
   韩信提交的 run 会不会落进人工审批队列。推错了依赖关系就变。**第一件就核它。**
2. ~~**孔明处方出口到底在哪一行**~~ → **已核，而且比我以为的麻烦，PR B 必须照这个来**：
   `persistZhugeActions` 有 **5 个非测试调用方，其中 3 个是 SEO 的**：
   `api/clients/[id]/zhuge/conduct/route.ts:124`（页面触发）、
   `api/cron/zhuge-recalculate/route.ts:107`（周计划 cron）、
   `lib/seo-meta/cycle/runner.ts:188` 与 `:538`、`lib/seo-patrol/job.ts`。
   **所以绝对不能把「处方完成 → 发 `ads.action_batch.ready`」挂进这个共享写入函数** ——
   那样 SEO 每次跑都会放一个广告事件出来。事件必须挂在**广告专属的那一段**，
   并且**按动作是不是 `ads.*` 过滤**。这条写进 PR B 的实现者清单。
3. ~~**两张表要不要 `updated_at` 触发器**~~ → **已核：仓库有现成的 `update_updated_at_column()`**
   （样例 `supabase/migrations/20260812100000_memory_supersession_v1.sql:84-86`）。
   `ads_action_batches` 的 `updated_at` 挂这个触发器，**不自己写一份**；
   `ads_action_batch_items` 没有 `updated_at` 列（只增不改），不需要。

---

## 6. 验证计划（PM 2026-09-26 硬规矩：交付前必须当场试跑）

| PR | 当场试跑怎么做 | 不外发怎么保证 |
|---|---|---|
| A | 手动发一次 `ads.impact_cycle.due`（给一个客户），看：批次行建出来、熔断评估器写了回执、`already_ran` 复用路径也走一遍 | 评估器**只写 `ads_circuit_events` 和批次表，不碰 Meta**；判据 #1/#2 只读 `ad_daily_insights` |
| A | **人为造一次超上限** → 看 trip 真写进去 → 执行前闸真拦住 → PM 待办真出现一条 | 用测试客户或把阈值临时调到必然触发；**不动真实广告** |
| B | 造一批假处方（含同 adset 两条）→ 看去冲突留 1 条、其余 `deferred_kind='conflict'` 并出待办 | 提交到 Kernel 但**信封必然拒**的组合，或用 dry-run 身份 |
| C | 造一条 denied run → 看只有幂等键相同的被恢复 | 同上 |

**单元测试绿不算当场试跑**（PM 9-26 原话）。每个 PR 正文必须有「## 当场试跑」一段：触发方式、时间、退出码/运行状态、输出摘要。

---

## 7. 不做

不改 Kernel 一行判据；不新增 ActionKey（本包是接线，不是加能力）；不碰那十条绕开授权闸的旁路
（另案，缺口稿 G3）；不改授权口径；不建第三张表；不替 PM 点任何授权；不碰 Google / TikTok。

---

## 8. Reuse Statement

- **复用**：`circuit-detectors.ts` 五条判据（**已写好且有测试，一行都不重写**）、
  `circuit-cap-facts.ts` / `circuit-spend-window.ts` 两个取数层（也已写好、现在是孤儿，正好接上）、
  `circuit-state.ts` 派生态、`ads_circuit_events` 表、Kernel 的 `authorize` / `isWithinEnvelope` / 信封、
  `pushAdsCircuitItems` + `pushAdsAutonomySyncItems`（已存在已挂）、Inngest、`resolveClientEvaluationDate`、
  `cron_run_logs` 回执范式。
- **平台共享**：编排层、熔断评估器、批次两张表、去冲突与排序判据 —— 对任何有 Meta 广告账户的客户都成立。
- **行业层 / 客户层**：无。阈值（3 倍中位数、72h 冷却、每轮 20 条）是平台默认；
  真要按行业分化再下沉 Playbook，不在共享代码里加 `if 客户名`。
- **有没有客户事实进共享代码**：没有。CTS 只出现在验证证据里。
- **落点与 tier-gate 判定是否一致**：一致。不新增能力线 / capability / 支柱；
  这是既有广告支柱 + 既有平台基础设施（Kernel / Measurement）内部的接线。
