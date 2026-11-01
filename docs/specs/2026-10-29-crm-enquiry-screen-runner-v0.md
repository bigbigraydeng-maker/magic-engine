# CRM 有效咨询筛选 —— 自动运行器设计稿 v0.1（2026-10-29，已吸收子牙+魏征两审）

承接 [valid-leads 设计稿 v0.3](./2026-10-21-crm-valid-leads-only-design-v0.md)。v0.3 的纯函数（准入 / 第一层规则 / 硬否决 / 模型 / 三道校验）、`not_enquiry` 阶段、「退回」按钮、回退脚本已合并；**缺的只有「每天自动跑」这一环**——现在只有手动干跑脚本。本稿只补这一环，不改判据。

## 1. PM 要什么
PM 2026-10-29：「Magic Engine 智能模式下不够智能，MyMotorland、Turisti in Puglia 等推销也被并入了；这里主要是销售为目标的 list」→ 「全做，用模型判断」「开自动筛」。当天已手动清掉 26 位（我读邮件判，PM 批准），要让它以后自己做。

## 2. 事实（只读生产，2026-10-29）
- CTS `leads_config.enquiry_screen` = 空（开关关着）；非咨询阶段已存在（24 人手工/早期标的）。
- 手动清理前，「只有对方来信、无人回过、无人跟进」的候选共约 54 人，其中 26 人是推销/合作邀请；剩余 5 人是真客人（签证资料、问团价、问广州出发、私人团询价、报价请求）——**说明必须由模型读内容，不能靠数封数。**
- 这批人之所以漏，是因为 `senderShapeOf` 只看地址形状（群发服务商、noreply），info@ 公司邮箱过不了；且 9/26 记的「不用回：不是客人」只是一条备注，没改阶段。

## 3. 查了哪三处平台能力（Reuse First）
1. `src/lib/crm/enquiry-screen/*`（decideScreen、acceptNonEnquiry、SCREEN_MODEL=Haiku）—— 判据全部复用，不改。
2. `scripts/crm-enquiry-screen-dryrun.ts` —— 取数/组装逻辑（页面同口径基线、事件、触点）要抽成 `src/lib/` 里的函数，脚本改成调用它，避免两份。
3. `runPostBriefSweeps`（`src/lib/messenger/brief-cycle.ts`，每小时由 Inngest `messenger-brief-after-sync` 与 cron 路由共用）—— 已有 stage-infer、call-advance 同款「整轮独立 try/catch」的挂法，新增一段即可，不新建 Inngest 函数、不新增 render.yaml 条目。

## 4. 设计
### 4.1 挂在哪、怎么跑
- `runPostBriefSweeps` 里 `callAdvance` 之后加 `enquiryScreen = runEnquiryScreenSweep(now)`，自己的 try/catch，失败只记日志不影响别的段。
- 逐客户读 `leads_config.enquiry_screen`；**`enabled !== true` 的客户立刻跳过：不调模型、不读触点、不写库**（保持 v0.3 的「关着什么都不做」）。
- 三档运行模式（新增键 `mode`，缺省 `shadow`）：
  | mode | 调模型 | 写 contacts / 事件 | 留痕 |
  |---|---|---|---|
  | `shadow` | 是 | **否** | 回执（见 4.3） |
  | `apply` | 是 | 是 | 回执 + 阶段事件 |
  `enabled=true` 且 `mode` 缺省 = shadow：**打开开关本身不会改任何人**，改人必须再显式设 `mode='apply'`（PM 一句话）。
- 范围写死：候选 = v0.3 §5.1 准入全满足者（只有入站邮件/WhatsApp、无人回、无电话、无人工改阶段、非同行/员工、第一封至少过 `minAgeDays` 天）。本稿**不扩范围**。
- 预算闸：每轮最多判 `MAX_PER_RUN=40` 人；每人只发「主题 + 前 255 字预览」；同一个人同一份内容指纹判过一次就不再判（`keep` 也记），避免每小时重复花钱。

### 4.2 写入（apply 模式）
- 复用 `advanceContactStage(sb, clientId, id, 'not_enquiry', note, ENQUIRY_SCREEN_ACTOR 对应写法, expectedFromStage)`；写前**重新查一次**「此刻有无新入站/人工动作」（v0.3 §5.3 魏征 N2），对不上跳过并记。
- 模型 confidence ≥ 阈值（默认 0.9）且引文逐字在原文里才改；其余一律 keep。
- 被挪走的人再来真咨询自动回名单、人工「这是真客人」后机器永不再判（v0.3 §5.3.1，已实现，本稿不动）。

### 4.3 留痕（Inngest 约束：每个关键阶段要有机器可读回执）
- `runPostBriefSweeps` 的返回值加 `enquiryScreen: { clients, considered, wouldMove, moved, kept: {原因: 数}, skippedBudget, errors }`，由现有 Inngest 函数/cron 路由原样写进运行记录。
- **shadow 模式的「本会挪走名单」**必须能被人看到：每轮把 `wouldMove` 的每人（contact_id、类别、confidence、原因、引文）写入新表 `enquiry_screen_shadow_log`（A 级：新表 + 迁移，service-role RLS 模板）；PM/FDE 在后台能看。**若不想加表，备选：写进 `fde_work_logs`——待审查人定。**
- 每周一份汇总进「今日待办」人工任务（what/how/href 三件套）：「本周模型想挪走 N 人，点这里抽查」。

### 4.4 上线顺序（PM 本人一句话分步）
1. 合并本功能（开关仍关）→ 当场试跑：对 CTS **用测试开关 shadow + `--dry` 手动触发一次完整链路**，拿真实输出（处理几条、几人 wouldMove、回执长什么样）。
2. PM 说「开影子」→ `enabled=true, mode=shadow`，跑 ≥ 7 天，PM 抽查 wouldMove 名单；容忍线 = 0 错筛。
3. PM 说「开改」→ `mode='apply'`。随时可一键回退（v0.3 回退脚本）。

## 5. 风险级别：A
理由：自动改客户状态（数据）+ 调外部模型 + 新增定时写入路径 + 可能新表。走 §4 A 级流程：草稿 PR、子牙+魏征独立审、Claude Code 签 SHA、PM 回「合」。

## 6. 待审查人回答
1. shadow 留痕用新表还是 `fde_work_logs`？
2. 内容指纹去重放哪（新表一列 / 另表）？
3. `MAX_PER_RUN=40`、预览 255 字够不够判中文/混合语言？
4. 抽取脚本逻辑到 `src/lib/` 时，页面基线（enrich → buildPriorityView）一次要拉全量触点（脚本每次拉 1232 人 + 全部触点）——每小时跑是否过重？是否改成「只取候选集」？
5. 是否漏了「同一人换邮箱」「Mailchimp 触点」等 v0.3 已列的准入条件？

## 7. 两审结论与处理（v0.1 新增；子牙、魏征为独立只读审查，均判「不能直接动工」）

**先决条件（做不完不许谈「开改」）——魏征 BLOCKER，已对代码核实：**
| # | 问题 | 处理 |
|---|---|---|
| P1 | v0.3 §5.3.1「判走的人再来真咨询自动回名单」代码里**没有**（`segments.ts:721` 只要阶段被压住就排除；`eligibility.ts:87` 之外没人读「非咨询」）。我原稿写「已实现」是错的。 | 列为 WP-A，先补并加测试；未完成前运行器只能 shadow。 |
| P2 | 回退脚本**不存在**（只有 `actors.ts:47` 的常量）；且回退身份被 `isAutomatedActor` 当机器，下一小时同一人会被再判走。 | 列为 WP-A：写回退脚本；被回退过 / 人工「这是真客人」过的人**永久**不再参加筛选。 |
| P3 | 扫尾都在同一个 `step.run`（`messenger-brief-after-sync.ts:212`，`retries:2`），约 125 秒上限；再加 40 次 Haiku 会超时→整步重试→别的扫尾一起重跑、重复花钱；手动路由与 Inngest 无互斥。 | 运行器**单开一个 step**（约 40 秒预算，到点就停），按客户加并发锁；手动补跑路由跳过这段。 |

**设计修改（吸收两审）：**
1. **取数**：不再每小时全量拉 1232 人+全部触点。先在库里筛候选（阶段属可筛四种、无电话、非勿联系），只拉这批人的触点；传该人**全部邮箱**（不只主邮箱）。
2. **读失败 = 不动**：「我们发出的邮件」读失败不能当空（`contact-enrichment-loader.ts:119-121`），自动运行用严格版，报错则整个客户跳过。
3. **不写死行业/客户**：询价词表按客户行业取，无词表整户跳过；员工名从 `leads_config.enquiry_screen.staff_names` 读，没配则不判；CTS 编号、客户名不进共享代码。
4. **模型失败 fail-closed 且可见**：失败不记指纹、计入 `errors`；用现成 `abortReasonFor` 识别账户级故障（余额 0）→整轮停并写回执；连续失败停本轮。
5. **「打开开关不改人」由结构保证**：`readScreenConfig` 读 `mode`，**仅 `mode==='apply'` 严格相等才写**；「判出名单」与「写库」分成两个函数，写库函数从外部传入；测试断言 shadow 下写库调用 0 次。干跑脚本强制 `enabled:true` 的做法不得原样搬进共享代码。
6. **留痕**：新增一张判定记录表（不用 `fde_work_logs`），字段含 客户/客人/内容指纹/模式/结论/类别/信心分/理由/引文/模型/判定层（规则层或模型层）；(客人, 指纹, 模式) 唯一，**同时解决 shadow 留痕、去重、重试不重复花钱**。写这张表失败 → 该人不记指纹、`errors+1`、本轮标失败。**该表涉及迁移 → 按规矩只能 PM 亲手合并。**
7. **去重含模式**：影子判过的人，切到 apply 后仍可判（去重键带 mode），写库前再核一遍。
8. **写前复核**：`advanceContactStage` 只比阶段；写入前**重新查有无比快照更新的入站记录/人工动作**，有则跳过；写入改为带条件的 UPDATE。
9. **预览截断**：`toScreenTouch` 显式截到前 255 字。
10. 第一层规则直接判走的也要在 shadow 名单里标明「规则层」；「第一封信 vs 最新一封」以代码（按最新一封）为准，本稿改口。
11. 简报整轮中止时扫尾整段跳过（`sweepsSkipped`）→ 回执里必须能看出「本轮因 OpenAI 余额/中止没跑筛选」。

## 8. 拆分（v0.1）
- **WP-A（B/A，先做）**：P1 回名单规则 + P2 回退脚本与永久不再判 + 测试。不接线、不碰运行器。
- **WP-B（A 级，含新表迁移，PM 亲手合）**：判定记录表 + 运行器（单 step、候选先筛、严格读、shadow only）。开关仍关。合并后当场手动触发一次 shadow，贴真实回执。
- **上线**：PM「开影子」→ ≥7 天抽查（错筛容忍 0）→ PM「开改」。
