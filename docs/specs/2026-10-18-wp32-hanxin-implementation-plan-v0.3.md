# WP3.2（韩信编排）实施方案 v0.3 · 119 号 · 2026-10-18

> **状态：待第三轮复审（子牙 + 魏征）。审回来之前一行代码都不写。**
> v0.2（`…-v0.2.md`）作废，只留作审查轨迹；它顶部 ⛔ 块列的 12 条在本文件 §9 逐条对账。
> 授权：PM 2026-10-18 当面「开，做编排层那一包」，随后「先走只读版」「开编排层」。**授权的是写方案与走审，不是合并、不是开投、不是改任何开关。**

## 0. 给 PM 的一段话（大白话）

编排层是广告 Agent 的「调度员」：每天收工后把当天的建议排好队、去掉互相打架的、过一遍安全检查、再交给系统执行，并留下记录。

这一版和上一版最大的不同有三处：

1. **先做「演练版」调度员。** 它每天真跑、真排队、真留记录，但**不真的提交给系统执行**。跟 A0 探针同一个思路：先让它在真实数据上跑，看它排出来的东西对不对，再谈放手。
2. **防烧钱刹车的「真踩」单独拆成第二阶段**，要四个前提都满足才开（§7）。其中一个是你给两个账户的每天上限金额。
3. **我查出一个会咬人的坑：**「演练开关」只有 D3 自动暂停那一个函数在看，系统内核本身不看。所以新调度员必须自己守这个开关，否则对 CTS/NAL 这种已开自动模式的客户，**开关拦不住它**。这是本版最重要的一条（§3 红线 1）。

## 1. 现状（2026-10-18 当天查实；每条都标了怎么查的）

| 件 | 现状 | 怎么查的 |
|---|---|---|
| CTS / NAL 的自动模式 | **都是 `bounded_auto`，`ads.*` 九个键全是 `auto_approve`**；Roman 等是 `observe` | 生产库 `ad_strategy_configs` + `client_automation_policies` |
| `autopilot_dry_run` | **所有客户都是 `true`**，只有 PM 能改。PM 10-18 的原话落在**还没合并的分支** `origin/docs/ads-dry-run-stays-on`（经 74/18 号转述），**主干上还没有这张卡**；主干现有的相关旧卡是 `2026-09-26-ads-d3-dry-run-stays-on-until-approval-fix` | 库 + `git branch -r` + `git grep` |
| **谁在看 `autopilot_dry_run`** | **只有 `ads-d3-auto-pause.ts:384` 一处**。Kernel（`authorize.ts`）完全不读它——**这条结论来自 grep 全仓只命中 `ads-d3-auto-pause.ts` 与配置读取，未逐行读 `authorize.ts` 全文，请复审重核** | `git grep autopilot_dry_run origin/main -- src` |
| 两张批次表 / `ads.impact_cycle.due` 事件 / 韩信代码 | 都不存在 | 生产库 + 全仓 grep |
| 熔断五条判据 | `circuit-detectors.ts` 在主干（PR 2162），**零生产调用方**；`ads_circuit_events` 0 行 | 同上 |
| A0 探针 | **已合并（PR 2830）**，每天读 + 留回执，零写入；原因码 `cap_missing` / `spend_missing` 等 | 主干 |
| 三个在投账户的日上限 | CTS 主 $40（实际日花费中位数 $111，已被突破 2.8 倍，**基准是假的**）；CTS 次 $110；NAL **空** | 生产库 `client_meta_ad_accounts` |
| CTS 花费为零 | **不是采集坏了**，是主账户欠款停摆（`account_status` 10-10 起 = 3，连续 8 天） | 库 + 74 号 Meta 接口核实 |
| 账户停摆告警 | 已上线（PR 2805），超 24 小时进今日待办 | 主干 |

### 在飞的、会撞车的（开工前搜到的）

| PR | 是什么 | 本方案怎么处理 |
|---|---|---|
| **2019**（9-25 开、A 级、3499 行、至今未合） | 一套**竞争的**熔断设计：自带 `circuit-breaker.ts` + Inngest `check_due` + 触发时把策略写成 deny。主干上没有它的核心文件，被「WP3.1b 重做」（PR 2162）取代但没人关 | **互斥，不复用。** 开工前提：统筹裁决 2019 关闭（已发消息给 18 号）。**在裁决前，第二阶段（写 trip）不动** |
| 2695（swap_creative 真实落地，已封存，PM 10-15 回「停」） | 换素材的真实执行 | **本包不实现换素材**，批次里遇到换素材一律 `manual_only` |
| 2381（工厂 Reel 发布后自动起草「暂停」广告） | Act 的素材一侧 | 不冲突；批次只管「已有处方」，不管「新建广告」 |

## 2. 范围：拆成两个阶段（这是和 v0.2 的结构性区别）

v0.2 把「排队提交」和「真写熔断」捆在一个包里，结果每个前提都互相牵制。拆开：

### 阶段 1 · 演练版调度员（本方案要做的）

每天跑，留回执，**不提交 Kernel、不写 `ads_circuit_events`、不改任何执行结果**。

| # | 内容 | 谁写 |
|---|---|---|
| S1-1 | migration：`ads_action_batches` / `ads_action_batch_items` 两张表（§5） | 我（A 级 schema） |
| S1-2 | 日 cron 末尾每客户发 `ads.impact_cycle.due`（try/catch 兜住，失败不拖垮采数） | 我（接进大文件） |
| S1-3 | 韩信 Inngest 函数：收处方 → 分组 → 排序 → 去冲突 → 写批次行 + 回执。**走到「提交」那一步时，若 `autopilot_dry_run=true` 或读不到，只记 `would_submit` 不提交**（红线 1） | 我（A 级核心） |
| S1-4 | 熔断评估只读沿用 A0 探针的读法，**回执并入批次行**（§5 `evaluator_receipt`），不另建表 | 我 |
| S1-5 | 待办：`pushAdsCycleLivenessItems`（昨天有启用客户却没批次行）+ 评估成色。**回看 ≥3 天** | DeepSeek + 我审 |
| S1-6 | `docs/agents/12-hanxin.md` + 权限矩阵加 `agent:hanxin`（**署名不是授权**） | 我 |
| S1-7 | 测试 + 架构测试（§8） | 我 |

### 阶段 2 · 真提交 + 真踩刹车（**不在本方案里排期，只写前提**）

要 §7 的四个前提全满足，且 **PM 本人单独点头**才开。本文件只把它的设计约束写清，不承诺时间。

## 3. 必守红线

1. 🔴 **韩信必须自己守 `autopilot_dry_run`，且 fail-closed。**
   Kernel 不读这个开关（§1 已查实）。韩信在**提交的那一行之前**，对每个客户**现读**一次 `ad_strategy_configs.autopilot_dry_run`：`true`、读失败、读到 `null`、客户没有配置行 → **一律不提交**，批次行标 `would_submit`（读失败标 `config_unreadable`）。
   这条要有**架构测试**钉死：提交函数的唯一调用点前面必须有这个判断；以及一条**变异验证**（去掉判断 → 红）。
   **为什么写这么重：** 不这么做，阶段 1 对 CTS/NAL 就是「看起来是演练、实际会真打 Meta」。
2. 🔴 **「判不了」的处置写死三件**：①**不写** circuit event；②成员标 `facts_unavailable`；③出待办，带账户 id 和 `facts:` 原因码。三件缺一件，交付物就是个「看起来接上了、实际恒放行」的评估器。
3. 🔴 **不许碰 `ad_strategy_configs.updated_at`**——它是自治同步的幂等键（`autonomy/sync-policy.ts:17-19`）。
4. 🔴 **熔断不许拦人踩刹车** → **v0.2 的写法落不了地，降级处理，见 §6.2。**
5. 🔴 新增/改 Inngest 函数后要去后台对 `/api/inngest` 手动 Sync 一次，否则安静地不跑（`docs/STATE.md:174`）；当场试跑要在 Sync 之后。**这是人工动作，写进 PR 上线步骤。**
6. 🔴 `step.run` 里不许 `setTimeout` 轮询，用 `step.sleep`（PITFALLS F10）。
7. 🔴 **`agent:hanxin` 是署名，不是授权**——`TriggeredBy` 枚举本来就有 `'agent'`，这个字符串只落审计自由文本、无校验、谁都能冒充。
8. 🔴 **韩信落点改变了「谁算人按的」白名单的语义**（v0.2 漏了这条）：`HUMAN_TRIGGER_ALLOWED_DIRS = ['src/lib/action-submission/']`，韩信落在这个目录里，就进了「可以自称人按的」目录。→ 架构测试加一条：`hanxin/` 下任何文件**不许**出现 `triggeredBy: 'human'`；并在 `00-architecture.md` 写明。
9. 🔴 **不实现换素材**（PR 2695 已封存，PM 回「停」）；`ads.budget_move_plan` 不进 Kernel，直接 `manual_only`（权威稿 §6.1 末尾）。

## 4. 编排判据（分组 / 去冲突 / 排序）

**分组**：`(client_id, ad_account_id)`。**先排序再去冲突。**

**v0.2 把冲突的方向写反了，更正如下：**

| 情形 | 处理 |
|---|---|
| **真冲突**：同一实体、同一字段、相反方向（如同一广告组既「加预算」又「降预算」） | 按优先序留一条：**暂停 > 降系列预算 > 降广告组预算 > 加预算**；被丢弃的标 `conflict`，出待办带原因 |
| **父子链上两条收类同日落地**（降系列预算 + 关掉系列里最差的组） | **不冲突，都执行**。这是常态，不是异常 |
| 收类与加类在父子链上相遇（系列级暂停 + 其下某组加预算） | 收类留下，加类 `deferred`；**文案不许写成「72 小时后再评估」**（那对一条真被丢弃的加预算是谎话） |

去冲突按**实体及其父子关系**判——成员表用 `subject_level` + `subject_id`，不用 `adset_id NOT NULL`（`pause_campaign` / `cut_campaign_budget` / `budget_move_plan` 没有 adset_id）。

**同步漂移闸**（权威稿 §4.8）：提交前比同步回执版本与 `ad_strategy_configs.updated_at`，不一致 → 整批 `held_sync_drift` + `step.sleep(60s)` 重查 ≤3 次，仍不一致才出批次级待办。**只读比较，不写 updated_at。**

## 5. 两张表（DDL 以权威稿 §11.6/§11.7 为底，偏离逐条声明）

| 偏离 | 内容 | 理由 |
|---|---|---|
| D1 | 显式 `REVOKE/GRANT` + RLS 用 `FOR ALL TO service_role USING (true)`（**漏掉 `TO service_role` = 对匿名访客敞开读写**） | CLAUDE.md §7；09-27 熔断 migration 的更严标准；**架构测试那条断言按文件硬编码、不覆盖新表，要为两张新表各补一条** |
| D2 | 成员表 `adset_id NOT NULL` → `subject_level` + `subject_id` | 见 §4 |
| D3 | 成员表补幂等唯一键 + `kernel_run_id` 外键 | 权威稿 §2.5 要求成员幂等，§11.7 的 DDL 没写；无外键会攒脏行 |
| D4 | **批次表加 `evaluator_receipt jsonb`**（评估器回执的家） | **子牙二轮：v0.2 的回执没有落点**（批次表没有 verdict 列，而 §7 又写「不建第三张表」）。这是我们自己新建的表，加一列比另起一张便宜 |
| D5 | 成员 `deferred_kind` 的 CHECK 扩 `facts_unavailable` / `would_submit` / `config_unreadable` / `conflict` / `held_sync_drift` | 「读不到事实」「演练未提交」在原五个枚举里没有档位。**CHECK 的所有权归 S1-1 这个 migration**（子牙二轮点名的"归哪个 PR 没说"）|
| D6 | `ads_action_batches.updated_at` 挂仓库现成的 `update_updated_at_column()` 触发器 | 样例 `20260812100000_memory_supersession_v1.sql:84-86` |
| D7 | items 表**不做 append-only** | `kernel_run_id` 是提交后回填的 |

**判据 #1 的硬顶倍数不在本阶段定。** v0.2 写「账户上限 × 具名常量（初值 3）」，已被证伪：CTS 主账户 ×3 = $120，14 天里 4 天超过（29%），约三天一次必 trip；更根本是 $40 这个基数本身是假的。
→ 阶段 1 不写 trip，所以**不需要这个数**。阶段 2 的前提之一就是「PM 给了真实上限」（§7），届时倍数按 A0 探针攒出的真实分布定。
**读法沿用 A0**：绝对硬顶与相对判据**分开评估各记一份**（`detectSpendSpike` 里绝对分支排在中位数之前，直接调用会把相对判据吃成死代码——子牙二轮点名）；阶段 2 写 trip 时取**任一命中**。

## 6. 两个必须明说的缺口

### 6.1 熔断旁路

`meta-ads/execute` / `boost-post` / `winner-reel-sync` 等十条路径**不经 Kernel**（缺口稿 G3）。熔断对它们**完全无效**。本包不碰，PR 正文必须写这句话，不许让读的人以为「熔断开了就罩住了所有花钱路径」。

### 6.2 人工止损豁免——v0.2 的写法落不了地，降级成已知缺口（不许做成假防线）

v0.2 红线 3 要求「`triggeredBy==='human'` 的收类动作放过熔断」。魏征二审查实：解析器**拿不到** `triggeredBy`，熔断那一刀又在人工信封分叉**之前**。要实现就得改 Kernel 公开契约，与「不改 Kernel 一行」直接冲突。
> ⚠️ **行号核验状态**：v0.2 引的 `kernel/deps.ts:97-104`、`authorize.ts:412-427/:448` 是二审当时的行号，**今天对主干重查已对不上**（`authorize.ts` 现在是 ⑥b `outward_requires_human_policy`（约 `:371-390`）→ ⑥c 信封查询（约 `:396`）的结构）。**结论（熔断在人工信封分叉之前、解析器入参无 `triggeredBy`）我没有在当前主干上重新证实**，所以本条标「待复审重核」，复审者请以当前代码为准。

**处置：降级。**
- 阶段 1 不写 trip → **这个缺口在阶段 1 不存在**。
- 阶段 2 的前提之一：二选一，**开工前必须定**——(a) 单独立项改 Kernel 契约，声明为偏离；(b) 明写「trip 期间 PM 在看板上按的止损也会被拒，**解除按钮是唯一出路**」，并把**解除按钮做出来**（现在解除只有 API 路由、零个界面调用，等于让 PM「告诉开发帮你调接口」——铁律 3 禁止的人工 SOP）。**不许两样都不做就上线。**

## 7. 阶段 2（真提交 + 真写 trip）的前提——四个全满足才开

1. **PM 给了三个在投账户的真实日上限**，且后台有界面能填（铁律 8）。台账 `2026-10-18-ad-account-daily-caps-wrong-or-missing`，owner 是 PM，日历 10-27。
2. **PR 2019 已关**（两套熔断设计互斥），统筹裁决。
3. **§6.2 二选一已落地。**
4. **阶段 1 至少稳定跑满一周**，批次行里 `would_submit` 的内容经人看过「排得对」。CTS 当前账户欠款停摆，**无花费不算稳定**——起点从 CTS 结清并重新投放算起。

**每一个前提之外还有一个：开 `autopilot_dry_run=false` 只由 PM 本人决定**（PM 10-18 经 18 号转述；对应的卡在未合并分支 `origin/docs/ads-dry-run-stays-on`，**合并前我不引它当主干事实**）。本方案任何地方涉及「关掉演练」，一律写「PM 决定」。

## 8. 验证与当场试跑（PM 2026-09-26 硬规矩）

**试跑一律挂 DEMO 客户 + 假 `ad_account_id`**：库里现成的 DEMO——Harbourline Physio (DEMO)、Kiwi Silk Road (DEMO)、【测试】可删。PR 正文附 `select count(*) … where client_id in (CTS, NAL)` 回执，证明生产客户零 trip 行、零 Kernel 提交。

| 试跑 | 预期 |
|---|---|
| 手动发一次 `ads.impact_cycle.due`（DEMO） | 批次行建出；评估回执写入；再发一次 → `already_ran`，不停不死信 |
| DEMO 设 `autopilot_dry_run=true` | 批次行 `would_submit`；**Kernel 零新增 run** |
| DEMO 设 `autopilot_dry_run` 读不到（临时指向不存在配置行） | 标 `config_unreadable`，**不提交** |
| 造一批处方：同实体一条止损 + 一条加预算 | 留止损，加预算标 `conflict` 并出待办 |
| 造父子链上两条收类 | **两条都进批、都不标 conflict** |
| 造一天数据缺失 | 走「判不了」三件处置；原因码 `growth_state_missing` ≠ `data_partial` |
| 生产 CTS/NAL 的 dry-run 日跑 | 只产批次行与回执；**Kernel 零提交、`ads_circuit_events` 零新增** |

**变异验证**（必做，打在真正会动钱的路径上，不打在纯函数上——WP3.1b 重做的教训）：
- 去掉红线 1 的 dry-run 判断 → 必须红
- 把「读失败」当成 `false` 放行 → 必须红
- 把去冲突的父子链识别删掉 → 必须红
- 往 `hanxin/` 里加一行 `triggeredBy: 'human'` → 必须红

**架构测试**：①`agent:hanxin` 字面量只许出现在韩信模块；②`hanxin/` 下不许 `triggeredBy: 'human'`；③提交函数唯一调用点前有 dry-run 判断；④两张新表各一条 `REVOKE/GRANT` 断言；⑤韩信写入者文件里**只许出现 `'trip'` 字面量**（阶段 2 才用），出现 `release` 会让 `architecture.test.ts` 那条「`src/lib` 下不许有 release 写入者」变红。

## 9. v0.2 那 12 条的对账

| # | v0.2 提出的 | v0.3 怎么处理 | 在哪 |
|---|---|---|---|
| 1 | 事实底座错（4 客户全 observe） | 全部改按生产库实查；PR B 验收重写——对 CTS/NAL 走 bounded 分支，不是审批队列 | §1 |
| 2 | 红线 3 落不了地 | 降级成已知缺口，阶段 2 前提二选一 | §6.2 |
| 3 | 硬顶倍数错 / 基准是假的 | 阶段 1 不需要；阶段 2 前提是 PM 给真上限；NULL 账户单列 `cap_missing` | §5、§7 |
| 4 | 休眠账户要能排除 | 沿用 A0 的 `hasDeliveringEntity` 分层 + `account_status`；停摆账户已有 PR 2805 的待办，不重复告警 | §2 S1-5 |
| 5 | B2 冲突方向写反 | 重写：真冲突 vs 父子链收类；明确优先序 | §4 |
| 6 | A7 回看窗口不够 | ≥3 天（`pm-daily-todo` 是周一–周五，周五周六的评估失败原先永远不会被报） | §2 S1-5 |
| 7 | `kernel_needs_human` 车道是 dev，PM 看不到 | 待办 kind 不复用它；新 kind 进 `five-kinds.ts` 的 PM 车道（实现时核对 `five-kinds.ts:176` 现状） | §2 S1-5 |
| 8 | 白名单语义漂移 | 红线 8 + 架构测试 | §3 |
| 子牙-a | 开关落点未定，环境变量做不到只对 DEMO 开 | **不新建开关**，复用现成的每客户 `autopilot_dry_run`（DB 里、按客户） | §3 红线 1 |
| 子牙-b | 评估器回执没落点 | 批次表加 `evaluator_receipt jsonb` | §5 D4 |
| 子牙-c | 绝对硬顶把相对判据吃成死代码 | 两个分开评估各记一份，阶段 2 取任一命中 | §5 |
| 子牙-d | 扩 CHECK 归哪个 PR | 归 S1-1 的 migration | §5 D5 |

## 10. 不做

不改 Kernel 一行判据；不新增 ActionKey（本包是接线不是加能力）；不碰那十条旁路；不改授权口径；不建第三张表；不实现换素材；不碰 Google / TikTok；**不替 PM 点任何授权，不改任何开关**；不动 PR 2019；不改 `ad_strategy_configs` 任何字段。

## 11. 这一包能堵什么、堵不住什么

| 断口 | 阶段 1 后 | 阶段 2 后 |
|---|---|---|
| 熔断不生效 | ◻ **不堵**（只读沿用 A0，仍无 trip） | ✅ 堵住（#1/#2/#3 真写，执行前闸开始真拦） |
| 建议没有人排队执行 | ◻ 排队、去冲突、留记录，**但不提交** | ✅ 提交 Kernel |
| 批准完没人执行 | ❌ 堵不住（Kernel WP07） | ❌ 同左；对 CTS/NAL 走 bounded 自动放行，不走人工队列，但**别的客户仍然卡在这** |
| 效果不回流（Check/Tune） | ◻ 批次行带 `action_run_id` 锚，评估器属 WP3.3 | ◻ 半堵 |

## 12. Reuse Statement

- **复用的平台能力**：Kernel `authorize` / 信封 / 策略表；`circuit-detectors.ts` + A0 探针的读法；`pm-todo` 拉取模式与 `five-kinds.ts` 车道表；Inngest；`autopilot_dry_run`（现成的每客户开关）；`update_updated_at_column()`。
- **真正 platform-shared 的新东西**：两张批次表、韩信编排函数、冲突判据（纯函数）。
- **industry-specific**：无。
- **client-specific**：无。三个在投账户的日上限属 client configuration（`client_meta_ad_accounts`），不进共享代码。
- **有没有把客户名/ID/行业判断写进 shared runtime**：没有。换 CTS 为 Roman 或悉尼地产客户，共享代码不需要改。
- **learning/memory**：本包不产生 learning；批次行是执行记录，不是学习。
- **与 tier-gate 决策时的分类是否一致**：一致。L1 平台基础设施（Kernel / Governance 的接线），不新增支柱、不新增能力线。
