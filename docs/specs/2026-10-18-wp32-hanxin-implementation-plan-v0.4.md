# WP3.2（韩信编排）实施方案 v0.4 · 119 号 · 2026-10-18

> # ⛔ 第四轮聚焦复查（魏征）：**不能进实现——而且原因不是方案写得不够细，是输入根本不存在。2026-10-18**
>
> **生产库实查（我自己 `SELECT` 复核了魏征的结论，数对得上）：** 飞轮动作表 `flywheel_actions` 里，
> `action_type = 'ads.auto_pause_on_d3'` **整张表 0 行**（不限日期）。
> 广告类（`flywheel='ads'`）的行全是**别的性质**：`diversify_ad_creative_meta`、`expand_to_google_ads`、
> `launch_google_search_ads_3pl` 这类——是**给人看的策略建议**，不是能提交 Kernel 的 `ads.*` 动作。
> 仅有的几条 `ads.adjust_bid` / `ads.pause_campaign` / `ads.reactivate_ad_set` / `ads.restrict_placement`
> 都是 **2026-09-21 一天**写进去的，之后再没有。
>
> **所以 §0 说的「确实有东西可做」今天不成立**：阶段 1 的候选清单和 v0.3 的批次一样，**每天是空的**。
> 这是第三轮「没有处方来源」换了个说法——我换了数据源，结果数据源也是空的。
>
> **为什么 D3 是空的（叠加两个原因）：** ①D3 只在 `autopilot_enabled=true` 时跑，现在只有 CTS 是 true；
> ②CTS 主账户欠款停摆、花费为零，D3 的"花钱没结果"判据命中不了。
> 即使将来有行，也只有 **adset 级暂停**这一种动作——§4 的父子链、"暂停 + 加预算"在真实数据里**永远造不出来**，只能靠合成数据测。
>
> ## 魏征这一轮另外确认的三条硬伤（v0.5 之前必须改）
>
> 1. **架构测试钉不住"阶段 1 不提交"。** 现有断言（`architecture.test.ts` 约 `:1914`）只查**具名 import、逐文件、不查传递**；
>    `createKernel` 不在 `KERNEL_RUNNER_SYMBOLS` 里；韩信若 import `action-submission/*` 里的函数（该目录本来就被允许碰推进符号，
>    D3 的 `submitCandidate` 就是这个形状），断言照样绿；`ads-strategy/` 在架构测试里**零命中**，没有"此目录不许碰 Kernel"。
>    → §8 ② 的写法不够，要改成：禁止韩信文件**及其传递依赖**非 type 地 import `@/lib/kernel` 和 `action-submission/*`，并附合成反例证明会红。
> 2. **`subsumed` 有时序洞。** `pause_campaign` 被 Kernel 拒绝或被熔断挡下，其下已被标 `subsumed` 丢弃的 `pause_unit` 就白丢了。
>    "收类留下"同理：`cut` 若因 AI 信封 100% 拒绝被拒，`scale` 也已被丢，两条都没动。
>    → `subsumed` / 被丢弃的只能是"暂挂"，带 `parent_run_id`，父级最终状态不是已执行就**放回候选**。阶段 1 无法验证，列为阶段 2 前提。
>    另外"同实体同效果只留一条"要写"**留带人工授权的那条**"（D3 的有归属闸，`pause_unit` 是人按的，留错会丢掉人的授权来源）。
> 3. **休眠判式必须显式写，否则 `null` 会被当 0 判休眠（fail-open）。** `circuit-probe.ts` 在读失败 / 零行 / 撞行数上限三种情况下两个计数都是 `null`。
>    判式：**休眠 = `deliveringCampaigns === 0 && deliveringAdsets === 0 && adsetsSeen !== null`**；任一为 `null` = 判不了、走 §3.3 三件处置、**不得排除**；
>    `adsetsSeen === 0` 是共用账户，"没有在投的组"说明不了问题，也不能判休眠。
>
> ## 魏征另指出、我认账的两处
>
> - **退出日期 2026-11-15 是我随手定的，没有锚点。** 应换成事件锚点；魏征倾向「D3 `dry_run_logged` 累计到 N 条」——它直接对应上面的零行问题。**选哪个是 PM 的事，我不替定。**
> - §3.2 说"复用 `loadAdStrategyConfigWithSource`（`config.ts:102-137`）"——魏征没重核，子牙上一轮核过；保持，但标"两轮里一轮核过"。
>
> ## 我的判断（技术，不是向 PM 要答案）
>
> **现在不该动手写编排层。** 不是方案不够好，是**喂给它的东西不存在**：没有程序产出广告处方，D3 在生产里没跑出过一条，
> CTS 欠款、NAL 总开关关着、日上限没填。造一个今天每天空转的调度员，只会产出"看起来在运转"的假象——
> 正是这个会话里反复踩的那个形状。
>
> **真正要先有的是上游的处方来源**（让孔明产出能提交的广告处方，或让 D3 在真实数据上跑出记录）。那是另一件事，不在本方案范围，也没人要求过。
> **本方案停在这里，等上游条件变化再开。** v0.4 的其余设计保留作参考，不作废。

> **状态：待第四轮聚焦复审（只审本版改了的部分）。审回来之前一行代码都不写。**
> v0.3 被第三轮（子牙 + 魏征）判「不能进实现」，两人**独立**得出相同的几条硬伤，v0.4 逐条改掉，对账在 §10。
> v0.2、v0.3 作废，只留作审查轨迹。授权：PM 2026-10-18「开，做编排层那一包」「开编排层」——**授权的是写方案与走审，不是合并、不是开投、不是改任何开关。**

## 0. 给 PM 的一段话（大白话）

编排层是广告 Agent 的「调度员」：把当天的建议排好队、去掉互相打架的、过安全检查、再交给系统执行。

第三轮审查查出一件我之前没看到的事，**它改变了整个方案的形状**：

**调度员现在没有东西可调度。** 主干上没有任何程序一次产出「一批广告处方」——现有的广告动作只有三个来源：D3 自动暂停（自己提交）、你点的止损按钮、你点的加预算按钮。所以 v0.3 的「阶段 1 每天排队」每天都是空批次，没有任何可验证的东西。

所以 v0.4 的阶段 1 改成两件**确实有东西可做**的事：
1. **把已有的来源收拢成一份「当天候选清单」**，只读、不提交——读的是 D3 自己记下的「演练时本来会暂停哪些」。
2. **阶段 1 的代码里根本没有「提交」那一行**（不是靠开关拦）。第三轮两位审查的共同意见：开关是运行时的，哪天有人为了 D3 翻开一个客户的开关，阶段 1 就会瞬间变成阶段 2。

另一件小事但会咬人：**NAL 的「自动驾驶总开关」是关的**（`autopilot_enabled=false`），v0.3 只守了「演练开关」，漏了这个。已补。

## 1. 现状（2026-10-18 当天查实，标了怎么查的）

| 件 | 现状 | 怎么查的 |
|---|---|---|
| 自动模式 | CTS、NAL = `bounded_auto`，`ads.*` 策略全是 `auto_approve`；Roman、Kiteroa = `observe` | 生产库（我查 + 魏征独立复核一致） |
| **`autopilot_enabled`（总开关）** | **CTS = true，NAL = false**，Roman/Kiteroa = false | 生产库（我 `SELECT` 核过） |
| `autopilot_dry_run` | 4 个客户全是 true | 同上 |
| **谁在读这两个开关** | **只有 `ads-d3-auto-pause.ts`**（`:483` 判总开关，`:384` 判演练）。Kernel（`authorize.ts` 全文）、信封解析器、策略翻译表（`sync-policy.ts:33-36`）**都不读** | 子牙逐行读 `authorize.ts` 710 行 + `git grep`，结论成立 |
| **处方来源** | **主干没有**。`git grep action_batch` 在 `src` 零命中；`prescribe()` 只出面向界面的文字建议；现有广告动作来源只有 D3、止损路由、O1 加预算路由 | 魏征 + 子牙独立 `git grep` |
| 两张批次表 | 不存在（连 migration 文件都没有，权威稿 §11.7 只是文档里的 DDL） | 生产库 + `git ls-tree` |
| `ads.impact_cycle.due` 事件 | 零订阅者、`ads-events.ts` 里没有 | 子牙 `git grep` |
| 熔断判据 | `circuit-detectors.ts` 在主干（PR 2162），零生产调用方；`ads_circuit_events` 0 行，且**没有任何唯一约束**（见 §7） | 同上 |
| A0 探针 | 已合并（PR 2830），每天读 + 留回执，零写入 | 主干 |
| Kernel 在生产跑过广告动作吗 | `action_runs` 整表只有 2 行（8/21），`ads.*` 为 0——**Kernel 从没在生产跑过任何广告动作** | 魏征生产库只读 |
| 三个在投账户的日上限 | CTS 主 $40（实际日花费中位数 $111，基准是假的）、CTS 次 $110、NAL 空 | 生产库 |
| CTS 花费为零 | 不是采集坏了，是主账户欠款停摆：`ad_entity_snapshots`（`level='account'`）的 `account_status` 10-10 起 = 3。⚠️ 魏征说在 `client_meta_ad_accounts` 里查不到这一列——**对，它不在那张表，在 `ad_entity_snapshots`**，我之前核的就是这张 | 生产库 + 74 号 Meta 接口 |
| PR 2019 | **已于 10-18 07:32Z 由统筹关闭**（可重开、分支保留） | `gh pr view 2019` |

### 在飞 / 相关的

| PR | 处理 |
|---|---|
| 2019（已关） | 互斥，不复用。**但关闭会丢东西，见 §7 前提 2**：14 张只在它分支上的台账卡 + 一个解除熔断的界面形状 |
| 2695（swap_creative，PM 回「停」） | 本包不实现换素材 |
| 2381（工厂 Reel 自动起草「暂停」广告） | 不冲突，边界：批次只管已有处方，不管新建广告 |
| 2805（账户状态异常进今日待办，已合） | 停摆账户的告警归它，本包不重复 |

## 2. 范围

### 阶段 1 · 收拢候选清单 + 评估回执（本方案要做的）

**硬约束（两位审查共同要求）：阶段 1 的韩信模块里没有「提交」这一行代码。** 不 import `createKernel`、不 import 任何 `KERNEL_RUNNER_SYMBOLS`、不 import `action-submission/*` 里的推进函数，用架构测试钉死（§8）。**不靠 `autopilot_dry_run` 判断来保证不提交——靠代码里压根没有。**

| # | 内容 | 谁写 |
|---|---|---|
| S1-1 | migration：两张批次表（§5）。**CREATE TABLE 时一次写全枚举**，不是"扩 CHECK"（表在主干不存在）。同一个 PR 里**同步改权威稿 §11.7 的那行枚举**，否则别的窗口（WP3.3）照抄会建出旧 CHECK | 我（A 级 schema） |
| S1-2 | 日 cron 末尾每客户发 `ads.impact_cycle.due`，try/catch 兜住（先例：`fireAdsDiagnosticsCompletedEvent`，`google-data-pullback-daily/route.ts:156/172`）。零订阅者已核 | 我 |
| S1-3 | 韩信 Inngest 函数：①**`concurrency: { limit: 1, key: client_id }`**（同目录 `ads-autonomy-sync`、`ads-campaign-budget` 都有）②**依赖在 handler 内创建**，不在模块顶层（D3 的写法；否则模块加载出错会拖垮整个 Inngest 路由）③收候选清单 → 评估 → 写批次行（首次写入为准，§5） | 我（A 级） |
| S1-3b | **候选清单收集器（只读）**：读 D3 的 `dry_run_logged` 记录。**落点已核实**：`ads-d3-auto-pause.ts:384-390` 在演练开关为 true 时调 `recordFlywheelAction(…, { status: 'dry_run_logged', … })` 写入飞轮动作表（`/api/clients/[id]/execution` 展示的就是同一批行，`autonomous-action-board.ts:53` 把它归为「未执行：仅演练记录」）——**收集器读这张表，不读 D3 内部**。**O1 加预算候选、止损路由是否也该收，我没核实来源，标「待核」，核完再定，不假设** | DeepSeek + 我审 |
| S1-4 | 评估**直接调 `probeClientCircuit`**，不另写第二套读法（子牙：A0 已经在同一个 cron 里每天输出同样的评估，再写一遍是重复） | 我 |
| S1-5 | 待办（§6）。**阶段 1 全部走 dev 车道，PM 车道留到阶段 2** | DeepSeek + 我审 |
| S1-6 | `docs/agents/12-hanxin.md` + 权限矩阵 `agent:hanxin`（**署名不是授权**） | 我 |
| S1-7 | 测试 + 架构测试（§8） | 我 |

### 阶段 2 · 真提交 + 真写 trip（**不在本方案排期，只写前提和约束**）

要 §7 的前提全满足，且 **PM 本人单独点头**才开。

## 3. 必守红线

1. 🔴 **阶段 1：结构性不提交，不靠开关。** 见 §2 硬约束。
2. 🔴 **阶段 2：提交守卫要三条同时成立，且现读。** 守卫 = `autopilot_enabled === true` **且** `autopilot_dry_run === false` **且** `source === 'row'`。
   - **直接复用 `loadAdStrategyConfigWithSource`**（`config.ts:102-137`）——它已经是 fail-closed：读失败返回 `source:'fallback'`，没有配置行返回 `'default'`，`null` 按 `!== false` 变成 true。**不另写**（v0.3 写的「读到 null」那一档在代码里不存在）。
   - **读和提交必须在同一个 `step.run` 里**。D3 的写法是 step 里现读一次。如果读成独立的 step，值会被 Inngest 缓存；先读到 false、PM 再改回 true，缓存的 false 仍会提交。这是魏征点出的**反方向**时间窗，v0.3 没堵。
   - **守卫放哪**：子牙分析过——放 Kernel 入口不行（Kernel 刻意不认识广告表；而且人按的止损路由 `stop-loss` / `o1-scale` 也走提交，不能被 dry_run 拦）。最小位置是 **`ads-strategy/` 下一个共用的守卫函数，韩信调它；D3 暂不改**。
   - **已提交的 run 不归这个开关管**：开关只管"新提交"。已在 Kernel 里的 pending / denied / dead-letter run 仍能被 `approveAndRun`、`recoverDeniedRun`、`resumeDeadLetterRun` 推进（魏征：Kernel 有 6 个推进入口，v0.3 只谈了提交一个）。**阶段 2 的 denied 恢复必须逐个入口说明走哪个、是否受守卫约束。**
3. 🔴 **「判不了」的处置写死三件**：不写 circuit event；成员标 `facts_unavailable`；出待办带账户 id 和 `facts:` 原因码。
4. 🔴 不许碰 `ad_strategy_configs.updated_at`（自治同步的幂等键，`autonomy/sync-policy.ts:17-19`）。
5. 🔴 新增/改 Inngest 函数后要去后台对 `/api/inngest` 手动 Sync（`docs/STATE.md:174`）；当场试跑要在 Sync 之后。**人工动作，写进 PR 上线步骤。**
6. 🔴 `step.run` 里不许 `setTimeout`，用 `step.sleep`（PITFALLS F10）。
7. 🔴 `agent:hanxin` 是署名不是授权（`TriggeredBy` 枚举本来就有 `'agent'`，字符串只落审计自由文本、谁都能冒充）。
8. 🔴 **韩信的目录**：v0.3 说落在 `action-submission/hanxin/`，从而进入 `HUMAN_TRIGGER_ALLOWED_DIRS = ['src/lib/action-submission/']`（`boundaries.ts:280`）——**没必要**。子牙建议：**韩信放 `ads-strategy/` 或 inngest 目录**，阶段 2 由它调用现有 `action-submission/*` 的提交函数。这样根本不碰「谁能自称人按」的白名单。v0.3 为这件事设计的「`hanxin/` 下不许 `triggeredBy:'human'`」测试随之作废。
9. 🔴 **不实现换素材**（PR 2695 已封存）；`ads.budget_move_plan`、`ads.swap_creative`、`ads.add_retargeting_adset` **三个都是 stub 能力**（ROADMAP「三个 stub capability」），一律 `manual_only`。v0.3 只写了前两个，漏了第三个——`envelope-facts.ts:492-493` 只替 `budget_move_plan` 返回 `manual_only:`，另两个要**韩信自己先挡**。「新建广告组放在已暂停系列下」的情形同样补进。

## 4. 冲突判据——v0.3 的版本有 5 处套不上，重写

注册表实有 9 个 `ads.*`：`auto_pause_on_d3`、`pause_unit`、`pause_campaign`、`cut_unit_budget`、`cut_campaign_budget`、`scale_unit_budget`、`budget_move_plan`、`add_retargeting_adset`、`swap_creative`。

按**实体 × 效果**判，不按字段名判：

| 情形 | 处理 |
|---|---|
| **同实体、同效果、不同 key**（`auto_pause_on_d3` ≡ `pause_unit`） | **去重只留一条**，另一条标 `duplicate_effect`。Kernel 的幂等键（`cycle_date`+`adset_id`）不会去重这两个，不处理会出两条暂停 |
| **同实体、相反效果**（暂停 + 加预算） | 收类留下，加类标 `conflict`。**这是 v0.3 漏掉的**：v0.3 把"真冲突"定义成"同字段相反方向"，使得"暂停 + 加预算"按字面不算冲突、两条都执行 |
| **父子链上，父级暂停覆盖了子级动作**（`pause_campaign` 之后，其名下 `cut_unit_budget` / `pause_unit`） | 子级标 `subsumed`，**不执行**。v0.3 写"收类都执行"是错的 |
| 父子链上两条收类，**效果不重叠**（降系列预算 + 暂停系列里最差的组） | 都执行 |
| **跨来源**：D3 在批次之外自己提交 `auto_pause_on_d3`，同一个组孔明又出了 `scale_unit_budget` | **阶段 1 收集器读 D3 的候选，所以看得见**；阶段 2 D3 仍在批次外提交，**必须把 D3 的当日提交纳入去冲突的输入**，否则两条互相看不见 |

**两个我标「拿不准 / 阶段 2 前提」的，不假装解决了：**
- **叠加幅度**：系列降 20% + 其下某组降 20%，各自在 20% 信封内，合起来约 36%；信封判据按单实体算。子牙拿不准信封会不会逐次拦下。→ 阶段 2 前提：要么补一个父子合计判据，要么声明不做并写进缺口。
- **累积停光**：每个组各一条 `pause_unit`，单条都合规，没有"一个系列至少保留 N 个在投组"。→ 同上，阶段 2 前提。

**时间维度**：72 小时冷却判据看不到 Kernel 自己的改动——魏征在 PR 2019 分支的台账里看到 `kernel_post` 快照在主干上没有任何生产写入方，同一实体连续两天的收类/加类可能绕过冷却。→ 见 §7 前提 2（把那张卡摘回主干）。

**同步漂移闸**（权威稿 §4.8）：提交前比同步回执版本与 `ad_strategy_configs.updated_at`，只读比较、不写；不一致 → `held_sync_drift` + `step.sleep(60s)` ≤3 次。**阶段 1 不提交，所以这一步阶段 1 不做，留阶段 2。**

## 5. 两张表（以权威稿 §11.6/§11.7 为底，偏离逐条声明）

| 偏离 | 内容 | 理由 |
|---|---|---|
| D1 | 显式 `REVOKE/GRANT` + RLS `FOR ALL TO service_role USING (true) WITH CHECK (true)`（漏掉 `TO service_role` = 对匿名访客敞开读写）。范式：`20260927000002_ads_circuit_events_v2.sql:132-138` | CLAUDE.md §7；`architecture.test.ts:2274` 那条断言只针对 `kernel_action_lineage`，**两张新表各补一条** |
| D2 | 成员表 `adset_id NOT NULL` → `subject_level` + `subject_id` | 见 §4 |
| D3 | 成员幂等唯一键：**`(batch_id, action_key, subject_level, subject_id)`**。v0.3 没写具体列。要**逐个 ActionKey 写明实体映射**：`scale_unit_budget` 带不带 `campaign_id` 决定它的实体是广告系列还是广告组（`envelope-facts.ts:431-459`） | 子牙：不写，映射会各写各的 |
| D4 | **批次粒度跟权威稿一致：`UNIQUE (client_id, ad_account_id, date)`，一账户一批次**（v0.3 说"一批次一客户"是我写错了，子牙指出）。**客户级字段**（判据 #2 的客户合计上限、判据 #5 的数据完整度、`clientReferenceDate`，见 `circuit-probe.ts:138-150` 的 `ClientProbe`）**在每个账户行的 `evaluator_receipt jsonb` 里各存一份并声明** | 回执要有家，且不另建第三张表 |
| D5 | `date` 的口径：**批次 `date` = 客户评估日（各账户时区最早的昨天）**，账户自己的 `targetDate` 写进回执。两者可以不同天，都记 | 判据 #2 用客户级参考日，判据 #1 用账户级目标日，两条各自的正确口径 |
| D6 | **重跑：首次写入为准**（`INSERT … ON CONFLICT DO NOTHING RETURNING id`），后续重跑只在 cron 回执里记 `already_ran`，**不覆盖**。这是已知的「回执被重跑覆盖，记的是最后一次」坑 | 记忆 `feedback-receipt-overwritten-shows-last-attempt-not-first` |
| D7 | **拆两列**：成员行 `disposition`（`candidate` / `duplicate_effect` / `subsumed` / `conflict` / `manual_only` / `facts_unavailable`）；`deferred_kind` 保留权威稿原五档不动。**批次级**的闸状态（`submit_gate`）放批次表。v0.3 把 `would_submit` / `config_unreadable` 塞进 `deferred_kind` 是语义错位（前者是处置结果，后者是整批状态，且会在每个成员行重复；阶段 2 转成已提交时 `kernel_run_id` 与它的关系会乱） | 子牙 |
| D8 | `ads_action_batches.updated_at` 挂 `update_updated_at_column()` 触发器（样例 `20260812100000_memory_supersession_v1.sql:84-86`）；items 表不做 append-only（`kernel_run_id` 是提交后回填的） | 同 v0.3 |

**判据 #1 的硬顶倍数不在阶段 1 定。** 阶段 1 不写 trip，不需要这个数；阶段 2 前提之一是「PM 给了真实上限」。**读法沿用 A0**：绝对硬顶与相对判据**分开评估各记一份**，阶段 2 取任一命中。

## 6. 待办（阶段 1）

- **幂等键 `(账户, 原因码)`，不按天出。** `circuit-probe.ts:94-97` 的注释自己写着休眠账户会"每天产出一条 `facts:account_data_stale` 把待办刷满"；CTS 次账户（系列开、广告组全停）和 NAL（`cap_missing`）每天仍会各出一条。
- **阶段 1 的 `conflict` 待办取消**——对一条永远不会执行的动作发通知，是纯噪音（子牙）。
- `cap_missing` **不再重复推**：PM 已有台账 `2026-10-18-ad-account-daily-caps-wrong-or-missing` 和 10-27 日历。
- **全部走 dev 车道**（`five-kinds.ts` 里 `kernel_needs_human` = dev，约 `:176`）。PM 车道留到阶段 2。
- `pushAdsCycleLivenessItems`：回看 **≥3 天**（`pm-daily-todo` 是周一至周五，周五周六的评估失败原先永远不会被报）；时区**用 `resolveClientEvaluationDate`**，不写死 `Pacific/Auckland`（AU 客户时区不同）。
- **休眠排除**：用 A0 的 **`deliveringCampaigns` / `deliveringAdsets` 两个分层计数**，**不用 `hasDeliveringEntity`**——后者正是台账 `2026-10-18-ads-delivering-level-collapsed` 查出的"系列和广告组折叠成一个布尔"那个值（`circuit-cap-facts.ts:147,181`），CTS 次账户 5 个在投系列 + 0 个在投广告组会被判成在投、不休眠。**该缺陷这次不修，所以休眠排除在它修好前部分不可靠，明说。**

## 7. 阶段 2 的前提——全部满足才开

1. **PM 给了三个在投账户的真实日上限**，且后台有界面能填（铁律 8）。台账 `…ad-account-daily-caps-wrong-or-missing`，owner 是 PM，日历 10-27。
2. ✅ **PR 2019 已关**（统筹 10-18）。**但关之前要做完的事还没做**：
   - 把只在 2019 分支上的 **14 张台账卡摘回主干**（魏征 `git ls-tree origin/main` 查为 0 命中）。其中直接影响韩信的：`envelope-facts-cooldown-blind-to-kernel-own-changes`（P0，同实体连续两次动作冷却失效）、`…pre-provider-not-batch-scoped`（预算合计不按批次限定）、`…multi-account-budget-cap-not-summed`、`…truncated-history-misread-as-never-changed`、`…zero-test-coverage`、`circuit-breaker-single-evaluation-date-per-client`、`…account-level-campaign-attribution`、`pullback-daily-secondary-only-client-gap`、`find-shared-ad-accounts-pagination-gap` 等。**不摘回，批量提交会重新踩进没有登记的坑。**
   - 解除熔断的界面：2019 的 `autonomy-settings.tsx` 里有 55 行横幅 + 按钮，但调的是它自己的**客户级**路由，对主干**账户级**设计不适用。形状可借鉴，端点要改。主干已有 `src/app/api/admin/ads/circuit/release/route.ts`，除路由和它的测试外**无调用方**（即没有界面）。
3. **§6.2 二选一已落地**（见下）。
4. **trip 写入幂等**（v0.3 漏了，子牙点出）：`ads_circuit_events` **没有任何唯一约束**（迁移 `:77-119`），append-only 触发器只拦 UPDATE/DELETE/TRUNCATE。韩信每天跑、Inngest 重试，都会重复追加 trip；非 sticky trip 靠 `created_at > now()-24h` 判定，**每天追加会让账户永远处于熔断，且误 trip 删不掉。** → 写前先查同账户同原因是否已有未解 trip，**并补 partial unique index**。
5. **AI 信封对 `learning_stage` 全 NULL 的拒绝已核实**：魏征引 9-27 实测，CTS+NAL 共 46 个广告组因此被 AI 信封 **100% 拒绝**。韩信署名 `agent`，走的是 AI 信封，不是人工信封。**阶段 2 提交上去很可能全部被拒——我没核这个问题现在修没修，魏征也说"推断未实测"。** 前提：先核它。
6. **叠加幅度判据** + **"至少保留 N 个在投组"**（§4 两个拿不准的）二选一落地或明写缺口。
7. **阶段 1 稳定跑满一周**；**CTS 无花费不算稳定**。
8. **退出条件**（v0.3 没有，魏征点出前提 4 取决于外部、永不满足）：**前提 7 若到 2026-11-15 仍不满足，提交 PM 决定"改用别的客户 / 搁置"**——这个日期是我的提议，PM 可改。同时，**阶段 1 的验收不依赖 CTS 真实花费**，用 DEMO 数据证明链路通。

**还有一个不在清单里的：开 `autopilot_dry_run=false` 只由 PM 本人决定**（PM 10-18 经 18 号转述；对应的卡在未合并分支 `origin/docs/ads-dry-run-stays-on`，合并前我不引它当主干事实）。

### 6.2 人工止损豁免——降级成已知缺口（不许做成假防线）

v0.2 要求「`triggeredBy==='human'` 的收类动作放过熔断」。**当前主干核实（子牙逐行读，取代 v0.3 里对不上的行号）**：熔断检查在 `envelope-facts.ts:367-379`（解析器内部）；解析器被 `authorize.ts:412-418` 调用，入参只有 `{clientId, actionKey, input, at, runId}`，**没有 `triggeredBy`**；返回 `unavailable` 后直接 deny 在 `:420-428`；人工信封分叉 `selectEnvelopeVerdict` 在 `:447`，排在它们之后。→ **熔断在人工信封分叉之前，且解析器拿不到 `triggeredBy`，原结论成立**。要实现豁免就得改 Kernel 公开契约，与「不改 Kernel 一行」冲突。

**处置：降级。** 阶段 1 不写 trip，缺口不存在。阶段 2 前提二选一，**开工前必须定**：(a) 单独立项改 Kernel 契约，声明为偏离；(b) 明写话术：**"trip 期间，连 PM 批准后的人工止损也会在碰 Meta 前被挡"**——子牙核实 `outward-authorization.ts:163-192` 的 pre_provider 重查对**所有** `bounded` 动作都执行，范围比 v0.3 说的更宽——并把**解除按钮做出来**（现在零个界面调用，等于让 PM「告诉开发帮你调接口」，铁律 3 禁止的人工 SOP）。**两样都不做就上线是不允许的。**

## 8. 验证与当场试跑

**试跑一律挂 DEMO 客户 + 假 `ad_account_id`**（Harbourline Physio (DEMO)、Kiwi Silk Road (DEMO)、【测试】可删）。PR 正文附 `select count(*) … where client_id in (CTS, NAL)` 回执，证明生产客户零 trip 行、零 Kernel 提交。

**⚠️ 更正 v0.3 §8 里的一句话：** 「生产 CTS/NAL 的 dry-run 日跑只产批次行与回执」**当时没有证据支撑**（代码还不存在，那是预测）。v0.4 把它改成**试跑要验证的目标**，不是已查实的事实。

| 试跑 | 预期 |
|---|---|
| 手动发一次 `ads.impact_cycle.due`（DEMO） | 批次行建出；评估回执写入；再发一次 → `already_ran`，**不覆盖首次回执**，不停不死信 |
| 阶段 1 韩信跑完 | **Kernel 零新增 run**（这条靠"代码里没有提交"，不靠开关） |
| DEMO：造一条 D3 的 `dry_run_logged` | 收集器把它收进候选清单 |
| 造同实体 `auto_pause_on_d3` + `pause_unit` | 只留一条，另一条 `duplicate_effect` |
| 造 `pause_campaign` + 其下 `cut_unit_budget` | 子级 `subsumed`，**不是都执行** |
| 造同实体「暂停 + 加预算」 | 留暂停，加预算 `conflict` |
| 造父子链「降系列预算 + 暂停系列里最差的组」 | 两条都进批、都不标 conflict |
| **阶段 2 才有**：配置**无行** vs 读**报错** | 无行 → `source:'default'`；报错 → `'fallback'`；**两者都不提交，标签不同，测试预期分开写**（v0.3 把"无行"也写成"读不到"，对不上 `config.ts:108-114`） |
| 造一天数据缺失 | 「判不了」三件处置；原因码 `growth_state_missing` ≠ `data_partial` |

**变异验证**（打在真正动钱的路径上，不打在纯函数上）：
- **阶段 1：往 `ads-strategy/hanxin*` 里加一行对任何 Kernel 推进符号的 import → 架构测试必须红**
- 把去冲突里的"同效果去重"删掉 → 必须红
- 把 `subsumed` 识别删掉 → 必须红
- 把"休眠排除"改回用 `hasDeliveringEntity` → 必须红
- **阶段 2：** 去掉三条守卫里的任一条 → 必须红；把读和提交拆成两个 step → 必须红

**架构测试**（仓库里可抄的机制：`boundaries.ts` 的 `KERNEL_RUNNER_ALLOWED_CALLER_DIRS` + `KERNEL_RUNNER_SYMBOLS` 的符号级 import 检查；`AUTHORIZED_CONTEXT_MINTERS` 的类型铸造模式）：①`agent:hanxin` 字面量只许出现在韩信模块；②阶段 1 韩信模块不 import `KERNEL_RUNNER_SYMBOLS` 里任何符号；③两张新表各一条 `REVOKE/GRANT` 断言；④韩信写入者文件里只许出现 `'trip'` 字面量（阶段 2 才用），出现 `release` 会让 `architecture.test.ts` 那条红。

## 9. 不做

不改 Kernel 一行；不新增 ActionKey；不碰那十条旁路；不改授权口径；不建第三张表；不实现换素材；不碰 Google / TikTok；**不替 PM 点任何授权、不改任何开关**；不动 PR 2019 分支；不改 `ad_strategy_configs` 任何字段；**不修共享层 `hasDeliveringEntity`**（A 级，另立项）。

## 10. 第三轮复审对账

| 来源 | 必改 | v0.4 处理 | 在哪 |
|---|---|---|---|
| 子牙 1 / 魏征 1 | 红线 1 漏 `autopilot_enabled` | 守卫三条同时成立，复用 `loadAdStrategyConfigWithSource` | §3.2 |
| 魏征 1 | 读和提交须同 step | 写死 | §3.2 |
| 魏征 1 | 已提交 run 的推进入口 | 阶段 2 逐入口说明 | §3.2 |
| **子牙 2 / 魏征 1（独立得出）** | **阶段 1 不该把提交路径写进代码** | **阶段 1 不 import 任何 Kernel 推进符号，架构测试钉死** | §2、§3.1 |
| 子牙 3 / 魏征 2 | **阶段 1 没有处方来源** | 收集器读 D3 `dry_run_logged`；O1/止损来源标「待核」 | §0、§2 S1-3b |
| 子牙 4 | 待办刷屏 | 幂等键 `(账户, 原因码)`；conflict 待办取消；全 dev 车道 | §6 |
| 子牙 | 评估重复 | 直接调 `probeClientCircuit` | §2 S1-4 |
| 子牙 | 时区写死 | `resolveClientEvaluationDate` | §6 |
| 子牙 5 | 客户级字段怎么放、`date` 口径 | 每个账户行各存一份并声明；`date` = 客户评估日 | §5 D4/D5 |
| 子牙 5 | 重跑覆盖 | 首次写入为准 | §5 D6 |
| 子牙 6 | CHECK 不是"扩"是一次写全；同步改权威稿 | S1-1 CREATE TABLE 写全 + 同 PR 改 §11.7 | §2 S1-1 |
| 子牙 | `would_submit` 语义错位 | 拆 `disposition` 列 + 批次级 `submit_gate` | §5 D7 |
| 子牙 | 幂等键没写具体列 | `(batch_id, action_key, subject_level, subject_id)` + 逐键映射 | §5 D3 |
| 子牙 7 / 魏征 4 | 冲突判据 5 处套不上 | 按实体×效果重写；`duplicate_effect` / `subsumed`；三个 stub 都 `manual_only` | §3.9、§4 |
| 魏征 4 | 叠加幅度 / 累积停光 | 标「拿不准」，列阶段 2 前提 | §4、§7.6 |
| 子牙 8 / 魏征 6 | PR 2019 状态过期 + 丢东西 | 改为已关；14 张卡摘回、解除界面形状借鉴 | §1、§7.2 |
| 子牙 | trip 幂等 | 阶段 2 前提：写前查 + partial unique index | §7.4 |
| 子牙 | 人工止损被挡的范围更宽 | 话术改写 | §6.2 |
| 魏征 3/5 | 阶段 2 永不满足 | 退出条件 + 阶段 1 验收不依赖 CTS 花费 | §7.8 |
| 魏征 3 | AI 信封 100% 拒绝 | 阶段 2 前提：先核 | §7.5 |
| 子牙 9 | 韩信目录进白名单 | 韩信放 `ads-strategy/`，不进 `action-submission/` | §3.8 |
| 魏征 7 | **§9 第 4 条对账说反了**（`hasDeliveringEntity` 就是被查出判错的那个布尔） | **承认说反**，改用分层计数，并明说休眠排除部分不可靠 | §6 |
| 魏征 2 | `config_unreadable` 试跑预期对不上代码 | 无行 / 报错分开写 | §8 |
| 魏征 2 | §8 一句话没有证据 | 改成"试跑要验证的目标" | §8 |
| 子牙 7 | §6.2 行号对不上 | 换成当前主干行号，**结论成立** | §6.2 |
| 子牙 6 | §12 说两张表是 platform-shared | 改为"广告支柱专用，跨客户/行业共享"（权威稿自己写的是 ads-specific） | §11 |

## 11. Reuse Statement

- **复用**：Kernel `authorize` / 信封 / 策略表；`circuit-detectors.ts` + A0 `probeClientCircuit`；`loadAdStrategyConfigWithSource`；`pm-todo` 拉取与 `five-kinds.ts` 车道表；Inngest；`resolveClientEvaluationDate`；`update_updated_at_column()`。
- **新增**：两张批次表（**广告支柱专用，跨客户 / 跨行业共享**，不是 platform-shared——权威稿自己写的就是 ads-specific，带 `ad_account_id`）、韩信函数、收集器、冲突判据（纯函数）。
- **industry-specific**：无。**client-specific**：无；日上限属 client configuration（`client_meta_ad_accounts`），不进共享代码。
- **有没有把客户名/ID/行业判断写进 shared runtime**：没有。换 CTS 为 Roman 或悉尼地产客户，共享代码不需要改。
- **tier-gate Inline**：归位 L1 平台基础设施下的**广告支柱**接线；不新增支柱、不新增能力线。子牙对"L1 平台基础设施"这个分类拿不准，建议跑一次完整 `me-platform-tier-gate` 把报告附上——**第四轮聚焦复审时一并做**。
- **与 tier-gate 决策时分类是否一致**：一致。
