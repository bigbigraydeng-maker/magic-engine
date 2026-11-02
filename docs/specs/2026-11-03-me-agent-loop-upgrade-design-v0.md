# ME Agent 闭环升级设计 v0.1：先立基线和考卷，再用广告跑通第一条闭环

日期：2026-11-03
状态：设计稿，等 PM 回「开工」才进第 0 步。v0.1 吸收了魏征复审的 14 条意见（见 §9）。
风险：本文件 **C**（只加文档；基线查询放在附录 C，全是只读）。第 0 步 **B**（只加测试）。第 1 步碰定时任务路由和广告 Inngest 函数，**A**。
写入者：Claude Code 会话 `claude/agent-loop-optimization-23e235`（本文件）
基线：`main` = `origin/main` = `4e891c5bd`（本地记录，未 fetch）。生产库 `glbdnayojixmexgofbsd` 只读查询，2026-11-03（NZDT）。

不做：新表、新 agent、新的大模型调用、新定时任务、自我进化、改模型、把对外写入一次性迁进内核。理由见 §6。

---

## 0. 一句话结论

ME 现在是「每天跑规则 → 出建议 → 人批 → 执行」的流水线。执行后的结果，大多数量不出来；量出来的那一点，下一次做决定时也没人读。

升级只做三件事，按顺序：

1. **立基线、出考卷。** 当前代码答错的题，就是要修的范围，清单外的不做。
2. **用广告跑通第一条完整闭环。** 只有真执行、读回也通过的动作才出结论；第二天的诊断读这个结论，只用来压住「加码」类提议、给其他提议加标注，**永远不压住止损**。
3. **广告这条过了验收，才按同一个契约复制到社媒，再到 SEO。**

## 1. 依据：讲稿里反复出现、对 ME 适用的原则

资料在 `~/Downloads/173`，共 75 份 QCon 2026 讲稿。读了最相关的 53 份，其中 6 份完全读不出文字，4 份只读到目录。

| 原则 | 出处（讲者） | 在 ME 的含义 |
|---|---|---|
| 先 Harness 后 Loop：单次结果不可信，自动化只会放大错误 | 肖汉松（蚂蚁阿福） | 先让单个动作的结论可信，再谈回流 |
| 工具说成功 ≠ 业务成功；完成证据分层记 | 俞昊晟、李桐馨 | 「执行了 / 读回对上 / 观察期满有结论」三层分开记 |
| 错例进回归考卷；改之前在同一批样本上配对比较；生成者不审自己 | 肖汉松、陈忻、朱革、李峥峰 | PM 确认过的错，变成固定考题 |
| 回放不经大模型，结果可复现 | 王政达 | 考卷只测确定性规则 |
| 能一键撤回的先放开 | 张忻正 | 只先放开「少做」的改动，比如压住加码 |
| 运行反馈不能直接当新规则，要复核、版本化、能回退 | 徐帅（传音）、袁彬航 | 本轮不自动生成规则 |
| 先跑通一个完整任务再复制；砍掉多余的 agent 和好看的指标 | 徐帅、张忻正 | 只做广告一条，不几条线并行 |
| 不抄：在线强化学习、多 agent 堆叠、大而全的知识库 | 袁彬航（自述样本小）、滕爱龄 | ME 全部客户加起来，每天约 8 个动作 |

**ME 跟大厂最大的不同：量小、反馈慢、噪声大。**

- 量小：广告走内核的执行，历史上一共只有 2 次。
- 反馈慢：SEO 要 18–28 天，社媒 72 小时，广告 3–7 天。
- 噪声大：在 CTS 的流量下，没改标题的页面也有 41% 被判成「变好或变差」（见 `src/lib/seo-meta/cycle/runner.ts:137-143` 的注释）。

所以目标是**每个真执行的动作都有一个说得清的状态**，不是「判成有效的越多越好」。

## 2. 基线 B0（2026-11-03 实测）

复跑用附录 C 的只读查询。

### 2.1 指标

| 编号 | 指标 | B0 | 说明 |
|---|---|---|---|
| M1 | 动作有结论行的比例（90 天） | SEO 386/457，GEO 79/135，社媒 **0/97**，广告 13/51 | 分母混着建议、演练、被拦的提议行（见 M5）。第 1 步起，分母只算真执行 |
| M2 | 判成「确认有效 / 确认无效」的动作 | SEO **0**，GEO 71，社媒 **0**，广告 7 | 30 天 540 条结论里 532 条是「说不清」。其中 504 条是全站 GSC 指标，规则上强制判成说不清 |
| M3 | 规则型决策点里，会读上次结果的有几个 | **0/5** | 五个点：广告每日诊断（喂 D3）、巡检（喂 O1）、社媒排期、SEO 选页、内核授权。注：内核授权有 72 小时冷却，但只看「最近动没动」，不看结果 |
| M4 | 决策回放考卷 | 广告诊断有现成回放测试（`diagnostics/__tests__/replay.test.ts`，14 条）；SEO 有 1 个事故回放文件；**「执行后该怎么接」的题目 0 道** | 现成的测的是诊断规则本身，不测闭环 |
| M5 | 动作名称（90 天） | 740 行，约 90 种 `action_type`；`action_run_id` 这一列有值的 **0 行** | 大模型的建议也被记成动作（`flywheel/attribution/execution-evidence.ts:1-17` 有说明） |
| M6 | 学习原料是否新鲜 | 偏好 30 天新增 1 条；处方效果最后写入 08-20；帖子读数回执最后写入 09-09；社媒结论表已建、**0 行**；SEO 标题最后一次改动在 09-28 那周，排名结论 0 条 | 学习任务都在跑，只是没有原料 |
| M7 | 广告诊断同一问题连续挂了多少天（30 天） | D7「广告结果怎么算没设置」：4 个账户，平均挂 28.8 天；D7「设置在投但日数据停更」：1 个账户挂 29 天 | 卡在人工那一步，或者数据断了。不解决，这些账户上另外两条规则一直判不了 |
| M8（新） | 闭环漏斗：真执行 → 读回通过 → 观察期满 → 有结论 → 被下一次决策读到 | 广告：2 → 2 → 未核实 → 未核实 → **0** | 第 1 步验收看这条，不看 M3 |

### 2.2 护栏（升级过程中不能变差）

- **G1 对外误发：0 起。** 包括发错帖、回错评论、误停在投广告，以及**止损提议被压住**。
- **G2 PM 每周要批的条数：不比动工前一周多。** 第 0 步开工那天记下数字。
- **G3 新增外部接口费用：每周不超过 B0 加 5 美元。**

## 3. 测试 agent 环境

只用两样，全部扩展现有设施。

### 3.1 回放考卷：离线、确定性

- **放在哪**：扩展现有的 `src/lib/ads-strategy/portfolio/diagnostics/__tests__/replay.ts` 和 `replay.test.ts`，不新建目录。
- **怎么跑**：现有 vitest 直接跑，不联网、不调大模型、不连数据库。
- **测什么**：纯函数。包括 `runDiagnostics`（`diagnostics/run.ts:23`）、`runOpportunities`（`opportunities/run.ts:31`），以及第 1 步新加的诊断后处理。
- **出题规则**：
  - 只收 PM 或事故复盘确认过答案的题。
  - 每题写明来源（PITFALLS 编号或台账卡）。
  - 新题不放生产编号、真实金额、账户名。金额统一换成比例。
  - 现有夹具里已经有真实账户编号，那是另一件事，另开卡处理（见 §8）。
- **第 0 步首批题目（只覆盖广告这条线）**：
  1. 只有提议、没执行的暂停（演练、被拦、等批准），不许出结论。
  2. 刚加过预算不到 72 小时的组，不许再出「加预算」提议，要写明原因。
  3. 刚动过不到 72 小时的组，如果命中止损，**照样要出暂停提议**，只多加一行「上次动作」标注。
  4. 「上次动作确认无效」超过 14 天就作废，不再影响提议。
  5. 「广告结果怎么算」没设置时，不出「花钱没结果」的结论（D7 的前置条件）。
  6. 读回没对上的动作，进现有的「内核要人处理」待办，不另建新待办。
- **当前代码答错的题，不删也不改答案**，标成「已知待修」。这张清单就是第 1 步的全部修改范围。

### 3.2 影子跑：线上真实数据，正式结果一字不改

放在第 1 步做，因为要改定时任务路由（A 级）。

- **挂在哪**：后处理挂在诊断的**两个出口**，两条都跑影子：
  - `run-daily.ts`：写 `ad_health_narratives`，D3 从这里读（`ads-d3-auto-pause.ts:100-116`）；
  - `patrol.ts`：写 `ads_growth_states`，O1 从这里读（`o1-scale/route.ts:47-64`）。
- **历史怎么读**：「最近对这个对象做过什么」从现有的 `kernel_action_lineage` 视图（`kernel/lineage.ts`）和快照设置变化读。冷却口径复用内核已有的判据（`envelope-facts.ts:354`、`:736-750`），不另写第三套 72 小时规则。
- **出错怎么办**：这次读取放在诊断加载函数外面，失败了只记一行影子日志，**当天的诊断、D3、O1 和日报照常跑**。
- **结果写哪**：照抄现成先例 `circuit_probe`（`google-data-pullback-daily/route.ts:123-130, 723-731`）的写法，写进 `cron_run_logs.summary`。
- **防写测试**：影子开和关两种情况下，写进 `ads_growth_states` 和 `ad_health_narratives` 的内容逐字节相同。
- **PM 怎么看**：每周一周报里加一行（多压了几条、多标了几条、各举一例），不进今日待办。
- **影子期多长**：至少 14 天，**并且至少看过 10 条差异**。不够 10 条就顺延，最多 28 天。到 28 天还不够，说明这条规则几乎碰不到，停下复盘值不值得开。

## 4. 闭环契约：一个动作一张卡

不建新表，只约束现有的 `flywheel_actions` / `flywheel_outcomes` 怎么写、怎么读。

**写的一侧：只有真执行的动作才写结论行。** 一行要带五样：

1. **动作名**：本轮只把广告这条用到的定死（暂停、减预算、加预算）。其余写入点不动。
2. **作用对象**：广告组、帖子或页面的编号，不许只写「整个账户」。
3. **执行凭证**：内核运行编号写进 `action_run_id` 这一列。只有执行成功、读回通过才写。`executed_at` 取执行完成的时间（`run.finished_at`），不取提议的时间。
4. **怎么量**：复用现成的 `resolveAndLogAdsExpectedMetric`（`ads-campaign-budget.ts` 已在用）。
5. **结论**：沿用表里现有的三种值。确实量不了的，原因只能从一张固定清单里选，单独统计，不算进「有结论」。

**读的一侧：** 决策规则只通过 `kernel_action_lineage` 读历史，不各自查表。

**收和放分开对待（硬规则）：**

- **放类**（加预算、扩受众）：冷却期内，或上次确认无效（14 天内），**压住不提**，写明原因。
- **收类**（暂停、减预算、止损）：**永远不压**，只加一行「上次动作 + 读回 + 结论」标注。

**平台归属**：这是现有「核对 + 记忆」基础设施的契约，不是新能力线。换成 Oztop 或地产客户，契约不用改；行业差异只体现在「用哪把尺子、观察几天」。

## 5. 分步方案

每一步都写清：做什么、验收、停止线、不做什么。上一步没过验收，不进下一步。

### 第 0 步：基线 + 考卷（约 1 周，B 级，只加测试）

按 §11：频率高（每次改规则都要用，同类事故反复发生）/ IMPACT 高（没有它，改得对不对说不清）/ 收入中 → **P0**。

- **做**：
  - 出 §3.1 的首批题目，写进现有回放测试，整理出「已知待修」清单；
  - 动工前一周的 G2 数字入台账；
  - 核实 D7 的人工待办有没有真的推到今日待办（只核实，不修）。
- **验收**：题目在 CI 里跑（已知待修的题标成预期失败）；清单交 PM；基线入台账。
- **停止线**：有确认答案的题不到 5 道，就先补题，不往下走。
- **不做**：任何决策逻辑和定时任务的改动。

### 第 1 步：广告闭环，第一个完整样板（约 3 周，A 级）

按 §11：频率高（每天跑两遍诊断）/ IMPACT 高（检查这一环断在这里）/ 收入高（客户的广告钱）→ **P0**。

- **1a 量得出**：
  - 在 D3 批准后的执行路径里（`action-submission/ads-auto-pause.ts`），执行成功、读回通过时写结论行，带 `action_run_id`、执行完成时间和观察指标；
  - 在 `execution-evidence.ts` 里加按 `payload.status` 区分的闸，演练、被拦、等批准的提议行不进结论计算；
  - D3 提议那一刻写的那一行保持不动。
- **1b 喂回去**：
  - 只加一个纯函数后处理，挂在 §3.2 的两个出口；
  - 规则只有 §4 的「收放分开」两条；
  - 读回没对上，走现有的 `kernel_needs_human`（`pm-todo/manual-items.ts:986`）。
- **1c 影子跑**：按 §3.2，满足条件后 PM 看周报，回「开」才生效。开关默认关，一键能关。
- **当场试跑**：改动单必须有「## 当场试跑」一段，用演练模式手动触发一次每日巡检的完整链路，贴出影子日志和防写测试结果。14 天影子跑不能代替这一次试跑。
- **验收**：
  - 广告相关的「已知待修」题全部通过；
  - 影子期达到 §3.2 的条件，且零错压、零漏标；
  - M8 漏斗每一级都有数；
  - G1–G3 不变差。
- **停止线**：影子期出现 1 条「压住了本该提的动作」，就停下复盘，不靠加例外规则硬改。
- **不做**：改 D/O 规则本身的阈值；新的结论计算程序；把 `meta-ads/execute`、`winner-reel-sync` 迁进内核（另开 A 级卡）；动作名全量统一。
- **跟在飞的工作**：#3521 和 #3522 改的是 `ads-next-step/` 和 `approval-context/`，不碰本步要改的文件。开工前、合并前各重查一次主干。

### 第 2 步：社媒结论（广告样板过验收后，约 2 周，B 级）

按 §11：频率高（每日计划天天发）/ IMPACT 高 / 收入中 → **P0**。

排在广告后面有两个原因：
1. 一次只做一条支柱（§6 第 5 条）；
2. 社媒读回现在归 97 号窗口（WP1），要先交接写入权。

- **前提**：
  - 结论表 `social_verification_verdicts` 生产库已建、0 行（11-03 核实）；
  - 写入开关 `SOCIAL_VERIFICATION_VERDICTS_ENABLED` 当前值未核实；
  - 跟 97 号窗口确认谁是写入者。
- **做**：
  - 发帖后第 72 小时那次读数成功时（`daily-plan-post-measurement.ts` 约 `:294-344`），跟同一主页最近若干条的第 72 小时读数中位数比，写一条结论；
  - 下周排期读 #3523 已经汇总好的上下文。
- **验收**：真发出去的帖子，80% 以上在第 72 小时有结论（「样本不足」单独统计，不算进 80%）；排期确实读到了结论（考卷里有题）。
- **停止线**：每个主页每周不到 3 条帖子，只记「样本不足」，不硬比。

### 第 3 步：SEO 先查清再说（约 1 周，C 级，只读）

按 §11：频率中（标题改动线 9 月底后已停）/ IMPACT 中 / 收入低 → 一个低、零个高 → **P2**。

- **做**：只查清两件事：
  1. 标题改动线为什么 09-28 那周以后没有新改动；
  2. 排名结论为什么一条都没有。
- **不做**：不新做尺子，不重做空白对照。10-04 已经证明按单页点击率前后比不准，已改用排名抽样（`seo-meta/cycle/rank-verdict.ts`）。
- **结论出来再决定**：要修就单独开卡，不预先排开发。

### 之后（不在本轮，进台账待认领）

| 项 | §11 | 为什么现在不做 |
|---|---|---|
| 动作名全量统一（约 20 个写入点） | 频率高 / IMPACT 中 / 收入低 → P2 | 每步只定死自己那条线用到的名字，够用 |
| 绕过内核的对外写入迁进内核（约 25 处，见附录 A） | 频率中 / IMPACT 中 / 收入高 → P2 | A 级、量大，先让结果量得出来 |
| 大模型调用留痕 | 频率低 / IMPACT 中 / 收入低 → P3 | 考卷只测规则，暂时用不上 |
| 自动生成规则或提示词（自我进化） | 频率低 / IMPACT 高 / 收入低 → P3 | 前面没跑通就做，会放大错误 |

## 6. 防过度开发的硬规则

1. **没有考题，不改决策代码。** 每个改动先在 §3.1 有一道当前答错的题。
2. 第 0–2 步：不新建表、不新增 agent、不新增大模型调用、不新增定时任务、不新增待办种类。
3. 每步最多 2 个改动单，每个不超过约 400 行。
4. 每步都有停止线。到点数字没动，就停下复盘，不追加功能去补。
5. 一次只做一条支柱。广告样板过验收之前，不碰社媒和 SEO 的代码。
6. 能扩展现有的就不新写。本稿里每一样新东西，都写明了扩展的是哪个现有文件。
7. 代码按仓库规矩派 DeepSeek 写，Claude Code 审 diff、跑测试；A 级按合并闸走，不自己合。

## 7. 时间与回执

- **第 0 步结束**：复跑附录 C 的查询，结果写进台账卡。
- **第 1 步影子期开始那天**：建日历提醒，在第 14 天上午看周报，决定继续影子期还是开开关。
- **每步结束**：交一段短记录，包括改了哪些文件、考卷通过数、基线前后对照、没跑的项。

## 8. Reuse Statement

- **复用**：
  - 结果记录：`flywheel_actions` / `flywheel_outcomes`、`execution-evidence.ts`、`resolveAndLogAdsExpectedMetric`
  - 内核与读回：`kernel_action_lineage`、`action_run_steps.verification`、`envelope-facts.ts` 的冷却判据
  - 广告诊断：现有回放测试和夹具、两个诊断出口
  - 日志与待办：`circuit_probe` 日志写法、`kernel_needs_human`
  - 社媒：`social_verification_verdicts`、#3523 的汇总
- **新增、平台共享**：诊断后处理（收放分开）、动作契约的五项约定、新增考题。
- **行业层**：各支柱用哪把尺子、观察几天。
- **客户层**：无。新题目去掉身份。
- **另开卡**：现有回放夹具里有真实广告账户编号和金额，而仓库是公开的。这不在本稿范围，另开一张卡处理。
- **层级核对**：本次落点与层级判定一致，都归已有的「核对 + 记忆」基础设施，不新增能力线，不登记候选。

## 9. v0 → v0.1 改了什么（魏征复审）

| 编号 | 意见 | 处理 |
|---|---|---|
| P0-1 | 会对没执行的提议算出结论 | 结论行只在执行成功且读回通过时写；加状态闸；加考题 1 |
| P0-2 | 影子只测了巡检，D3 读的是另一个出口 | 两个出口都挂；M3 改成 5 个点 |
| P1-3 | 冷却会挡住止损 | 改成收放分开；「无效」14 天过期；加考题 2–4 |
| P1-4 | 五样东西重做了 | 全部改成扩展现有的 |
| P1-5 | 第 0 步风险级别定低了 | 影子跑挪到第 1 步，第 0 步只加测试 |
| P1-6 | 周汇总进今日待办 | 改成周报一行；G2 基线取动工前一周 |
| P1-7 | 影子出错会连带正式流程 | 读取放在加载函数外，失败只记日志 |
| P1-8 | 指标可以刷 | 分母只算真执行；「没法测」单独统计 |
| P1-9 | 缺证明闭环真通了的指标 | 加 M8 漏斗；影子期至少 10 条差异；第 0 步核实 D7 待办 |
| P1-10 | SEO 尺子已经证明不准 | 第 3 步改成只读查清 |
| P1-11 | 社媒结论表可能没建 | 已核实：生产库已建、0 行；开关值未核实，列为前提 |
| P2-12 | D7 查询混在一起 | 脚本改按 `date` 过滤、按标题细分 |
| P2-13 | 防写测试测不到真风险 | 改成影子开关两种情况写入逐字节相同 |
| P2-14 | 当场试跑、台账、打分 | 第 1 步写明当场试跑；本稿配台账卡；广告频率改高，社媒改 P0 并写明排序原因 |

---

## 10. 第 1 步重开又停下（2026-11-03 第二次）

**重开的理由**：内核真执行的广告动作太少（全部历史 2 次），而人在 Ads Manager 里手改很多（近 30 天 CTS 真改 35 处），快照全看得到。于是第 1 步加了一块「改动回看」：快照看到的暂停 / 加减日预算满 7 天时，比改前 7 天和改后 7 天。代码、34 道测试、子牙 + 魏征两轮复审都做完，存档在分支 `feat/agent-loop-step1-ads`（提交 `05c58ec58`），**没开改动单、没合并**。

**为什么又停**：拿 CTS、NAL 09-26 → 11-02 的真实改动和日数据逐天回放——

| | 处数 |
|---|---|
| 清理型暂停（停之前就没花钱，不用看） | 16 |
| 拿来回看 | 17 |
| 其中**有结论** | **0** |
| 说不清：不是出结果的单位（视频播放 / 点击类） | 6 |
| 说不清：前后 7 天里还有别的改动，分不清 | 5 |
| 说不清：暂停的是 WhatsApp 组，客户主结果却是留资，没法跟目标成本比 | 3 |
| 说不清：系列下各组优化目标不一样，结果归不准 | 3 |

第一版规则回放出过「有结论 6 处、止损成立 5 处」，魏征复审指出、查库证实：**那 5 条全是误判**——视频播放组、WhatsApp 组被拿「留资」去数，零留资就成了「止损成立」。修正后是 0。按 §5 第 1 步的停止线，没有可验证的样本就不往下做。

**真正卡住的地方（不是代码量）**：
1. 广告「结果」的口径是**按客户**配一个（CTS = 留资），而 CTS 的广告组一半是 WhatsApp 开聊、视频播放。凡是按客户口径数结果的判断，在这些组上都会错——**线上的 D3「花钱没结果」已经在错**：CTS 的 WhatsApp 组 `…493473` 10-25 → 10-30 连着 6 天被判「花钱没结果」，进了日报和今日待办（另开台账卡）。D2 / D10 早已按广告组自己的结果种类判（`rules/core-metric.ts`），D3 没有。
2. 人改广告是一批一批改的（10-25 一天 CTS 停了十几处），单独一处的效果分不出来。这一条是客户怎么干活，不是 bug。

**下一步**：先修第 1 条（D3 按广告组自己的结果种类判，A 级），它同时是线上误报。第 1 步的重启条件不变（见台账卡 `2026-11-03-agent-loop-step1-paused-no-traffic`），12-03 复看时把「改动回看」的回放再跑一遍——命令和数据形状写在本次台账证据里。

## 附录 A：绕过内核直接写外部系统的路径（2026-11-03 代码只读核对）

- **Meta 广告**：
  - `meta-ads/execute/route.ts:186,400`
  - `service-pause-only.ts:271`
  - `winner-reel-sync/engine.ts:277,335`
  - `draft-and-gate.ts:225,414,541`
  - `go-live-cards/execute.ts:153,156`
- **主页内容 / 评论**：
  - `daily-plan-publish-effects.ts:129,190`
  - `daily-plan-post-story-resolve.ts:96`
  - `facebook-reel-adapter.ts:46,106`
  - `campaign-daily-plan/recall/route.ts:249`
  - `story-lite/ports.ts:79-80`
  - `comment-autoreply-engine.ts:363,381,388`
  - `comment-engagements/route.ts:110`
- **消息**：
  - Messenger：`messenger/.../reply/route.ts:130`、`messaging/adapters/messenger.ts:88`
  - WhatsApp：`whatsapp/.../reply/route.ts:74`、`messaging/adapters/whatsapp.ts:73`
- **客户网站**：
  - `seo-meta/cycle/apply-adapter.ts:155,241`
  - `cts-meta-pr.ts:524`
  - `wordpress/update-post/route.ts:274`
  - `publish-wordpress/route.ts:286,299,398,401,495,497`
  - `publish-shopify/route.ts:229,233`

## 附录 B：没核实的

- SEO 标题改动线 09-28 之后为什么没有新改动（第 3 步查）。
- 各个「只演练不发」开关、`SOCIAL_VERIFICATION_VERDICTS_ENABLED` 在生产上现在的值。
- 08-20 之后有没有「已批准、有案例记录」的处方走到观察节点。
- D7 的人工待办是否真的推到了今日待办（第 0 步查）。
- 讲稿：6 份完全读不出文字（赵雨森、张凯寓、泠乐、货拉拉、王上淇、桑木），4 份只读到目录（温睦宁、吴垚、李俊、曹一凡），这些讲稿的细节没有采用。

## 附录 C：基线查询（只读）

在老应用库（`glbdnayojixmexgofbsd`）用任何只读身份运行。每一句都是 SELECT。每步结束复跑一次，和 §2 的 B0 对照。只记汇总数字，不把客户级明细贴进仓库。

```sql
-- Output is aggregate counts only; do not paste client-level rows into the public repo.

-- M1 + M2: actions per pillar (90d), how many got any outcome row, how many got a decided verdict.
select a.flywheel::text as pillar,
       count(distinct a.id) as actions_90d,
       count(distinct a.id) filter (where o.id is not null) as with_outcome,
       count(distinct a.id) filter (where o.verdict::text in ('confirmed', 'reversed')) as decided
from flywheel_actions a
left join flywheel_outcomes o on o.action_id = a.id
where a.created_at > now() - interval '90 days'
group by 1
order by 2 desc;

-- M1 detail: why outcomes are inconclusive (site-level metric keys are forced to inconclusive).
select coalesce(evaluator_key, '(none)') as evaluator, metric_key, verdict::text as verdict, count(*) as n
from flywheel_outcomes
where created_at > now() - interval '30 days'
group by 1, 2, 3
order by n desc;

-- M5: action naming. Distinct action_type values vs rows, and rows tied to a real executed item.
select flywheel::text as pillar,
       count(*) as rows_90d,
       count(distinct action_type) as distinct_action_types,
       count(*) filter (where action_run_id is not null) as with_kernel_run,
       count(*) filter (where execution_item_id is not null) as with_execution_item,
       count(*) filter (where execution_mode::text = 'external_manual') as external_manual
from flywheel_actions
where created_at > now() - interval '90 days'
group by 1
order by 2 desc;

-- M6: freshness of the learning inputs.
select 'client_learned_preferences_30d' as k, count(*)::text as v from client_learned_preferences where created_at > now() - interval '30 days'
union all select 'prescription_outcomes_last_write', max(created_at)::text from prescription_outcomes
union all select 'social_post_measurement_receipts_last_write', max(created_at)::text from social_post_measurement_receipts
union all select 'social_verification_verdicts_rows', count(*)::text from social_verification_verdicts
union all select 'seo_meta_log_last_change', max(optimised_at)::text from seo_meta_log
union all select 'seo_meta_log_rank_verdicts_90d', count(*) filter (where rank_verdict is not null)::text from seo_meta_log where created_at > now() - interval '90 days'
union all select 'kernel_action_runs_ads_all_time', count(*)::text from action_runs where action_key like 'ads.%'
union all select 'kernel_readback_steps_all_time', count(*)::text from action_run_steps where step_key ilike '%readback%';

-- M7: ads patrol problems that stay flagged day after day (30d). Long runs = loop stalled at a human step.
-- Filter on `date` (rows are overwritten daily, created_at does not move). Several D7 variants share
-- one code and one account unit, so group by title as well.
with p as (
  select s.client_id, s.date, pr->>'code' as code, pr->>'title' as title, u->>'id' as unit_id
  from ads_growth_states s,
       jsonb_array_elements(s.payload->'problems') pr,
       jsonb_array_elements(coalesce(pr->'units', '[]'::jsonb)) u
  where s.date > current_date - 30 and pr->>'status' = 'hit'
), runs as (
  select client_id, code, title, unit_id, count(distinct date) as days_flagged
  from p group by 1, 2, 3, 4
)
select code, left(title, 40) as title, count(*) as problem_units, round(avg(days_flagged), 1) as avg_days_flagged,
       count(*) filter (where days_flagged >= 7) as flagged_7plus_days
from runs
group by 1, 2
order by problem_units desc;
```
