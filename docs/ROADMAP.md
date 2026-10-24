# Magic Engine — Roadmap（未完成事项）

> 最后整理：2026-08-01（并入 main 一周新增）· **本文件只留未完成的事**（162 条）。
> 已上线的功能见 [history/CHANGELOG.md](./history/CHANGELOG.md)。
> 系统当前跑着什么见 [STATE.md](./STATE.md)。架构决策见 [DECISIONS.md](./DECISIONS.md)。
> 完整历史底稿（含 344 条已完成 + 全部 Phase 背景）：[archive/ROADMAP-full-2026-07-25.md](./archive/ROADMAP-full-2026-07-25.md)

**新增任务的规则**：先登记到本文件，再写代码。完成后从本文件删除、追加到 `history/CHANGELOG.md`。commit 带 Phase ID，如 `feat(ads): xxx [P18.B.1]`。

> ## 🔴 Roadmap 全局约束：Reuse First / Platformization
>
> 本文件**所有未完成事项**都受 [ME2 Reuse & Platformization Principle](./roadmap/2026-08-19-me2-platformization-principle.md) 约束。真实客户与 Customer Zero 用来验证平台能力，不得默认演化成客户特供系统；未来 **ME Real Estate / ME Travel** 等垂直版本必须建立在同一共享底层上。
>
> **开工顺序固定**：`Repository Fact Gate → Domain Semantics Gate → Product Gate → Architecture / Reuse Gate → GO BUILD`。
>
> - Current State Audit 第一行必须报告 `remote fetched at + exact main SHA`；没有 SHA，审计不成立。
> - 复用 shared Module / Capability 前必须检查内部语义是否仍 hard-code 首个客户/行业；接口参数化不等于语义通用。
> - 默认共享 Capability、Adapter / Connector、Kernel、Measurement/Growth Contract、Verification / Attribution / Flywheel 与可安全泛化的 Learning / Memory 机制。
> - 行业差异进入 Playbook / Profile / Policy；客户差异进入 configuration / approved evidence / client-private memory。
> - 每个有实质产出的交付必须附 **Reuse Statement**：说明复用了什么、哪些是 platform-shared / industry-specific / client-specific，以及有没有客户名、客户 ID、行业规则或客户私有事实进入 shared runtime。

---

## Agent 自治运行计划 v1 —— 14 个 agent 从「等派活」改成「目标 + 闹钟 + 待办署名」（PM 2026-09-24 拍板，文档 PR #1985 已合并）

计划全文：[`docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md`](./specs/2026-09-24-agent-autonomy-operating-plan-v1.md)。达芬奇已撤（7 问并入 `docs/agents/10-ziya.md` §四b）。**仅 B1 / B2 这两批**由 DeepSeek 执行、Claude Code 统筹复审（PM 2026-09-24 指定）；其他任务的写入者仍按 CLAUDE.md §5 协作规则按任务能力分配。

| 批 | 内容 | §11 打分 → 优先级 | 风险级 | 状态 |
|---|---|---|---|---|
| B1 广告 WP3 | Inngest 链、孔明预检 + denied 恢复点、韩信、Check/Tune、Jev、五段日报、`autonomy_mode`↔`client_automation_policies.mode` 同步设计、G11 熔断落点确认 | 高/高/高 → P0 | A | 已派 ME 广告构建控制（合同待开）；设计与实施各一次 子牙+魏征，狄仁杰看同步开关 |
| B2 三只闹钟 | 马良出片自动 9 宫格自检 · 李白逐句溯源 + 月度提示词体检 · 司马迁周四读评价起草不发 | 中/中/中 → P2 | B | 已派 ME 2.0 构建控制；只写 pm-todo 三件套，避开周五六 |
| B3 审查自动被叫 | 接线 `tools/ops-review-loop/src/risk.mjs` → PR 事件 → 自动分派魏征/狄仁杰/板桥 | 高/中/低 → P2 | A（碰 workflows） | PM 2026-09-25「分两档」插队：定级接线 + B/C 自动合 + A 级签字闸已派 ME 2.0（合同 A 级，DeepSeek 执行）；三人签字的自动写入仍待广告跑稳两周后开 |
| B4 板桥待办人话闸 | 今日待办条目先过板桥改人话 | 高/中/中 → P2 | B | 待广告跑稳两周、且 B2 后再开 |
| B5 孔子 SEO 笼子 | 给 SEO 改文案划「不问就能做」范围 | 广告跑稳两周后再打分 | A | 未开工 |

红线不放宽：发布 / 口碑执行 / 花钱类无 PM 授权不做；事实服务端读；读不到 = 不动；每动作有回执与撤回。

## `meta-leads-sync` 每一轮都标红，「红了」这个信号已经不携带任何信息（2026-09-24 查实，P0）

**§11 打分**：频率高（每 2 小时一轮，轮轮红）· IMPACT 闭环关键度高（Measure 段，报警器焊死在响，真出事分不出来）· 收入关联度高（这个报警器的职责就是发现线索断供；2026-08-21~08-30 同一个报警器失灵时 CTS 漏了 45 条线索）→ 零个低、三个高 → **P0**。

- **现象**：`cron_run_logs` 里 `meta-leads-sync` 最近每一轮 `status='failed'`。根因不是 CTS —— 是 Magic Lab Class（`377468af-…`）和 New Asian Logistics（`4ae76381-…`）两个客户的主页令牌缺 `pages_read_engagement` 等权限，`leadgen_forms` 每轮回 HTTP 400 code 190。
- **为什么会染红整轮**：`api/cron/meta-leads-sync/route.ts` 只要有任一客户 `error` 就把 `summariseSyncProblems` 传给 `finish()`，`run-logger.ts` 见到 error 就把整轮标 `failed`。
- **要做什么**：`run-logger.ts` 记的 `status` 必须如实反映这一轮真实取数是否成功——**不能**因为「这个权限错误不是本轮新增的」就不传 `error`，让 `finish()` 把持续故障写成 `completed`：现有健康待办只看最近一轮的失败状态生成 `cron_failing`，一旦这一轮伪装成功，两个客户仍在断供的事实会从标准健康监控里彻底消失，重演 2026-08-21~08-30 那次线索断供却看着正常的事故。真正要改的是**下游**：把「取不到线索」和「出口有问题」分开决定 `status`，在通知 / 健康待办层给同一个已知权限错误去重，或者新增一个 `degraded`（持续故障但非新增）状态单独告警——而不是靠错误新旧程度篡改这一轮的成败。
- **顺带**：那两个客户的令牌权限本身也要么补齐、要么正式标成停用，不能一直挂着每轮报错。
- 来源：PR [#1973](https://github.com/bigbigraydeng-maker/magic-engine/pull/1973) 复审过程查实（魏征）。

---

## 线索去重闸的两条后续（PR #1973 合并时明确留下，2026-09-24）

PR #1973 给 Meta 留资同步加了「上一轮已办完就别重跑」的闸。Codex 复审提的两条 P2 当时没改（Ray 已按当时 head 授权合并，新增提交会作废环境审批），在这里记账：

1. **settled 判据没绑定当前 audience / tag**（`lib/mailchimp/outlet-tally.ts` 的 `isMailchimpSettled`）。FDE 通过 `/api/clients/[id]/leads-config` 换了 audience id 或来源标签之后，回看窗口里那批已判 settled 的 lead 不会被推进**新**名单 —— 改动前它们会在 24 小时内被重新处理一次。
   - 修法：把本次实际用的 `audienceId` + `tag` 一起写进 `metadata.mailchimp_result`（`crm/meta-lead.ts` Phase D），`isMailchimpSettled` 收一个期望配置参数，配置对不上就不算办完；历史回执缺这两个字段 → 判不成 settled → 部署后窗口内每条多跑一次然后收敛，自愈。
   - **要动 `crm/meta-lead.ts` 的回执形状**（#1973 刻意一个字没动那个文件，那里带着合同 5425312107 / 5426843158 两份条款），按 A 级另走一轮设计 + 实施复审。
2. **`settledLookupFailures` 没有消费者**。这个数已经进 `cron_run_logs.summary`，但没有任何告警在读它，所以「去重闸瞎了」目前只能靠人工查（已加 2026-09-26 的日历）。
   - 修法：在 `pm-todo/manual-monitoring-items.ts` 加一条**独立**判据（不要复用 `isMailchimpExportFailureKey`，那是邮件出口的词汇表），`settledLookupFailures > 0` 时下发待办，带上客户和轮次。
   - 后果有限：闸瞎掉只是退化成改动前每轮重打，不丢数据、不丢线索，白花 provider 调用。

---

## 台账证据文件没有任何格式或敏感信息检查（2026-09-26 查实，P3）

`src/lib/ledger/load.ts:15` 用 `readdirSync(dir)`（不递归）再只留 `.md`，`docs/ledger/evidence/` 子目录整个被跳过，所以 `parse.ts:137` 那条「10 位以上连续数字」之类的检查对证据文件完全不生效；证据文件目前只有 `ledger-check-refs.sh` 查它存不存在。证据文件由夜巡和各窗口核验时写入，内容来自生产取数，是最可能混进账户号 / 客户私有数据的地方。

- **要做什么**：给 `docs/ledger/evidence/**` 单独加一道检查（至少：长连续数字、邮箱 / 电话形态、令牌前缀），不要把证据文件塞进台账卡的完整格式解析（格式不同）。主页 ID 这类公开标识要不要豁免，实现时再定。
- **§11 打分**：频率低（证据文件只在夜巡与偶发核验时写）· IMPACT 低（不在客户闭环内）· 收入低（迄今未发现客户数据入库）→ 三个低 → **P3**，待认领。
- 来源：CRM 窗口 2026-09-26 准备 NAL 止血快照时查实。

---

## Facebook 表单勾的「我不要收邮件」走不到 Mailchimp 的抑制标签（2026-09-24 查实，潜在，迄今 0 次，P3）

一个人被订阅进 Mailchimp 之后**才**被判成 opt-out 时，`crm/meta-lead.ts` 会把触点回执从 `subscribed` 覆盖成 `skipped:explicit_opt_out`、并写上 `do_not_contact: true`；结果本地证据被改写成「没进名单」。**这不是 `src/lib/mailchimp/` 缺能力**——`api/cron/mailchimp-suppression-sync` 每天跑一次，职责就是把 CRM 判过的「别再联系」同步成 Mailchimp 的 `suppressed_do_not_email` 标签，`lib/mailchimp/suppression-sync.ts` 复用的正是 `crm/dnc.ts` 的 `isDoNotContact()`。真正的缺口在这条管道自己的取数：`api/cron/mailchimp-suppression-sync/route.ts` 的 `loadContactsForClient()` 查 `contact_touchpoints` 时只把 `metadata.outcome` 映射进 `DncTouch.outcome`，从没把同一条触点的 `metadata.do_not_contact` 映射进 `DncTouch.flagged`——所以 `crm/meta-lead.ts` 写下的这条 opt-out 触点，`isDoNotContact()` 永远看不到，人也就不会被这条每日 cron 打上抑制标签。
- **要做什么**：修 `loadContactsForClient()`，把 `metadata.do_not_contact === true` 一起映射进 `flagged`，复用并扩展这条已有的每日抑制管道——**不要**另起一套退订 / 归档写路径，否则会跟这条管道形成两个不一致的 DNC 出口。
- **§11 打分**：频率低（生产核对 `metadata->>'do_not_contact' = 'true'` 命中 **0 条** —— CTS 现在的表单根本没有这个勾选项，要先有客户加上才可能发生）· IMPACT 闭环关键度中（不卡 Act，是合规口子）· 收入关联度低 → 两个低 → **P3**。埋着的雷，不是正在漏水的管子。
- **不要据此以为「说过别联系的人在继续收信」** —— 那条链是通的：抑制管道每天正常跑（2026-09-23 扫 CTS 947 人、26 人已带 `suppressed_do_not_email`），**且 PM 2026-09-24 确认 CTS 发群发时已经把这个标签排除掉了**。电话 / 邮件笔记那条路进来的拒联，标签打得上、群发也确实躲开了。断的只有表单勾选这一条支路。
- 涉及合同 5426843158。来源：魏征复审 PR #1973；口径经 PM 2026-09-24 确认后收窄。

---

## 26 个带抑制标签的人不被打扰，只靠 Mailchimp 后台一个人工排除设置顶着（2026-09-24 记，P2）

`suppressed_do_not_email` 是个**标签**，标签本身不拦邮件 —— 只有在建群发、挑收件人那一步把它排除掉才生效。那一步是 Mailchimp 后台的手工设置，**代码层面没有任何东西能拦住**：谁哪天新建一封群发忘了加排除，26 个带这个标签的人当场全收到，而且没有任何告警。

- **26 人不是清一色「明确说过别联系」**：`suppression-sync.ts:13-15` 打这个标签的口径是 `not_interested`（终结性销售拒绝——`note-parser.ts:28` 判的是「聊过了，明确不要了」，跟只是暂缓的 `not_interested_now` 不是一回事，且 `suppression-sync.ts:22-24` 明确写了它没有撤销机制——但不等于明确禁止联系）∪ `do_not_contact`（真正说过别再联系）的并集，而 `note-parser.ts:306,322` 会把 `not_interested` 显式记成 `do_not_contact: false`——两者语义不同。26 人里各占多少目前没有分开统计过，本条先按「带抑制标签」记账；后续如果要按拒联严重程度调整优先级或推「永久移出名单」的方案，必须先分别查出两类人数，且永久移除只能基于真正的 `do_not_contact` / 退订信号，不能把「明确不要了」当成「明确禁止联系」处理。
- 现状：PM 2026-09-24 确认当前的群发已经排除了。所以这不是一个正在发生的故障，是一个**单点人工依赖**。
- **§11 打分**：频率中（每建一封新群发就赌一次）· IMPACT 闭环关键度中（不卡闭环，但会让一次外发变成合规事故）· 收入关联度中（NZ 反垃圾邮件法 + 客户信誉）→ 零个低、零个高 → **P2**。
- **可能的修法**（未拍板）：发信前用 Mailchimp 接口把这封群发的目标收件人核一遍，发现里面有带抑制标签的就拦下并下发待办；或者把真正 `do_not_contact` 的人从名单里移出去（但那要先想清楚「移出去之后怎么恢复」，`lib/mailchimp/client.ts` 开头那条「只 POST 不改会员状态」的红线是有理由的；`not_interested` 不适用「移出名单」，那类人是终结性销售拒绝，不等于明确要求别联系）。
- 来源：PM 2026-09-24 确认排除设置存在时，顺带发现这条链依赖的是人不是代码。

---

## CTS 表格「员工跟进记录」换过列，转化回传那条线一直在读旧列（2026-09-24 查实并已修，记账用）

**背景**：CTS 员工的电话跟进记录，表格第 505 行（含）以前写在 R 列，第 506 行起改写在 S 列（R 被拿去放 Facebook 后台链接）。`conversions/cts-crm-sheet-sync` 的 `parseSheet1Row` 恒读 R 列，于是 506 行之后的记录一个字都没读到。

- **实际影响（已量化）**：`notesExcludeLead`（把「wrong number」「not interested」的脏线索挡在 CAPI 回传之外）原来判出 55 行该排除，修好之后是 67 行 —— **12 行本该排除的脏线索之前被当成合格线索传给了 Meta**。
- **已修**：列判据收敛成 `ctsNoteColumnIndex(sheetRow)` 一处，`parseSheet1Row` 改成必须传行号（不给默认值，逼调用方想清楚）。两个消费方（转化回传 / 表单线索汇总信）共用这一份。
- **还没做**：那 12 条已经传出去的脏转化没有撤回，也没评估过对 Meta 优化模型的影响。量很小（占已传总量极小比例），**先记在这里，不单独开工**；下次碰转化回传时一起看。
- 来源：PR「客人填了表还没人回」查证过程，2026-09-24。

---

## Meta AI 客服的自动回复被当成「我们联系过了」，把新线索从「今天要联系」上挤掉（2026-09-24 查实，A 级，P0）

**§11 打分**：频率高（每天都在发生 —— CTS 最近 30 天 259 条表单线索里 116 个人被这样挤掉）· IMPACT 闭环关键度高（卡在 Act：人进来了、系统认为已处理、于是没人去打这通电话）· 收入关联度高（客人留了电话没人回 = 直接丢单）→ 零个低、两个以上高 → **P0**。

- **现象**：CTS 表单线索进 CRM 之后，Meta 自家的 AI 客服会在几分钟内自动回一条。这条回复写成 `contact_touchpoints`（`channel='messenger'`, `direction='outbound'`, `source='messenger'`, `raw` 恒空），跟一通真人回复在库里**长得一模一样**。`crm/segments` 的 `segmentContact` 只看 `lastOutbound > 0`，于是这个人不再是「新客人，还没打过」，被冲进 `stale_conversation` / `retry_channel` 埋掉。
- **证据**：`conversation_messages` 里 CTS 2026-09 的 messenger 外发原文，最多的三条是「你的 AI 客服将会回复。」（86）「你已接管 AI 客服的这场聊天。」（40）「你的 AI 客服已将这个聊天转移给你。」（24），其余多为欢迎语和节日群发模板。生产核对：30 天 259 条线索，160 个在系统眼里「已联系」，其中 **116 个唯一联系过他们的是机器人**。
- **🔴 一个想当然的修法先排除掉**（子牙复审 2026-09-24）：「在 `messenger/sync.ts` 写触点时按消息正文标 `metadata.automated`」**做不出来**。Messenger 出站触点是**一个会话一行**，不是一条消息一行（`messenger/link-contacts.ts` 的 `source_ref = <convId>:out`，`messenger/send.ts` 销售手动回复写的是同一个键的同一行）。AI 客服 10:00 自动回一条、真人 15:00 回一条，库里只有这一行——标了就把真人那次也抹掉，不标等于没修。照这句去做的人会先写完代码才发现打不通。
- **两个真能做的修法**：
  1. **拿 `conversation_outbound_log` 反查**（推荐）。那张表记着每一条 **ME 自己发出**的消息（`messenger/send.ts` / `microsoft/mail-send.ts` / `inngest/functions/conversation-inbound-autoack.ts` 都在写），拿它判「这个会话里有没有一条出站是真人经我们系统发的」，比猜正文硬得多。代价：多一次查询；不动写入侧、不影响任何现有统计。
  2. **拆键**：出站触点分 `<convId>:out`（真人）和 `<convId>:out-auto`（机器）两行。代价：所有按触点条数做的聚合要同步改（`link-contacts.ts` 注释点名的那类），并且要回填存量（改客户数据，需 PM 单独授权）。
- 两条路都要注意：「你已接管 AI 客服的这场聊天」反过来是**真人介入**的正信号，别一起标成机器。
- **改完要一起撤掉的权宜之计**：`crm/lead-followup-due` 的 `isHumanFollowup` 现在把 Facebook 私信外发**整类**排除，`crm/lead-followup-digest` 的正文里也为此写了一段「为什么这个名单比后台那一页长」。根子修好之后这两处一起收回，否则两个地方对「联系过了没有」长期给不同答案（同 2026-09-22 广告看板 D5/O3 的坑）。
- 来源：PR「客人填了表还没人回 —— 每天提醒一次」查证过程，2026-09-24。

---

## 「填了表没人回」汇总信转发给客户销售之前，必须先补提醒节奏（2026-09-24 复审提出，P2）

**§11 打分**：频率中（只在这封信真的转给客户销售之后才天天发生，现在只发到 ME 自己信箱）· IMPACT 闭环关键度中（不影响判据对错，影响人会不会继续看这封信）· 收入关联度中（信被当噪音忽略 → 线索照样没人回）→ 零个低、零个高 → **P2**。

- **现象**：`crm/lead-followup-due` 排序是「等最久排最前」再切 15 条，所以每天早上是**同一批最老的 15 个人**，一直到他们掉出 7 天窗口（约 6 天）、然后彻底沉进积压数字里再不出现。没有任何「已经提醒过了」的台账。
- 现在收件人只有 ME 自己，看几天就知道准不准，无害。**一旦按计划转给客户的销售，那就是连续 6 天同样的名单、之后永久静音** —— 销售会先烦、再无视这一栏。
- **修法**：接 `src/lib/pm-todo/remind-cadence.ts`（已有的两段式节奏，且明确避开 7 的倍数），并参照 `pm-todo/manual-crm-items.ts` 的做法，在生成名单的那一刻按当前状态再过滤一次，做到「有人处理完就不再冒出来」。
- 同批还要一起做的两件（写在 `crm/lead-followup-digest.ts` 文件头 1b 条）：`interest` 之外的自由文本脱敏复核；正文里「直接回复这封邮件告诉我们」要换成一个真能点的入口，否则就是「下发给人的任务做不到」。

---

---

## 线索同步到客户 Google 表格：上线前还差几步人工动作（2026-09-24 最终改为「写老表」，B 级，P1）

**§11 打分**：频率高（每天都有新线索）/ IMPACT 闭环关键度高（卡在 Act，线索进不了销售手上）/ 收入关联度高（留了电话没人跟＝丢单）→ 零低、三高 → **P0**（代码已交付，剩下的人工动作按 P1 挂着）。

代码已在 PR #1972（`src/lib/lead-sheets/` + `client_lead_sheet_routes`）。2026-09-24 当天 PM 改口三次，**最终口径是第三次**：
「不要过度开发，就按照 fb 默认的表格式，把几个 form 的信息拉齐到一张 form 上」——
也就是**写客户一直在用的那张老表**（`FB 即时表单 Infrontof2000` / `Sheet1`，
`1vISaVkVkcQMSaR6Jo7xdmym6Ed5eE-q9025snYWYDVA`），保持 Facebook 原样的 32 列，
只在表尾追加两列给 v4 表单多问的两个问题。**不新建表、不翻中文、不合并列。**
前两版（分两张表 / 汇总进一张新建的 13 列中文表）作废。

**这条链路现在一行也写不进去**，还差：

1. **在 Sheet1 表尾加两列**（第 33、34 列 = AG / AH），表头逐字写 `when_are_you_hoping_to_travel?` 和 `whats_your_budget_per_person_nzd?`（Facebook 原字段名，不要翻中文）。
   🔴 **必须加在最右边**：下面那两条下游读的是固定列下标，中间插一列会让它们整体错位。
   排错了不会闷声错位——配置里带了一份 34 格的「表头签名」，系统开工前逐格比对，对不上就整轮停手并出待办。
2. **CTS 的 Google 连接要重新授权一次** —— 现有令牌只有「看表格」的权限。写权限 `spreadsheets` 早在 #1972 就合进 `COMBINED_GOOGLE_SCOPES` 了，本次没再改 scope；已经连过 GSC/GA4 的客户不会因此掉线，只是拿不到新权限，而需要写表格的只有 CTS。走一次
   `https://app.magicengine.com.au/api/auth/google/connect?client_id=c0000000-0000-0000-0000-000000000000&flow=admin`，在同意页上勾「查看、修改 Google 表格」。
3. **两个 migration + seed SQL 还没 apply**（`supabase/migrations/20260925000003_client_lead_sheet_routes.sql` · `…000004_client_lead_sheet_routes_header.sql` · `scripts/seed-cts-lead-sheet-routes.sql`），按规矩等 PM 显式 go。
4. **合并后去 Inngest 后台对 `/api/inngest` 点一次 Sync**，否则新函数安静地不跑。

### ✅ 「切表会打断两条下游」这条风险随这次决定消失了

`src/lib/conversions/cts-crm-sheet-sync-run.ts`（读表取成交喂广告回传）和
`src/lib/crm/sheet-followup-sync.ts`（读员工跟进记录回灌 CRM）都把这张表的 id 写死在代码里。
上一版切到新表会让它们安静地停在切表当天、日报还是绿的。**现在不切表，这个风险不存在**，
两条下游一行都不用改。`CLIENT_FOLLOWUP_SHEETS` 跟 `client_lead_sheet_routes` 指的是同一张表、
同一个 tab，两处配置重复这条**降回普通欠账**（待认领，见下）。

### 待 PM 决定的两件事

- **旧表上那条外部管道要不要停。** 这张表每天还在进 7–16 行（带着 ME 库里没有的广告组名/系列名/表单名，几乎可以肯定是客户自己账号里的 Zapier/Make）。ME 现在的定位是**补漏安全网**：先读表 → 已有的跳过 → 只补它漏掉的。实测 2026-09-20 以来库里 26 条线索，那条管道写进去了 23 条，漏的正好是 v4 表单那 3 条（它一条 v4 线索都没进过表）。两者并存不会写重（判重靠第 1 列的 `l:` 线索编号），所以**不急**；要不要让 ME 接管，PM 拍。
- **补档窗口要不要往前调。** 现在卡在 `2026-09-20`，开闸第一轮只会追加 3 行（就是那 3 条 v4）。2026-07-24 ~ 2026-09-20 这一段往前调是安全的（全是真线索编号，判重挡得住重复）。
  🔴🔴 **但 2026-07-24 之前调不得**：库里 735 条线索有 **347 条的 `source_ref` 不是 Facebook 线索编号**，而是历史导入时拼的 `邮箱|时间戳`（如 `dave.attwell@outlook.com|2026-06-14T...`），全部落在 2026-06-14 ~ 2026-07-25。往前调会（a）在第 1 列写出邮箱、（b）机器键永远对不上 → **那 347 个人在销售正在用的表上被重写一遍**。要补这一段得先把 `contact_touchpoints.source_ref` 回填成真编号，不是改个日期的事。

**已知留白**（不是 bug，是如实留空）：
- `form_name`（第 10 列）**必然是空的** —— `leads.ts` 本地没有表单名缓存，一律留空。表单编号在第 9 列，认得出是哪张表单。
- `lead_status`（第 17 列）、员工跟进记录 / Many Chat / 邮件追踪那一片（第 18–32 列）一律留空 —— 别的管道和员工手工维护的，这条链路只 append 不覆盖，碰不到已有内容。
- `inbox_url`（第 32 列）留空，**这是一个留给 PM 的问题**：线索的问答里带着一个叫 `inbox_url` 的字段（Meta 原样给的），v3 表单上是真的 Messenger 会话链接，可 v4 那三条的值是「Nil」「What answer」「the right itinerary」，像是 v4 建表单时把它改成了自由文本题。表里现有 703 行这一列全是空的，本轮跟现状保持一致。

**待认领欠账**（都不致命，不挡合并）：

1. **`src/lib/lead-sheets/` 名字是「线索」，实际只吃 Meta 即时表单。** `leads.ts` 把 `.eq('channel','meta_lead_form')` 写死在共享层。第二个客户的线索如果来自官网表单或 GHL，这个模块要改代码。两条路二选一：目录改名点明 meta-lead；或给路线表加一列 `source_channel`（默认 `meta_lead_form`）由取数层读。
2. **`CLIENT_FOLLOWUP_SHEETS` 是同一张表的第二套配置。** 现在两处都指向同一张表同一个 tab，不会打架，但改表 id 要记得改两处。收编进 `client_lead_sheet_routes` 是正事，不急。
3. **347 条历史线索的 `source_ref` 不是真线索编号**（见上）。修它才能补 2026-07-24 之前的历史。

另外两条小的：`registry.ts` 里这条的 `schedule` 是手抄的，`registry.test.ts` 没有对它做「跟函数定义一致」的断言（漂移了 CI 不会红）；`leads.ts` 回查广告组/系列名字时把 `ad_entity_snapshots` 的全部历史快照分页拉回来，只为取一个名字，每小时一次的无谓开销。

## Meta / TikTok / 商家页的授权只能靠状态位判断，没有心跳（2026-09-24 断线监控上线时留下的口子，P1）

**§11 打分**：频率低（目前没有「状态位是绿的、实际却不通」的 Meta 实例证据；已知那几次断线状态位都变了，新上的监控抓得到）· IMPACT 闭环关键度高（广告的 Act 和 Measure 都靠它）· 收入关联度高（客户投诉/续费直接相关）→ 恰好一个低、两个高 → **P1**。

**现状**：2026-09-24 上线的断线监控（`src/lib/platform-oauth/connection-health.ts`）对每个平台分两种判法 —— 微软邮箱和谷歌取数有「心跳」（每次成功刷新令牌会盖 `last_synced_at`，有固定节奏的定时任务在调），Meta / TikTok / 商家页 / 谷歌广告 / GTM **没有**：`token-manager` 里压根没有 Meta 和 TikTok 的刷新实现（用的是长期令牌），商家页只在有人发帖读评价时才刷。所以这几个平台目前只有「状态位不是 active」这一条判据。

**口子在哪**：如果一条 Meta 授权实际已经不能用、而平台又没让我们撞到那个会改状态位的报错，监控看不出来。

**要做的**：给这几个平台找一条真正的「最近一次成功调用」的证据 —— 要么在调用方成功后主动盖 `last_synced_at`（最小改动），要么按平台各自的数据落地表定义新鲜度探针。做之前先确认节奏：没有固定节奏的平台加了心跳只会天天误报，那比没有更糟。

---

## AI 可见度周快照聚合把失败的 API 调用也计入总数，客户分数被系统性腰斩（2026-09-23 两位复审确认，A 级，P0）

**§11 打分**：频率高（每周每个客户都在发生，生产数据 CTS 9-14 那周 221/408 次失败混入分母）· IMPACT 闭环关键度高（分数直接喂进下一轮处方，算低等于给错建议）· 收入关联度高（影响客户可见诊断报告的核心维度分数）→ 零个低、两个以上高 → **P0**。

- **背景**：`ai-tracker/orchestrator.ts` 的 `aggregateSnapshot` 拉本周 `ai_visibility_runs` 时不排除 `error_message` 有值的行，失败次数计入 `total_runs`，`mentionRate = mentions_count / total_runs` 的分母被撑大。CTS 9-14 那周落库 23.3%，真值 50.8%。
- `ai-visibility-collector.ts:93` 看到 `mentions_count === 0` 就直出 critical「Brand Not Mentioned by AI」，不检查这些 run 是否真的测到过——这跟 PR #1919 修的实时探测是同一类 bug，走了快照这条管子。
- **修法**：`aggregateSnapshot` 过滤 `error_message IS NULL`；给快照补 `failed_runs` 列；collector 的 `mentions_count === 0` 分支加 guard。
- 见 PITFALLS D12 补充段。

---

## 行业 AI 可见度采集 · 除奥克兰外所有城市的问题 100% 采不到数（2026-09-23 查实根因，P1）

**§11 打分**：频率高（每天跑，每天所有非奥克兰城市的问题全军覆没，自 09-10 至今没有一天例外）· IMPACT 闭环关键度高（Measure 段给的是空数据，行业基线的城市维度整片缺失，下游 AI 可见度分数因此长期算不出来）· 收入关联度低（目前没有活着的客户目标在读这个分数，两个历史 goal 都已归档/过期，也没有客户投诉）→ 恰好一个低、两个高 → **P1**。

- **现象**：`industry_ai_visibility_snapshots` 里 `error_code = 'dataforseo_error'`，报错原文 `DataForSEO SERP task 40501: Invalid Field: 'location_name'`。自 2026-09-10 起累计 390 条 × 2 个平台（`google_ai_overview` 和 `google_serp` 共用同一次调用，所以一炸炸两个）。
- **规律非常干净（已在生产库逐城核对）**：`auckland` 100% 成功；`brisbane` / `sydney` / `melbourne` / `perth` / `adelaide` / `gold-coast` / `christchurch` / `wellington` / `queenstown` **100% 失败，一条都没成功过**。`geo_scope='national'` 的问题完全不受影响。
- **根因位置**：`src/lib/dataforseo/serp.ts` 的 `CITY_DISPLAY_NAME`（约 68–85 行）。城市位置是拼成 `location_name = "{城市},{国家全名}"` 发出去的，例如 `"Brisbane,Australia"`——供应商不认这个写法。奥克兰能过，说明只有它恰好命中了供应商的合法名称。
- **为什么 2026-09-23 这一轮没有顺手修**：要改就必须先拿到供应商认的城市全名到底怎么写，而当时的工作目录拿不到它的账号密码（`.env.local` 复制被权限拦下），改了也验证不了。按「没真跑过的不许说成功」，只登记不动手，不猜着改。
- **接手的人怎么做（三步，不用问人）**：
  1. 用 DataForSEO 账号调它的位置清单接口 `POST /v3/serp/google/locations`（这个接口**不收费**），把返回里 `location_name` 含上面这些城市的条目捞出来，看它到底要求写成什么（很可能是带州/大区的三段式，例如 `"Brisbane,Queensland,Australia"`，但**必须以接口返回为准，不要照抄这个猜测**）。
  2. 按接口返回改 `src/lib/dataforseo/serp.ts` 的 `CITY_DISPLAY_NAME`（或改成直接用供应商的 `location_code`，比字符串更稳）。
  3. 逐个城市真发一次请求确认不再报 40501，再看第二天的采集里这些城市的行 `error_code` 是不是变成了 `null` 或 `no_ai_overview`。**回执全绿不算数，要看到真数据落库。**
- **连带影响（已在 [PR #1928](https://github.com/bigbigraydeng-maker/magic-engine/pull/1928) 里挡住，不会再出错数字）**：这个故障让每天的采集覆盖率长期掉到 40%~50%，所以修好之前，AI 可见度分数会经常正确地返回「算不出来」而不是一个数。**这是预期行为，不是新 bug。** 覆盖率恢复到 60% 以上就会自动恢复出分。

---

## 行业 AI 可见度采集 · 2026-09-23 当天一行数据都没写进去（2026-09-23 发现，待查）

**§11 打分**：频率未知（只观察到一次，需要看是不是每天都这样）· IMPACT 闭环关键度高（整个 Measure 段当天空白）· 收入关联度低（同上，没有活着的客户目标在读）→ 一个低、一个高、一个未知 → 暂按 **P2** 记，查清频率后重定。

- **现象**：2026-09-23 05:30 UTC 查生产库，`industry_ai_visibility_snapshots` 的 `max(collected_date)` 还停在 `2026-09-22`，当天 0 行。而这个采集的定时任务排在 02:30 UTC，三小时前就该跑完了。
- **注意**：9-21 只采了 25 个问题（正常是 78 个），9-19 采了 54 个——说明「没跑完」不是第一次，只是以前没被发现。
- **第一步查什么**：看 `industry_ai_visibility_runs` 表里 2026-09-23 有没有 run 行、状态是 `running` 卡住还是 `failed`；再看 Render 上 `industry-ai-visibility-daily` 这个定时任务当天的日志。
- **跟 AI 可见度分数算不出来的关系**：当天没有数据 → 新鲜度闸门直接拦下 → 所有客户的 AI 可见度分数返回「今天还没刷新」。这跟上面那条城市 bug 是**两件独立的事**，都会导致算不出分，别只修一个就以为好了。

---

## Kernel 认领执行权函数字段歧义 bug 已修复、代码已合并 main，生产数据库还没真正应用（2026-09-23 发现并修复，P0）

**§11 打分**：频率高（这个数据库函数每次被真实调用都会报错，不是偶发）· IMPACT 闭环关键度高（卡在 Kernel「提交动作 → 认领执行权」这一步，是所有走 Kernel 执行的能力共用的入口）· 收入关联度高（已上线的 `page.apply_optimization_request` 页面优化 PR 提交能力也共用这两个函数）→ 零个低、两个以上高 → **P0**。

- **背景**：`kernel_claim_or_takeover_run` 和 `kernel_claim_run_step`（`supabase/migrations/20260808000003_me2_execution_kernel_v1.sql`）各有一处 PL/pgSQL 裸列名歧义（`RETURNS TABLE` 输出列名跟被更新的表列名撞名），Postgres 默认设置下直接拒绝执行，报 `column reference is ambiguous`。这不是偶发，是这两个函数每次真被调用都会炸。
- **已完成**：修复已写成新 migration `supabase/migrations/20260923000000_kernel_fix_ambiguous_column_refs.sql`，本地 Postgres 沙盘真跑验证过（含负对照：换回原版定义精确复现报错、换回修复版恢复正常），经子牙 + 魏征两个独立复审都通过，[PR #1905](https://github.com/bigbigraydeng-maker/magic-engine/pull/1905) 已合并 main（`758675f`）。
- **还没做的（需要 PM 显式点头才能做）**：
  - [ ] 把这条 migration 真正 `apply` 到生产 Supabase 数据库——合并到 main 只是代码进了仓库，**不会**自动跑数据库结构变更，这一步需要 PM 明确说"去 apply"才能做。
  - [ ] 有生产库权限的人确认这个 bug 是否已经在生产复现：查生产 `action_runs` 表里有没有真实成功从 `queued`/`authorizing` 推进到 `authorized`/`running` 的记录，如果一条都没有，说明「提交动作 → 认领执行权」这条链路可能从上线到现在一次都没真正跑通过。

---

## CTS 每日广告日报定时任务 · 权限模式不固定，摊上"要问人"那天会无人值守卡死（2026-09-22 排查，已部分修复，P3）

**§11 打分**：频率高（每天一次）· IMPACT 闭环关键度低（只影响内部日报，不卡广告投放本身的 Act 动作）· 收入关联度低（无客户投诉/续费风险）→ 两项低 → **P3**，已修复一半，剩下的登记待认领。

- **现象**：`~/.claude/scheduled-tasks/cts-daily-ads-report/SKILL.md`（不在本仓库，是本机定时任务配置）第一步要读本地 `.env.local` 拿 Render 的接口令牌、再查 Meta 广告数据，2026-09-21～22 出现两次异常：一次卡了 35 分钟才拿到数据（且拿到的是空文件，靠模型现场重新摸索出 Python 脚本才补救成功）；另一次挂起 4 分多钟毫无进展，靠人手动叫停。
- **根因 1（已用命令层面绕开，未根治）**：直接 `grep`/`cat`/`Read` 读 `.env.local` 会被全局安全规则秒拒（预期行为，绕不过去也不用绕）；但换一种不在这条任务"已批准命令"名单里的写法（比如把读文件和调用接口合成一条 `curl`），如果这次任务运行摊上的是"敏感操作要问人"这种权限模式，就会卡住等一个没人在场点的审批。查了这条任务最近 8 次真实运行记录（2026-09-17～09-22），权限模式在"全自动不问人"和"要问人"之间来回切换，不是固定的——目前没找到能通过工具接口把它锁死成"全自动"的办法，只在 App 里那条任务自己的设置页面里可能有这个开关，需要 PM 找一下并锁定。
- **根因 2（已修复并现场验证）**：即便摊上"全自动"模式，原来的查询命令用 `curl -s -o file` 会把请求失败悄悄吞掉、写出一个空文件却不报错，等于"看起来跑完了，其实什么也没查到"。已经把 `SKILL.md` 第一步改成一条固定、系统已永久批准、失败会显式报 `ERROR:` 的 Python 脚本，2026-09-22 现场手动触发测试一次，不到一分钟正常出报告（真实数据：留资表单花 $10.49 拿到 2 个留资，老客户召回花 $10.25 零结果）。
- **还没做的**：PM 去 App 里找到这条定时任务的设置，把权限模式锁定成"全自动执行"（不要留"敏感操作要问人"那一档），这样万一以后命令写法又被绕过去，也不会再卡审批。

---

## D1「投放卡住」诊断 · UTC+7/+8 账户跨午夜的零投放段会永久漏报（2026-09-24 卫青复审发现，P3）

**§11 打分**：频率低（现网 7 个广告账户全是 `Pacific/Auckland` ×6 + `Australia/Brisbane` ×1，没有一个落在 UTC+7/+8，今天触发不了）· IMPACT 闭环关键度高（D1 报的是"钱花不出去"，漏了就是客户预算白白少花，属于 Act 段该抓没抓）· 收入关联度低（当前无客户受影响）→ 两项低 → **P3**，记入待认领，不现在动。

- **怎么来的**：PR [#1966](https://github.com/bigbigraydeng-maker/magic-engine/pull/1966) 把评估日从「UTC 的昨天」改成「广告账户时区的昨天」，评估日整体往后挪了一天。D1 的「报表滞后」守卫是拿**评估那一刻的账户本地钟点**跟缺口结束时刻比，评估日一挪，这个差值就整体少了 24 小时。
- **判据在哪**：`src/lib/ads-strategy/portfolio/diagnostics/d1-delivery-stall.ts:142-146`，`sinceGapEnd = hoursFrom(D, run.end, evalLocal.day, evalLocal.hour)`，小于 `D1_REPORT_LAG_HOURS`（`thresholds.ts:18`，= 2）就判 `report_lag`「判不了」。
- **什么条件下出错**：cron 固定 17:00 UTC（`render.yaml:360`），账户本地钟点 = `(17 + 偏移) mod 24`。偏移 +8（Australia/Perth）→ 本地 01:00，一段跑到当地午夜结束的零投放段算出来只有 1 小时 → 判 `report_lag`；偏移 +7（雅加达/曼谷）本地 00:00，连 23 点结束的段都躲不过。偏移 ≥ +9 的账户（奥克兰 +12/+13、悉尼 +10/+11、布里斯班 +10）算出来 ≥ 2 小时，不受影响。
- **后果为什么是"永久"**：D1 只评估 `ctx.date` 这一天，下一轮 `ctx.date` 已经是 D+1，被判 `report_lag` 的那天**再也不会被重新评估**。改之前同一段卡住会在第二天那轮算成 25 小时稳稳命中，改之后从「晚一天报」退化成「一次也不报」。
- **将来要修的话**：命中 `report_lag` 的那一天不能就这么丢掉。两个方向——(a) D1 单独退回评估 `shiftDate(D, -1)`（小时数据加载器本来就会取 D、D-1、D-2 三天，`D1_REPEAT_LOOKBACK_DAYS = 2`，数据现成）；(b) 把 `report_lag` 的那天记下来，下一轮补评一次。**接手前先确认现网有没有 UTC+7/+8 账户**——没有的话这条仍然只是隐患，不要因为它插队。
- **同时发现的既有不一致（不属于本条，一并记着）**：`src/lib/cron/registry.ts:157` 里 `google-data-pullback-daily` 的调度写的还是 `'0 3 * * *'`，而 `render.yaml:360` 早在 2026-09-16 就按 PM 拍板改成 `'0 17 * * *'` 了。上面这条判据的全部安全性都建立在「17:00 UTC 跑」这个前提上，而仓库里有两份互相打架的记录。

---

## Meta Ads AI 只读内测 · 换人接手一条已连接的 Facebook 授权时永久卡死（2026-09-22 发现，P3）

**§11 打分**：频率低（一个客户通常固定一人/账号维护）· IMPACT 闭环关键度低（不阻塞当前 Act，有绕过办法）· 收入关联度低（无客户投诉/续费风险）→ 三项皆低 → **P3**，记入待认领，不现在动。

- **现象**：CTS Tours NZ 用 `hello@magicengine.cloud` 登录连好 Facebook 后，`bigbigraydeng@gmail.com` 用同一个 Facebook 账号（同一个 `ads_user:<fb_id>`）再连一次，UI 报"Facebook 授权已取消、已过期或未完成"，实际生产日志真实原因是 `connection owner is immutable`（`supabase/migrations/20260920235723_meta_ads_ai_schema_forward_fix.sql:315-326` 的触发器）——不允许把一条 `meta_ads_read` 连接的 `authorizing_principal_id` 改绑给另一个 Magic Engine 平台账号。这本身是有意的安全设计，不是 bug。
- **真正的 bug**：`src/lib/meta/ai/manage.ts` 的 `revoke()`（type='connection' 分支）只把 `status` 改成 `revoked`，从不把 `authorizing_principal_id` 清空为 `null`。而上面那条触发器允许换人接手的唯一合法路径，恰恰要求 `OLD.authorizing_principal_id IS NULL`——现在的断开连接功能永远做不到这一步，导致"断开重连换人"这条路径在数据库层面根本走不通，连原来的 owner 自己断开重连也一样卡死。
- **当前绕过办法（2026-09-22 当天实测：这条走不通）**：本以为换回最初完成 Facebook 授权的账号（`hello@magicengine.cloud`）操作就行，但客户当天全程用的是 `bigbigraydeng@gmail.com` 登录，一直没能真正切到 `hello@magicengine.cloud`（可能是拿不到那个登录邮箱的收信权限）。最终是 PM 授权后**直接 `DELETE` 掉那一条卡住的 `platform_oauth_connections` 记录**（`id=972589ac-d997-49ad-9b91-618db8ed0409`，`meta_ads_read_grants` 当时对应记录为空，级联删除无副作用）才解开，删完后不管哪个账号登录去连都是全新 `INSERT`，不会撞到这条触发器。
- **原计划的修法已验证行不通**：以为 `revoke()` 只要在 update payload 里加 `authorizing_principal_id: null` 就行，但实测这条触发器的豁免条件要求 `OLD.status IN ('revoked','expired','error')`——而"清空归属人"这个动作，不管是紧跟着断开一起做、还是断开之后再单独做一次 update，那一刻的 `OLD.status` 要么还是 `active`、要么虽然是 `revoked` 但 `OLD.authorizing_principal_id` 依然不是 `null`，两种情况都会被同一条触发器拦下来报同样的 `connection owner is immutable`。**这条触发器目前没有任何合法的 `UPDATE` 路径能把归属人清空**——只有 `DELETE`（触发器只挂在 `UPDATE` 上）能跳出这个死循环。
- **将来要修的话**：`revoke()` 的 connection 分支改成"断开时如果没有存量依赖就直接 `DELETE` 这一行"，而不是把 `status` 改成 `revoked`；如果业务上必须保留断开记录做审计，就要改这条触发器本身（放宽豁免条件，或者单独开一个"清空归属人"的专用 RPC，用 `SECURITY DEFINER` + 显式业务校验绕开这条 immutable 检查，而不是让业务代码去猜怎么绕）。

---


## Meta Social Technologies MCP 内部工程助手 · 后续评估（2026-10-24 登记，未排期）

Meta 官方 MCP 工具可辅助开发者查询 Meta 开发文档、应用与权限状态、审核 / 合规信息、API 用量与弃用信息，以及 webhook 订阅状态；Manage 能力还可管理 webhook 订阅并发送测试事件。

- **当前决定**：仅登记为候选，后续有时间再评估是否适合 Magic Engine；尚未按 §11 打分，不排期、不开发。
- **预期价值**：为 Magic Engine 内部工程人员提供查询 Meta 官方开发资料与应用状态的入口，减少维护 Meta 集成时在代码、文档和开发者后台之间切换核对的工作。
- **边界**：这是内部研发 / 运维辅助工具，不是 Magic Engine 面向客户的 Meta Ads Connector；不提供客户广告账户 Insights，也不替代 Magic Engine 自身的 OAuth、账户授权、数据存储和只读数据管道。Manage 能力不代表可以修改应用配置或完成 App Review。
- **后续评估要点**：确认开放资格、Read 权限实际覆盖的问题、与现有 Meta Ads Connector 的互补关系及认证 / 数据边界；默认只评估 Read，只有明确的非生产 webhook 验证需求时再考虑 Manage。
- **相关现状**：[`docs/specs/2026-09-20-meta-ads-ai-connector-v01.md`](./specs/2026-09-20-meta-ads-ai-connector-v01.md) 仍标记为 Discovery / Implementation Proposal、STOP BEFORE BUILD；本条不改变该状态。
- **来源**：[Meta Social Technologies MCP 官方文档](https://developers.facebook.com/documentation/mcp/devtools-mcp/)。
## SEO 标题周循环 v1 · 上线后跟进（2026-09-20 上线，CTS 开关已关；清单来源 Issue [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) 评论）

- [ ] **重新打开 CTS 的开关**：先用 `POST /api/cron/seo-meta-cycle-trigger` 带 `{"dry_run": true, "client_id": "<CTS>"}` 跑一次演练，把「这一轮会改哪些页、改成什么字、依据的搜索量/难度/前 3 标题」给 PM 看；PM 批准后才把 `clients.seo_config.meta_cycle_enabled` 改回 true（见 PITFALLS D10）

**第 4 步（出文案 → 开 PR → 合并）重跑安全**
- [ ] 1. AI 生成标题那步没包 try —— 一个候选失败会让整个第 4 步重跑，应只跳过这一个
- [ ] 2. 重试时发现这条改动的 PR 已开过且已合并，代码什么也不做 —— 应补写 `seo_meta_log` 基线记录，不能让改动凭空消失
- [ ] 3. 查对手标题的 DataForSEO 调用被重试会重复付费 —— 缓存，或拆成独立步骤
- [ ] 4. 写 `seo_meta_log` 失败没检查错误 —— 失败要计入回执失败数，不能永远显示 0
- [ ] 5. 第 4、5 步回执内容重复，考虑合并

**14 天回查与人工待办**
- [ ] 6. 现在先标「已回查」再写待办，写待办失败则回归没人知道 —— 顺序反过来
- [ ] 7. 老记录 `pr_url` 为空时，待办仍写「点开这个 PR 链接」—— 改指向页面改动历史，或明说没有 PR 链接
- [ ] 8. 判回归前先确认谷歌数据是改动之后才更新的，避免拿旧数据误判「没变化」
- [ ] 9. 取待回查记录时排除没有基线曝光数据的历史补录，免得占每周名额
- [ ] 10. 「有没有效果」的样本门槛（现 30 次曝光）按实际噪音再评估

**代码清理**
- [ ] 11. 删掉已无人调用的 `readMetaForSlug`
- [ ] 12. `roster.ts` 精简（`toClientConfig` 重复代码；`run-one` 只读当前客户；`isoWeekKey` 重复导出）
- [ ] 13. 手动补跑被跳过的客户时，别覆盖「最近跑过」时间戳（会误伤下周正常那次）
- [ ] 14. 设计文档里关键词来源、学习记忆几段没跟上最新代码，需同步
## 内容工厂发布前品控:生产环境未配 `TYPESAFE_API_KEY`（2026-09-20 #1832 已合并，功能代码就绪但未生效）

`src/lib/jev/client.ts` + `src/lib/factory/content-quality-guard.ts` 已上线：成片交付时检测竞品品牌当角度 / 内部分类标签冒充字幕 / 人称口吻不符简报,命中标红转人工审核（详见 PR #1832）。是 fail-closed 设计——缺这个变量不会报错崩溃，但 `callJev` 会直接抛错，每个有文案的工单都只会写入 `quality_check_unavailable`，三类新语义检测在生产完全不会运行，跟没上线效果一样。

- [ ] **需要人工操作**：在 Render `crazycontent` web 服务配置 `TYPESAFE_API_KEY`（TypeSafe Jev 判断模型密钥，对外封装名 Compliance Engine），配完跑一次真实工单交付验证 `output.quality_flags` 确实产出竞品品牌/占位字幕/人称口吻判断，而不是清一色 `quality_check_unavailable`。
- 按 §11：频率高（内容工厂天天跑，不配就天天漏检）/ IMPACT 中（发布前把关环节）/ 收入高（原始动机——竞品品牌广告或占位字幕上线会真实损客户关系）→ 两个高 → P0，但这一步是纯配置操作，不占开发排期，谁能登录 Render 谁就能几分钟做完。

---

## Park Homes 官网升级候选（2026-09-20 全站审计，按 §11 打分均为 P3，未开工）

PM 要求把 parkhomes.nz 整体检查一遍还有什么可以升级。首页网图占位（最高优先级项）已在同次会话修复上线，见 CHANGELOG。以下两项按 [ENGINEERING_QUALITY_GATES.md §11](./ENGINEERING_QUALITY_GATES.md#11-资源优先级判断pm-2026-09-07-拍板) 打分：频率、收入关联度均判低 → 两个低 → 一律 P3，先登记不占用当前排期。

- **补齐 Greenview / Castor Bay / Forrest Hill 的配套内容**：2026-09-13 已经在邮件里主动跟 Jason 说了要补（Greenview 零配套文章；Castor Bay / Forrest Hill 各只有 1 篇）。**2026-09-21 进展**：Jason 补来 4 张 Greenview 工地航拍，已做成页面上的"工程日志"时间线上线（PR #1858）；效果图仍只有 2 张，配套文章仍未写。文章可以照抓取真实区域数据的方法自己先写（不必等客户）。
  - **PM 2026-09-21 提的方向（候选，未开工）**：在建项目持续记录进展 + 每次更新产出一篇配套文章，当成给开发商的加分项。目前只在 Park Homes 站内实现了"进度日志"板块；"每次更新自动出文章"和"做成地产行业通用打法"都还没做——等第二个地产客户出现同样需求再评估往共享层提，届时先过平台层级门。
  - 频率：低（内容沉淀类工作，非每日撞上的问题）· IMPACT：中（SEO 自然流量导流环节，9-13 邮件里给 Jason 看的数据是 24 次点击/589 次曝光/平均排名 19，这几篇項目页搜索表现偏弱正是原因之一）· 收入：低（间接，非直接决定客户流失/续费）→ 两低 → P3。
- **全站没有分享预览图（Open Graph / Twitter Card 元数据）**：链接被转发到微信/WhatsApp/Facebook/短信时，不会带图片和摘要预览，只显示裸链接。技术上是给 `Base.astro` 加几行 `<meta property="og:*">` 标签，工作量很小。
  - 频率：低（不是每天会撞上的故障，是"有人转发链接时"才体现）· IMPACT：中（影响转发链接后的点击欲望，偏 Act 前一步）· 收入：低（间接）→ 两低 → P3。

---

## 广告 WP3 · Impact loop 接线 — 设计稿 v2.1 等 PM 认，实施按四小步（2026-09-25，A 级，P0）

**§11 打分**：频率高（每日跑）· IMPACT 高（Check/Tune 段决定闭环通不通电）· 收入高（客户续费看广告效果）→ 三高 → **P0**。合同 [#1986](https://github.com/bigbigraydeng-maker/magic-engine/issues/1986)；设计稿 `docs/specs/2026-09-25-ads-impact-wp3-design-v1.md`（三方设计复审两轮：子牙 / 魏征 / 狄仁杰，21+27 条全部并入）。执行走 DeepSeek，本窗口统筹复审。

- [ ] **WP3.1a 同步 worker**：`ad_strategy_configs.autonomy_mode` → `client_automation_policies.mode`（按 `(client_id, action_key)` 逐键条件 UPDATE，registry 动态取 `ads.*` 键；Kernel 一行不动；同步 SQL 函数 SECURITY DEFINER + REVOKE/GRANT；审计列 + receipts 表；架构测试 grep 禁令）。狄仁杰判「可进」。
- [x] **WP3.1b 核心安全链已合并（PR #2204）**：熔断、账户级预算上限、生产 Kernel 接线及 WP2 遗留修复已进入当前 `origin/main` 基线。WP3.1b 仍有后续欠账，不能据此称整包完成；预算 Inngest 首次云端注册/无写入探针与真实预算写入审批见 [Inngest 待验证台账](./ledger/2026-09-30-ads-campaign-budget-inngest-pending.md) 和 [安全试跑台账](./ledger/2026-09-30-ads-campaign-budget-first-run.md)。
- [ ] **WP3.1b 止损接线 + B2 前端契约修（PR #2205 草稿待审）**：当前工作分支已把广告健康看板止损从直连 Meta 改为经 Kernel 提交；人身份边界由访问校验与架构测试约束。实现与待验收条件见[止损接线台账](./ledger/2026-09-30-ads-stop-loss-kernel-wiring.md)。尚未合并/部署；上线后仍须验证真实执行记录及熔断拒绝。
- [ ] **WP3.1b 欠账（本轮明确没做，逐条登记，不许只留在台账里）**：
  - [ ] **系列级 / 自动化三条旁路真收编**（`meta-ads/execute`、`meta-ads/boost-post`、`winner-reel-sync`）—— 需新增 4 个 ActionKey + capability handler，PR B / C 承载；`winner-reel-sync` 的保护判据是**学习期**不是预算（必须另建独立广告组，往在投组加广告会重置该组学习期；手册 `playbook-ads-meta-general` :249/:333/:367/:127-131 记了四处，NAL 实例每留资 $19.6→$138 七倍恶化）
  - [ ] **运行时跨账户日上限强制** —— 卫青 2026-09-27 查实 CTS 两账户各花各的、合计 10 天超客户总闸。WP3.1b 只做了「配置时校验 sum ≤ 总闸」+「按账户取上限」，**运行时没人查「这个客户今天全部账户加起来花了多少」**，洞仍开着。不许因为 §3.9 做了就认为这条修好了
  - [ ] **`client_meta_ad_accounts` 缺 `currency` 列** —— 账户级 `daily_budget_cap_cents` 的币种是隐含的、靠 `ad_entity_snapshots.currency` 反查。今天不出问题纯因 CTS/NAL 实测全 NZD。多币种客户接入前必须补；在那之前 PATCH 校验对「取不到币种」和「币种不一致」一律拒、不许相加
  - [ ] **熔断 #4 Jev 连续低分接线** —— 数据源 `prescription_evaluations` 按 v2.2 §9.3/§11.8/§12 是 WP3.3 才建；3.1b 判据打桩恒返回 undeterminable（不熔不放），表就绪后接线
  - [ ] **admin 熔断解除看板页** —— 3.1b 只交付 API（`guardGlobalAdmin` 保护），UI 延后
  - [ ] **`ads.pause_unit` 缺专属审批入口 → 批准没有绑定保护** —— 人按的止损在 `observe` 客户上落成 `pending_approval` 后走通用审批页，而通用页的 `expectedDecisionId` 是可选参数（默认 `{}`），所以「批准的人看到的就是他批的那份」这条保护对它不生效。修它要给 `ads.pause_unit` 建专属入口 + 登记进 PR #2063 那张登记表；两边同时改那张表会撞，所以等 #2063 合并后做
  - [ ] **让 `triggeredBy: 'human'` 不可自报** —— `SubmitActionInput.triggeredBy` 是提交方必填、`runner.ts:194` 原样写库、**零校验**；而人工止损信封刻意不看学习期 / 72h 冷却 / 变动 ≤20% / 日上限，所以**谁能填 `'human'` 就能跳过 AI 信封那五条闸**（统筹 + 卫青 2026-09-27 查出，我核实成立；今天生产代码零处填它，止损路由接上那一刻打开）。彻底修法 = `submitActionRun` 不收 `'human'`，改收一个由鉴权层产出的「已鉴权人工上下文」，Kernel 自己翻成 `'human'`，让类型系统保证「没鉴权过就构造不出 human 提交」（同 `AUTHORIZED_CONTEXT_MINTERS` 的思路）。代价是动 `runner.ts` 公开入参 = 动所有提交方，本轮太大。**本轮的替代是两层围栏**：`HUMAN_TRIGGER_ALLOWED_DIRS`（只有 `src/lib/ads-strategy/submission/` 能传）+ `HUMAN_TRIGGER_REQUIRED_AUTH_CALLS`（传它的文件必须命中鉴权调用，剥注释后按调用形式判），两条由架构测试强制、4 条变异全红。**不许因为围栏在了就认为这条修好了** —— 围栏管的是「哪个文件能说谁」，不是「说谁本身不可能」
  - [ ] **provider-write 闸的 AST 化** —— 狄仁杰实测那道闸能被 barrel 转发 + 同目录相对 import 绕过（9 种写法里架构测试只认得 1 种）。修法在 `architecture.test.ts` 同文件里已有（341 行起的 AST 版 `moduleRefsIn`），存量弱点非本轮引入
- [ ] **WP3.2 链条**：`google-data-pullback-daily` 末尾发 `ads.impact_cycle.due`（不新开 cron）；韩信（新 agent `docs/agents/12-hanxin.md`）编排：熔断检查 → 孔明 `isWithinEnvelope` 预检 → denied 恢复入批 → 去冲突 → Kernel；批次表 + 成员表；pm-todo 四个拉取函数 + 活性项。
  - 🔴 **在它做完之前，熔断等于不存在**（2026-10-18 查实）：写 trip 的人是韩信 step 1（设计稿 §2.2 第 1 行：「#1/#2/#4 的 trip 在这里写」），而韩信属本条。所以今天 `ads_circuit_events` **0 行**、`capabilities/ads/envelope-facts.ts` 的执行前熔断闸**恒为放行**、`pm-todo/ads-circuit-items.ts` **恒为空**。WP3.1b 交付的是表 + 五条判据函数 + 派生态查询 + 执行前闸 + admin 解除接口，**读侧已在生产、写侧在本条**——代码读起来像有熔断保护，实际没有。工作量只读估算见 `docs/specs/2026-10-18-ads-agent-whole-design-and-code-gaps-v0.1.md` §6.5。
- [ ] **WP3.3 Check + Tune + Jev + 日报两段**：韩信在 `runAction` 成功后写 `flywheel_actions`（加 `action_run_id` 列）；attribution 加 `ads_check` 评估器（扩 `flywheel_outcomes_evaluator_key_check`、`OUTCOME_EVALUATOR` 登记、`ads.` owner）；Tune 复用 `memory-extractor`（`pattern_type` CHECK 扩 `budget|pause|creative`）；`prescription_evaluations`；日报 Check/Tune 段。
- **不在 WP3**：任何客户开 `bounded_auto`（单独授权）；三个 stub capability 的真实实现；`deny` 写入口（v1 不提供，管理员的「关」= `observe`）。
- **PM 需知**：翻 `autonomy_mode` 触发 `policy_version +1`，当天在途授权作废、下一轮重提（正常，日报提示）。

## Agent 管理系统（旅行社送来的终端客户）· 上线后两条小尾巴（2026-09-24 上线，P3）

PR [#1983](https://github.com/bigbigraydeng-maker/magic-engine/pull/1983) 已合并，两张 migration 已 apply。按 §11：频率低（CTS 一家在用）· IMPACT 低 · 收入中 → 两低 → **P3**，待认领。
- [ ] 页面顶栏「最后同步时间」硬编码「每小时一次」+ TODO，改从 `mailbox-sync` 心跳读。
- [ ] 大团客户（pax > 30 常态）会被 `needs_review` 淹掉看板；判据升级成「同 Agent 30 天内见过一次即默认信任」。CTS 短期不撞。

## 广告支柱 IMPACT 闭环升级 · 阶段 0 止血 + 阶段 1 只读诊断（2026-09-14 已开 PR，PM go 已完成，验证与收尾进行中）

设计定稿：`~/.claude/plans/ads-impact-loop-capability.md`（§14 为验收条款）。阶段 0：PR #1656（看板查错列）、#1657（STATE.md 内核事实）、#1658（替代 #1080 的广告写路径归属校验 + 主页绑定只许员工改）。阶段 1：#1659（设置快照表 + 视频/广告组日数据）→ #1662（角色判定 + 结果阶梯配置界面）→ #1664（诊断 D1/D3/D4/D5/D7/D8）→ #1665（内部版日报）；#1660（行业词下沉剧本 + 回读去客户名）。PM go 与 migration 授权已完成，完成记录见 [CHANGELOG 2026-09-22](./history/CHANGELOG.md)。

- [ ] **合并上线后正式站验证（登录后台页）**：`/dashboard/ad-engine`「汇总数字有没有在骗人」出数据；客户设置页「广告结果怎么算」面板能存。
- [ ] **FDE 给在投客户配结果阶梯**（NAL / CTS / Oztop）：没配之前「花钱没结果」「钱和结果错配」会一直判不了，内部日报会提醒。
- [ ] **客户真实情况待确认（P0-4 剩余，Roman HU / 30 Kiteroa 已了结见 CHANGELOG 2026-09-20）**：Oztop 8/19 起零花费是有意停投还是付款/审核问题——2026-09-20 实查每日回流仍报 Oztop 的 Meta 账户读不到（`getAdAccountInsights returned null`）。
- [ ] **老接口鉴权**：`/api/clients/[id]/ad-strategy-config` PATCH 已改成只许内部员工（`8e4d2210`）；`domain` 绑定接口同类问题未查。
- [ ] **主页改绑补全**：查「这个主页是否已绑给别的客户」+ 写 `client_binding_audit`（复用 #1649 引入的审计表，#1649 合并后做）。
- [ ] **共用账户根治（G15 / M9）**：落广告系列级归属表；之前共用账户只做账户级诊断；老的系列级/广告级日数据同步仍会把共用账户写进两个客户名下。**2026-09-22 补充**：新增的 D9 诊断（纯播放广告漏排除 Audience Network，PR #1874）同样受这条限制——共用账户（CTS 跟 Oztop/30 Kiteroa 共用的 `act_2775766642787274`）整层跳过广告组设置抓取，D9 看不到里面的广告，这条账户归属表根治了之后 D9 应该顺带能覆盖。
- [ ] **行业词表加 `logistics`**（物流剧本目前选不中），`E-commerce …` 自由文本行业值归一。
- [ ] **L3 Meta Connector 收口**：Graph 版本统一（v19/v20/v21 混用）；`src/lib/meta/client.ts` 已超 800 行需拆文件；快照取令牌（`getMetaTokenForClient`）与每日同步 cron 的令牌口径统一。
- [ ] **内部日报先影子跑几天、人工核对**：回放验收造不出「开着但不花钱」「白天被暂停」两种情况，不能证明生产不误报。
- [ ] **诊断后续**：D7 补令牌有效期、主页令牌权限、像素触发、自动化身份任务四项体检；诊断结果从体检记录迁到诊断自己的表；D2（按角色的疲劳模型，学习期排除）、D6（行业先验，需 ≥2 客户证据）；Meta 实验排除扩展到止损与素材同步（§14 M7，写路径，阶段 2 收口）；诊断事件链接 Inngest（§4.4）。
- [ ] **阶段 2（内核 + 执行）/ 阶段 3（客户版 + 剧本 + 调优）**：按设计 §4.1 硬前置与 §14 K1–K14、C1–C9 推进。
- [ ] **广告决策原因留痕（P2）**：2026-09-16 CTS 顾问窗口交互式调整预算/定向后，把"为什么"临时塞进 `ad_entity_snapshots.targeting_summary` 的 note 键——用错了字段（该表是机器设置快照，非人工决策日志）。设计判断见 [2026-09-16-ad-decision-log-review.md](./specs/2026-09-16-ad-decision-log-review.md)（已按 Codex 复审三轮修订，以文档最新版为准）：不建议给快照表加字段，也不建议另建独立表，建议扩展仓库已有的 `client_decision_history`（诸葛亮决策历史表）补几列（`affected_entities`/快照关联/`source`/`flywheel_action_id`）；阶段 2 内核接管广告动作、把批准理由改成必填后，必须在**同一 PR 内硬性关闭**交互式顾问直写 Meta 的旁路（不是渐进式停用）。**排期实施前仍有三处未决口子需先解决**（详见文档 §2.1/§2.2/§2.3）：①`client_decision_history` 现在的写入权限矩阵（`docs/agents/CODEX.md`/`00-architecture.md`）明确限定只有诸葛亮能写，新增"交互式顾问"写入方前必须先修订写入所有权并走架构复审；②`outcome_verdict` 自动回填已于 2026-09-06 永久停用，新增的 `flywheel_action_id` 只是给 attribution job 一个可写的外键，不会让既有的 `loadRecentDecisions`/`formatMemoryForPrompt` 读取路径自动看到 Outcome，需要另设按动作 join 的读取链路；③一次决策可能跨多个广告账户，需要给动作和指标定义一致的账户/实体作用域，否则 attribution job 会把无关账户的变化误归因给这次决策。按 §11 三维打分：频率中 + IMPACT 中 + 收入低 = 中中低 → P2，排在阶段 0/1 之后；实施前需大任务 2 审（触碰 schema）。判定为既有广告支柱 L1 能力线内部扩展，不占用 `platform-candidates.md` 候选名额。
- [ ] **P0 遗留**：CTS 网站仓库草稿 chinatravel#136 关或合、CTS 自动化策略 `5d66c469` 没有结束日期（P0-3）；Oztop 2026-08-16 那行 `level='adset'` 孤行来自旧电脑手写 SQL 的 `oztop-meta-daily-monitor` 定时任务，确认该任务已停（P0-6）。

---

## 广告执行层（Ads Act Layer）— IMPACT 闭环补全 [P-ADS-ACT]

> **背景**：2026-09-15 NAL 广告优化全程靠 Claude Code 手动调 Meta Graph API 完成（版面排除、Advantage+ 关闭、相似受众创建）。ME 现在有 Inspect / Measure / Prescribe，唯独缺 **Act**。这个功能要把今天手动做的所有动作全部搬进 ME，由 **Inngest** 负责异步编排。
>
> **设计原则**：PM 明确拍板前不许动广告账户（fail-closed）。执行必须经过现有 Execution Kernel（生成 `action_runs`、append-only `authorization_decisions`、输入哈希、幂等、回滚、lineage），不能绕开 Kernel 单独发明一套 `approved_at` 审批闸；Check 阶段的可追溯性由 Kernel 记录提供，不是单独写 `client_decision_history`。
>
> **Reuse 边界**：Act 是平台级能力（IMPACT 第四段），不是 NAL 专属。生产已有 Execution Kernel（见 `docs/STATE.md`），当前缺的是「广告动作注册」，不是另建一套执行通道——Inngest 只负责编排，实际写操作必须经 Kernel gateway/action bridge 调用已有 Meta Connector（`src/lib/meta/`），不可散落在 cron 或页面路由里，也不能新建第二条 provider 写路径（如 `src/lib/meta-ads/`）。

### 设计结构

```
ad_health_narratives（每日自动出处方）
        ↓  Inngest event: ads/prescription.ready
ads-act-executor（Inngest function）
        ↓  ① 读取处方里的 executable actions
        ↓  ② 生成「审批卡」推送 PM（Portal UI 或 Telegram）
        ↓  ③ PM 点「批准执行」→ Kernel 写入 append-only authorization_decisions
        ↓  ④ Inngest step.run() 经 Kernel gateway/action bridge 调 src/lib/meta/targeting-mutations.ts（已验 API 调用）——动手前必须先用 `findSharedAdAccounts`（`src/lib/meta/client-ad-accounts.ts`）核对目标账户，命中共用账户一律 fail-closed 拒绝（见硬约束 5）；四个改 targeting 的动作在真正 POST 前把当前完整 `targeting` 存一份快照供回滚，「创建相似受众」记录新建的 `custom_audience_id` 供清理
        ↓  ⑤ Kernel 写 action_runs（含输入哈希/幂等/回滚/lineage）；同一 Inngest step 内以 `action_run_id` 为幂等键 upsert 一行 flywheel_actions（`expected_metric` 取处方监控的指标；`expected_delta` 是带符号的**预期变化方向**——成本类指标预期下降必须写负数，不能照抄 `watch_metrics` 的基线数值，基线由评估流程自己测量）；此时不产生任何 outcome 记录——待 outcome-checker 回填
        ↓  ⑥ 建 Google Calendar 提醒（review_at 日期）
```

### 已验证可直接移植的 Meta API 操作（2026-09-15 NAL 实测）

| 操作 | API 调用 | 作用范围 | 验证状态 |
|---|---|---|---|
| 排除受众网络版位 | `POST /{adset_id}` 改 `publisher_platforms` | adset 级 | ✅ 已验证 |
| 关闭 Advantage+ 受众 | `POST /{adset_id}` 设 `targeting_automation.advantage_audience=0` | adset 级 | ✅ 已验证 |
| 排除 IG 动态/FB 快拍 | `POST /{adset_id}` 改 `instagram_positions`/`facebook_positions` | adset 级 | ✅ 已验证 |
| 创建相似受众 | `POST /act_{ad_account_id}/customaudiences` `subtype=LOOKALIKE` | **账户级**——无 `adset_id`，不改任何 adset 的 `targeting` | ✅ 已验证 |
| 添加相似受众到广告组 | `POST /{adset_id}` 改 `targeting.flexible_spec` | adset 级 | ✅ 已验证 |

⚠️ **Codex P2 复审结论**：「创建相似受众」是账户级操作（`POST /act_{ad_account_id}/customaudiences`），不带 `adsetId`，也不读写任何 adset 的 `targeting`；不能套用下面「五个函数都先 GET adset targeting 再合并回写」的规则，否则会在真正创建受众前就因缺 adset 参数而失败，还会把无关的 targeting 回写混进这个动作。它必须建成独立的账户级 Kernel action（独立 `action_key`，参数只有 `adAccountId`/`token`，产出 `custom_audience_id`），GET-merge-POST 的安全回写规则只适用于其余四个真正修改 adset targeting 的操作。

### 待做清单

- [ ] **`src/lib/meta/targeting-mutations.ts`**（路径经 Codex 复审纠正，原写 `meta-ads/` 是错的）：把上表五种操作从一次性脚本搬成有类型约束的模块函数，其中四个改 adset targeting 的函数签名带 `adAccountId`/`adsetId`/`token` 参数（不硬编码客户）。⚠️ **Codex P0 硬要求**：这四个写函数第一行必须先 `GET /{adset_id}?fields=targeting` 拿完整定向设置，在内存里合并修改后再整体 POST 回去——禁止局部传值，Meta 会把未传的字段全部清空（真实事故记录：`feedback-meta-targeting-update-not-safe-merge.md`）。这次 GET 到的原始 `targeting` 同时就是回滚快照，必须原样存进 `action_runs` 的可回滚载荷，不能只 GET 用完即丢。「创建相似受众」是账户级操作，函数签名只带 `adAccountId`/`token`（无 `adsetId`），不读取也不回写任何 adset 的 `targeting`，直接 `POST /act_{ad_account_id}/customaudiences`——见上表后的 Codex P2 复审结论，不适用 GET-merge-POST 规则；它的回滚不是恢复 targeting，而是要能删除这次新建的 `custom_audience_id`。
- [ ] **执行前对目标账户跑 `findSharedAdAccounts` 核对，命中共用账户一律 fail-closed**（⚠️ Codex P1 复审结论）：`campaign-ownership.ts:14-18` 的归属校验明确说明只能挡「`campaign_id`/`ad_account_id` 完全不在客户注册账户里」这种跨账户误操作，挡不住同一账户内的跨客户资产——处方如果因为归因串线指向了同账户里另一个客户的 adset，四个改 targeting 的动作会直接改错客户的广告；账户级的「创建相似受众」风险更高，新建的受众直接挂在整个共用账户下，不区分客户。历史案例：Roman HU 与 30 Kiteroa 曾共用 `act_1260456876069575`（`src/lib/meta/client-ad-accounts.ts:75-103`），2026-09-20 两客户停投后该账户已从 `client_meta_ad_accounts` 解绑（见 CHANGELOG 2026-09-20），`findSharedAdAccounts` 只查这张表的当前登记，此后再拿这个账户号去测不会命中共用——**验收时必须用单测 fixture**（往 `client_meta_ad_accounts` 插两个不同 `client_id` 登记同一个 `ad_account_id` 的 mock 数据）或另找一个生产里当前真实存在的共用账户，不能沿用这个已解绑的旧案例。在账户级归属表落地前，Kernel 动作在生成 action_run 之前必须先查 `findSharedAdAccounts`，命中即拒绝执行、转人工，不生成任何 action_run（详见硬约束 5）。
- [ ] **五个动作各自挂真实 rollback handler，不能只挂声明**（⚠️ Codex P1 复审结论）：`src/lib/kernel/gateway.ts:238-257` 的 `assertRollbackHandlerAssembled` 只保证「`outward` + `provider_native` 的 capability 必须声明 rollback handler」，挡的是「忘记声明」，挡不住「声明了 `snapshot_restore` 但没真的实现恢复步骤」——那样失败后外部状态依然撤不回来。四个改 targeting 的动作，rollback handler 要把 GET 阶段存下的原始 `targeting` 快照原样 POST 回去；「创建相似受众」的 rollback handler 要能删除这次新建的 `custom_audience_id`。五个动作在 Kernel action 注册表里必须各自挂对应 handler，不能共用一个占位实现敷衍过关。
- [ ] **Inngest function `ads/act-executor`**：监听 `ads/prescription.ready` 事件；解析处方里的 `executable_actions` 字段；每个动作单独 `step.run()` 经 Kernel gateway/action bridge 注册与执行，失败不级联。
- [ ] **PM 审批门**：执行前发「审批卡」（Portal 通知 或 Telegram bot）；批准后由 Kernel 写入 append-only `authorization_decisions` 记录（含真实 PM 身份与时间戳），Inngest 拿到该 Kernel 授权记录才能触发执行——没有 Kernel 授权记录 = 不执行，不报错、不静默跳过，记录「待审批」状态。
- [ ] **执行结果写 Kernel action/outcome 记录，不写 `client_decision_history`**（⚠️ Codex P2 复审结论）：`client_decision_history` 是单写者表，只有诸葛亮 conductor 在选择动作时写入（`docs/agents/CODEX.md:84-87`，唯一调用方 `src/lib/zhuge/action-persister.ts`）；执行完成的 receipt 是「做了什么、结果如何」，不是「为什么选这个动作」的决策记忆，写进去会污染后续策略上下文。`ads-act-executor` 执行后应把结果（含 `confidence_pct`/`hypothesis`/`watch_metrics`/`review_at`）落到 Kernel 的 `action_runs` + `flywheel_actions`（`action_run_id` 关联）里，决策历史仍由诸葛亮在选择动作时产生；最终成败判定见下一条 `outcome-checker` 写 `flywheel_outcomes` 的机制。
- [ ] **执行后自动建 Google Calendar 事件**：`review_at` 字段驱动，标题写人话动作（如「查 NAL 排除受众网络版位效果」），描述写「查什么 / 怎么算成 / 不成怎么办」。
- [ ] **`ad_health_narratives` 新增 `executable_actions` 字段**：结构化表达哪些处方是机器可执行的（带动作类型、adset_id、参数）——目前处方是自然语言，Act 层需要机器可读的格式。
- [ ] **Codex 代码审核**（开工前必做）：子牙审架构、魏征挑刺。特别检查：① 令牌泄露风险（`META_SYSTEM_USER_TOKEN` 不得进日志）；② 共用账户隔离——不只是「不同客户的 ad_account_id 不许混用」这种字面校验，必须实测「命中 `findSharedAdAccounts` 返回的共用账户时是否真的 fail-closed 拒绝执行」；③ 审批门是否真的 fail-closed 而非 fail-open；④ 写操作是否真的经 Kernel gateway/action bridge，而不是绕开 Kernel 直调 Meta Connector；⑤ 五个动作的 rollback handler 是否真的实现了恢复/清理，而不是只挂了声明。
- [ ] **outcome 回填机制复用现有 `flywheel_metrics` evaluator，不能让 `ads/outcome-checker` 自己另插一次 `flywheel_outcomes`**（⚠️ Codex P1 复审结论，2026-09-16 三轮修正）：`memory-extractor` 负责回填的那段代码已在 2026-09-06 退役（代码注释明文标注），回填目标是已作废的 `client_decision_history.outcome_verdict`，不适用——真正该写的表确实是 `flywheel_outcomes`。但 `flywheel_outcomes` 的自然键固定为 `(action_id, metric_key, window_days)`，且 `flywheel_outcomes_evaluator_owns_metric` 约束（`supabase/migrations/20260808000001_flywheel_outcomes_identity_expand.sql:174-207`）把除 `seo.gsc.*` 外的所有指标都判给唯一 evaluator `flywheel_metrics`——也就是既有归因管道 `src/lib/flywheel/attribution/job.ts`。Meta 广告指标不是 GSC 指标，天然落在这唯一 evaluator 名下：`ads/outcome-checker` 如果自己算 verdict 直接插 `flywheel_outcomes`，带别的 evaluator_key 会被数据库约束拒绝，省略 evaluator_key 又会被 `job.ts` 的 `claimOwnUnsignedRows`（`job.ts:457-465`）认领，随后在同一 action 的下一轮 reconciliation（`retireExtraWindows`）里被覆盖或撤下，等于白算一次。正确做法：`ads/outcome-checker` 只负责去 Meta Insights API 拉指标，把结果写进 `flywheel_metrics` 原始指标表（`client_id` + 处方里的 `expected_metric` 命名对齐 `job.ts` 的 `latestMetricValue` 读取口径），本身**不产生** `flywheel_outcomes` 行；baseline/after/verdict 的计算继续交给既有 `flywheel_metrics` evaluator 的定时任务读取新写入的指标后自动完成。`expected_delta` 必须是处方给出的带符号预期变化方向（成本类指标预期下降写负数，见步骤⑤），不能拿 `watch_metrics` 的基线数值顶替——那样会让指标下降（对成本类指标是好事）被 `computeVerdict`（`job.ts:546-558`）判成方向相反的 `reversed`。关联链路：`action_runs.id` ← `flywheel_actions.action_run_id`（步骤⑤已写入）← `flywheel_outcomes.action_id`（`kernel_action_lineage` 视图已拼好，见 `supabase/migrations/20260808000003_me2_execution_kernel_v1.sql:1594-1602`）。「待验证」状态就是「`flywheel_actions` 行存在但还没有对应的 `flywheel_outcomes` 行」，不需要新增字段。
- [ ] **`flywheel_actions` 的 `action_run_id` 关联写入必须幂等**（⚠️ Codex P2 复审结论）：`flywheel_actions.action_run_id` 目前只有普通索引，没有唯一约束（`supabase/migrations/20260808000003_me2_execution_kernel_v1.sql:1547-1551`）——Inngest 在 `flywheel_actions` 插入已提交、但本 step 结果还没落盘时崩溃重试，会从 Kernel 拿到同一个幂等命中的 `action_run`，对 `flywheel_actions` 再多插一行，导致同一次真实执行被学习/报告重复计数。开工前需要给 `action_run_id` 加唯一约束并用 `upsert (on conflict action_run_id)` 写这一步，明确「一次 action_run 只对应一条 flywheel action」的契约。

### 硬约束

1. **Inngest 负责编排，写操作必须经 Kernel**：不许在 API 路由或 Inngest step 里直接调 Meta API 改广告设置；必须走 Kernel gateway/action bridge 注册广告动作（生成 `action_runs`、append-only `authorization_decisions`、输入哈希、幂等、回滚、lineage），再由 Kernel 触发 `src/lib/meta/targeting-mutations.ts`。缺的是「广告动作在 Kernel 里注册」，不是另建一套审批/执行通道。
2. **PM 审批不可绕过**：审批只能来自真实 PM 身份产生的 Kernel `authorization_decisions` 记录，不允许任何运行时输入（脚本参数、事件 payload、调用方字段）携带可自行声明的绕过开关（如 `force_approve: true`）；调试只能用测试环境专用、不进正式契约的假执行器（fake executor）。
3. **令牌不写进代码**：从 `META_SYSTEM_USER_TOKEN` 环境变量取，不从函数参数传入字符串字面量。
4. **一次执行一个动作**：不做批量「一键优化所有广告组」，每个 adset 的每个操作、以及账户级的「创建相似受众」，都要独立审批、独立执行、独立记录——这是刻意设计，防止一个错误决定大规模扩散。
5. **命中共用广告账户 fail-closed**：现有的 campaign 归属校验（`campaign-ownership.ts:14-18`）只挡得住「资产完全不在客户注册账户里」的跨账户误操作，挡不住同账户内的跨客户资产。历史案例：Roman HU / 30 Kiteroa 曾共用同一 Meta 账户 `act_1260456876069575`（`src/lib/meta/client-ad-accounts.ts:75-103`），该账户已于 2026-09-20 两客户停投后从 `client_meta_ad_accounts` 解绑（见 CHANGELOG 2026-09-20），不再是生产里的共用账户，不能再拿它来验证本条守卫——验收改用单测 fixture（两个不同 `client_id` 登记同一 `ad_account_id`）或届时生产里真实存在的共用账户。在系列/adset 级归属表落地前，Kernel 动作生成 action_run 之前必须先跑 `findSharedAdAccounts`，命中共用账户一律拒绝执行、转人工处理，不生成 action_run，不允许「先执行再补隔离」。

### 开工前置条件（PM 2026-09-15 拍板）

- `ad_health_narratives.executable_actions` 字段结构需要先定稿（影响 Inngest 触发条件）
- PM 审批门的 UI 形式需 PM 确认（Portal 弹框 vs Telegram bot 回复）
- 子牙 + 魏征复审设计后才能动手写代码

---

## Creatomate Connector 落地后续

> 代码见 [docs/specs/2026-09-09-creatomate-connector-spec-v1.md](./specs/2026-09-09-creatomate-connector-spec-v1.md)（spec v2）。2026-09-13 端到端真实验证已跑通（PR #1570/#1594/#1604，见 memory `project-cts-video-factory-decision-ledger` 完整记录），下面只留还没做完的。

- [x] `CREATOMATE_API_KEY` 已配进生产（PM 2026-09-12 确认）
- [x] webhook payload 真实字段结构已通过多次真实渲染验证，正常工作
- [x] 至少一个试点客户（CTS）已在 `factory_config.render.creatomate` 配好 template_id + scene_field_map，多次真实渲染成功
- [x] 镜头槽位入场/推拉动画已确认真实存在（模板源码里每个 Still-N 都有 scale 动画，2026-09-13 直接读取模板源码确认，不再是假设）
- [ ] 找 Creatomate 客服或后台账单确认超出 2,000 credits/月后的真实计费行为（硬顶拒绝还是继续扣钱）（spec §6.2）
- [ ] `pickRealPhoto`/`loadRankableClientAssets` 补一道质量分门槛（`client-asset-pool.ts` 的 `MIN_QUALITY=5` 口径目前真实照片路径没用上）
- [ ] `PreparedScene.visualSource` 接入人工分镜自检表 UI，让 FDE 逐镜看时能分清"这镜是真图"
- [ ] `pickRealPhoto` 内部调用 `rankAssetsByPrompt` 的 `gpt-4o-mini` 排序成本（分钱级）没有计入 `content_factory_render_jobs.cost_usd`
- [x] CTS 真实素材库缺 Hutong（Still-5 专属）、西安城墙（Still-6 专属，不是兵马俑）的真实照片——2026-09-13 发现公司自己的 Dropbox 素材库（`CTS/footage/photos/`）里其实早就有 2 张胡同 + 1 张西安城墙真实照片，只是从未录入 `client_assets`，不需要去 Unsplash 找。已上传+PM 过目确认+标记 `client_verified`。2026-09-15 已真正接进成片生成：`scene_field_map` 从 4 条扩到 6 条（新增 Still-5/Still-6），原标注太笼统（西安城墙那张标注甚至没有"wall"这个词）已按真实图核对改准。胡同照片现在能稳定被选中；西安城墙照片因素材库里还有 4 张别的"墙"容易混淆，选不准时会正确回退 AI 现画，不算 bug，是已知限制。详见 memory `project-cts-video-factory-decision-ledger`。
- [ ] Still-5/Still-6 的 `caption`（大字标题）Creatomate 元素名还没核实——本地 `.env.local` 没有 `CREATOMATE_API_KEY`，Chrome 里登录的 Creatomate 账号也找不到生产用的那个模板，需要能进生产 Creatomate 账号的人去模板 Code 视图查真实元素名再回填，否则这两镜头的大字标题会停在模板默认占位文字（画面本身的真实照片不受影响）
- [ ] PR [#1655](https://github.com/bigbigraydeng-maker/magic-engine/pull/1655) 待 PM 拍板合并：`rankAssetsByPrompt` 加"没把握就别选"的置信度门（`requireConfidentMatch`），修复"素材库有对的照片，排序器却选了完全文不对题的图，还写了个听着很确定的理由"这个问题（2026-09-14 用真实脚本诊断发现）。已过 6 轮 Codex 复审，测试/类型检查/构建全过
- [x] 那个已确认"退役但没真的关掉、还在偷偷抢渲染任务"的老 Render 服务（`content-factory-render-worker`）——PM 2026-09-13 拍板彻底删除，已在 Render 后台执行删除，服务已不存在
- [ ] PM 拍板"AI 配音统一用 ElevenLabs"，账号免费版无法通过 API 调用任何声音——PM 2026-09-13 拍板暂不升级付费，先维持现状；CTS 出片全程仍未真正测过配音这一步
- [ ] "多开发不同模板"：PM 不想招人代画，已验证 Creatomate 模板编辑页的 Code 视图（`{}` 图标）能直接读出完整模板 JSON 源码，理论上也能反向粘贴编辑保存，但只验证了"读"，没验证"改并保存"这一步
- [x] 背景音乐——2026-09-13 发现模板其实自带一个通用的 `Music` 音频图层（此前的模板结构记录漏记了这个，只记了画面/文字元素），PM 上传了 3 首新曲目到 Dropbox（`MagicLab_Studio/Music/`），已全部转存到正式素材库，PM 选定 `Horizon's Call` 作为默认背景音乐，通过已有的 `static_overrides` 机制接入（不需要改代码），已用真实渲染验证音轨确实有声音且不是哑的
- [x] 片尾信息（团名/路线/天数价格/出发日期）此前 100% 是模板作者写死的示例内容，从不随视频变化——新增 `CreatomateTemplateContract.requiredPostFields` + `content_posts.generation_context_snapshot.endcard`（PR #1613），每条视频可以有自己真实的片尾内容，缺字段直接拦渲染不许静默套用旧内容。已用两条真实渲染验证（"Best of China"/"China Awaits"两条视频片尾信息各自正确、互不相同）
- [x] 🔴 早前记录"MUAPI_API_KEY 缺失是低频 P3"是错的判断——2026-09-13 当天晚些时候真正用全新脚本出片（不复用旧 scenes）才发现真正根因：`loadRankableClientAssets`（自动选真实照片）的数据库查询有 bug，把 47 张已核实真实照片里的 46 张误判成"视频"过滤掉了，池子实际只剩 1 张，几乎每次都会命中"配不到真实照片→AI 现画兜底"这条路，而不是低频边缘情况。已修复（PR #1615）：改成跟同文件另一处已经写对的逻辑一致的判断。修复后验证：真实照片池从 1 张恢复到 50 张，两条全新脚本各自正确匹配到长城/故宫/兵马俑/上海真实照片。`MUAPI_API_KEY` 本身仍未配置，但命中率修复后应显著下降，不再是当天最紧迫的事
- [x] 上一条遗留的 `MUAPI_API_KEY` 缺失当天晚些时候真的命中了三次（全新脚本每次都触发一个镜头配不到真实照片、回退现画、卡在 Muapi 图生视频缺密钥）——2026-09-13 PM 直接在 Render 后台补上，已用真实渲染验证 Muapi 回退路径恢复正常
- [x] 片尾信息此前虽然有 `requiredPostFields` 机制（PR #1613），但全仓库没有任何代码真的往 `content_posts.generation_context_snapshot.endcard` 写值——此前两次"验证通过"全靠人工手写数据库代填，等于每条视频出片前都要一次人工介入，撞了 CLAUDE.md「FDE/PM 要填的字段必须连 Settings UI 一起做完，不能进 Supabase 后台直填」这条红线。新增 `CreatomateTemplateContract.offers`（按团/出发城市变体分的真实事实字典）+ `postFieldSources`（元素名→事实字段映射）+ 自动写入机制（PR #1632，子牙+魏征两轮设计复审 + 实施后复审共抓出 3 处真问题都已修）：这几个字段现在是纯函数确定性映射（不走 LLM，杜绝幻觉/改写风险），且"没指定用哪个团 + 客户配了 ≥2 个团"时 fail-closed 抛错，不会猜一份不相关的事实套上去。已用真实渲染验证：`endcard` 自动写对（团名/路线/价格/出发日期全部正确且互不相同），零人工数据库写入
- [x] 上两条遗留全部补完（PR #1642）：①`client-config.ts::mergeFactoryConfig` 的 Settings UI 写入路径此前确实没有回写 `static_overrides`/`required_post_fields`/`offers`/`post_field_sources`——已修，四个字段现在按"没带就沿用已存值、带 null 就清空、带合法值就覆盖"的语义正确合并。②新增结构化"资料包"管理界面（设置页 → 内容 tab → 视频工厂配置）：FDE/PM 自己就能增删团/档位及其真实字段，不用再找工程改代码；内容工厂看板"确认做"这一步新增归属下拉框（`content_posts.generation_context_snapshot.offer_key`），客户配了 ≥2 个资料包时必须先选。实施后复审（对抗性）额外抓出并修复两个真洞：offer_key 写入前不校验是否存在于客户配置里（会让选错/选到已删档位的视频混进渲染队列，等 Inngest 任务异步失败才发现——已改成确认那一刻同步 400 拦下）、资料包表单里档位名重复会静默互相覆盖（已改成阻塞报错）。CTS 真实的 7 个在售团（Golden China / 圣诞团奥克兰+基督城 / Best of China / 丝路 / 双城记 / 上海周边）已从 `config/clients/cts/offerings.yaml`（见下面"内容/私信"分组的说明）导入配置好，用真实产品数据在生产环境跑通完整闭环验证（UI 选团 → 自动核对 → 自动填对片尾信息 → 渲染成功）。
- [ ] 上面这次发现：CTS 现在有**两套**"这个客户在卖哪些团"的真实事实存储——视频工厂这边（`factory_config.render.creatomate.offers`）和私信回复 Agent 那边（`config/clients/cts/offerings.yaml`，#1577）各存一份，语义高度重叠，以后团有变动要改两个地方，容易漏改。建议后续把其中一份定为唯一真相源，另一份改成读它、不再各自维护。
- [ ] 真实照片排序（`rankAssetsByPrompt`）疑似没有匹配度门槛，会把明显文不对题的照片当"匹配成功"返回（如故宫文案配上长城照片、兵马俑文案配上梯田照片，`reason` 字段自己写的解释都文不对题）——2026-09-13 诊断发现，已建独立任务调查范围和优先级，不在这批改动里处理
- [ ] NAL（New Asian Logistics，物流客户）首次接入视频工厂——PM 拍板"先用现有真实素材做1图1视频"，2026-09-13 已完成（真实素材取自 NAL 自己的 Facebook 主页，走 ffmpeg 本地合成，未走 Creatomate，NAL 没有专属模板）。素材偏薄（只有1张车队照+1条员工讲解视频），正式量产前建议向客户要更多真实素材
- [ ] **CTS 三个优先团（11月 Golden China / 12月圣诞团奥克兰版/基督城版）实拍两轮真实渲染，均未过分镜自检，未发布**（2026-09-16）。用刚上线的"资料包管理界面"核对时发现并直接在生产环境修正了 3 处真实错误（golden-china/xmas-nye-akl/xmas-nye-chch 三个资料包的"路线"字段城市顺序跟官网真实行程逐字核对后不符，如实修正——详见 PR #1786）；同时发现并修复一个平台级 bug："视频工厂配置"面板若 `factory_goal_id` 指向一个已失效/不属于本客户的目标，下拉框会显示占位符但底层仍带着失效引用，导致保存被后端拒绝且 UI 无法自行清除——已修（PR #1786，子牙+魏征两轮复审 CONDITIONAL PASS，等 PM `go merge`）。
  - Golden China 用生产环境真实跑了两轮完整"选题→确认→Creatomate 渲染"：第一轮脚本 6 段落里混了开场白/结尾 CTA（不是纯 6 个地标各一段），导致地标错位——故宫这一段的画面被顶替下移，"上海"变成一张跟内容完全不相关的绿色峡谷航拍图配"Huangpu River cruise"字样；第二轮改成严格 6 段落（长城/故宫/胡同/西安/兵马俑/上海各一段）后位置对齐了，但真实照片匹配这一步本身选错图：故宫画面选中了一张**西藏风格金顶寺庙**（明显不是故宫）、胡同画面选中了长城照片的重复图。两轮渲染都在分镜自检表这一步被拦下，均已打回草稿，未进入板桥审核，未发布。
  - **根因已定位、非玄学**：CTS 素材库里其实已经有 3 张标注正确的故宫真实照片（`forbidden-city-aerial.jpg`/`forbidden-city-gold-lion.jpg`/`forbidden-city-lion-2.jpg`）和标注正确的胡同真实照片（`p_hutong_x36931913.jpg`，第一轮渲染时其实被正确选中过），问题不是"没有照片"，是真实照片排序算法本身选择不稳定——跟 [ROADMAP.md 第67行]已经记录的"真实照片排序无匹配度门槛"是同一个根因，PR #1655（置信度门）已经写好、过了6轮 Codex 复审，还在等 PM 一句话合并。**建议**：合并 #1655 后再重跑这两条 Golden China 渲染，大概率能解决故宫/胡同选错图的问题。
  - 圣诞团奥克兰版/基督城版：脚本已按真实官网行程写好（长城明确写的是慕田峪 Mutianyu，不是 Juyongguan——两个团真实去的地方跟 Golden China 不一样，已避免把两个团的长城位置搞混），但**故意没有触发渲染**：现有 Creatomate 模板的"长城"那一屏画面下方有一行写死的副标题文字"at Juyongguan"，这行字模板设计阶段就固定了、不会随视频内容变化——Golden China 真的去 Juyongguan 所以没问题，但圣诞团两个团实际去的是慕田峪，如果直接用这个模板渲染，成片上会出现一句写死的错误地点文字。这是真实存在的红线风险（跟 PITFALLS D2 那次"长城日出"事故同一类型：地点细节跟官网不符），不是我能在这次会话里改的（改模板固定文案需要能登录生产 Creatomate 账号的人去模板编辑页改，见 PITFALLS/decision-ledger 里"当前登录账号跟生产账号不是同一个"的已知阻塞）。**在这行文字改成能按团动态变化之前，不建议用这个模板给圣诞团出片**，或者需要 PM 明确接受"字幕写错但问题不大"这个折衷。

## CTS Meta CAPI — CRM 表格数据源接入（PR #1597，已合并 2026-09-12，迁移已 apply）

> 背景：`me_sale_outcomes`/`me_conversion_writebacks` 表结构（Issue #1397）2026-09-05 已定稿。
> 这条给它接了第一个真实数据源：CTS 人工维护的 Google Sheet（FB 即时表单留资 + 员工跟进
> 记录）。设计经子牙+魏征两轮独立复审后实施，详见 PR #1597 描述。
>
> **2026-09-15 更新**：下面这份清单原本停在"还没接生产"的状态，是过期快照——实际这条线
> 早就跑起来了：`source_kind='crm_sheet_sync'` 的迁移已 apply（生产库确认约束里有这个值）、
> Google Sheet 访问权限和 Sheets API 已经在跑（生产库有 513 条真实同步记录，不是理论上能跑）、
> `POST /api/admin/conversions/cts-crm-sync` 已经跑过很多次并入了后续几轮工作（NAL 私信同步、
> AI 全自动审核、`conversion-daily-pipeline` 每天自动调）。本节剩下的只是两条当初就没解决、
> 现在依然没解决的真实缺口，不是"还没上线"。

- [x] ~~PM 确认 `source_kind='crm_sheet_sync'` 命名~~——已定，已 apply
- [x] ~~PM/FDE 把 Google Sheet 分享给 service account~~——已在跑，513 条真实记录为证
- [x] ~~确认 GCP 项目里 Sheets API 已启用~~——同上
- [x] ~~用 `POST /api/admin/conversions/cts-crm-sync` 真实跑一次~~——已经跑了很多次，现在
      `conversion-daily-pipeline`（PR #1738）每天自动跑
- [ ] **依然真实存在**：`阶段Stage` 列 1599 行只填了 1 行，`阶段更新日` 列 100% 空白——"已
      成交"检测目前几乎找不到信号，是表格填写现状不是代码问题；等 PM/FDE 开始真正使用这两列，
      成交同步会自动生效，不需要改代码（这条 2026-09-15 用当前生产数据重新核实过，情况没变）
- [ ] 若未来这条同步的记录量明显起量（不再是当前的量级），"查不到价格/缺日期"的搁置项要不要
      升级成正式的 `pm-todo` manual item（而不是只在同步响应里一次性返回），需要重新评估

## NAL 私信 → Meta CAPI 有效咨询同步（PR #1675/#1684/#1689，dry_run，已合并，2026-09-14/15）

> 背景：CTS 那条线（上一节）接的是结构化 Google 表格；NAL（New Asian Logistics，跨境集运
> 物流代理）182 个 Messenger 联系人几乎全无邮箱/电话（2/182 有电话，3/182 有邮箱），得先
> 给 `me_sale_outcomes` → Meta CAPI 这条共享通道扩展第三种匹配键（Facebook 私信身份/PSID）
> 才能接上这条数据源。全程经两轮子牙+魏征设计评审 + 每次实现完再复审一遍实际代码，
> 详见 `src/lib/conversions/nal-messenger-lead-classify.ts` 文件头的完整设计说明。

**已完成**：
- [x] 修了一个**跟 NAL 无关、影响 CTS 现有真实发送**的漏洞——发送前的拒联检查原来查
      `contacts.do_not_contact` 那一列，可能漏看还没被人工确认的最新拒联信号（PR #1675）
- [x] `me_sale_outcomes` 扩展支持 Facebook 私信身份（PSID）当第三种匹配键（PR #1684，
      migration `20260915000001_conversion_page_scoped_user_id` 已 apply 到生产库）：客人
      要求删除个人信息时这一列同步清空、`action_source` 由数据来源渠道决定不靠字段反推、
      预览界面绝不暴露 PSID 原始值
- [x] 用 21 个真实 NAL 联系人的对话人工标注 + 模拟跑规则验证过判据（0 假阳性，约 69% 召回），
      判据实现 + 编排层（PR #1689）：186 段真实对话跑通，判出 20 条有效咨询，全部正确写入
      `pending_review`；重跑一次确认幂等键生效，不会重复写
- [x] 手动触发入口 `POST /api/admin/conversions/nal-messenger-sync`（`guardGlobalAdmin`）

**范围内明确没做**（PM 待日后决定）：
- WhatsApp 未接入——设计标题写"私信/WhatsApp"，但 NAL 现有 1913 段对话 100% 是 Messenger
  渠道，没有等价的稳定消息 id 来源可验证幂等设计，这次范围收窄到 Messenger

> 「已成交」判定这一块，2026-09-15 已在下面单独一节（NAL 客户管理工作台标已成交 → CAPI）
> 补上，见下方，不再是缺口。

**待办**：
- [ ] PM/FDE 决定要不要开始审核这 20 条 `pending_review` 记录、要不要切到真发送
- [ ] 编排层目前每次全量重扫该客户全部历史消息（无增量游标），今天 186 段对话（最长 102
      条消息）跑得动，量级明显起量后建议加时间下界过滤——魏征复审记录的已知技术债，不影响
      当前正确性
- [ ] 对话没有关联联系人的情况目前生产库实测 0 个，代码已加 `skippedNoContact` 计数防呆，
      后续若这个数字非零需要去查联系人建档流程是不是有延迟/漏建档

## NAL 广告预算止血 + WhatsApp 对话接入排查（2026-09-21）

**第一件事·广告预算已处理完**：主系列「新亚8月广告系列-物流」（`52589907084125`）预算
$62/天但真正带咨询的 Messenger 广告组「物流潜在客户广告组」（`52589967398925`）当时是暂停
状态，只剩再营销组在跑，当天只花掉 $9.76；同时两个零咨询零留资的播放量视频系列各花
$10/天、$20/天。已执行：恢复 Messenger 广告组、暂停两个视频系列、主系列预算从 $62/天加到
$92/天（把视频系列省下的 $30 并入）。四个改动都用 Graph API 直接确认回读生效，审计记录已
写入 `flywheel_actions`，工作日志已写入 `fde_work_logs`。**待办**：观察 1-2 天，确认咨询量
回到暂停前的每周 30-50 条水平；若没回升需要进一步排查。**2026-09-21 Codex 复审第 2 轮抓到**：
这个复查此前只写在本文档里，没有任何执行管道会主动提醒，违反铁律 3 下半「管道不许断头」——
已改成同时下发一条截止 2026-09-23 的今日待办（`src/lib/pm-todo/client-doc-manual-tasks.ts`），
不再只靠人回头翻文档。做不到用已同步的广告数据自动判定回升与否（咨询量算不算「回升」目前
要读对话内容判断，不是能可靠自动跑的规则），先用带截止时间的人工待办兜底。**2026-09-21
Codex 复审第 3 轮抓到**：这条待办原本让操作者去 ME 的「广告健康」页面核对，但实测那个页面
只按整个系列汇总近 7 天，没有广告组维度也没有逐日数字，指定的广告组在那页查不到；ME 系统内
也没有其他页面能按天看某个广告组的咨询数（这个能力还没建）。已改成直接指向 Meta Ads Manager
本尊查该广告组自己的原生逐日「Messaging conversations started」指标做粗判，不再指向一个查
不到目标数据的链接。

**第三件事·30天咨询量增长方案（PM 目标：每天稳定咨询 10 个以上）**：

拉了 9 月以来的真实数据对账：9/1-9/12（私信广告组正常开着那段）平均每天"打开对话"9.6次，
9/13-9/20（广告组被误停那段）掉到 4.4次/天——跟第一件事是同一个问题的另一半证据。平台拆分：
Facebook 占过去14天91%的"打开对话"效果；Instagram 花得少但单次对话成本更低（$4.19 vs
Facebook $5.93）；Audience Network 这个投放位置14天花了$69.67、零效果，纯浪费。专门做
WhatsApp 的那条线单次打开对话$2.62，是三条线里最便宜的；ThruPlay 攒的重定向池子14天只带来
2次对话、比直接投私信广告还贵，PM 已同意关停（Thruplay 两个系列在第一件事里已经停了）。

PM 澄清目标口径：稳定在10个以上是"咨询"（客人开聊，哪怕当周没成交也算潜在客户，历史上这批
咨询质量本来就不错），不是 Meta 表单那种"留资"（NAL 基本不用表单，这个数字一直趋近于0，不能
当核心指标）。按这个口径，9/1-9/12 的 9.6次/天已经很接近目标，不是要从头翻3-4倍，主要是把这个
水平稳住、再往上拱。

**已执行**：PM 拍板把 WhatsApp 线（`52594661605725`）预算从 $25/天翻倍到 $50/天（三条线里
最便宜、最确定的渠道，直接加码）。Graph API 执行+回读确认，审计记录已写 `flywheel_actions`，
工作日志已写 `fde_work_logs`。

**待办**：
- [ ] 观察本周"打开对话"数量能不能回到并超过健康期 9.6次/天水平，单次对话成本有没有明显上涨
      （超过健康期50%就是见顶信号，要停止加钱改用换素材/换受众，不能一路硬冲）
- [ ] PM 待决定：Audience Network 这个零效果的投放位置要不要关掉（不花新钱，纯粹省掉浪费）
- [ ] PM 待决定：一直停着的"3PL"留资表单系列（纽澳都投，不只新西兰）要不要小额重新测试，
      作为扩大盘子的一条路——前提要先确认 NAL 是否真的服务澳洲客户
- [ ] 第二步加码（私信线/WhatsApp线继续加预算）视本周数据决定，不会自动往下涨

**第二件事·WhatsApp 对话接入排查结论——不是要新建，是要把已经写好但没启用的东西接通**：

原以为要新建一条 Messenger 那样的 webhook 接入线，实测发现**代码早就写好了**：
`src/app/api/webhooks/whatsapp/route.ts` 是一条完整的 WhatsApp Cloud API webhook（签名校验、
建会话、写 CRM 触点、退订检测、事件广播全都有），`src/lib/whatsapp/send.ts` 管发送，跟
Messenger 走的是同一套 `conversations`/`contact_touchpoints` 表、`channel='whatsapp'`。
**真正卡住的是下面这几件事**，跟"要不要写代码"无关：

1. **数据库那张表的新字段其实没加上**——`supabase/migrations/20260902000002_whatsapp_phone_number_id.sql`
   这个改动文件半个月前就合并进主分支了，但从来没有真的对生产数据库执行过（`clients` 表里
   实测没有 `whatsapp_phone_number_id` 这一列，查询直接报错"字段不存在"）。这是纯新增字段，
   风险很低，但按铁律"改生产数据库需要 PM 明确拍板"，这次没有擅自执行，**等 PM 一句话**。
2. **NAL 那个 WhatsApp 号码的技术编号（phone_number_id）现在拿不到**——想用现有的广告授权
   直接从 Meta 后台查这个号码的编号，被 Meta 拒绝（403，权限不够），当前用的授权缺一个叫
   `whatsapp_business_management` 的权限。这个权限只能在 Meta Business 后台里手动加，不是代码
   能绕过的。**需要 PM/FDE 进 Meta Business 后台，给现在这个系统用户授权加上
   `whatsapp_business_management`**，加完之后就能自动查到号码编号，不用再人工找。
3. **卡的不是 NAL 自己的企业身份，是"魔法引擎"自己这个技术服务方的身份**（2026-09-21 PM
   纠正：NAL 自己的企业身份验证是通过的）——[#1299](https://github.com/bigbigraydeng-maker/magic-engine/issues/1299)
   说的是 Magic Engine 自己在 Meta 开发者后台注册的那个应用（`1752513682785923`）还没通过
   Meta 对"技术服务提供方"这一层的身份核实，需要 PM 本人上传我们公司的证件。这一层过不了，
   上面第2条要加的 `whatsapp_business_management` 权限就申请不下来——跟 NAL 自己有没有验证
   过完全是两件事，NAL 验证过也没用，因为要验证的是我们。这一步不卡继续做前两步，但卡
   "这条 WhatsApp 线真正在 Meta 那边生效、开始收到消息"这一天。
4. **生产环境还缺两个必配变量，前三步全做完照样收不到消息**——查了 `docs/ENV.md` §10，
   `META_VERIFY_TOKEN`（订阅握手用）和 `META_APP_SECRET`（签名验证用）在 Render 上都标
   "⬜ 待配"。实测 `src/app/api/webhooks/whatsapp/route.ts:66-68` 缺 `META_VERIFY_TOKEN`
   时订阅握手直接返回 500，`:487-489` 缺 `META_APP_SECRET` 时收消息也直接返回 500——不是
   "配置不完美"，是**这条线现在物理上收不到消息**。如果还要让 ME 回复客户（不只是收），
   `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` 同样待配（`lib/whatsapp/send.ts`
   的关键路径依赖）。这四个变量的配置与验证必须跟前三步一起算作启用前置项，不能等前三步
   做完才发现还缺这一环。

**下一步（PM 拍板，不是技术选择；前三条已按铁律 3 下半下发到「今日待办 / 🙋 需要你动手」
[`src/lib/pm-todo/client-doc-manual-tasks.ts`]，不只是留在这份文档里；2026-09-21 Codex 复审
第 3 轮抓到 migration 决策和 `META_APP_SECRET` 此前都只留在本文档没进管道，已补下发）**：
- [ ] （已下发今日待办，回 `go apply` / `暂不`）PM 决定：要不要把
      `20260902000002_whatsapp_phone_number_id.sql` 这个已合并到主分支、纯新增字段的改动，
      对生产数据库真正执行一次
- [ ] （已下发今日待办）PM/FDE 去 Meta Business 后台给系统用户加 `whatsapp_business_management`
      权限（加完后可以用现成脚本自动查出 NAL 的号码编号，不需要再人工翻）
- [ ] （已下发今日待办，同一条里已把 `META_VERIFY_TOKEN` / `META_APP_SECRET` 配置一起带上）
      PM/FDE 去 Meta App 后台确认这个号码的 webhook 订阅是否已经打开，并在 Render 后台把
      收消息必配的 `META_VERIFY_TOKEN` / `META_APP_SECRET` 两个变量配上
      （这一步也需要能登录 Meta 后台+Render 后台的人核实，无法从这台开发机验证）
- [ ] PM/FDE 在 Render 后台把 `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`
      （要回消息才需要，不影响收消息）两个变量配上——优先级低于上面三条，暂未下发今日待办
- [ ] #1299 企业验证走完，再确认线上真的开始收到 WhatsApp 消息
      （命中一句话：企业验证走完后来查一下WhatsApp消息有没有开始进系统——建议这一步由 PM
      在 #1299 验证通过当天，去 Supabase 查一次 `conversations` 表 `channel='whatsapp'` 的
      条数是不是从 0 变化）

不需要新写 webhook 代码、不需要子牙+魏征架构复审——因为没有新架构，是把已经审过、已经合并
的现成能力接通。真正要做的几步全是配置/审批动作，不是技术选型，所以直接列出来等 PM 拍板，
没有抛回"走 A 还是走 B"这类技术问题。

## NAL 客户管理工作台"标已成交" → 自动写一条 Meta CAPI 成交记录（PR #1715，dry_run，已合并，2026-09-15）

> 背景：上一节留的缺口——NAL 员工在临时 CRM 工作台里把联系人标"已成交"时没有金额来源，
> 拼不出合法的成交记录。这次直接给这个动作接上金额输入，标已成交时同时生成一条走
> `me_sale_outcomes` → CAPI 审核发送通道的记录。只对 NAL 生效，不碰 CTS 现有的独立成交
> 回传通道（表格同步）。两轮设计评审 + 实现完成后两轮实际代码复审，详见提交历史。

**已完成**：
- [x] `POST /api/admin/conversions/nal-mark-won`：推进阶段 + 写成交记录一次性完成，
      鉴权跟"审核/发送成交记录"那几个既有接口同一级别
- [x] 复审揪出并修复一个真实漏洞（两轮）：原代码先把联系人阶段改成"已成交"、再校验能
      不能生成合格记录，任何一步校验/写库失败都会留下"人被标成已成交、但没有对应成交
      记录"的孤儿状态。最终顺序理顺为"记录先真的写进数据库，成功了才推进阶段"
- [x] 数据库新增 `crm_stage_manual` 来源分类标签，已 apply 到生产库
- [x] 前端金额面板只对 NAL 生效，不影响 CTS 现有"改状态"交互（24 条自动化测试覆盖）

**待办**：
- [ ] PM/FDE 决定要不要开始审核这批新记录、要不要切到真发送
- [ ] 技术债（不影响当前正确性）：`WON_STAGE_KEY` 目前写死对应 NAL 今天的阶段配置，跟
      前端"是否弹出金额面板"的判断（只看 `marketingAction`）是两套独立逻辑，Settings 页面
      没有唯一性约束防止未来配置出两个"已成交"档——目前 NAL 只有一档，可接受，但改 NAL
      阶段配置前要注意这个耦合

## 成交审核换成 AI 全自动判断+自动发送，带异常刹车（PR #1721，已合并，2026-09-15）

> 背景：PM 拍板把审核页面"人工点确认才发给广告平台"这一步换成 AI 直接判断+自动发送，
> 不要人再点一下；唯一让步是要有"异常刹车"（发送量/金额/批准占比异常时自动暂停+通知）。
> 两轮设计复审 + 实现完成后两轮实际代码复审，详见提交历史与 CHANGELOG。

**已完成**：
- [x] `POST /api/admin/conversions/ai-auto-review-run`：AI 判断 + 熔断检查 + 复用既有
      `sendApprovedOutcome` 发送通道，鉴权按 clientId 有无分别走 `guardConversionRoute`/
      `guardGlobalAdmin`（最终代码复审揪出并修复了一个真实的权限漏洞——最初错用了
      更松的 `guardAdmin`）
- [x] 数据库新增 4 个字段（客户级开关+熔断暂停原因、记录级重判次数+时间戳），已 apply
- [x] 姓名注入防护（客户可控文本白名单清洗 + 系统提示安全声明）
- [x] 独立于熔断的客户级停止开关 `clients.ai_auto_review_enabled`（默认 false）
- [x] 熔断触发后接入既有 PM 待办拉取管道，不新开通知通道
- [x] 41 条自动化测试覆盖（含两轮复审各自新增的回归测试）

**待办（PM 待拍板）**：
- [ ] 数据库那两个新开关默认是关的——代码合并上线**不代表**已经对 CTS/NAL 生效，
      要不要真的打开、先开哪个客户、什么时候开，需要 PM 另外一句话拍板
- [ ] 这一版只有手动触发入口，没有接 Inngest 定时——先观察几天判断质量和熔断阈值，
      校准过再决定要不要接定时（子牙复审建议：这次风险比现有手动先例更高，值得先看效果）
- [ ] 熔断触发后目前只进 PM 每日待办（拉模式），不会主动推送邮件——如果这类"钱可能
      发错"的异常，PM 觉得需要更及时知道（不等自己点开待办页面），需要另外决定要不要加
      邮件/即时通知，这次范围内没做（魏征复审标记为非阻塞，留给 PM 判断优先级）

## CTS Messenger+WhatsApp 治理式客服 v3 —— 事实层改用客户知识库平台能力（2026-09-14）

> 完整方案（v1/v2/v3 全在一份文件里，v3 = WhatsApp 双渠道扩容 + 9 条必补项 + §9.14 C 客户
> 知识库同步修订）：`~/.claude/plans/cts-tours-messenger-dynamic-pearl.md`（不在仓库里，
> 本地文件）。平台层级登记：[docs/registry/platform-candidates.md](./registry/platform-candidates.md)
> 第 79 行（Governed Lead-Reply Agent）。跟踪 issue：
> [#1290](https://github.com/bigbigraydeng-maker/magic-engine/issues/1290)。

**进度**：方案已过子牙+魏征 2 轮复审 + 板桥客户视角复审，Build Gate 五关走完，拆成 18 个
GitHub issue（#1574-#1592）。**wave-1/wave-2 共 7 个 issue 已合并到 main**：数据库表结构
（#1628）、跨渠道退订检测（#1625）、对话分类逻辑（#1621）、CTS 团清单资料层（#1626，**已
作废，见下**）、channel-dispatch 查表分发（#1636）、WhatsApp webhook 退订+事件接线
（#1637）、Messenger webhook（#1640）。

**2026-09-14 重大变更**：开发过程中发现 #1577/#1626 的 `offerings.yaml` 事实层方案跟一条
更早的真实 PM 决策（`docs/DECISIONS.md` 2026-09-13 记录："客户知识库作为 Governed Lead-Reply
Agent 的事实层，替代 offerings.yaml 路线"）矛盾。PM 拍板"一步到位建客户知识库平台能力"
（独立 L1 候选，见 [docs/registry/platform-candidates.md](./registry/platform-candidates.md)
及本文档下一节"客户知识库"）。**2026-09-15 更新：6 步已全部合并完成**，详见下一节
"客户知识库"的完整清单——不在这里重复列。

本方案 Layer 1（事实层）/2（3 只读工具，#1639 已把原 4 个收敛为 3 个）/3（五闸）/4（F1 auto-ack）/5（daily-todo 复核栏）
六处已改接 `getClientKnowledge`，`config/clients/cts/offerings.yaml` 及其加载器整条路线
已作废（详见方案文末"§9.14 C 同步修改"章节）。

**此前 Held 的 PR，依赖已解除，改接 + 两轮复审 + 合并全部完成（2026-09-15）**：等的是
`getClientKnowledge` 全部 6 步真正合并完，2026-09-15 步骤 6（#1648）合并后 6 步已全部到位。
改接工作完成后子牙+魏征各跑了两轮（第一轮各自独立发现真实问题、打回；修复后第二轮各自核实
确认已解决），PM 拍板后两个 PR 均已合并到 main：
- [x] #1638 Verifier 框架 + CTS policy —— 已改接 `forbiddenFactKeys`/数字核实闸设计（新定义
      `tour.active.<code>`/`tour.retired.<code>[.alias.<slug>]` fact_key 命名约定供 gate 2 用）。
      复审中发现并修复两个真实漏洞：① 事实标签打错一类（`sensitivity` 标成 `general`）会绕过客户
      确认闸门，AI 有可能说出没经过客户确认的价格——已加二次校验；② 判断"是不是提到了下架产品"的
      算法在 CTS 真实产品数据上会误伤合法回复（两句话拼接 / 产品名字首字重叠）——已改成按句子
      分开判断。42 条测试通过，`npm run build` 通过。子牙 CONDITIONAL PASS（条件：把"命名约定没人
      强制遵守"这条已知风险开一个正式跟踪单——已开 [#1726](https://github.com/bigbigraydeng-maker/magic-engine/issues/1726)，P3，不阻塞合并）；魏征 ✅ 通过。
      **已合并**（merge commit `65efbfa0`）
- [x] #1639 agent-core prompt.ts + tools.ts —— 已改接（4 工具收敛为 3 个：
      `query_customer_facing_facts`/`query_conversation_history`/`query_client_brand_facts`，按
      purpose+sensitivity 模型）。复审中发现两处文档描述跟代码实际行为对不上（不影响功能，但会
      误导以后维护的人），已改正。158 条测试通过，`npm run build` 通过。子牙 ✅ 两项都已解决。
      **已合并**（merge commit `2c05d77f`）

代码本身还只是静态校验/推理逻辑，**尚未上线**——Messenger/WhatsApp webhook 接收本身已合并
（#1637/#1640，见上），CTS 私信客服真正跑起来还需要 Inngest 编排消费**已接收的 Messenger 事件**
（范围已冻结只做 Messenger 一条路，见 [docs/roadmap/2026-09-15-crm-ai-agent-build-control.md](./roadmap/2026-09-15-crm-ai-agent-build-control.md)
"范围问题已拍板"——WhatsApp 目前止于接收落库，不接入 AI 应答编排）、门户 UI、dry-run 验证等
剩余步骤（见本节下方"剩余 issue"）。

**审查过程发现并已修复的关键问题**（wave-1，不是走过场，逐条真实验证）：数据库外键漏写级联
删除；退订判断第一版设计换渠道即失效（已改用现成的 `contacts.do_not_contact` 机制）；CTS
团清单目录名（`cts`）跟数据库客户 ID（UUID）对不上会导致整套功能在生产环境直接报错。

**已知但不阻塞的后续项**：
- `optout.ts` 的撤销入口/分页/写路径归属校验三项小缺口，详见 issue #1290 评论

- [x] F1（issue #1584，安抚话术自动发出）/ F2（issue #1585，AI起草→7道核对→存草稿→等
      人工批准→发送主链路）/ F3（issue #1586，人工审批结果回传）/ F4（issue #1587，系统
      健康巡检）**四个 Inngest 编排函数已全部合并到 main**（2026-09-15，F2 最后合并，
      merge commit `8bb140f1`）。**代码合并 ≠ 已上线接真实客户**——下面这几项仍是剩余项：
  - [ ] 门户 UI（PM/FDE 看草稿、点批准/改后发送/拒绝）还没做，F2 存的草稿目前没有人能在
        界面上批准，只能直接改数据库测试
  - [x] dry-run 验证（issue #1591 · Messenger 部分，2026-09-16）：拿 CTS 生产库真实 30 条
        私信（覆盖问价/团期/退改/签证/行前/中英混用/长短消息/表情/post-sale 九类，"已停团"
        只挑到 1 条代理样本——见下方缺口说明）跑通了完整 F1→F2→verifier→人工批准→发送
        链路，跑在临时开的 Supabase 隔离测试分支上，**未污染生产的 `conversation_reply_drafts`
        审核队列**（跑完已删除测试分支）。真实数据实测揪出两个真问题，已开独立 issue 交回
        对应源头，不在这个验证任务里现场打补丁：
        - [#1772](https://github.com/bigbigraydeng-maker/magic-engine/issues/1772) F2 起草
          AI 输出解析失败，真实数据实测 **8/30（26.7%）** 直接卡进 `error` 态需要人工捞
        - [#1773](https://github.com/bigbigraydeng-maker/magic-engine/issues/1773) post-sale
          分类器误判，实测至少 2/30 条明显不是售后（单人问价、要行程单）被错误跳过 AI 起草
        - 另一个已知缺口（不是代码 bug，是数据缺口）：CTS 名下目前 **0 条**"下架团不能提"
          知识事实，导致"已停团"这道 verifier 闸这次 30 条里一次都没被真正触发过，闸本身
          现在对任何输入都不会拦——要不要给 CTS 补这类知识事实，是产品/客户侧决定，不是
          代码缺陷，留给 PM/FDE 判断优先级
        - 批准→发送这条链路抽样实测了 4 条，2 条完整走到"已发送"（假发送，不真实外发），
          2 条因为重放的是几个月前的历史对话、用今天的时间点算批准窗口显示"已过期"——这是
          重放旧数据的正常现象，不是代码问题
  - [x] 长度阈值真实发送验证（issue #1591 剩余项，2026-09-16 收尾，PM 拍板跳过）：
        WhatsApp 那一半确认不适用（AI 客服范围已冻结不做，WhatsApp 现在只发 F1 的固定
        模板消息，没有"AI 起草超长被截断"这个风险，测了也验证不出任何生产会遇到的情况）。
        Messenger 那一半原计划挑一条 1800 字符（JS 字符串 `.length`，等于代码里
        `MAX_REPLY_LENGTH` 的判定口径）、实测 3280 UTF-8 字节的中英文混排+emoji 边界文案
        真发一次，确认 Meta 不会按字节数比我们认为的字符数更早截断/拒绝——PM 本人已经
        配合发了一条测试消息打开真实会话窗口，但实际执行时卡在一个真实的技术限制：本地
        开发环境里没有（也不应该有）CTS 生产用的 Meta 系统用户令牌，那个令牌只应该存在于
        正式部署的服务器环境里，往本地环境搬会是真实的安全隐患。要继续测只能改在正式服务器
        环境里跑，需要额外搭建执行入口，PM 判断这一项优先级不足以为此专门搭一套发送通道，
        拍板跳过，记为**已知未验证风险**：Messenger 长度阈值在真实平台层面（字节数口径）
        是否会被截断，目前仍未经真实发送验证，只验证过我们自己代码里的字符数口径
        （`src/lib/messenger-agent/verifier/policies/cts.ts` 的 `MAX_REPLY_LENGTH = 1800`）
  - [ ] Delivery day 灰度切换：真正对 CTS 客户开放前的开关计划还没定
  - [ ] F4 系统健康巡检故意留的缺口——issue 原文要求的"4小时批准超时算事故"这一项**仍未
        做**。当时没做是因为依赖 F2 发出的 `conversation/reply.timeout` 事件，F2 那时还没
        写；**现在 F2 已经合并，事件已经有了，需要回来给 F4 补这一类检查**（代码里已有
        注释标记位置：`src/lib/messenger-agent/health-heartbeat.ts` 文件头）
  - [x] 邮件渠道接入（issue #1745，PR #1808，已合并 main 2026-09-20 · merge commit
        `1c0d983f`）——见下方"范围问题已拍板"一节记录的**唯一例外**：PM 2026-09-15 当场
        拍板，只豁免邮件这一条渠道，不代表 Messenger-only 范围冻结整体松动。F2（AI 起草
        →人审→发送）已接受邮件，复用同一套渠道无关的只读工具/verifier/prompt/classify/
        optout 层（issue #1745 调研已确认）；F1（秒回安抚话术）刻意不接邮件——邮件靠每
        小时同步、秒回没有对应产品价值，这是业务判断，留给 PM/华佗决定要不要做邮件版，
        不在这次范围内替他们拍板。顺带补上 `mail-ingest.ts`（邮件每小时同步）此前完全不
        emit `conversation/message.received` 的缺口（不补这个，channel-dispatch 认识
        邮件也没用，F1-F4 永远不会被邮件触发）；把"紧急停用全渠道" kill switch
        （`src/lib/knowledge/kill-switch.ts`）从两列扩到三列（不扩的话，加邮件之后这个
        按钮会变成"紧急停用两个渠道"却还叫"全渠道"）。子牙+魏征两轮独立复审均无 blocker，
        子牙顺手抓到一处文案没跟上（门户面板还写"Messenger+WhatsApp"）已在同一 PR 修复。
    - [ ] 后续跟进（子牙复审记录，不阻塞已合并代码）：F4 健康心跳对"某渠道消息已入库但
          从未生成过草稿"这类局部故障暂无检测能力——继承自 Messenger/WhatsApp webhook
          既有的 best-effort 设计，是三渠道通用缺口，不只是邮件专属，需要单独立项补
    - [ ] 邮件渠道的 kill switch（`messenger_agent_enabled_email`）仍然只有 API、没有
          Settings UI 开关——跟 messenger/whatsapp 两个既有开关同状态，可以一起补
    - [ ] **NAL（New Asian Logistics，client_id `4ae76381-cd45-43bd-85cd-98cfd7604007`）
          真实数据实测发现的缺口**（2026-09-20，PM 授权测试）：迁移已 apply 到生产库
          （`glbdnayojixmexgofbsd`，即 Supabase 面板里显示名为"CrazyContent"的那个
          项目——名字对不上是历史遗留，不是接错库，已用真实数据核实过）；NAL 的邮件
          渠道本身接得好好的（`sales@nalexpress.com`，Microsoft 邮箱，每小时正常同步，
          库里已有真实客户询价邮件）。但 NAL **没有配置 `verifier policy`**（AI 起草后
          自己核对内容对不对的规则本，目前只有 CTS 一家有，见
          `src/lib/messenger-agent/verifier/policies/index.ts` 的 `VERIFIER_POLICIES`
          查表）——`resolveVerifierPolicy` 查不到时 fail-closed 返回 `null`，F2 会把
          任何草稿直接判 `blocked`，永远进不了"待批准"列表。这意味着：**在没给 NAL
          写一套 verifier policy 之前，就算打开 `messenger_agent_enabled_email`，
          真实客户来信也只会白花一次 Claude 调用的钱、测不出任何有用结果，不会误发**
          （fail-closed 方向本身是安全的）。PM 拍板**先把 NAL 的开关关回 `false`**，
          等谁给 NAL 设计一套 verifier policy（参考 `verifier/policies/cts.ts` 那七道
          闸的写法，但物流询价这个行业需要重新设计判据，不是抄一份改客户名就行）之后
          再重新打开、正式测试。这次全程只做到"核实开关/迁移/邮箱接入状态"，**没有
          发送任何测试邮件、没有跑真实起草、没有花任何 Claude token**——发现问题就停，
          没有为了"测出个结果"硬冲。
- [ ] Meta 企业验证仍未通过（issue [#1299](https://github.com/bigbigraydeng-maker/magic-engine/issues/1299)，需要 PM 本人上传公司文件）——不卡继续开发，但卡 Messenger/WhatsApp webhook 真正上线那天

## 客户知识库（Client Knowledge Base）—— L1 平台能力，6 步已全部完成（2026-09-15）

> 方案：`~/.claude/plans/client-knowledge-base-capability.md`（本地文件）。PM 2026-09-13
> 拍板："长期来看 Magic Engine 后台一定要有自己的客户知识库这样的专门存储，一步到位按正确
> 做法建"。让 AI 对客户说价格/时效/承诺/政策类事实前，必须先过"ME 内部批准+客户本人确认"
> 双签闸——直接解决了 CTS "AI 报停售团价格"这类事故的根因（AI 靠训练数据背景知识乱编，不是
> 靠受控事实源）。**2026-09-15：6 步全部合并到 main，issue 均已关闭。**

**6 步进度（全部完成）**：
- [x] 步骤 1（issue #1643，已关闭）敏感度检测器 —— PR #1650 已合并
- [x] 步骤 2（issue #1644，已关闭）表结构 + 读取入口 —— PR #1652 已合并（过子牙架构+魏征
      挑刺+狄仁杰攻击验证三方复审，合并前修了邮箱比较缺 trim、身份唯一性设计跟冲突检测
      需求冲突两处真问题）
- [x] 步骤 3（issue #1645，已关闭）萃取工作流（Inngest，从 Messenger 对话里提炼知识候选）
      —— PR #1671 已合并，PR #1673 修了一处误依赖 budget-guard.ts 的设计违规。移植自另一
      窗口 PR #1616 已过魏征复审的核心算法，又经新一轮子牙+魏征复审修了 6 处真问题（PII 脱
      敏对英文地址完全无效、entitlement 检查顺序、进程崩溃恢复缺口等）。PR #1616 已关闭并
      credit
- [x] 步骤 4（issue #1646，已关闭）FDE 审核页 + 客户确认链接 —— PR #1685 已合并，PR #1690
      补了一次迁移版本号冲突。子牙+魏征+板桥三方复审发现并修复：客户确认后想反悔叫停 AI
      却找不到按钮、页面缺 §9.10 强制安心话、冲突事实被拆到不同批次、"确认了 0 条"文案
      自相矛盾；另外把"claim 确认请求 + 写事实"两步分开写的半失败态改成一个数据库事务
      （已用真实本机 Postgres 复现验证）。草稿输出检查（Verifier 层）明确不在本步骤范围，
      归 #1638/#1639
- [x] 步骤 5（issue #1647，已关闭）`brief.ts` 去 CTS 化 + CTS 历史事实迁移 —— PR #1694 已
      合并，收尾了 PR #1629 当时只是把 CTS 事实从系统提示词搬到 `brief-client-facts.ts`
      （同一条红线违规换了个文件）没有真正解决的问题；`brief-client-facts.ts` 已删除，CTS
      的 4 条历史事实迁移进知识库，其中免签政策一条给了到 **2026-10-15** 的确认宽限期（日
      历提醒已建：过期前一周提醒 FDE/PM 决定要不要走正式客户确认）
- [x] 步骤 6（issue #1648，已关闭）rollout 三段式阶段切换 + 客户确认链接页面 —— PR #1693
      已合并。子牙+魏征联合复审各自独立在真实本机 Postgres 上复现了一个真漏洞：ME 一键
      回退阶段（发现报价说错）后，客户手上一条更早发出的"同意前进"旧链接仍能被点开，把
      回退悄悄抹掉——已修复（同一个数据库事务里重新核对当前阶段，对不上就拒绝且不留痕
      迹地保留成可重试状态，不是简单标记失败）；板桥复审同时指出这一步最初交付时完全没
      有客户能打开的页面，已一并补上。合并过程中两个并发会话各自独立在同一个分支上处理
      同一个问题，靠互相 SendMessage 核对收敛，没有产生冲突结果

**6 步全部完成。** 遗留跟进（不阻塞，已知不阻塞合并）：
- issue #1669（确认人登记写入 API）已关闭，PR #1674 已合并
- `rollout.ts` 的 `hashesMatch` 跟 `confirmation-requests.ts` 几乎重复实现，未抽共享（魏征复审 ⚠️ 警告项，技术债不影响正确性）
- PR #1693 的描述文字落后于最终合并代码状态，未回填更新（魏征复审 ⚠️ 警告项，不影响代码本身）
- **操作陷阱已记入** [PITFALLS.md §D7](./PITFALLS.md)：给任何客户开 `client_knowledge.read` 授权前，必须确认同步走完 rollout stage 双签，否则 `customer_reply` 会静默读空知识库、不报错

## ME 旅游版 · Tour 管理模块（2026-09-14 立项，PM 已立版，未授权实施）

规划见 [`specs/2026-09-14-me-tour-management-module-plan.md`](./specs/2026-09-14-me-tour-management-module-plan.md)。ME 旅游版已正式立版（`registry/product-versions.md`，Customer Zero = CTS）。**已上线的只有「行程路线地图」这一块**（8 个 CTS 团在正式站，见 CHANGELOG 2026-09-14）；下面是模块化的未完成项，每步走双审 + 五道 Build Gate：

- [ ] **P1 · 统一/连接现有团事实源 + 最小营销快照**（A 级）：连接 `config/clients/cts/offerings.yaml` / `src/lib/web-intelligence/first-party-tours.ts`(`FirstPartyTour`) / 客户官网，**不新建第三份权威源**；价格/库存/出发日期按 `ME_PRODUCT_DEFINITION.md` §3.2 留外部源 Connector 读。先解决「多份源漂移、各渠道给客户不同答案」。
- [ ] **P2 · 路线图生成器产品化**（B 级）：把原型 `docs/specs/prototypes/tour-route-map/` 搬成 ME 正式能力，输入 = P1 快照，输出 PC + 手机 SVG 落公开桶。**前置：品牌/logo、底图、地理标注规则参数化**（当前 CTS/中国硬编码）。晋升门槛 = 第 2 个旅游客户复制（L2）。
- [ ] **P3 · Tour 管理后台 UI**（B 级）：ME 后台录入营销快照 + 一键生成地图；价格/出发日期只读展示。
- [ ] **P4 · 内容 + 定价产出**（B 级）：接现有 AI 文案 / SEO writer / grounding，从快照产出各渠道文案；价格读统一事实源。
- [ ] **P5 · 一键交付**（C 级）：地图 + 文案 + PDF brochure + 落地页片段打包。
- **PM 待拍板**：优先级（P1+P2 何时排期）· 第一版范围（只做地图+行程 vs 四块一起）。

## ME Web Intelligence v0.1 [ME-WI.0.1] — #1497

- [ ] Latest-result follow-up: show newest signal per page/direction including ignore; collapse earlier records without implying they are resolved. Read-only presentation, risk C, based on main bd6d3c4e47ae4d02feccabc9dcb88aabb744c1c6 fetched 2026-09-09.

- [ ] Readable UI follow-up: result-first views, collapsed configuration/evidence, Chinese future interpretations; locally verified, pending review/production release. Hiring/People/Partnership/Reviews/Technology collection remains a separate extension.

- [x] Implementation merged (#1500); production migration and CTS-only pilot explicitly approved and enabled. Existing Industry Baselines UI → Inngest → Apify → immutable snapshot/evidence → actual cost settlement verified on Wendy Wu homepage. Compatibility fixes #1506/#1507 deployed. [Implementation / rollout receipt](./specs/2026-09-09-web-intelligence-v01.md).
- [ ] Verify an actual later website change through LLM classification/recommendation; do not manufacture live evidence. One UI draft-refresh follow-up remains deferred; queued-run target recheck and content-limit failure settlement are implemented and regression-tested. Hiring/People/Partnership/Reviews/Technology remain future extensions. No automatic action.

## ME Web Intelligence 多管道外部情报 [ME-WI.0.2]

> **新需求登记（2026-09-11）**：WI 是面向高级客户的外部市场情报与竞争预警能力，不能收窄成竞品官网抓取。范围新增主流新闻媒体、行业新闻、行业杂志、招聘信息，并逐步接入 SERP、公开广告库、AI 可见度和口碑。完整需求与分期见 [多管道外部情报需求 v1](./specs/2026-09-11-me-wi-multichannel-intelligence-v1.md)。

- [ ] **ME-WI.0.2-A**：统一 source / observation / evidence / event 契约、来源等级、新鲜度、去重、运行状态与结果呈现。
- [ ] **ME-WI.0.2-B**：主流新闻、行业新闻、行业杂志/行业网站采集与事件抽取；旅游行业首批纳入 Travel Today 等垂直来源。
- [x] **ME-WI.0.2-B0**：完成首批 Apify Actor 适配和 Travel Today、TRAVELinc、Tourism New Zealand 来源登记；待生产 migration、真实小样本和调度验收。
- [ ] **ME-WI.0.2-C**：首期接入新西兰 SEEK、Indeed 公开招聘信息，识别组织与战略领先信号，并明确不等同于已发生业务事实。
- [ ] **ME-WI.0.2-D**：SERP、公开广告库、AI 可见度、口碑接入统一事件模型，复用既有 provider，不恢复已退役 `ai-tracker`。
- [ ] **ME-WI.0.2-D1**：通过 Apify `themineworks/similarweb-scraper` 接入竞品网站流量方向信号；仅保存域名级公开估算、变化率、来源结构和主要国家，标记低置信度，不将其解释为真实访问量、销售影响或 NZ 精确市场流量。已完成小样本验证、统一 observation/snapshot、经营 Agent 页面展示、历史趋势和默认关闭的月度调度；下一步做小样本线上验收，再决定是否打开 `WEB_INTELLIGENCE_TRAFFIC_ENABLED`。
- [ ] **ME-WI.0.2-E**：跨来源事件聚合、高级客户预警与周度情报摘要。
- [x] **ME-WI.0.2-F0**：登记 Facebook Group 受控情报源契约；仅支持客户授权导出或 Meta 审批后的接入，不实现绕过权限的社交抓取。
- [ ] 每条管道必须完成“采集 → 证据 → 时效 → 变化分析 → 结果呈现”，保持只读、建议型、人工复核；不自动执行外部经营动作。

## ME2 — Roman GEO / AI 可见度参考闭环（史诗 [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872)）🔄 GEO 测量线已跑出首个生产 baseline（WP08）

> **新窗口开工前必读**：[WP00 契约冻结 v1.0](./specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md)。
> 它冻结了七层边界、五个概念结构、禁令清单与未决登记表，**后续每个 WP 从那里取自己的边界，不重新讨论**。

**治理规则（跟本仓其它 Phase 不一样，别照惯例办）**：
- 架构、PR 边界、验收与合并决策归 **ChatGPT Build Control Room**；**不要自行启动任何 WP**，等它明确授权。
- 一个 Claude 窗口 = 一个已授权的 WP / PR。
- 生产 migration 的 apply 是**单独授权的运维动作**，必须 PM 显式 `go`，**绝不夹带进任何 PR**。
- 🔴 **PR [#844](https://github.com/bigbigraydeng-maker/magic-engine/pull/844) 不许合并**（独立 Website Growth Agent 架构已被本史诗取代），也**不许从它摘代码**。

**已合入 `main`**（下面注明哪些真跑过、哪些仍不活动；另见 [STATE.md §3.1](./STATE.md)）：
- ✅ WP00 [#873](https://github.com/bigbigraydeng-maker/magic-engine/issues/873) 契约冻结（PR #888，docs-only）
- ✅ 执行内核 v1（PR #863）—— 生产 migration **未 apply**、**无提交 / 执行调用方**。⚠️ 但**已有一条只读接线在生产跑**：`pm-daily-todo` cron 经 `pm-todo/manual-items.ts` 读 `action_runs` 生成交接待办（表不存在时报错被吞成警告）。详见 [STATE.md §3.1](./STATE.md)
- ✅ WP01 [#877](https://github.com/bigbigraydeng-maker/magic-engine/issues/877) 纯 Growth 契约（PR #890 / `700f57e`）—— `src/lib/growth/`，**仍零 importer、不活动**
- ✅ **WP02** [#876](https://github.com/bigbigraydeng-maker/magic-engine/issues/876) GEO 测量运行时契约（PR [#894](https://github.com/bigbigraydeng-maker/magic-engine/pull/894)）—— `src/lib/geo-measurement/`。issue 已关闭
- ✅ **WP03** [#875](https://github.com/bigbigraydeng-maker/magic-engine/issues/875) 不可变测量存储（PR [#897](https://github.com/bigbigraydeng-maker/magic-engine/pull/897)）—— `src/lib/geo-measurement-store/` + migration `20260811000001`，**已 apply**，并已真实承载 Roman Baseline v1。issue 已关闭
- ✅ **WP04** [#874](https://github.com/bigbigraydeng-maker/magic-engine/issues/874) 测量执行 + 成本 / 覆盖率控制（PR [#914](https://github.com/bigbigraydeng-maker/magic-engine/pull/914) / `caf8d481`）—— `src/lib/geo-measurement-runtime/`。issue 已关闭
- ✅ **WP04A** [#917](https://github.com/bigbigraydeng-maker/magic-engine/issues/917) 真 provider / parser / WP03 store 接线（PR [#922](https://github.com/bigbigraydeng-maker/magic-engine/pull/922) / `885fe6e1`）—— `src/lib/geo-baseline/`。**Roman Baseline v1 就是它跑出来的**。issue 已关闭
- ✅ **WP06** [#878](https://github.com/bigbigraydeng-maker/magic-engine/issues/878) 共享 Page 能力 resolve / snapshot / draft / diff / validate（PR [#895](https://github.com/bigbigraydeng-maker/magic-engine/pull/895) / `e818d9dc`）—— `src/lib/page-optimization/` + `src/lib/capabilities/page-optimization/snapshot.ts`，**零线上写、零持久化、零调用方**。issue 已关闭
      ⚠️ **交付的是被缩小过的范围，不是能力契约的全集**：Build Control Room 的 WP06 MINIMUM 实施指令（2026-08-10）冻结决定第 5 条明写「**WP06 的模型花费固定为零，不许加通用预算引擎或可配置花费政策**」，因此**代码里没有成本上限，也不该有**。
      但 [页面能力契约 v1.0](./specs/2026-08-10-me2-page-optimization-capability-v1.0.md) §10 的验收要点仍写着「draft 与 snapshot 的模型 / provider 调用都声明了成本上限，建立不起来就 fail closed」—— **两份权威文档打架，后发的实施指令赢**。真要恢复成本闸门，那是 WP07（#880，它才有真的对外调用）的事，不是回头改 WP06。
- ✅ **K-WP02** [#882](https://github.com/bigbigraydeng-maker/magic-engine/issues/882) ActionCandidate→ActionKey 治理 + per-action 副作用政策（PR [#898](https://github.com/bigbigraydeng-maker/magic-engine/pull/898) / `2d9e426a`）——
      📍 **主实现在 `src/lib/action-bridge/`**（`MAPPING_TABLE` / mapper / 词汇表 API 都在这里，且 `MAPPING_TABLE` 目前是**空数组**）；**只有副作用授权那一段在 `src/lib/kernel/`**（`outward-authorization.ts`）。
      🔴 K-WP02 的冻结边界要求 **bridge 不许放进 Kernel** —— 要加新映射就加在 `action-bridge/`，**别加进 Kernel 层**。
      🔴 **只是合并了，没在生产跑过**：映射注册表为空、**零调用方**，且它依赖的执行内核四张表在生产**根本不存在**（见下）。**不要把它跟真跑过生产的 WP03 / WP04A 归成一类。** issue 已关闭，关闭说明里逐字写明了「已合并 ≠ 已启用」

> **哪些真跑过生产 —— 2026-08-12 对生产库做对象存在性只读实查（不认文件名、不认版本号）**：
>
> | 对象 | 生产实际 |
> |---|---|
> | `geo_query_sets` · `geo_queries` · `geo_batches` · `geo_observations` · `geo_evidence` | **都在** —— 3 个批次 / 25 条观测 / 12 条证据 |
> | 批量原子写入 RPC（migration `20260812000001`） | **在** |
> | `action_runs` · `action_run_steps` · `authorization_decisions` · `client_automation_policies` | **四张全不存在** |
> | `kernel_*` RPC | **0 个** |
> | Roman 的 `client_site_pages` / `cms_connections` | **0 / 0** |
>
> 结论：**GEO 测量线（WP02→WP03→WP04→WP04A）真跑过一次生产；内核线（PR #863 + K-WP02）没有。**
> **别把「issue 已关闭」读成「功能已在生产生效」** —— 关闭只代表代码交付完成。

**未完成**：
> WP05（#879）与前置 #930 已于 2026-08-17 合入 main（PR #1032 / #1020）—— 详见 [CHANGELOG](./history/CHANGELOG.md)，此处按仓库约定不再保留完成项。

**WP05 follow-up**（本轮不扩，登记待排）：
- [ ] **#1023** WP05 follow-up
- [ ] **#1030** WP05 follow-up
- [ ] [#1040](https://github.com/bigbigraydeng-maker/magic-engine/issues/1040) 聚合分组键需按 `engine_family / model_version / query_set_version` 隔离（未知 fail-closed）—— Codex #1032 第 4 轮 P1-c，Roman 单引擎/单模型未触发但结构上带洞；已在 [comment 5315681257](https://github.com/bigbigraydeng-maker/magic-engine/issues/1040#issuecomment-5315681257) 追加两条：severity 分母独立锁减弱（P1-b 副作用）· `buildStatement` 表述错位（仍报 explicit_positive/conditional 计数但本链已不承诺）
- [ ] **WP07** [#880](https://github.com/bigbigraydeng-maker/magic-engine/issues/880) Kernel 授权的 apply / verify / rollback
- [ ] **K-WP01** [#881](https://github.com/bigbigraydeng-maker/magic-engine/issues/881) 认证审批 / 拒绝界面 + 政策 Settings UI
- [x] ~~**WP08**~~ ✅ **2026-08-12 完成** [#883](https://github.com/bigbigraydeng-maker/magic-engine/issues/883) Roman 首个有效生产 GEO baseline 已捕获并经 Product Owner 验收 —— 批次 `688bd8ae-2db6-4300-b761-b850f30c32c5`，冻结查询集 `roman_geo_baseline_v1`（12 条问题），12 / 12 观测成功 ＋ 12 条证据，累计记账成本 US$0.708 / US$5.00。
      **这是冻结的测量事实，不因后续优化、诊断或重解释而回写或重新表述**（[冻结审计记录](https://github.com/bigbigraydeng-maker/magic-engine/issues/883#issuecomment-5260895662)）：
      唯一已确认的 Roman 可见度数字是 **owned-domain citation coverage = 2 / 12 = 16.7%**；
      「12 / 12」指 12 个回答都带了引用，**不等于** Roman 被提及或被推荐；
      qualified mention / recommendation / conditional rank 的判据（M1）未决因而**不可计算**，
      `direct_owned_page_citation` 记 `not_computable`（不是 0）。
      **未执行**：diagnosis · optimization action · 第二轮测量 · 页面台账补录 · Roman 网站修改。
      Issue #883 已于 **2026-08-12 经 Product Owner 授权关闭**（[结账说明](https://github.com/bigbigraydeng-maker/magic-engine/issues/883#issuecomment-5262037905)）；其余留的 3 项前置工作已拆入 #932。
- [ ] **WP08 余项** [#932](https://github.com/bigbigraydeng-maker/magic-engine/issues/932) Roman 页面台账 + 权威来源 · 测量频率（cadence，须与 #885 对齐）· WP09 前置就位登记 —— **WP09 的前置**，与已冻结的 Baseline v1 无关
- [ ] **WP09 / WP10** [#884](https://github.com/bigbigraydeng-maker/magic-engine/issues/884) / [#885](https://github.com/bigbigraydeng-maker/magic-engine/issues/885) 首次 1–3 页优化 → T+7/14/28 复测与学习（严格串行，**两项均未开工**）
- [x] ~~**U11**~~ ✅ **已完成** —— `docs/STATE.md` 与本文件的 ME2 条目已补齐（本 PR）
- [ ] **WP00 §15 其余未决项**（**U1–U10、U12**）仍**单独**以未决形态挂着，**任何 WP 不许把它们当既定假设**
- [ ] **Product Map PR3**（WP「ME2 Product Map v1」的最后一段）—— **PR1**（组件登记册＋成熟度引擎,PR [#976](https://github.com/bigbigraydeng-maker/magic-engine/pull/976)）与 **PR2**（GitHub 只读动态同步,PR [#979](https://github.com/bigbigraydeng-maker/magic-engine/pull/979)）均已于 2026-08-15 合并**并完成生产 provisioning**（migration 已 apply · ME 仓 webhook 已建并有真实投递 · GITHUB_TOKEN/cron 密钥已配 · 首轮全量同步实测 12 PR / 14 issue / 28 条待分类）。剩 **PR3**:`/dashboard/me2/product-map` PO 控制台四视图（业务总览 / 组件清单 / 依赖 / 待拍板队列）——必须渲染 partial 轮、`manual_claim` 未核验标记、factsSource 三态,不许把不完整快照显示成完整。开工需 PO 授权。
  🔄 **2026-08-19 新增「老板摘要」视图,PR [#1076](https://github.com/bigbigraydeng-maker/magic-engine/pull/1076) 待复审,未合并**:PM 反馈现有视图对非技术管理层太细,新增一个并列标签把组件按业务线收成一行卡片(状态灯 + 在跑分数 + 下一步)。默认打开的仍是"等你拍板"(板桥 S1 原则未推翻)。经子牙+魏征两轮设计复审,两轮都真挑出问题并已按复审改(状态灯改成"有在跑就算绿灯"、needsYourCall 改成直接核对 decisionsNow、加小样本标注)——具体见 PR 描述。
      ⚠️ 已知遗留:同步的 `unresolved_threads` 恒 null(GraphQL 那一步静默失败),故每轮标 partial —— 独立修复任务在案,不阻塞 PR3

**独立并行、不并入本链**：[#886](https://github.com/bigbigraydeng-maker/magic-engine/issues/886) Operating Brief（参考闭环稳定前不开工）· [#887](https://github.com/bigbigraydeng-maker/magic-engine/issues/887) 广告安全泳道（**不许夹带进任何 ME2 的 WP**）

**运维泳道（也不并入本链，等 PM 拍板）**：
- [ ] [#911](https://github.com/bigbigraydeng-maker/magic-engine/issues/911) / PR [#912](https://github.com/bigbigraydeng-maker/magic-engine/pull/912) OPS03 事件驱动 Issue 中继试点 —— ⚠️ 它写死的唯一标的 #910 **已关闭**，试点要么改标的要么归档
- [ ] PR [#931](https://github.com/bigbigraydeng-maker/magic-engine/pull/931) OPS02「Codex 复审干净就自动合并」—— ⚠️ 前置已就绪，**卡点在 PR 自己身上**：原引用的 [#939](https://github.com/bigbigraydeng-maker/magic-engine/issues/939) 已于 2026-08-16 关闭修复，不再是阻塞点。曾经存在的另一个真实缺口——`tools/ops-review-loop/src/fix-scope.mjs` 的 `GUARDED_BRANCH_PREFIXES` 把「Codex 复审→Claude 自动修复」循环的生效分支焊死在 `claude/me2-` 前缀，团队实际工作分支（`claude/<issue号>-<slug>`）从不匹配——已由 PR [#1175](https://github.com/bigbigraydeng-maker/magic-engine/pull/1175) 于 2026-08-24 11:45 UTC 合并修复，`GUARDED_BRANCH_PREFIXES` 现已扩到 `claude/`，覆盖日常工作分支（2026-08-24 在 PR [#1174](https://github.com/bigbigraydeng-maker/magic-engine/pull/1174) 上实测过循环本身能跑通：Codex 打 P2 标签 → 自动触发修复 → Claude 推送修复 commit）。急停开关 `OPS_AUTO_MERGE_ENABLED` 也已经是 `true`（2026-08-12 设置）。**现在真正卡住的是 #931 这个 PR 自己**：其分支 `claude/me2-ops-auto-merge` 自 2026-08-12 起未再更新，与当前 `main`（已并入 #941/#942/#943/#947/#1175 等后续改动）产生冲突（`mergeStateStatus: CONFLICTING`），需要先 merge origin/main 解决冲突（禁止 rebase，见 CLAUDE.md §6），才能重新走复审流程。
      ✅ **兜底闸门这一条不是问题**：2026-08-12 实查，`main` 上有 **active 的 ruleset「Protect main」** —— 禁删、禁 force push、只许 merge commit、**所有复审线程必须解决**、`ai-orchestrator-tests` 必须过。（旧说法「GitHub Free 私有仓库开不了分支保护」已作废，ruleset 已对私有仓库开放。）

---

## 官网「免费体检」漏斗断流（2026-09-02 发现）

**症状**：`magicengine.com.au/discover` 的免费体检——两步漏斗（`/api/scout` 存 lead → `/api/report` 补 email 发报告）——自上线起从未真正存过一条 lead，也从未真正发出过一封报告邮件。生产 Supabase `discovery_leads` 表核实为 0 行。

**已确认根因（2026-09-02 直接调用 `/api/scout` 验证 `leadId` 前缀 = `demo-...`）**：`website/`（Cloudflare Pages 独立静态站，独立于本仓 Render 部署，独立 Cloudflare 账号）的生产环境**没有配置 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`**，导致 `website/functions/api/scout.js` 的 `storeLead()` 从未真正连接过 Supabase，一律返回假 `demo-` id；`website/functions/api/report.js` 据此拒绝发送报告邮件（"P0-A fix" 防御生效，符合设计但暴露了上游问题）。

**已一并修复但非本次症状根因**（子牙+魏征 2 审通过，2026-09-02 已 apply）：`discovery_leads.email` 列建表起就是 `NOT NULL`，但 `scout.js` 插入时从不传 email（设计上是两步收集）——只要 Cloudflare 侧接上 Supabase，这条 NOT NULL 约束会立刻撞库产生新的 `fallback-` 失败。migration `20260902000001_discovery_leads_email_nullable.sql` 已放开该约束。

- [ ] 🔴 **需 PM 在 Cloudflare 后台（独立账号，本仓无法访问）给 magicengine.com.au 的 Pages 项目补 `SUPABASE_URL`=`https://glbdnayojixmexgofbsd.supabase.co`、`SUPABASE_SERVICE_KEY`=（从 Render `magic-engine` 服务的 `SUPABASE_SERVICE_ROLE_KEY` 复制同一个值）→ Settings → Environment variables → Production，保存后触发一次重新部署
- [ ] 补上后必须端到端验证：重新跑一次 `/discover` 全流程，确认 `leadId` 是真实 UUID、Supabase `discovery_leads` 真的新增一行、**且真的收到报告邮件**（不能只看页面显示"发送成功"——`report.js` 的 `sendEmail()` 在 `RESEND_API_KEY` 未配置时会静默跳过发送但仍返回 `{ok:true}`，需顺手确认这个 key 也配了）
- [ ] 次要（魏征复审发现，非阻塞）：`discovery_leads` 表建表起没有任何 migration 显式 `enable row level security`/加 policy，虽然 service-role 调用不受 RLS 影响、暂无实际泄露，但应补一条独立 RLS migration 让它符合"新表必须 service-role 模板"的红线并消除账本漂移
- [ ] 次要：`website/_headers` 对 `/api/*` 声明 `Access-Control-Allow-Origin: https://magicengine.com.au`，而各 Function 自己又各设 `Access-Control-Allow-Origin: *`——未验证 Cloudflare Pages 对两者如何合并，换一个 origin（如 `www` 子域名/`*.pages.dev` 预览域）访问不排除请求直接被 CORS 拦掉

---

## 每日待办 href 落地页 action-gap（2026-09-07 审计发现，PR #1467 未合并）

**背景**：审计了 `src/lib/pm-todo/**` 下发给 PM 的所有 `href`，逐条实测「点开链接是不是真能办成那件事」。4 个「链接完全打不开 / 静默丢失」的问题已经修复并合并（`crawl_stale` 404、`blog_draft_waiting` 与两条 `conversion_*` 相对路径被链接闸丢弃）——见 [history/CHANGELOG.md](./history/CHANGELOG.md) 对应条目。

Codex 复审又挖出 6 个「落地页存在，但操作的东西跟待办要修的不是一回事」的问题，按 [ENGINEERING_QUALITY_GATES.md §11](./ENGINEERING_QUALITY_GATES.md#11-资源优先级判断pm-2026-09-07-拍板) 三维打分排了优先级（PM 2026-09-07 拍板顺序）：

- [ ] 🔴 **[P0] `price_claim_unbacked` 落地页读写错了表**（`src/lib/pm-todo/manual-items.ts` `pushPriceGateItems`）：这条待办检查的是 `visual_assets` 表按 `post_id` 关联的配图，但 href 指向的 `/dashboard/clients/{id}/assets` 素材库页读写的是 `client_assets` 表——两张不同的表，PM 点进去根本找不到要改来源的那张图。要么把 href 改到能操作 `visual_assets` 的地方，要么把这条检查也接到 `client_assets`。客户投诉风险直接（配错图客户按图下单对不上）。
- [ ] 🔴 **[P0] `factory_worker_idle` 落地页无法远程启动 worker**（`src/lib/pm-todo/manual-items.ts` `pushFactoryWorkerItems` + `/dashboard/factory`）：待办的 how 要求「在那台 Mac 上跑 `node scripts/factory-worker/worker.mjs --loop`」，但 `/dashboard/factory` 页面只能看 worker 心跳状态，没有任何远程启动/连接控制。要么加一个能远程触发 worker 的入口，要么把 worker 迁到不依赖单台 Mac 开机的执行环境（长期更优，但改动更大，先讨论方案）。
- [ ] **[P2] `kernel_needs_human` 三处分支生成空 href**（`src/lib/kernel/handoff.ts` 91/103/112 行）：这几类交接待办的 `href: ''`，PM 点开邮件根本没有入口可点，只能靠 how 里的文字描述摸索。是「管道不许断头」这条铁律的安全网本身在这几个分支失效。要给这几类交接补上真实入口（哪怕是执行看板的一个筛选视图）。
- [ ] **[P2] `leads_metric_untrusted` 落地页没有修复入口**（`src/lib/pm-todo/manual-items.ts` `pushLeadsSanityItems` + `/goal/{goalId}`）：待办要求 PM 去客户网站统计后台收窄「产生线索」触发条件，但目标页是纯展示、没有任何外部统计后台的链接。要么加一条到客户 GA4/GTM 后台的直达链接（如果连接器里存了 property id），要么在 how 里明确「这一步要联系客户或自己去 GA4 后台改」而不是暗示落地页能做。
- [ ] **[P2] `meta_stuck` 落地页跟需要做的事不对应**（`src/lib/pm-todo/manual-items.ts` 515-520 行 + `/dashboard/clients/{id}/settings`）：待办要求登录**客户自己的** WordPress 后台启用 Magic Engine 插件，但 `/settings` 页是我们自己的连接器配置（API 密钥、SEO 字段探测），不是客户 WP 后台，也没给客户后台的直达链接。要在 CmsPanel 里补上客户 WP 后台的地址（如果连接时存了站点 URL）。
- [ ] **[P2] `goal_baseline_mismatch` 目标起点数字改不了**（`/goal/{goalId}` 页 + `src/app/api/goals/[goalId]/route.ts` 只有 GET/DELETE）：待办要求把错误的起点改成重算值，但目标详情页只读展示 `baseline_value`，也没有对应的 PATCH/PUT 接口。要新增一个编辑 baseline 的入口（前端表单 + 后端接口），同时要考虑这个字段被改动后要不要留痕（谁在什么时候把起点从 A 改成了 B）。

### ME 产品动态自动发 LinkedIn（2026-08-20 建成，默认关闭）

代码已完成并测试通过：`src/lib/linkedin-progress/`（取材/敏感词硬过滤/文案生成/发布编排）+
`src/app/api/cron/linkedin-progress-post-{mon,thu}/`（每周一/四各一条 cron）+
`src/lib/pm-todo/manual-items.ts` 的 `pushLinkedinProgressItems`（待审/账号未连/发布失败三种卡点接进日常待办）。
只从 `docs/history/CHANGELOG.md` 已上线条目取材，完全自动发布，命中客户敏感信息才转人审。
前两轮 Codex 复审挑出的问题（敏感词表查询失败要 fail closed / 发布账号严格绑定 / 人工复审路径也要接上真正发布 /
并发确认要原子认领 / 发布成功但状态没同步要能对账 / 窗口边界防同日条目丢失）均已修完并测试通过。
第三轮挑出的 1 条回归（原子认领误伤视频内容重新确认）已修；另 4 条（下方 ⚠️ 清单）功能默认关闭时不触发，
按 PM 决策登记成"开启前必关"的后续任务，不阻塞本次合并。

- [x] 【已作废（Publer 已删除）】**上线前 PM 必做的一次性动作**：① 去 Publer 后台用自己的 LinkedIn 账号做一次性授权连接
      ② 打开 ME 后台「Magic Lab Class」客户的 connectors 设置页，把出现的 LinkedIn 账号 ID 填进 Publer 绑定
      ③ 在 Render 的 `crazycontent` 服务（不是 render.yaml 里那个不对外服务的 `magic-engine`）Environment 页手动加
      `LINKEDIN_PROGRESS_POST_ENABLED=true`（未配置=默认禁用，这三步没做完之前功能保持休眠，不会误发）
- [x] 【已作废（Publer 已删除）】上线后先跑一次人工验证：确认 Publer 的 schedule 接口对 `provider='linkedin'` 真的认（目前只有代码推断，没有已连账号可实测），
      建议先手工发 1-2 条真实验证一次发布路径，再考虑打开 cron 开关

**⚠️ 打开开关（第③步 `LINKEDIN_PROGRESS_POST_ENABLED=true`）之前必须先关掉的 4 条（Codex 第三轮复审，功能默认关闭时不会触发，所以不阻塞合并，但是"开启前"的硬门槛）：**

- [ ] **[P1] 匿名客户业务数字漏过滤**（`src/lib/linkedin-progress/run.ts` 敏感过滤）：CHANGELOG 若只用匿名方式写客户指标（如「2099 条消息 / 658 个会话」），`findSensitiveMatches` 只认客户名/域名/代号/术语，完全不认运营数字，这类稿会绕过"不点名也不得披露客户数字"的要求自动发。要加代码级数字/联系方式检测，或含此类数据一律转人审。
- [x] 【已作废（Publer 已删除）】**[P1] 人工确认路径没处理"发布成功但数据库没同步"**（`content-factory/[postId]/route.ts` LinkedIn 分支）：cron 的 `run.ts` 已消费 `dbSyncError` 并写 `published_but_db_sync_failed` 对账标记，但看板手工 confirm 这条分支还没有——Publer 已发但回写失败时，界面会误报失败稿，可能被当失败重发。要把 run.ts 那套对账逻辑同样接到这条分支。
- [x] 【已作废（Publer 已删除）】**[P1] 发布失败后 approved 状态卡死、无重试入口**（同上文件 LinkedIn 分支）：Publer 调度超时/报错时，帖子已被原子认领改成 approved，这里只返 500 不回滚；无视频的 approved 帖子归"备料"段，确认按钮只在"选题"段显示，PM 修好连接后无法再确认，稿件永久卡住。要在确认外部未接受时回滚为 draft，或给 approved 提供幂等重试入口。
- [ ] **[P2] 待办查询失败被当成"零条记录"**（`src/lib/pm-todo/manual-items.ts` `pushLinkedinProgressItems`）：那次 `content_posts` 查询若失败，Supabase 返回 `{data:null,error}` 不抛异常，这里只取 `data` 再 `?? []`，账号未连/敏感稿/已发未同步等卡点会全部静默从今日待办消失。要检查并抛 `error`。

### 广告引擎中心 — 已上线部分的收尾（2026-08-05）

已上线（见 CHANGELOG）：每天扫在投广告的闸门 · ME 起草→建成暂停→过闸门→人点头才花钱 · `/dashboard/ad-approval`。

- [ ] **P21.J.M4** 起草那一步现在只有 API，**没有任何调用方** —— 得有个地方（AI 或 UI）真的产出一份草案，否则整条链路空转。优先接 Roman：留资表单 + 视频养受众各一条
- [ ] **P21.J.M5** 素材上传还没接：`imageHash` / `videoId` 要人先传到 Meta 才有。要么接 `ads_creative_upload_*`，要么从 ME 已有的成片直传
- [x] ~~**P21.J.M6/M7/M8/M9/M10**~~ 2026-08-05 全部完成：共享闸 34 种写法 0 漏 0 误拦（原漏 28 种）+ 唯一写入口 `write-lesson.ts` + `POST /api/ad-engine/lessons`；页面加 90 天窗口 + 5000 行上限 + 撞顶告警；轮播/动态商品/自然帖投流三种文案形态补齐（自然帖会去主页把文案取回来）；行业归一化统一成 `normaliseIndustry` 一个函数

#### 2026-08-14 Meta 方向审计（[docs/audits/2026-08-14-meta-ads-direction-audit.md](./audits/2026-08-14-meta-ads-direction-audit.md)）新发现，按影响面排序

> 全部来自只读审计 + 16 轮复审逐条核实，未改生产代码。审计只报缺口不写方案的，这里登记成可排期的条目。

- [ ] **AD-CUR-1 广告花费表都没有币种列 —— 跨客户金额全是混币种加总【影响面最大，且是三张表】**：2026-08-14 实读账户 `currency`：Oztop `1735240120460765` = **AUD**，CTS / Roman / 混账户 = NZD；而两张表都把 Graph 返回的账户币种金额原样存下、不换算、不记币种。
  - `ad_daily_insights.spend`（裸 `NUMERIC`，`parseDailyMetrics` 写）→ 喂**广告健康引擎 / ad-engine 看板**
  - `meta_ads_snapshots.spend`（裸 `NUMERIC`，注释直言 "total spend in account currency"）→ 喂 **`MetaAdsAdapter.ts:90`（Goal 指标）、月报、production package（`production/[packageId]/route.ts:117`）**

  ⚠️ **只修 `ad_daily_insights` 修不到报表侧** —— `20260721000001` 的注释本身就写明 "meta_ads_snapshots is left untouched — MetaAdsAdapter, the monthly report and the production-package view all still read it"。**两张表必须一起加 `currency` 列**（Graph `account_currency` 直接给），并在任何跨客户汇总处按基准日折算 + 注明汇率。

  ⚠️ **而且加列 + 改新拉取还不够，历史行仍然没有单位**：`meta_ads_snapshots` 是**每次同步只追加一行**的表，月报和 Goal 历史读的就是当时那一行 —— 新的同步不会修好已发出去的旧月报；（⚠️ 第三十一轮订正：这里原写 "production package 会永久关联某一条旧 snapshot"，**那条关联从来没成立过**，见 `AD-PKG-1`）`ad_daily_insights` 的历史行一旦超出回拉窗口也会一直是 NULL。所以本条必须包含：**① 按 `ad_account_id` 回填历史币种**（账户币种不随时间变，可安全回填）**② 读侧显式处理 NULL**（宁可拒绝汇总也不要默认同币种）。否则 migration 做完，旧月报和 Goal 历史照样解释不了

  ⚠️ **其实是三张表，不是两张 —— 派生出去的飞轮指标也裸存账户币种**（第四十轮 Codex 指出，已核实）：`flywheel/adapters/MetaAdsAdapter.ts:118-145` 把 snapshot 的 `spend` / `cpc` **原样复制**进 `flywheel_metrics.metric_value`，而它写的 `source_ref` 只有 `{snapshot_id, ad_account_id, period_start, period_end}`，**没有币种**；下游 `flywheel/attribution/job.ts:290-313` 的 `latestMetricValue` 又只取 `Number(data.metric_value)` —— 一个没有单位的裸数字。**所以回填 snapshot 修不好已经生成的飞轮历史**，Goal 和归因照样会把 AUD 和 NZD 当同一个单位比。
  → ⚠️ **而且补币种之前先做 `AD-ATTR-1`** —— 读侧连"这行是 Meta 还是 Google"都不分，币种对了平台还是错的。
  → 本条必须一并规定：**`flywheel_metrics` 怎么带币种**（加列，或统一折成基准币种存），并**重放或作废已有的 `ads.account.spend` / `ads.account.cpc` 及其派生结果**。✅ 好消息是可回填 —— `source_ref.ad_account_id` 在，按账户查币种即可
- [ ] 🔴 **AD-ORPH-1 被闸门拦下和被人否决的草案，Meta 那边的实体没人收 —— 既不删也不下发人工任务**（第四十三轮发现，`AD-GATE-1` 的同一段生命周期）：`publishDraftPaused` 成功后 campaign / ad set / creative / ads **都已经在 Meta 建出来了（暂停着）**，然后：
  - `createDraftForApproval` 的 `blocked` 分支（`draft-and-gate.ts:137-141` 回读失败、`:158-163` 闸门拦下）**只写账本，不删实体**；
  - `rejectDraft`（`:213-235`）同样**只改 payload 状态**。
  而 `publishDraftPaused` 里那套逆序 `graphDelete` 回滚**只在建的过程中失败时才跑**（`:165-169`），终态是 blocked / rejected 时根本不触发。结果：**一堆永远不可能再被批准的暂停广告长期堆在 Meta 后台**，而它们看起来跟正常的暂停草案一模一样 —— **后台的人一手滑就能把它开起来花钱**。
  ⚠️ 这正好撞在 CLAUDE.md 铁律 3 下半：能自动就自动（终态时逆序删掉），确实删不掉（比如 Meta 报错、实体被引用）**就必须下发人工任务并进同一个管道**，带齐 what（这几条是废弃草案、别开）· how（在 Meta 后台删掉这几个 id）· href（直达链接）。现在两样都没有 —— `DraftRecord.orphans` 这个字段**只在建失败那条路上会被填**，blocked / rejected 根本不写它。
  ⚠️ **但"逆序删除实体"这句现在做不到 —— 三个前置得先补**（第四十四轮 Codex 指出，已核实。上一版直接写了这句修法，是**承诺了一个当前结构根本执行不了的动作**）：
  1. **creative id 根本没被带出来**：`ad-publisher.ts:224` 的 `created.push(creative.id)` 只进了 `publishDraftPaused` 内部那个局部数组，而 `PublishedDraft`（`:22-28`）只有 `campaignId` / `adSetId` / `adIds` / `orphans`，`:243` 返回时**不含任何 creative id**。事后想删创意，连 id 都拿不到。⚠️ 而且创意在 Meta 是**账户级对象、不是 campaign 的子对象** —— 删 campaign 不会把它带走，所以这批必然漏；
  2. **`rollback` 是个局部闭包**（`:165-169`），函数一返回就不可调用 —— 终态清理需要一个**可复用的清理能力**，不能指望复用它；
  3. **否决那条路手上没有 token**：`rejectDraft(actionId, supabase, reason?)`（`draft-and-gate.ts:213-217`）**签名里就没有 accessToken**，它连 Meta 都调不了。
  修：① **`PublishedDraft` 带上 creative ids 并落进 `DraftRecord`**；② 把清理逻辑从闭包里提出来做成可复用函数（建失败回滚和终态清理共用）；③ 给 `rejectDraft` 补授权；④ 然后才谈终态（blocked / rejected）自动逆序删除；⑤ 删不掉的落进 `orphans` **并下发人工任务**（`src/lib/pm-todo/manual-items.ts` 的「🙋 需要你动手」栏）—— 注意①没做的话，**这个人工任务本身也是残缺的**（列不全要删哪些东西）
- [ ] 🔴 **AD-QUEUE-1 审批页按"最近 50 条"截断后才在内存里筛待办 —— 早的待批草案会从唯一入口永久消失**（第四十三轮发现，**首投前置**）：`ad-approval/page.tsx:34-44` 的查询**不带任何状态条件**，只 `.order('created_at', desc).limit(PAGE_LIMIT + 1)`（`PAGE_LIMIT = 50`），拿回来之后才在 `:80` 用 `rows.filter(r => r.payload?.status === 'awaiting_approval')` **在内存里**筛。页面自己在 `:23` 写明「**不做分页**」。
  → 只要 `flywheel_actions` 里攒够 50 条更新的 `active` / `rejected` / `blocked` / `failed`，**更早但仍在等人点头的草案就再也不会出现在这个页面上** —— 而这是**唯一**的审批入口。
  ⚠️ 更阴的是 `:246-248` 那句兜底文案：「还有更早的记录没显示（这页只列最近 50 条）」—— 它把漏掉的东西说成**历史记录**，看的人不会意识到**里面可能有正在等他点头的活**。这张页面存在的意义就是保证"该你点头的都在这儿"，而这个保证现在不成立。
  修：**把状态条件下推到数据库**（按 `payload->>status = 'awaiting_approval'` 查，或落一列可索引的状态），或做真分页 / 待办完整队列；兜底文案也要分清"历史被截断"和"待办被截断"
- [ ] 🔴 **AD-ATTR-1 归因取数不按来源过滤 —— Meta 和 Google Ads 共用同一批 `ads.account.*` key【隐患已武装，Oztop 两边都配了】**（第四十二轮发现，`AD-CUR-1` 的前置）：
  - `google-data-pullback-daily/route.ts:710-716` 的注释自己写着：Google Ads 的账户级指标"写进**共享的 `ads.account.*` 命名空间**，靠 `source='google_ads_pullback'` 区分，好让同时接了 Meta + Google 的客户仍然分得开"；
  - 但读侧 `flywheel/attribution/job.ts:290-313` 的 `latestMetricValue` **只按 `client_id` + `metric_key` + 时间窗取最新一行，压根不过滤 `source`**（也不过滤账户、币种）。**写侧声明的那个"分得开"，读侧没实现** —— 又一次"要求写了、另一侧没做"，跟 `20260721000001` 那条一模一样。
  - 后果：同时接两家的客户，一次 Meta 动作的 baseline 可能取自 Google 那行、after 取自 Meta 那行，**两个不同平台、不同币种的数字直接相减**。⚠️ **光给 `AD-CUR-1` 补币种字段挡不住这个** —— 币种对了，平台还是错的。
  - 📊 **现状实测（口径要准）**：`clients` 里 **Oztop 同时配了 `meta_ad_account_id` 和 `google_ads_customer_id`**，所以隐患是**武装状态**；但 `flywheel_metrics` 全表的 `ads.account.*` 行**目前全部来自 `meta_ads` / `meta_ads_pullback`，一条 `google_ads_pullback` 都还没有**（Google 那条路多半卡在 `GOOGLE_ADS_*` env 缺失上，`syncGoogleAds` 会返回 `success:false` 而不是抛错）。**所以是"还没发生"，不是"不会发生"** —— Google 那边一旦补上 env 开始写，当天就混。
  修：读侧按 `source`（或账户）隔离，或改用 provider 专属 metric key；**这条必须排在 `AD-CUR-1` 的历史重放之前** —— 不隔离来源就重放，等于把错的配对重新算一遍
- [ ] **AD-PLAY-1 两个建广告调用点没传 `play` / `playSource`，打法账本恒为 NULL**：`boost-post/route.ts:122` 与 `winner-reel-sync/engine.ts:214` 都调了 `linkAdToCreative`，但**三个打法参数一个没传**，而 `persistLink` 会照写 NULL。`LinkAdToCreativeArgs` 和 `persistLink` 早就支持这三列 —— **纯粹是调用方没传，真·接线活**。**两条路径的处理方式不同，不能一起硬编码**：
  - `boost-post` → 固定 `boost_organic_post` + `declared_at_creation`。安全：给自然帖投流，这个路由干的就是这件事，打法由路由本身决定
  - `winner-reel-sync` → ⚠️ **不能硬编码 `thruplay_pool_build`**。`engine.ts:203-211` 只是往 `winner_reel_sync_config.target_adset_id` 指定的广告组里加广告，而**那张配置表没有打法/目标字段**（`20260711000001` 只有 `target_adset_id`），代码也**从不回读该广告组的 `optimization_goal`**。目标组要是被换成非 ThruPlay 的，所有新广告就会被贴上错标签 —— 这正好违反 `play` 那条"拿不到就留空，绝不猜"的契约，而且 `declared_at_creation` 在 `PLAY_SOURCE_TRUST` 里是**高可信**，错标签会污染打法学习。修：要么给配置表加受校验的打法字段，要么建广告时回读目标组 `optimization_goal` 确认后再写；**两者都做不到就留 NULL**

  注意 `AD-LINK-1` 解决的是 variant 身份 + migration，**不覆盖这两条帖子路径**，不能互相替代
- [ ] **AD-CUR-2 写预算的入口都写死 AUD、却不读账户币种 —— 两个入口，其中一个已上线在用**：Meta 一律按**账户币种**解释传进去的数字，而 CTS/Roman 账户是 **NZD**（已实读）。
  - 🔴 **执行抽屉（已上线）**：`AdsFixDrawer.tsx:309` 的输入框标签写死 **「新日预算（AUD）」**，`meta-ads/execute/route.ts:157` 直接 `Math.round(newBudget * 100)` 发给 Meta，**不读币种、不换算** → 人以为在填 AUD，钱按 NZD 花。注释里那句 "minor currency units (cents for USD/AUD)" 本身就默认了账户是 AUD
  - `boost-post`：收 `daily_budget_aud`、同样乘 100 原样发送，回显的 `estimated_total_aud` 也是错的

  - **草案 → 审批那条路（就是本审计推荐的首发路径）**：`ad-publisher.ts:195` 同样 `String(Math.round(d.dailyBudget * 100))` 按账户币种发送,而审批页的 `describeDraft` 和按钮只显示 `$`,**不告诉批准人这是 AUD 还是 NZD** → 币种不明就点了"开"

  修：三处都回读账户币种,UI 显示、请求契约与持久化记录都按**账户币种**表达(或显式换算并标注汇率)。⚠️ 只修 boost,既漏了最常用的执行抽屉,也漏了首发要走的草案路径
- [ ] **AD-GATE-1 `approveDraft` 激活前不重新回读**：只查 `payload.status` 就 `activatePublished`，不重跑 `fetchAdSetReadback` / `checkLaunch`。草案在共用账户里躺几天，期间被改则批准人看到的是旧快照、钱按新配置花 —— 这违背 `launch-readback.ts` 自己"只有回读能看见"的立论。修：激活前重跑回读 + 闸门，有 blocker 拒绝激活。**不需 migration**
  - 🔴 **"重跑一次回读"根本看不见预算 —— 而本条正文承诺要修的就是"钱按新配置花"**（第三十九轮 Codex P1，已核实）：`src/lib/meta/readback.ts:27-29` 的 `ADSET_FIELDS` 只有 `id,name,optimization_goal,destination_type,effective_status,campaign_id,targeting` —— **没有 `daily_budget`、没有 `lifetime_budget`、没有 `start_time`/`end_time`**；`checkLaunch` 也从不拿回读预算跟 `DraftRecord.draft.dailyBudget` 比。**所以草案躺着期间有人在 Meta 后台把日预算调高，重跑回读照样全绿放行**，本条正文那句"钱按新配置花"等于没修到。
    修：① **把批准人当时看到的那套钱的包络持久化进 `DraftRecord`**（日预算 + **账户币种**，见 `AD-CUR-2` + 排期）；② `ADSET_FIELDS` 补上预算与排期字段；③ 激活前逐项比对，**对不上就是 blocker，不是 warn**
  - 🔴 **买家看不到文案时只报 warn，照样放行；创意数组为空时连 warn 都没有**（第三十九轮 Codex P2，已核实）：`launch-readback.ts:294-303` 的 `creative_without_buyer_text` severity 是 `'warn'`，而 `safeToActivate = !findings.some(f => f.severity === 'blocker')` —— **warn 不拦人**，审批页（`ad-approval/page.tsx:147-150`）只是"建议你去 Meta 看一眼"。更糟的是那条规则来自 `adSet.creatives.filter(...)`：**`creatives` 是空数组时 filter 出来也是空，一条 finding 都不产生**，于是"一条广告都没回读到"和"全都回读干净了"在闸门眼里长得一模一样。
    修：**首条真钱广告之前，把"每条预期广告都回读到完整买家可见文案"设成 blocker**（含"回读到的广告条数 ≠ 建出来的广告条数"这一种），别把这一步推给批准人肉眼核对 —— 这正是 `launch-readback.ts` 开篇自己写的「查不出来 ≠ 没问题」
  - 🔴 **另一半：批准/否决必须原子认领，否则"显示已否决、广告在花钱"**（第三十六轮补入，**升级为首投前置**）：`approveDraft`（`:179-209`）和 `rejectDraft`（`:213-235`）都是**先读状态、再无条件写状态**，中间没有条件更新。两人同时点 → 批准那边已激活 Meta 实体、否决那边最后落账 → **账本和页面写着 `rejected`，广告继续花钱，没有任何地方会喊**。⚠️ 而且 `rejectDraft` 更松：它**连状态都不查**（`:225-227` 只判 `payload` 存在），否决一条已经 `active` 的草案会直接把账本改成 `rejected` 而广告照跑 —— 这条不用并发也能触发。
    修：用条件更新或 RPC **从 `awaiting_approval` 原子认领唯一决策**（写入时带 `payload->>status = 'awaiting_approval'` 的前置条件，认领失败就不执行动作），并为"Meta 已激活但落账冲突"留一条**停投 + 对账**路径。**不需 migration**（条件更新即可；要做 RPC 才需要，届时待 PM `go apply`）
  - ⚠️ **光"重跑一次"不够，会漏掉最要命的那条检查**：`expectedGeo` 只存在于 `CreateDraftDeps`（`draft-and-gate.ts:62`，创建时用一次），**没有落进 `DraftRecord`**；而 `approveDraft(actionId, supabase, accessToken)` 手上根本没有它。缺了它 `adaptMetaAdSet` 会传 `null`，`launch-readback.ts:281` 的 `if (input.expectedGeo && ...)` 直接跳过 **`geo_mismatch`** —— 也就是"等待期间被改到别的国家"这个核心场景照样放行。**修的时候必须同时**：创建时把可信地区持久化进 `DraftRecord`（⚠️ **不能只重载 `clients.country`**，见 `AD-GEO-1`）
- [ ] 🟠 **AD-ISO-1 生产同步把整账户数据写成单个客户的 —— 同步路径允许跨客户污染，隐患已上线在跑，损害尚未证实【已上线在跑】**（第二十八轮发现；标题第五十轮更正 —— 原写"正在污染"，与本条自己第 31 轮的实测结论自相矛盾）：
  - `ads-strategy/daily-insights.ts:209+` 的 `syncCampaignDailyInsights(clientId, adAccountId, …)` 拉的是 **`getCampaignDailyInsights(adAccountId, …)`（整账户）**，然后 `rows.map(r => toInsightRow({ clientId, … }))` —— **把每一行都写成该 client，零 campaign 归属过滤**；ad 级同理；
  - `google-data-pullback-daily/route.ts:595+`（**定时**）：把 `getAdAccountInsights` 的**账户级聚合**整个 `insert` 进该 client 的 `meta_ads_snapshots`,而那张表正是 `MetaAdsAdapter`(Goal 指标)、月报、production package 读的;
  - `clients/[id]/meta-ads/sync/route.ts:82-111`(**手动**,第三十轮补入):同样 `getAdAccountInsights(adAccountId, …)` 整账户 → `insert({ client_id: clientId, … })`;
  - ⚠️ **第三十一轮更正**:上一版在这里写"`:119-127` 会用 `production_package_id` 把污染 snapshot 永久绑进已交付的交付物"—— **撤回,那一列不存在**,绑定从来没成功过(改记为独立的 `AD-PKG-1`)。

  **三个写入口必须共用同一套 campaign→client 归属过滤**,只修定时任务,手动同步照样能生成掺了别家投放的月报和交付记录。

  CTS 绑的就是混账户 `act_2775766642787274`，里面**确有 Oztop 的投流**。`20260721000001_ad_daily_insights.sql:17-22` 自己写着「该账户仍带 4 条 legacy Oztop campaign……**任何账户级 rollup 必须从过滤后的 campaign 行聚合，不能信账户级总数**」—— **要求写了，写入侧没实现。**
  📊 **第三十一轮实测（105 行 = 101 行已核对干净 + 2 行无法核对 + 2 行差 $0.09 四舍五入）**：已核对的行里每个 campaign 都属于该行客户，那 4 条 legacy Oztop campaign 一次都没出现。所以本条的准确定性是**隐患已上线在跑；已核对的部分未见损害，但不能宣称"全库无污染"**。优先级不降：那几条 campaign 一旦重新投放，**当天**就会污染 CTS 的健康诊断、月报和 Goal 指标。这不是补读一次能解决的，`AD-EVID-1` 只管审计取证，管不了每天在跑的同步。
  ⚠️ **那 2 行是"记了总额、丢了明细"，属于未知不属于干净**（第三十一轮 Codex P2 更正）：CTS `2026-07-02→08-01` 记 `spend=2840.49`、Oztop `2026-07-09→08-08` 记 `spend=2668.64`，两行的 `campaigns` 都是 `null`。**混账户下，没有 campaign 明细就无法判断这笔总额是否夹带别家花费**，而它已经进了 Goal 指标和月报。在按其他来源（Graph API 重拉该窗口的 campaign 级数据）对上账之前，这两行既不能证伪也不能采信 —— **重建对账是本条的交付项之一，不是可选项**。
  ⚠️ **"从过滤后的 campaign 行聚合"这句本身有个坑，不点破就会少算钱**（第三十七轮 Codex 指出，已核实）：定时和手动两个写入口拿 campaign 明细走的都是 `src/lib/meta/client.ts:123-166` 的 `getAdCampaignInsights`，它**默认 `limit = 10`、`sort=spend_descending`、且不读 `paging.next`** —— 也就是只拿花钱最多的 10 条（`20260721000001` 注释里"truncated to the top 10 by spend"说的就是它）。**账户里超过 10 条 campaign 有花费时，照这个明细重算 = 跨客户污染是过滤掉了，但本客户的花费被静默截断**，Goal、月报、交付物一起少算。
    → 实施 `AD-ISO-1` 时**必须同时改成完整分页并带 completeness 状态**：沿 `paging.next` 取全，**分页没取完就不许用部分行聚合**（宁可这一行不写/标为不可用）。
    ✅ 顺带确认：现存 105 行 snapshot 的 `campaigns` 最多只有 8 条（CTS 最多 6、Oztop 最多 8），**没有一行撞到 10 这个上限**，所以上面那个"101 行已核对干净"的结论不受截断影响。
  🔴 **⚠️ "按 campaign→client 归属过滤"这句现在没有依据可用 —— 归属表根本不存在**（第四十六轮 Codex P1，已核实。这是我开的药方本身缺前置，不是实施细节）：全仓搜遍 `supabase/migrations/`，**没有任何一张持久化的 Meta `campaign_id → client_id` 归属表**。现有几个带 campaign id 的地方都不能当依据：
  - `ad_daily_insights.client_id` —— **正是本条指出的那条错误同步路径写进去的**，拿它当归属证据是循环论证；
  - `meta_ads_snapshots.campaigns` —— 同一次整账户拉取的产物，同样不独立；
  - `flywheel_actions` payload —— 只覆盖 **ME 自建且成功落账**的广告（今天是 0 条，且 `AD-LOG-1` 那条路还会丢记录）；
  - `contacts.attr_campaign_id` —— 只覆盖真出了 lead 的 campaign。
  → 所以实施时若"按现有 insight 行过滤"，污染原样保留；若"只保留已知 id"，**会静默丢掉人在 Ads Manager 里给本客户建的 campaign**（今天绝大多数广告都是这么来的）。两种都错。
  **必须先建立并回填一张权威归属登记**（campaign_id → client_id，带来源与置信度），**对未知 campaign 采取 fail-closed 或标记 completeness**，或者干脆先做账户拆分（`meta-flywheel-risk-and-sequencing.md` §2.1 的结论）。
  修：① 同步侧按 campaign→client 归属过滤（**前提是先有上面那张归属表**；或推进账户拆分）；② `meta_ads_snapshots` 那条改为从过滤后的 campaign 行聚合，不用账户级总数，**且明细必须分页取全**；③ **拉不到 campaign 明细、或分页没取完时不许只落账户总额**（要么整行不写、要么显式标为不可用），并回头处理已存在的那 2 行
- [ ] 🔴 **AD-PKG-1 交付物里的「广告」那一栏从上线起就是空的 —— 写和读都指向一个不存在的列，两边都不报错【已上线在跑】**（第三十一轮发现）：实查 `information_schema`，`meta_ads_snapshots` 的 16 列里**没有 `production_package_id`**。
  - 写侧 `clients/[id]/meta-ads/sync/route.ts:119-127`：`.update({ production_package_id })` 是个**不 await 的浮动 Promise**，必然报错，错误只进 `console.error`，接口照样返回 200 —— 调用方以为绑上了；
  - 读侧 `clients/[id]/production/[packageId]/route.ts:116-120`：用同一个不存在的列 `.eq('production_package_id', packageId)` 过滤，PostgREST 报错被 `?? []` 吞成空数组 —— **每一份 production package 的 ads 维度都一直是空的，没有任何地方会喊一声**。
  - 这正是 CLAUDE.md 铁律 3 下半说的"发现死在日志里"的机器版：两端都在静默兜底，于是"没数据"和"链路根本没通"长得一模一样。
  - 🔴 **补列之前必须先补归属校验，否则一补列就变成跨客户注入**（第三十一轮 Codex P1，核实成立）：`sync/route.ts:33-51` 的 `production_package_id` **直接取自请求体**，鉴权只有 `requirePaidClientAccess(params.id)`（URL 里那个客户），**从不核对 `production_packages.client_id` 是不是同一个**；而读侧 `production/[packageId]/route.ts:116-120` 查 snapshot 时只按 package ID 过滤、不带 `client_id`。
    ⚠️ 方向要说准：读侧对 package 本身是**有**客户隔离的（`:37-46` 同时 `.eq('id')` + `.eq('client_id')`），所以这不是"能读走别家的包"，而是**"能往别家的包里塞东西"** —— A 客户提交 B 客户的包 ID，B 的授权用户打开自己的交付物，看到的是 A 的广告数据。跟 `AD-SEC-1` 同源：**信请求体里的外部主键，只校验 URL 里的客户**。
    现在因为列不存在而无害，**正因如此必须写进修复口径**：补列的那一刻它就活了。
  - 🔎 **根因是 schema 漂移，不是"这个功能没做"**（第三十五轮 Codex 指出，已实测确认）：仓库里**早就有** `supabase/migrations/20260522000001_p13d_production_package_links.sql`，它同时给 `meta_ads_snapshots` 和 `project_reviews` 加列 + partial index。但生产的迁移账本里**只有 `p13d_project_reviews_pkg_link`（20260524111001）这半边**，那个仓库文件整份从没登记过。实测三张表：
    | 表 | `production_package_id` | 说明 |
    |---|---|---|
    | `project_reviews` | ✅ 有 | 单独那半边跑过了 → **口碑维度是好的** |
    | `competitor_snapshots` | ✅ 有 | 走的是 `p13e_pre_competitor_snapshots` → **竞品维度是好的** |
    | `meta_ads_snapshots` | ❌ **没有** | 仓库文件里的那半边**从没跑过** → 只有广告维度是断的 |
    **所以不要新写一个只补 `meta_ads_snapshots` 的 migration** —— 那会在仓库里留下两份意图重复的迁移，把真正的问题（仓库有、生产没有）盖过去。正确做法：先核对 `20260522000001` 这份文件与生产账本的差异，再决定重放它（文件本身是 `ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`，重放安全）还是写一份显式覆盖两侧的修复迁移。⚠️ 顺带查一遍**还有没有别的仓库迁移没落库** —— 账本里已经有一条 `backfill_drifted_schema`，说明这类漂移不是第一次。
  修：先定这条链路还要不要（P13.D 的原意是把当期广告数据钉进交付物）。要 → **按上面的口径处理漂移、把列补上**（**migration 待 PM `go apply`**）+ **写前按 `id + client_id` 校验包归属、读侧 snapshot 查询同时按 `client_id` 限定**，并把两侧的静默兜底改成显式报错；不要 → 把写侧和读侧一起删掉，别留一段永远返回空的代码。
  🔴 **但绝对不能顺手删掉 `20260522000001` 这个文件**（第四十一轮 Codex 指出，已核实 —— 上一版这里写的"把那份没落库的 migration 一并清理"**是危险建议，已撤回**）：它是**仓库里唯一**给 `project_reviews` 加 `production_package_id` + 索引的迁移（`grep` 全 `supabase/migrations/`，只此一份），而口碑链路（`review/route.ts`、`review/agent.ts`、交付包读侧）**正在用这一列**。生产之所以有这列，靠的是账本里那条单独的 `p13d_project_reviews_pkg_link` —— **那条在仓库里没有对应文件**。删了文件，生产照跑，但**任何新建/重建的数据库都会缺这一列**，口碑写入和交付包读取当场报错。真要清理，只能删该文件里 `meta_ads_snapshots` 那一段，**`project_reviews` 那一段必须留着**（或先补一份等价迁移）。
  ⚠️ 这本身就是 `AD-PKG-1` 那个漂移的第二个面：**生产账本和仓库文件对不上，两个方向都对不上** —— 仓库有生产没跑的（`meta_ads_snapshots` 半边），生产跑了仓库没有的（`p13d_project_reviews_pkg_link`）。修漂移时两边都要对，别只对一个方向。**顺带把 `AD-CUR-1` 里"production package 会永久关联某一条旧 snapshot"那句一并订正**（关联从来没成立过）
- [ ] 🔴 **AD-SPEC-1 房源广告没声明「住房」特殊类别 —— 建的时候不声明、回读也不查【投第一条真广告前必修，须与 `AD-GEO-0` 一起定】**（第三十八轮发现）：
  - `ad-publisher.ts:176` 写死 `special_ad_categories: JSON.stringify([])`，**不看客户业务类型**；
  - 而首投要走的 `draft-listing` 恰恰是**房源**（Roman / 30 Kiteroa 是住宅），客户服务协议 `docs/clients/30-kiteroa-rothesay-bay/service-agreement/2026-07-13-30-kiteroa-lead-gen-test-v1.html:380-383` 明确要求遵守住房广告与反歧视政策；
  - 闸门也看不见这个字段：`launch-readback.ts` / `readback.ts` / `meta-readback-adapter.ts` 三个文件里 `special` **零命中** —— 既不声明也不校验，**轻则拒登，重则违反投放限制**。
  ⚠️ **必须和 `AD-GEO-0` 同批设计**：住房类别下 Meta 会限制定向能力并对地理半径设下限（**具体口径动手前查一次 Meta 官方文档，不要照抄任何二手记忆值**）。也就是说 `AD-GEO-0` 那个"只发城市 + 10km 半径"的修法**在房源广告上可能根本不成立**。两条一起定，否则 geo 会按一个用不了的方案做出来。
  修：按**可信的客户业务类型**（不是请求体传进来的）决定 `special_ad_categories`，并把它加进激活前的回读校验（读 campaign 的 `special_ad_categories` 与预期比对，不符就拦）。**不需 migration**（业务类型若无现成字段，则需一列，届时待 PM `go apply`）
- [ ] 🔴 **AD-GEO-0 `targetingFor` 把国家和城市一起发出去，城市半径形同虚设 —— ME 建的广告从一开始就投整个国家【投第一条真广告前必修】**（第二十七轮发现，比 `AD-GEO-1` 更根本）：`ad-publisher.ts:105-109`
  ```ts
  const geo = { countries: d.geoCountries }            // ['NZ']
  if (d.geoCityKeys?.length) geo.cities = […radius 10km]  // 北岸 10km
  return { geo_locations: geo, … }
  ```
  Meta 的 `geo_locations` **包含项按并集生效** —— `NZ ∪ 北岸10km = 整个 NZ`。**也就是说 ME 自己起草的广告，天生就是"把北岸的房投给整个新西兰"**，正是 `launch-readback` 那条 `geo_mismatch` 引用的 2026-08-04 事故。而且回读会读到同一个错包络，**闸门自己跟自己比，永远一致、永远放行**（所以 `AD-GEO-1` 必须排在这条之后做）。
  修：**有城市就不要再发覆盖它的国家级包含项**（或把国家降为 `excluded_geo_locations` 之外的边界用法），再按 Meta 实际生效范围做批准前比较
  🔄 **2026-08-19 已修，PR [#1075](https://github.com/bigbigraydeng-maker/magic-engine/pull/1075) 待复审，未合并**：`targetingFor` 改成有 `geoCityKeys` 就只发 `cities`，不再同时带 `countries`；新增 3 条单测覆盖三种分支。⚠️ **尚未处理跟 `AD-SPEC-1` 的交互**——`AD-SPEC-1` 指出住房类广告下 Meta 会限制定向能力、对地理半径设下限，「只发城市 + 10km」这个修法在房源广告上可能根本不成立，两条需要一起复核（本次没做，PR 描述里未提及这个交互，复审时要留意）。
- [ ] **AD-GEO-1 `geo_mismatch` 闸门只到国家级，抓不到它自己写明的那次事故**（第二十五轮发现）：
  - `draft-listing/route.ts:302` 传的 `expectedGeo` 是 **`c.country`**（国家级）；
  - `launch-readback.ts:281-290` 只判断 `expectedGeo` 与 `geoNames` 是否互为子串，**从不比较草案里的 `geoCityKeys`**（`targetingFor` 里那个 10km 半径）。

  于是「北岸 10km 被放宽成整个新西兰」这种改动**照样通过** —— 而这条规则的 `learnedFrom` 写的正是「2026-08-04 Roman『IG 专投测试』把奥克兰北岸 $1.25M 的房投给了整个新西兰」。**规则抓不到它自己引用的那次事故。**
  修：把**可信的完整 targeting 包络**（国家 + `geoCityKeys` + 半径）持久化进 `DraftRecord`，激活前**按同一粒度**比较；国家级匹配只能当兜底，不能当唯一判据
  ⚠️ **2026-08-19 排查发现这条暂时排不进去**：`approveDraft()` 现在完全不重新回读/重跑闸门（那是 `AD-GATE-1`，更大的一块未授权工作），所以就算把 `expectedGeo` 存进 `DraftRecord`，approve 阶段也没有消费方，白做。而且 `draft/route.ts:71` 现在已经在传 `expectedGeo: client.country`——这本身就是段落里点名反对的"只重载 clients.country"写法，但由于 `AD-GATE-1` 没做，这行代码目前是死代码，暂时没有实际危害。**真正卡住的是一个产品判断**：`expectedGeo` 的权威来源应该是"这条广告要投的具体城市/郊区"，不是 client 级别的国家字段，需要先定这个再动 `AD-GATE-1` + `AD-GEO-1`，本次不做
- [ ] **AD-SEC-1 实体归属校验缺失 —— 五个入口，其中三个已上线在跑【本次审计发现的最严重一条】**：混账户下（CTS/Oztop 同账户）任何"只校验 URL 里的客户、实体 id 却取自请求体"的写路径，都能被 A 客户的调用方拿去动 B 客户的东西。这就是 strategy doc §2.4 狄仁杰记的 **R5 写越权**，那份文档还指出「ROADMAP §Phase 18 安全边界声称已校验账户 ownership，**与实现不符**」—— 至今仍不符。
  - 🔴 **`meta-ads/execute/route.ts:71+`（已上线、正在用的止损按钮）**：`campaign_id` 直接取自请求体，只做 `requirePaidClientAccess(clientId)`，**从不把 campaign 归属与该客户的 `meta_ad_account_id` 对账**，随后就用共享 system-user token 暂停广告 / 改预算。有 CTS 看板权限的人提交一个 Oztop campaign id 即可动别家的在投广告。**这条比 boost 那条严重 —— 它已经在生产里跑**
  - 🔴 **`ad-health/stop-loss/route.ts:94-115`（已上线、第五个入口，第四十九轮补入）**：跟 `execute` 同一个模子 —— `requirePaidClientAccess(clientId)` 只校验 URL 里的客户，`campaign_id` **直接取自请求体**，随后 `executeStopLoss(campaignId, action, …)` 就去暂停 campaign 或改它的 ad set / campaign 预算。**混账户下 A 客户点"止损"能停掉 B 客户的在投广告。**
    ⚠️ 注意这条和 `execute/route.ts` **是两个独立端点**，不是同一个的两种叫法 —— 修了一个不会自动修好另一个。
  - `boost-post/route.ts`：`post_id`/`page_id` 取自请求体（详见 AD-SEC-2 同类）
  - 通用 `meta-ads/draft`：见 AD-SEC-2
  - 🔴 **`winner-reel-sync/engine.ts`（第四十七轮补入 —— 原来这条清单漏了它，标题的"三个入口"实为四个）**：`loadConfig(clientId)`（`:69-84`）只按 `client_id` 取 `winner_reel_sync_config`，然后把 `ad_account_id` / `target_adset_id` / `fb_page_id` **原样拿去用，从不核验这个 ad set、这个账户、这个主页是不是这个客户的**。随后 `:187-218` 直接往那个组里建广告，`:228-272` 的每日任务还会按 CTR **暂停组内已有的广告**。
    → 所以 `target_adset_id` 一旦配错或残留成共享账户里**别家客户的组**，ME 会（a）把 A 客户的内容塞进 B 客户的广告组，（b）**自动暂停 B 正在投的广告**。这条跟 `execute/route.ts` 的区别是：**id 不来自请求体，来自一张没人校验过的配置表** —— 所以只加"别信请求体"那种守卫挡不住它。
    ⚠️ 这条还跟 `AD-PLAY-1` 咬合：那条已经指出 `winner_reel_sync_config` **没有打法/目标字段、代码也从不回读目标组的 `optimization_goal`**。同一张配置表，既没归属校验也没内容校验，却直接驱动建广告和停广告。
    修：让这条路径共用同一套**实体归属守卫**（ad set / account / page 三者都要），**归属查不出来就 fail closed**，别默认放行
    ↳ 触发它的有两处：`cron/winner-reel-sync-daily` 和看板上的「补新素材」按钮（`ad-health/execute-prescription/route.ts`）。**这两处本身不收实体 id**（`execute-prescription` 只按 `client_id` 查 `winner_reel_sync_config.enabled`），所以修守卫要修在 engine 里，不是修在这两个入口上。

  ✅ **第四十九轮已把全仓 Meta 写路径重扫一遍**（`pauseAd` / `updateCampaignBudget` / `executeStopLoss` / `boostPagePost` / `publishDraftPaused` / `activatePublished` + `src/app/api` 下所有 ads 相关 route），**没有第六个**。另核实 `meta-ads/draft/route.ts:58-64` 那句「不信请求体」的注释**只兑现了一半** —— `pageId: client.facebook_page_id ?? body.pageId ?? ''`，客户没配主页时**仍然回退到请求体**，所以 `AD-SEC-2` 依旧成立。

  修：统一加 **实体 → client 归属守卫**（campaign / page / post / form / creative 都要），或推进账户拆分（§2.1 子牙意见：**根治靠账户治理，不是写白名单**）

  🔄 **2026-08-19 五个入口已全部补上归属校验，两条 PR 待复审，均未合并**：
  - `meta-ads/execute` + `ad-health/stop-loss`：PR [#1075](https://github.com/bigbigraydeng-maker/magic-engine/pull/1075)，新增 `src/lib/meta/campaign-ownership.ts`（核对 campaign 的 `account_id` 是否等于客户登记的 `meta_ad_account_id`）
  - `boost-post` + `meta-ads/draft`（AD-SEC-2）+ `winner-reel-sync/engine.ts`：PR [#1080](https://github.com/bigbigraydeng-maker/magic-engine/pull/1080)
  - ⚠️ **局限没解决，两条 PR 里都写明了**：CTS/Oztop 共用同一个 Meta 广告账户时 `account_id`/`fb_page_id` 天然可能相同，这批守卫挡的是"campaign_id/配置行完全不在这个客户账户里"这一类，挡不住"同账户内配错到共享该账户的另一个客户"——根治仍然需要账户拆分或补一张权威归属表，是产品/运维决策，没有在这轮里做掉。`winner-reel-sync` 的 `target_adset_id` 本身也没核对（不在 `clients` 表任何字段里）。
- [ ] **AD-SEC-2 通用 `meta-ads/draft` 不校验素材归属**：`...(body as AdDraft)` 整体展开，`leadFormId`/`imageHash`/`videoId` 原样来自请求体，客户没配主页时 `pageId` 还回退 `body.pageId`；闸门只查买家可见内容不查资产归属。对比 `draft-listing` 已有 `client_assets` 租户守卫。修：补 page/form/creative 归属校验
  🔄 **2026-08-19 pageId 回退口子已堵上（PR [#1080](https://github.com/bigbigraydeng-maker/magic-engine/pull/1080)，待复审未合并）**：客户没配主页时改成 424 拒绝，不再回退 `body.pageId`。⚠️ **`leadFormId`/`imageHash`/`videoId` 的素材归属校验本身没做**——那部分需要理解 `client_assets` 表的归属规则，本轮判断范围会超出可控大小，特意没有一起动，仍是未完成项。
- [ ] **AD-FACT-1 事实来源从不校验，却盖"官网可溯"章**：`assertFacts` 只查 `sourceUrl` 非空，从不抓页面核对价格/地址/战绩，而 `traceClaims` 把原样传入的字段标成"官网可溯"。**第一条付费广告就会带着未核实内容投出去**，不是量大了才危险。⚠️ **修法不能是"按 `sourceUrl` 抓页核对"**（第二十四轮更正，Codex P1，核实成立）：**事实和 `sourceUrl` 是同一个调用方给的** —— 他完全可以指向一个自己控制、写着假价格假战绩的页面，抓下来照样"对得上"，然后拿到"官网可溯"的章。**拿请求体里的 URL 当信任根，等于没校验。** 而且直抓任意调用方给的 URL 还会引入 SSRF。

  正确修法两条一起：
  1. **信任根是客户配置的域名，不是请求体** —— `sourceUrl` 的 host 必须落在该客户已登记的官网/房源系统域名内（`master_briefs.source_website_urls` / `website` 这类已有字段），否则直接拒绝出稿；或干脆**只接受来自 ME 已核实数据记录的事实**（首条广告用这条最省）；
  2. **抓取必须走 `src/lib/net/safe-fetch.ts` 的 `safeFetchText`**（#965 刚落的 GET-only、连接绑定、带重定向与内网地址防护的原语），**不要自己 `fetch`**
  3. 🔴 **逐句来源必须持久化并显示在审批页 —— 现在它在创建请求结束时就没了**（第五十轮 Codex P1，已核实）：`draft-listing/route.ts:306-312` 的 `traceClaims(...)` **只写进 HTTP 响应**，代码注释自己写着「逐句可溯来源随交付一起给出 —— **红线要求，不是调试信息**」；但 `DraftRecord`（`draft-and-gate.ts:40-55`）**没有 `claims` 这个字段**，唯一的审批页（`ad-approval/page.tsx`）也只展示 `buyerWillSee`。全仓没有第二个调用方接住那份响应。
     → 于是「批准人逐句核对来源再点头」这件事**根本没法做** —— 到他面前时，那份逐字段来源已经不存在了，他只能看着文案批一条真金白银的广告。**校验做得再对，结论没传到决策点，等于没做。**
     修：`claims` 落进 `DraftRecord` 一起存，审批页在「开始投放」按钮前把每一句的来源标注（官网可溯 / brief 可溯 / 未证实）显示出来
  4. 🔴 **事实必须和"哪套房"绑定 —— 光有域名白名单还是能张冠李戴**（第四十六轮 Codex P1，已核实）：`draft-listing/route.ts` **从头到尾没查过 `listings` 表**。`listingId`（`:191-229`）只被拿去做**素材归属闸**（`pickUsableForListing(found, body.listingId, clientId)`），而 `body.listing`（`ListingFacts`：价格、地址、战绩）和 `sourceUrl` **全部来自请求体，从不与那套房的记录核对**。
     → 于是「**A 房的价格地址 + B 房的真实照片**」这种组合，域名白名单和素材闸**两道都过** —— 素材确实属于 B 房、URL 确实在客户域名下，但广告在拿 B 房的照片宣传 A 房的价格。这直接踩 CLAUDE.md §8「绝不凭空注入客户业务数据」那条红线，而且比编造更难发现（每一项单看都是真的）。
     修：**按 `id + client_id` 把那套房从 `listings` 读出来**当身份锚点；退一步至少要校验 `sourceUrl`、`ListingFacts` 与 `listingId` 三者指向同一套房，对不上就拒绝出稿
     ⚠️ **但"事实由 `listings` 这条记录派生"做不到，别照着施工**（第四十七轮 Codex P1，已核实 —— 上一版就是这么写的，错了）：`20260730145332_listings.sql:38-82` 里**没有 `sourceUrl`，也没有精确价格**。它有的是 `address_line` / `suburb` / `property_type` / `bedrooms`，价格只有 **`price_band` 档位**（`under_1m` / `1m_1_5m` / …），而且那个档位是**刻意**这么设计的 —— 迁移注释写明「NZ 很多房子 price by negotiation，真实要价到成交都不公开，**存一个编出来的数字比存档位更糟**」。另有 `status` / `vendor_notes` 是**内部**字段（`prospect` / `withdrawn` / 卖家备注）。
     → 所以照上一版施工会有两个后果：① `listing-draft-builder` 因为拿不到 `sourceUrl` **直接抛错、出不了稿**；② 更糟的是有人为了跑通，把 `price_band` 当价格、把 `status` 当对外说法**翻译成广告文案** —— 那是把内部档位和内部状态变成对客户的公开声明，本身就踩 §8。
     → 正确口径：**身份按 `id + client_id` 绑定（这半对），但事实必须取自一条带精确声明 + 逐字段来源的已核实记录** —— 这条记录今天不存在。**要么先扩数据契约**（给 listings 补 `source_url` + 精确价格声明 + 每个字段的 provenance），**要么首条广告只用 ME 已核实的数据记录**，不要从 `listings` 硬凑
- [ ] **AD-OBS-1 创意变体数不可观测**：`ad_daily_insights` 的 ad 级行无 `creative_id` / `asset_feed_spec`，`ad-level-breakdown.ts` 也只到 ad 级 —— "我们到底投了多少种说法"系统答不出来（用了 Advantage+ 素材自动化的广告尤其）。修：回读 `creative` + asset feed 并落库
- [ ] **AD-OBS-2 攒池测试无法按 hook 归因**：`client_audience_assets` 按 `audience_id` 唯一、无创意维度，而 `videoEventRule` 把一批 videoId 灌进同一个池 → `P18.E.3` 只给得出池子整体净增。修：一 hook 一池，或另建创意级增长映射。（完播成本那半由 `P21.K.8` 覆盖）
- [ ] 🔴 **AD-LOG-1 `record()` 漏读 `error`,而且失败时会留下失联的暂停实体【投第一条真广告前必修 —— 第四十五轮补入首投前置】**（第二十七轮升级,原写"小 bug 顺手修",低估了）：`const { data } = await supabase...insert()`,`error` 连接都没接;且它发生在 `publishDraftPaused` **已经建出 campaign / ad set / ads 之后**。
  所以插入失败时不只是"少一条账本":**那套暂停实体没有 `actionId`,既批不了也拒不了**,重试还会再建一套 —— 而 `ad-publisher.ts` 头部自己写着「半成品留在账户里比失败更糟:它会出现在后台、会被人误开、会进第二天的扫描」。
  ⚠️ **这比 `AD-ORPH-1` 更糟,不是同一回事**（第四十五轮补）:blocked / rejected 至少还有一条账本行记着 `campaignId` / `adSetId` / `adIds`,后面的人能顺着找;而这里**连行都没有**,那套暂停实体在 Meta 里彻底失联,**没有任何 ME 里的东西知道它存在**。而且 `:158-165` 拿到 `null` 照样返回 `status: 'awaiting_approval'`,调用方看到"成功"于是重试,再建一整套。
  修:① `record()` 读 `error`;② 账本写失败时按已返回的 Meta id **回滚**(publisher 已有逆序删除逻辑),或持久化可恢复/幂等状态;③ 回滚也失败时**下发人工任务**(what/how/href 三件套),不能只写 `console.error` —— 铁律 3「发现不许死在日志里」
- [ ] **AD-ADV-1 `ad-publisher.ts:116` 写死 `advantage_audience: 0`**：无差别关掉 Advantage+ 受众，是 ME 代码唯一与 Andromeda 打法正面冲突处。现有两种 `DraftKind`（`lead_form` / `video_thruplay`）都是冷投，应改为 `1`；将来加 `warm_pool_retarget` 这类 kind 时才需要显式关闭。**该路径没有留下任何成功建广告的记录（账本会静默丢记录，故只能说"无记录"），现在改成本极低**
- [ ] **AD-DRAFT-1 `listing-draft-builder` 硬写单条创意**：`creatives: [creative]`（`:193`/`:254`），而 `AdDraft.creatives` 是数组、publisher 已在循环建。同一语言内出 5–8 个角度需新增"批量角度选择/生成 + 去重 + 逐条溯源"编排层（**新增开发，半周到一周**，不是接线）。跨语言合并另需表单身份下沉到每条 creative + 表单广告混语言闸门
- [ ] **AD-FORM-1 选表单时不看语言，英文广告可能把买家送进中文表单【首条真钱广告的前置】**：`draft-listing/route.ts:82-105` 的 `pickForm(forms, wanted?)` **不接语言参数**，且该主页只有一个可用表单时**直接返回它**、不问语言；`launch-readback` 也不检查表单语言（它的混语言闸只覆盖私信）。于是按语言拆了草案也没用 —— 后果与 §5 问题 5 的"同一草案混语言"相同，只是路径不同。⚠️ **修法不能只是"把语言传给 `pickForm`"**（第二十九轮更正）：`BuildOptions` **早就有 `lang`**(`listing-draft-builder.ts:55`),缺的是**另一侧** —— `lead-forms.ts:118` 只请求 `fields: 'id,name,status'`,**表单本身没有任何语言信息可比**。传了也没东西可匹配。
  修(按可靠性排序):① **显式的 form→language 配置**(FDE 在 Settings 里给每个表单标语言,一次性,最可靠);② 回读表单的 `locale` 或问题文案再判定语言(需先验证 Graph 该节点确实返回 locale);③ 兜底:表单名必须带语言标记 + `pickForm` 强制要求 `formName`(禁止"只有一个就直接选")。**无论哪种,都要配一条"表单语言 ≠ 文案语言"的闸门**,别只靠选对
- [ ] **AD-EXPL-1 多角度测试要设"每臂最低探索量"，否则学不到东西【决定「找出赢家」这个卖点成不成立】**：把 5–8 个角度塞进同一个 ad set 让 Meta 分配，拿到的是**投放优化**，不是**可比较的角度实验** —— Oztop 那 14 条 hook 正是这个结构，`OZ-S1-A-spill` 一条吃掉 64.9%，另外 3 条不足 $1，大多数角度零探索。本仓 `ad-level-breakdown.ts:89-91` 早就写明「Meta 在同一广告系列内会先预测谁会转化再分配展示……把这种广告当成对照组会得出反向结论」，同文件的 `MIN_RESULTS_FOR_COMPARISON = 3` 与「从不宣称谁赢了」也是同一个意思。修：每臂最低展示/花费下限 + 分批放量，或直接用 Meta 原生 A/B test（`ads_experiment_abtest_*`，平台侧公平分流）。⚠️ **这要额外预算，属业务决策，需 PM 拍板**；没做之前对外只能说"多试几种说法、平台挑出跑得最好的"，**不能说"告诉你哪句话最打动人"**
- [ ] **AD-EVID-1 补读 Oztop + Roman 两个账户的 targeting【审计结论覆盖率的前置】**：本次审计的 broad/Advantage+ 结论**只覆盖 3 家客户里的 1 家（CTS）、17 条 campaign 里的 6 条**（⚠️ 不用花费占比表述 —— NZD 与 AUD 不可相加，见审计 §3.1）；Oztop 的 `1735240120460765` 是 `is_ads_mcp_enabled: false`，Roman 的花费在 `1018365291238494`（`is_queryable: false`，UNSETTLED）。两条路本次都实测过、都不通，**必须在有 `META_SYSTEM_USER_TOKEN` 的环境里**跑 `GET /act_<id>/adsets?fields=targeting,name,status,optimization_goal,campaign_id`。
  ⚠️ **必须沿 `paging.next` 翻到底，不能只读首屏**（第三十二轮 Codex P2）：Graph 的 `/adsets` 默认一页 25 条，而本次审计遇到的 CTS 账户就有 **26 个 ad set** —— 裸调一次会静默少一条，而"少读了"和"没有"长得一模一样，覆盖率和归属结论都会偏。照 `src/lib/meta/ads-posts.ts:36-66` 的写法（`while (url) { … url = json.paging?.next ?? null }` + 页数 guard），**并且撞到 guard 上限时必须把结果标成「不完整」，不能拿首屏去补审计结论**。
  ⚠️ **还要把混账户里剩下的 20 组也归属清楚**：`act_2775766642787274` 里只有 6 组能对上 ME 追踪的 CTS campaign,另外 20 组($1,278.76)含 Oztop 投流**和未被 ME 追踪的 CTS boost**,而**全部 8 个带兴趣定向的组都落在这 20 组里**。不归属清楚,"CTS 零兴趣定向"就只能说到"那 6 条 campaign",提不到"CTS 这家"。
  ⚠️ **必须带 `campaign_id` 并按归属过滤,不能拿整账户当某个客户的**：`act_1018365291238494` 挂在客户 Roman HU 名下,但 30 Kiteroa 那个楼盘(独立 client)的广告数据也落在同一账户里(见 `docs/clients/30-kiteroa-rothesay-bay/campaigns/live-ops-handoff.md`「广告数据其实一直在回流,只是记在了另一个客户名下」)。不过滤就会重演本审计第八轮那个错误 —— 把混账户的统计安到单个客户头上。活不大,但没做之前"投放侧已经做对了"这句话只能覆盖 3 家里的 1 家、17 条 campaign 里的 6 条
- [ ] **AD-FRAG-1 每条帖子一个 campaign + 一个 ad set，学习数据被打散**：CTS 账户 26 个 ad set 里 14 个是 `帖子："…"` 型 boost，单条 $2–$37。这不是"按兴趣拆人群"那种碎片化，但后果一样 —— 小预算跑不出 learning，创意之间无法在同一个竞价里公平竞争。⚠️ **这一条要拆成两件事，别当成一条修完**（第四十九轮 Codex P2，成立）：上一版改完变成"campaign 复用、预算或排期不同的各自一个 ad set" —— 但**本条声称要解决的"小预算跑不出 learning、创意无法在同一竞价里公平竞争"是 ad set 这一层的性质**。各自留一个 ad set，那个问题原样还在。所以现在这条修法**只是后台组织整洁，不是碎片化的解药**，不能记成同一件事做完了。
  - **(a) 组织归并（本条，低风险可先做）**：boost 走统一的常驻 campaign，不再每次新建一整套。收益是账户可读、报表可归并 —— **就到这儿，别声称它修好了 learning**。
  - **(b) 真正的碎片化修复（另一件事，须单独设计）**：要让创意真正进同一个 ad set 竞价，前提是**共享预算 + 单条广告自己的生命周期**（按广告起停，而不是靠 ad set 的 `start_time`/`end_time` 排期）。这会改掉 `boost-post` 现有的每次一份 `daily_budget_aud` + `duration_days` 契约（`route.ts:45-70,101`，预算与起止时间设在 ad set 层，见 `client.ts:696-698`），**属于新设计，不是顺手做**。
  ⚠️ **但不能一路并到"同一个 ad set"—— 那会打断现有请求契约**（第四十八轮 Codex P2，已核实。上一版写的是"统一的常驻 campaign/**ad set**"，那半句错了）：`boost-post/route.ts:45-70,101` 每次接受**这一次自己的** `daily_budget_aud` 和 `duration_days`（1–30 天），而 `client.ts:696-698` 的 `boostPagePost` 把 `daily_budget` / `start_time` / `end_time` **设在 ad set 这一层**。所以复用同一个 ad set 会有两个后果：① **新帖子没法有自己的预算和截止日期**；② **改这个组的预算/排期会同时影响之前所有还在跑的帖子**。
  → 正确口径：**campaign 复用（归并的收益主要在这一层）；预算或排期不同的仍然各自一个 ad set**。真要并到单个 ad set，得先把契约改掉 —— 定义共享预算 + 单条广告自己的生命周期（按广告起停而不是按组排期），那是另一件事，不能顺手做
- [ ] **AD-LINK-1 `creative_ref` 的身份粒度要按 variant 不按素材**：5–8 个角度常共用同一张图，按素材 id 记会让所有角度写同一个 `creative_ref`，角度归因归零。需 variant 稳定 id + 素材关系另存 + `adId → variantId` 绑定；配套 migration（`ad_creative_links.post_id` 放开 NOT NULL、`creative_source` 加 variant 层）**待 PM `go apply`**

### Onboarding / 第三方对接页面简化（2026-08-11，方案见 [specs/2026-08-11-onboarding-integrations-unify-v1.md](./specs/2026-08-11-onboarding-integrations-unify-v1.md)）

已上线（PR1 [#908](https://github.com/bigbigraydeng-maker/magic-engine/pull/908) / PR2 [#909](https://github.com/bigbigraydeng-maker/magic-engine/pull/909) / PR3a [#913](https://github.com/bigbigraydeng-maker/magic-engine/pull/913) / PR5 [#916](https://github.com/bigbigraydeng-maker/magic-engine/pull/916)）：GA4/GTM 补进真 OAuth provider 白名单 + DB 约束扩容 · GA4/GSC 真授权 + 老 `google_oauth_tokens` 表回填进新表 · 三处重复对接入口（`/connectors` 等）合并进 settings 页一个入口，19 处内部链接跟着改 · 顺手补上 Google OAuth 发起/回调此前零鉴权的越权漏洞。

- [x] ~~**PR6**~~ 2026-08-12 已合并（[#918](https://github.com/bigbigraydeng-maker/magic-engine/pull/918)）：已建好但一直没激活的 5 步自助向导正式设为新客户登录落地页。复审（魏征+板桥）已修：`isBriefComplete()` 卡两个完成戳导致的死循环锁 · 诸葛亮中文内部工具悬浮窗对 self_serve 客户可见（信任崩塌级） · Step1/2 表单不回填已保存数据（像丢数据）· 完成页死胡同没有返回按钮 · 500 MTC 欢迎奖励向导内无确认
- [ ] **PR6 板桥发现5（低优先级，随手可修）** Google 连接失败 vs 客户自己点取消，回向导后画面一模一样看不出区别——不卡人，PR6 已上线，这条留到下次顺手改
- [ ] **PR3b（contract 阶段，PM 已表态"优先级较低可以往后放"）** 老 `google_oauth_tokens` 表目前仍是读写兜底路径（PR3a 只做了双写+双读的 expand），等回填脚本在生产真正跑过、观察一段时间没问题后，再停止读写旧表并评估能不能删

### NZCPE 2026（新西兰中国贸易博览会 · 2026-08-05 建档，客户档在 [docs/clients/nzcpe/](./clients/nzcpe/)）

FDE 接手范围：网站 `nzcpe.co.nz`（Cloudflare Pages）+ Facebook，服务 11 月博览会。
已上线：假新闻清理 · GSC/GA4/Meta Pixel 全部接通（Pixel `1109538797562911`，全站 PageView + 三个报名表单 `Lead`）。

- [ ] **NZCPE-1 推广方向口径待 PM 一句话定死** —— 网站 SEO 已按 PM 2026-08-05 拍板改回 **B2B**（中国企业出海 / NZ 企业对华采购），而广告与社媒计划仍冲 **To C** 的 15,000 公众访客目标。两条线现在方向不同：是有意为之，还是广告也要一并转 B2B？没定死之前，广告线按 To C 继续跑。
- [ ] **NZCPE-2 GBP 建档** 地址挂 NZICC（101 Hobson Street, Auckland CBD）—— To C 推广也吃自然搜索流量
- [ ] **NZCPE-3 确认 `plan_tier`** 现设 `starter`，无预算信号，PM 确认后再调
- [ ] **NZCPE-4 广告账户挂谁** NZCPE 自建 vs Magic Engine `1018365291238494` 代投 —— PM 待拍板
- [ ] **NZCPE-5（可选，PM 决定要不要做）** 关键词调研发现 `things to do with kids auckland`（1900/月·低难度）比品牌词好抓，可做网站博客 / `news.html` 扩展 —— **但这跟 NZCPE-1 的方向问题绑在一起**，B2B 方向下这条不成立

### 三位 agent 复审剩下的（2026-08-05，已修的不列）

已修：26 个客户接口零鉴权 · 素材闸门能被一键洗白 · 撤回确认不可逆降级 · 上传页假隐私承诺 ·
chunked 绕过 OOM 闸 · 闸门没接在花钱那条线上 · 归档入口（全系统原来零个写 archived_at）

- [x] ~~**P21.J.UP1–UP8**~~ 2026-08-05 全部清掉：删房源被自己触发器挡死（外键 SET NULL 的级联是真 UPDATE）· 公开桶路径泄 client_id · 公开上传口零限流 + vision 队列全局 FIFO 跨客户饿死 · 上传失败原因被前端丢光 · `judgeAsset` 从不读 clientId + 库层无跨客户守卫 · 签字不限 FDE（客户能给自己背书）· 7 条逃逸变异逐条补测并复验 · 文件名用 `Math.random()`
      真库探针复验 6 条全过：删房源通了且素材归属自动置空 · 改挂/换文件/跨客户（INSERT 和 UPDATE）全被挡 · 签字/归档/放回来不受影响

- [ ] **P21.J.UP9** 两个新路由（房源素材列表、归档）+ 面板仍零测试。跨客户拿数、`uploadUrl` 的 fail-closed、20 文件截断回报、全失败分支，一条都没覆盖
- [ ] **P21.J.UP10** 上传文件零内容校验（信客户端 `file.type`，无魔数）；`visual-assets` 桶 `allowed_mime_types` 为 null（对比 `brief-uploads` 是有白名单的）
- [ ] **P21.J.UP11** `visual-assets` 桶仍是 `public=true`。路径已 hash 化不再泄 client_id，但「知道 URL 即可读」这条没变 —— 要根治得改私有桶 + 签名 URL
- [ ] **P21.J.UP12** 上传令牌非确定性（GCM nonce 随机），每打开一次页面就多铸一条永不过期、无法单独吊销的链接。至少要让签发落账可吊销

- [ ] **P21.J.M11** 卖家向 Reel 需要 **Ray White 侧的新证明点** —— 官网四条战绩全带前东家分行名 `Royal Heights Branch`，逐字引用不行、改写更不行。要跟 Roman 要 Mission Bay 的挂牌数/成交案例/Ray White 自己的奖项
- [ ] **P21.J.M12** `romanhu.com` 仍是旧行资料（含 `r.hu@barfoot.co.nz`）—— 广告线已被禁用词闸拦住，但网站本身该改（属 website-rescue 那条线）


- [ ] **NZCPE.1** NZCPE 2026（新西兰-中国商品博览会，client_id `3f3617f5-2124-475d-9212-6f8c14f0b0e2`，FDE 接管网站+FB，目标=11月展会 To C 推广，因粉丝基数≈0 已定调优先做广告非自然发帖）2026-08-05 已把 Page(`721663957708055`)共享给 Magic Engine 业务组合(`1265811139097132`，权限：内容+广告+成效分析)，Facebook 侧确认生效。**下一步**：验证 Magic Engine 广告账户(`1018365291238494`)能否用这个 Page 建广告；LinkedIn/Instagram/WeChat/小红书/TikTok 本轮暂缓不用管。详见 [docs/clients/nzcpe/client-brief.md](./clients/nzcpe/client-brief.md)
- [x] **NZCPE.1b** NZCPE 2026 追踪工具接线已完成 2026-08-05：GSC 验证+提交 sitemap、GA4 建 Property(`G-Q2L7PFQSB5`)、Meta Pixel 找到既有未装的 Pixel(`1109538797562911`)装上+接 Lead 事件，GTM 判断跳过(理由见 client-brief.md)。过程中发现本机 Cloudflare wrangler 全局登录会被并行窗口切走导致部署失败，改用专属 API token 解决，以后 nzcpe-site 部署都走这个 token
- [ ] **NZCPE.2** NZCPE 2026 GBP——2026-08-05 查到 Google 上已有未认领的旧档案"NZCN Expo Auckland office"(同一主办方旧年份用的)，PM 拍板改名/更新成2026版，但认领必须客户自己账号走验证流程，卡在等 Richard Meng 动手认领+加 ME Manager 权限。顺带发现网站全站 NZICC 地址写错("11–13 Hobson Street"→已修正为真实地址"101 Hobson Street, Auckland Central 1010"，13文件23处已部署验证)
- [x] **NZCPE.3** NZCPE 2026 DataForSEO 关键词调研已完成 2026-08-05，写入 `clients.primary_keywords`。真实发现：品牌词("NZCPE"等)搜索量≈0，"things to do with kids auckland"(1900/月,难度20)才是真实流量入口，内容方向应该从"贸易博览会"品牌向转成"奥克兰周末免费亲子活动"意图向
- [x] **NZCPE.4** NZCPE 2026 网站 SEO 技术审计+修复已完成 2026-08-05：加了 canonical/OG/Twitter Card(全站原本零覆盖，FB广告落地页分享没有预览图) + Event/Organization JSON-LD 结构化数据 + 修了首页 title 日期写错(19-22误写成20-22实际是20-22)。⚠️ 还差：Google Search Console 从未提交(无验证 tag)——需 PM 的 Google 账号登录才能拿验证码，我这边进不去；Meta Pixel 也没埋，投 Conversions 类广告前必须先装
- [ ] **NZCPE.5** NZCPE 2026 网站+FB 内容规划+广告计划已出草案，见 [docs/clients/nzcpe/content-and-ads-plan.md](./clients/nzcpe/content-and-ads-plan.md)。待 PM 拍板：广告预算量级、广告账户挂谁、要不要做"things to do with kids"博客内容、中文素材由谁做
- [ ] **TM.1** 团队工作记忆 · 套路层出第一条：机器已建好，但要先吃几天真实会话数据才提炼得出可复用套路。观察 `team_skills` 是否开始有行；一周后没有就回头看 distill prompt 的套路判据是不是太严
- [ ] **TM.2** 团队工作记忆 · 后台页 `/dashboard/team-memory` 补视觉验证：功能上线时页面在登录墙后未做视觉检查，数据层与接口层已验
- [ ] **TM.3** 团队工作记忆 · 补第二个 agent 复审：按铁律 4 属大任务（加表 + 新 endpoint + 新 UI），交付时只做了自审 + 变异测试，缺魏征挑刺那一刀

- [ ] **P29.SEO.14** AU/NZ SME service page QA pass - verify titles, canonicals, internal links, sitemap exposure, and only make tiny fixes if the new service pages need one more polish pass.
- [ ] **P30.S2.4** real_estate_auckland 8 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S2.5** flooring_tiles_brisbane 12 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S2.6** logistics_3pl_nz 9 个域名采集 + 写 industry_benchmarks
- [ ] **P30.S4.4** real_estate_sydney — 悉尼房产（等客户）
- [ ] **P30.S4.5** real_estate_melbourne — 墨尔本房产（等客户）
- [ ] **P30.S4.6** real_estate_christchurch — 基督城房产（等客户）
- [ ] **P30.S5.5** 前端加趋势列（domain 历史折线 / 14d 30d 涨跌）
- [ ] **P30.S5.6** 异常预警（domain 单次掉分 >10% 报警 FDE）
- [ ] **P30.S5.7** 客户对照视图（客户 vs 行业 P50 折线图）
- [ ] **P31.X.1** 月营收"季度签字对账"流程（避免客户自报数据失真）
- [ ] **P31.X.2** 主指标 measurement='auto' 时自动拉取 current_value（GA4 / SerpAPI / Apify）
- [ ] **P31.X.3** AI 参谋升级：基于历史 outcome 推荐 Initiative 组合（依赖数据沉淀）
- [ ] **P31.X.4** 评分公式重做（reputation / SEO / ai_visibility 维度独立大工程）
- [ ] **P31.X.4a** CTS 的 AI 可见度判断从 ai-tracker（系统 B）迁到 M1（系统 A = `geo-module`+`geo-baseline`）——**2026-09-20 投资调查结论**：PO 2026-08-19 已拍板「M1 唯一真相源、ai-tracker 整套退役」（见 [DECISIONS.md](./DECISIONS.md) 2026-08-19 条目 + [拆除清单](./specs/2026-08-19-ai-tracker-decommission-v1.md)），但退役从未执行，CTS 的每周可见度数字目前 100% 来自即将退役的 ai-tracker。M1 现在**接不了 CTS**，前置缺口：① M1 底层测量表（`geo_observations`/`geo_evidence`）目前确认有 Roman（批次 `688bd8ae`）和 ME 自家品牌（批次 `a2f09f81`，客户 `f1d062ca-929e-4b4e-ba6e-84752b748552`，18 条观测）两份真实数据；且 ME 那批当时是用 `docs/marketing/` 的人工五类规则（cited/recommended/described/compared/not_present）分类的，不是真跑了 `interpretObservation`（M1 判断函数本身）。**CTS 是否也已有真实数据待核实，不能再断言「空」**：只读诊断脚本 `scripts/diagnose-cts-geo.ts:30-31` 硬编码了一个具体批次 `77124a10-d22b-4722-94c2-aeae69f73d76`，且脚本 `:215-225` 把该批次观测真的送进 `runGeoModule`（→`pipeline.ts:164-171` 逐条调 `interpretObservation`）——这只能说明写这个脚本时数据库里已经有这个批次，但诊断结果从未落进任何文档（全仓 grep 该批次 ID 只命中脚本本身，无落盘记录；来源 issue [#1363](https://github.com/bigbigraydeng-maker/magic-engine/issues/1363) 至今仍 **OPEN**，验收清单「跑通 18 条证据→M1 解释」「结果报 PM」两项都还没打勾）。**推进本条前必须先核对这个批次现状**（是否仍在、观测数、重跑一次拿到最新输出），再准确定义缺口到底是「历史数据」「已有运行结果未沉淀」，还是仅剩「自动排期 + 客户配置持久化」——避免对已存在的测量重复采购，也避免遗漏已有 CTS 结果；② CTS 专属 `entityProfile`（消歧锚点等）只在手工诊断脚本 `scripts/diagnose-cts-geo.ts` 里有一份草稿（字段值已由 PM 2026-09-04 确认，见 #1363），从没进过任何客户配置或被排期任务读取过；③ M1 的每周自动采集调度（`geo-remeasure`）自己代码注释承认还是「slice 3a 骨架，不调 provider、不花钱、无 cron」，slice 3b 未落地；④ 子牙在拆除清单 §7/§9.2 里点名「M1 缺 living query set 能力（边发现边追加跟踪问题），删 ai-tracker 前必须先补」，至今未补；⑤ 拆除清单 §9.1 点名「归因靶心」——ai-tracker 退役后没有任何东西再往 `flywheel_metrics.geo.query.mention_rate` 写数，而这条 metric 是诸葛亮 AI 可见度动作的 `expected_metric`，断供会让归因永久失效、`GEO-01` 异常规则和健康分 GEO 维度静默归零，§9.1 要求二选一且不许静默留空：(a) M1 侧补一条写入路径，或 (b) ROADMAP 登记该指标断供 + 配可见告警，并让下游区分「未测量」与「真的差」。**本次先让 [#1823](https://github.com/bigbigraydeng-maker/magic-engine/pull/1823)（`00466090`）落地为 ai-tracker 侧 bug 修复上线**（修的是子串误判，让**以后**新采集的数字变准，历史记录尚未回填，见 [CHANGELOG](./history/CHANGELOG.md) 同日条目；判断口径本身也跟 M1 并不等价——ai-tracker 把「回答里引用了客户网址」算作提及，M1（`src/lib/geo-module/m1.ts`）的口径是「网址引用 ≠ 提及」，还要求推荐语义、消歧锚点和置信度门槛，两套规则有意不同，见 [口径说明](./audits/2026-09-20-ai-visibility-client-rank-grounding.md#规则口径说明与-geo-解读模块的差异有意为之)）；M1 迁移单独按这条 P31.X.4a 排期，规模跟 A 级任务一样大，需要逐步 PO `go`，不在这次任务里做。

  **别把这条只当成「CTS 一个客户的事」**：`ai-tracker-weekly` cron（`src/app/api/cron/ai-tracker-weekly/route.ts:50-102`）是全体客户共用的一个任务，只要客户有 enabled 的 query 就会被它每周跑到。2026-09-20 审计实际摸到的数据集除 CTS 外还有 **11 个**：Roman、Magic Lab Class、New Asian Logistics、Magic Lab、Shop Five、CYHB Fashion、Dixon Homes、IB Real Estate、Sandcastles Hotel、oztop、Kingston International English（见 [审计表](./audits/2026-09-20-ai-visibility-client-rank-grounding.md#一句话结论) 上方对照表）。**只把 CTS 迁到 M1、然后停掉整个 cron 或删表，会让这些客户里任何还在 active 的立刻停止新增 AI 可见度数据**——先核实这份名单里哪些客户现在还是活跃订阅，逐个要么迁到 M1（补 query set + entityProfile + 排期）、要么拿到 PO 明确的停测决定，不能只顾 CTS 一个。

  **验收条件**：①-⑤全部前置缺口都要闭合，其中⑤不能只续写 `mention_rate` 一条——`writeTrackerFlywheelMetrics`（`src/lib/flywheel/metrics/writeTrackerMetrics.ts:6-8`）实际写三条 `flywheel_metrics.geo.*`：`query.mention_rate`、`engine.coverage`、`query.avg_rank`（后者喂 `src/lib/flywheel/health/score.ts:66-69` 的 GEO 健康分），必须三条一起续写或一起显式登记未测量 + 可见告警，只接一条会让健康分先拿陈旧值算、再突然缺维度改口径；并由 PO 明确 CTS 迁移后采用 ai-tracker 式「网址引用=提及」还是 M1 式「网址引用≠提及」判断口径，不得默认「口径已看齐」。**⑥ 还必须核对引擎覆盖范围**：ai-tracker 每周默认跑 `['openai', 'google']`（`src/lib/ai-tracker/orchestrator.ts:79`），而 M1 目前唯一真实 provider 适配器明确只认 OpenAI（`src/lib/geo-baseline/provider.ts:36-37`）——直接切换会让 Google 那部分静默从提及率/平均名次里消失，却可能被误读成正常的趋势变化（GEO 测量契约把 engine coverage 定义为所有指标的分母修正项，见 `docs/specs/2026-08-10-me2-geo-measurement-contract-v1.0.md:134`）。迁移前要么给 M1 补齐等价引擎覆盖，要么显式重置基线并把缺失引擎标「未测量」，不能让两套系统的数字被当成同一条连续曲线看。**若本条最终推进到真删 `ai_visibility_snapshots`/`ai_visibility_runs`/`ai_visibility_queries` 三张表，DROP 前必须同时满足至少三条硬前置，缺一不可**：(a) 归档——原始回答 `raw_response` **实际存在 `ai_visibility_runs` 表**（`supabase/migrations/20260430000002_ai_visibility_tracker.sql:45`），**不在** `ai_visibility_snapshots`（同文件 `:69-85` 该表没有这一列），拆除清单 §9.3 只写了导出 snapshots+queries 是不完整的表述——**且这三张表是全体客户共用的，不是 CTS 专属**：2026-09-20 只读重算摸过全部 6,596 条历史记录，至少涉及 CTS、NAL、Roman、Dixon 四个客户，裸删表会把非 CTS 客户的原始回答也一起不可逆抹掉。归档范围必须是**全部客户**的 `ai_visibility_runs`（含 `raw_response`）+ `ai_visibility_snapshots` + `ai_visibility_queries` 一起导出 JSON（CTS 存 `docs/clients/cts/`，其余客户存各自 `docs/clients/<client>/`）——**导出脚本必须用 `src/lib/supabase-paginate.ts` 的 `fetchAll`，不能直接单次查询**：Supabase/PostgREST 单次硬顶 1000 行且不报错，`ai_visibility_runs` 有 6,596 条，裸查询会静默只导出前 1000 条，验收不能只看「文件存在」，要按表、按客户核对导出行数与删除前的数据库计数一致；(b) 拆除清单 §6 步骤 2–4 列出的全部**活消费方**已重接完成，不能只做归档就删表——§4 点名的组 F（诊断打分）、组 H（博客选题）、组 I 第 2 项（FDE 月报）、组 M（`strategy/analyzer`）、组 N（主看板 donut），加上这次复审另外核实到、拆除清单本身没登记的 `src/lib/web-intelligence/competition-sources.ts:43-44`（付费 Web Intelligence 接口的竞对 AI 推荐表现字段）——全部改到 M1 或补齐「未测量」降级读，并用全仓 grep 全 token + 生产 `pg_stat` 复核确认零读写；(c) 三张表另有 3 处外键会挡住裸 `DROP TABLE`：`geo_directives.source_tracker_snapshot_id`→`ai_visibility_snapshots`、`blog_posts.source_query_id`→`ai_visibility_queries`、`content_strategy_items.source_query_id`→`ai_visibility_queries`（均 `ON DELETE SET NULL`，只管行删不管表删），直接加 `CASCADE` 会悄悄丢约束、留下指向已删表的死列，DROP 前必须先决定这三列怎么处理（迁移数据 / 显式去约束）。**这条 DROP 清单已经过好几轮复审修正，真要执行前必须重新完整审计一遍，不要把这几条当作齐全的清单直接抄。**
- [ ] **P31.X.5** Retention / Reactivation intent（需先接通 CRM/EDM）
- [ ] **P31.X.6** Initiative 类型扩展：Operations / Market Intelligence / Product / Partnerships
- [ ] **P33.11** Goal 详情页 Initiative 卡片展开显示：关联 Campaign 数量 + action 完成率
- [ ] **P33.12** Goal 详情页底部「执行进度摘要」区块（各 Initiative 进度条 + 总数统计）
- [ ] **P34-P3.9**（降级 backlog）`createMcpAuthAdapter(kind)` 抽取防 verifyToken 漂移（两 endpoint 已工作+测试覆盖，纯重构）
- [ ] **二期补强**（狄仁杰/魏征 backlog）：真 colleague-confirm code 流程 · IP 白名单升 DB 强约束 · 过期邮件（依赖 P2 SendGrid）· 老 mcp_access_log.key_id 列下线
- [ ] **P35.7** 转化闭环接线：replied → 发 `/discover` magic link；converted → `converted_client_id` 关联 clients
- [ ] **P35.8** 定价页 / 官网 Digital Foundation 套餐文案（板桥必审：C 端文案）。**退款保证措辞红线（PM 拍板 2026-07-06）**：保证挂「交付」不挂「效果」——「7 天内四项升级全部交付并附验证截图，做不到全额退款」；绝不承诺排名/客流/生意变好（SEO 见效 8-12 周，写效果 = 给退款开后门）；交付验证截图（前后对比）同时是 case study 素材；「提升」的证据由 $199 Keep-Alive 月报在第 2-3 个月兑现（续费 + 升 FDE 钩子）
- [ ] **P35.9** AI 语音外呼（PM 指定方向 2026-07-06）：ElevenLabs Conversational AI / Bland.ai / Vapi 选型 PoC。用途分级：**warm 跟进优先**（邮件已回复/未接来电回拨），cold call 需先查 AU Do Not Call Register 合规（企业号码也可注册 DNC）。AU/NZ 口音语音 + 通话结果回写 outbound_prospects
- [ ] **P35.10** 外呼专用域名（PM 已拍板不用主域）：候选近似域名查询 → PM 选定注册 → SPF/DKIM/DMARC 配置 → 2-3 周预热计划。主域只收回复，保 magic link 通道信誉
- [ ] **P35.11 邮箱深挖（治本，PM 拍板 2026-07-13）⭐**：**「假邮箱」≠「没邮箱」** —— 诊断 9 个被判无邮箱的商家（Maddren Homes / Clinic 1 / ETF Electrical / Roofing Excellence / Space Air / The Cosmetic Store / Factory Carpets / Voltsy / Moore Quality），**全部有真实官网 + 电话，4 家还有在线询盘表单**。根因 = 抓取器只读首页 HTML、抓到主题占位符（`user@domain.com`/Wix `mysite.com`）就当邮箱、漏了真邮箱。三条深挖路径（PM 全部同意）：
- [ ] **P35.12 $19.90 Tripwire Onboarding（获客漏斗第一钩，PM 拍板 2026-07-13）⭐⭐**：一次性 $19.90「onboarding 数字优化」当 tripwire → 建联建信任 → 上钩 $990 套餐（GEO / FB 代运营 / newsletter+WhatsApp）。**设计原则**：每个 $19.9 交付物 = 一个 $990 套餐的「种子」，展示价值同时暴露只有 $990 能补的缺口。
- [ ] **P35.13 社媒内容引擎升级（IG 原生 + 品牌套件，为 $990 代运营铺路）**：现输出主打 FB 文字帖、太粗不符 IG。三支柱：① IG 原生格式模板库（轮播/Reel/精修图/Story）② **每客户品牌套件**（从 logo/官网抽主色+2 字体+滤镜，治「粗犷」根因，精致来自模板不是原始 AI）③ 视频优先（Higgsfield shorts_studio/Seedance 出竖版 Reel + virality_predictor 筛）。能力已有（Atlas/Higgsfield/HeyGen/Publer），缺模板+品牌系统。医美 before/after 有 Meta+NZ 合规限制 → 主打不需临床照的科普/团队/FAQ。**先建一套医美 IG 样板跑通一家再产品化**。此项是「医美 Wave 2」的前置。（Publer 已于 2026-10 删除）

## Phase 7 — 遗留尾项 ⚠️ 计划执行日期已过期，需判断是否作废

- [ ] **P7.4.14** 第 2/4 周复跑 AI Tracker，对比排名变化（2026-05-12 执行）
- [ ] **P7.4.15** 第 4 周生成首份月报（2026-05-26 执行）

## H2 规划（Phase 8-10）

- [ ] **P8.2.4** 社媒联动：博客 approved 后，自动在策略面板生成 3 条对应社媒话题建议（Facebook / Instagram / LinkedIn）
- [ ] **P8.P.1** 新建 `paid_ad_sets` 表（client_id / brief_id / set_name / format_matrix / status / created_at）
- [ ] **P8.P.2** 新建 `paid_ad_copies` 表（set_id / format_type / headline / body / cta / visual_prompt / visual_asset_id / status）
- [ ] **P8.P.3** `src/lib/paid-social/brand-dna-extractor.ts` — 从 Master Brief 提炼 Brand DNA（价值主张 / 受众痛点 / 差异化 / 证据点），Strategy Engine（Claude）输出结构化 JSON
- [ ] **P8.P.4** `src/lib/paid-social/ad-copy-generator.ts` — 按格式矩阵批量生成广告文案，Content Engine（GPT-4o-mini）输出，AU/NZ 本地英语拼写强制约束
- [ ] **P8.P.5** `src/lib/paid-social/visual-prompt-builder.ts` — 为每条广告生成配图提示词（结合产品图描述 + 品牌色调 + 格式规格）
- [ ] **P8.P.6** `POST /api/clients/[id]/paid-social/generate` — 触发一次完整生成（brief_id + 可选 format_filter + 可选 reference_image_desc）
- [ ] **P8.P.7** `GET /api/clients/[id]/paid-social/sets` — 广告集列表
- [ ] **P8.P.8** `GET /api/clients/[id]/paid-social/sets/[setId]/copies` — 单集文案列表
- [ ] **P8.P.9** `PATCH /api/clients/[id]/paid-social/copies/[copyId]` — 编辑单条文案 / 更新状态
- [ ] **P8.P.10** `POST /api/clients/[id]/paid-social/copies/[copyId]/generate-image` — 单条文案触发 Visual Studio 配图生成
- [ ] **P8.P.11** 路由 `/dashboard/paid-social/[clientId]` 创建（含客户选择 landing）
- [ ] **P8.P.12** 生成面板：选择 Brief + 勾选格式类型 + 可选填产品图描述 → [Generate Ad Set] 按钮（预估 10 分钟）
- [ ] **P8.P.13** 广告集列表视图（按格式分组 Tab，每条展示 headline / body / CTA / 状态）
- [ ] **P8.P.14** 单条广告卡片：文案内联编辑 + 右侧配图提示词展示 + [Generate Image] 按钮
- [ ] **P8.P.15** 批量操作：[Generate All Images] 一键触发全集配图生成（复用视觉生成队列）
- [ ] **P8.P.16** 侧边栏导航加 "Paid Social 📣" 菜单项
- [ ] **P8.12.S1.6** 张骞 Apify 商业情报扩展 — 社媒真实指标 + FB 广告 + 小红书 + Google Search（张骞按需调用，非每次全跑）
  - [ ] **S1.6b** 小红书 RedNote scraper（新封装 `apify/xiaohongshu-scraper.ts`，actor `zhorex/rednote-xiaohongshu-scraper`）+ `SocialPlatform` 枚举加 `xiaohongshu` + 接入（⚠️ 该 actor 无评价，先小范围实测）
- [ ] **P9.1** 月报 PDF 导出 + 邮件自动发送（Strategy Engine 生成分析文字，Puppeteer 截图）
- [ ] **P9.2** 客户 Portal（client-facing view，只看自己内容 + 当月月报）
- [ ] **P9.3** 站点权威度追踪（DA / 外链 / 内链趋势）
- [ ] **P9.4** Cron：每日 sync Content Workspace → 主库；每周一跑 AI Tracker + 更新策略建议
- [ ] **P9.5** 批量执行：一键为所有 approved 策略条目生成对应内容
- [ ] **P10.1** 小红书 / LinkedIn / TikTok 视频自动剪辑支持
- [ ] **P10.2** 多语言内容支持（中文市场优先）
- [ ] **P10.3** Magic Lab Academy 课程化（基于 CTS Tours 实战 SOP）
- [ ] **P10.4** Plugin 形态：WordPress / Webflow GEO 自动注入插件
- [ ] **P10.5** Google AI Overview 追踪（SerpAPI，AU/NZ 市场必做）

## 技术债

- [ ] **TD.1** Content Workbench 编辑失败无错误提示（当前静默失败）
- [ ] **TD.2** 图片生成失败后无法手动重试（需刷新页面）
- [ ] **TD.3** Supabase MCP 未连接 Magic Engine 项目（需加 `glbdnayojixmexgofbsd`）
- [ ] **TD.4** 缺少 Supabase Row Level Security 规则
- [ ] **TD.5** 视觉生成队列在客户端 localStorage（需迁移到服务端）
- [ ] **TD.6** 第三方真实名在部分 UI 文案中暴露（需扫描 + 替换为封装名）
- [ ] **TD.12** `SeoContentAdapter.pullMetrics` 入库失败只 `console.error` 不抛 —— 回执会报「写了 4 行」而库里 0 行。2026-09-07 每周 SEO 快照上线时发现，属适配器旧账，未在那条链路的 PR 范围内修（[#1440](https://github.com/bigbigraydeng-maker/magic-engine/pull/1440) 复审记录）
- [ ] **TD.13** `getDomainMetrics` 两层 `Promise.allSettled` 把 provider 故障写成 0 值 —— DataForSEO 故障那一周，全体客户的 SEO 指标会被记成 0 并写进 `flywheel_metrics`，Check / Tune 读到的是假数据。同 [#1440](https://github.com/bigbigraydeng-maker/magic-engine/pull/1440)，链路开跑后它从「潜在」变成「每周可能发生」
- [ ] **TD.14** 「谁买了 SEO」这个商业事实被编码成「填没填网址」这个技术字段 —— `flywheel-seo-weekly` / `keyword-snapshots-weekly` 等 5 条链路共用 `client_status='active' AND domain IS NOT NULL` 判据，随手给不买 SEO 的客户填个占位网址就会把他拉进每周付费扫描（PITFALLS 已记）。服务范围应由 client-level 配置决定，不由字段有没有值决定
- [ ] **TD.19** `src/lib/messenger/brief-client-facts.ts` 是临时止血文件，禁止扩张 —— 2026-09-13 修复"私信 AI 摘要把所有客户都当成 CTS"事故（分支 `feat/messenger-brief-declients-fix-agent`，commit `0c26bda9`）时，把 `brief.ts` 里写死给全体客户共用的 CTS 专属商业事实（25 年历史、免签政策、支持电话）搬进了这个单独文件，现状只有 CTS 一行。子牙两轮设计复审要求：新增第二个客户前必须先跑 `.claude/skills/me-platform-tier-gate/` 判层级，通过才能加——否则这张表会被后来者当成"正式客户配置层"越攒越大。长期方向是「客户知识库」项目上线后整体替换掉这个文件（决策见 [DECISIONS.md 2026-09-13](./DECISIONS.md#2026-09-13--客户知识库作为-governed-lead-reply-agent-的事实层替代-offeringsyaml-路线)）
- [ ] **TD.10** Git 本地分支堆积（20+ 个 `claude/*` 和 `feat/*` 废弃分支）
- [ ] **TD.11** `agitated-mahavira-be6d17` 等 worktree 物理目录占用磁盘空间
- [ ] **TD.7** 收集器模块（6 个）缺少错误重试机制
- [ ] **TD.8** 月报聚合库缺少事务型一致性保证
- [ ] **TD.9** 聚合器性能未优化（N+1 查询）
- [ ] **TD.10** 月报查询端点缺少分页 / 排序参数
- [ ] **TD.11** API 缺少速率限制（Rate Limit）
- [ ] **TD.12** 月报页面缺少加载骨架屏（loading skeleton）
- [ ] **TD.13** 分节组件之间缺少交互（drill-down / tooltip）
- [ ] **TD.14** 月报导出功能（PDF / 邮件）未实现（P8.2 任务）
- [ ] **TD.15** 聚合器单元测试覆盖率 < 70%
- [ ] **TD.16** 未做月报端到端测试（CTS Tours 实际客户）
- [ ] **TD.17** 聚合器架构文档缺失
- [ ] **TD.18** 缺少聚合器性能 / 错误监控仪表板
- [ ] **TD.19** 私信 AI 摘要的 `trip`（旅游行程专属字段）在 schema 层被建成"通用必填对象"——`src/lib/messenger/brief-schema.ts` 的 `TripDetailsSchema` 永远存在、永远带默认值，`MessengerBriefSchema.trip` 没有"这个客户要不要这个字段"的开关。**更新（2026-09-15）：[#1629](https://github.com/bigbigraydeng-maker/magic-engine/pull/1629) 已于 2026-09-13T15:00:42 合并（merge commit `593d8138`），私信 AI 摘要冒充 CTS 身份的事故已修复——`generateBrief`（`src/lib/messenger/brief.ts`）现在按 `clients.industry` 是否命中旅游关键词（复用 `hasIndustryFeature`）决定 `trip` 能不能非空，命中不了的客户一律强制清空成 `NULL_TRIP`；`brief-cycle.ts` 调用时也已传入 `clientId`。身份冒用问题在 main 上不再现行存在**，本条以下只描述剩下的 schema 技术债。这只是挡住"身份冒用 + 编造旅游需求"的最小止血，不是"行业专属字段该怎么建模"的长期方案——下一个需要专属结构化字段的行业（例如地产的"看房意向"）会重复同一种补丁思路。长期应随「客户知识库」项目（PM 已拍板，见 [docs/DECISIONS.md「2026-09-13 · 客户知识库作为 Governed Lead-Reply Agent 的事实层」](./DECISIONS.md)）把 `trip` 重新建模成客户可配置的行业专属结构化字段，而不是永远把旅游一个特例硬编码进通用 schema。#1629 范围内未动 schema：止血 PR 的任务范围是修复身份冒用 bug，重新设计 schema 牵连 `brief-cycle.ts` 调用链、数据库列形状和历史数据兼容，超出一次 A 级止血 PR 该做的事，子牙架构复审在设计阶段已指出这一点（见 #1629 PR 描述里的复审记录）。发现：Claude Code 会话，2026-09-13；2026-09-15 更新状态。
- [ ] **TD.20** 私信 AI 客服门户「批准」按钮点击时不检查该客户/渠道的 AI 开关是否已被关闭——PM/FDE 可以在渠道已经被紧急停用之后，照常点批准一条草稿，系统照常接受，真正挡住发送的检查点在批准界面上完全看不到、也不提示。2026-09-15 issue #1590 回滚演练发现：`conversation-approval-emit.ts`（F3）是纯中继不做任何检查，`reply/route.ts` 批准分支同样没有调用 `isChannelEnabled`；唯一的把关点在 F2 Inngest 函数内部的 Step 9，人工操作界面上完全不可见。建议：批准接口在写入批准前先查一次 `isChannelEnabled`，渠道已关时直接拒绝并提示，而不是让草稿静默卡进一个 4 小时超时窗口。详见 [docs/sops/messenger-ai-rollback.md](./sops/messenger-ai-rollback.md) §三。
- [ ] **TD.21** 私信 AI 客服没有"一键批量拒绝该客户所有待审批草稿"的入口——紧急停用 AI 后，已经生成、还没被人批准/拒绝的草稿只能逐条手动处理，客户草稿多时人工回滚会很慢，且容易漏掉。同一次 2026-09-15 演练发现，与 TD.20 同源。
- [ ] **TD.22** 私信 AI 客服没有"中止正在跑的 Inngest 任务"机制——一个已经开始但还没生成草稿的处理流程，目前没有任何办法主动打断，只能等它自己跑到检查点（生成草稿进入待审批）或等 4 小时等待上限超时。2026-09-15 演练确认：关掉客户的 AI 开关后，这类"还在路上"的任务不会被自动感知或中止。是否值得为这个低概率场景建中止机制，留给后续按 §11 资源优先级判断。

## Phase 11 — Creative Intelligence Engine（未来重点开发方向）

- [ ] Markifact API 能否回传 `creative_parent_id`（绑定我们的 seed creative）
- [ ] Markifact 能否提供"创意 × 受众 × 转化"三维数据切片
- [ ] Supabase `visual_assets` 表加 `embedding vector(512)` + `style_scores jsonb` 列

## Phase 12 — 飞轮数据闭环 ⭐⭐⭐（活跃，2026-05-17 启动）

- [ ] **P8.S.8** — `batchKeywordOverview`（`phrase_these`）→ `keywords_data/google_ads/search_volume/live` + `bulk_keyword_difficulty`（两次 task 合并）

## Social IMPACT — Check → Tune 闭环（Issue [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413)，CTS Customer Zero）🔄 Gate A + Gate B 步骤 1-3 已上线，Gate B/4 待授权

Gate A（激活 Check，让 Daily Plan Post 的 Facebook 发布真的能被自动测量回来）与 Gate B 步骤 1-3
（evaluator 纯函数 [#1451](https://github.com/bigbigraydeng-maker/magic-engine/pull/1451) + cohort loader
[#1452](https://github.com/bigbigraydeng-maker/magic-engine/pull/1452) + Daily Plan 页面显示效果建议
[#1453](https://github.com/bigbigraydeng-maker/magic-engine/pull/1453)）已合入 main，详见
[CHANGELOG 2026-09-08](./history/CHANGELOG.md)。CTS 因为只有一条未撤回的 Daily Plan Post，样本量凑不齐
Gate B 定的 `minSampleSize=3`，页面目前只会显示「数据还不够说话」占位——这是规则的正确表现，不是 bug。

- [ ] **Gate B/4（A 级 · 需 PM 单独授权）** —— 保存下一份 Daily Plan 时，记录本次采纳/拒绝了哪条 Tune 建议
      + source action ids，形成 lineage。这一步会动 Kernel 保存路径，是整条 Gate B 里唯一真正「写」的一环，
      按 Issue #1413 冻结的 Scope 走：人工审批保留，无自动发布 / 排期 / provider write / 广告花费。
- [ ] **evaluator cohort 全 0 时的 caveat 缺口**（魏征复审 #2，PR #1453 review）—— cohort 全部 `ok/partial`
      但 likes=0（新账号 / 权限不足未落 unmeasurable 的边界情形）时，target 只要 > 0 就判 REPEAT +
      `deltaPct: Infinity`，语义上可能鼓励重复"没人看的内容形态"。至少加一条 `cohort_all_zero` caveat。
- [ ] **阈值比较未走 roundTo 的浮点边界**（魏征复审 #3）—— `social-post-evaluator.ts` 的
      `>= repeatDeltaPct` / `<= stopDeltaPct` 判断走原始 `deltaPct`，不像展示层那样先 `roundTo(1)`。
      实数输入（如 13.7 / 10.53）可能在边界附近漂移到另一侧决策，现有测试只锁了整数边界。
- [ ] **`normalizeStatus` 三处复制**（魏征复审 #6）—— `social-post-cohort.ts` 与
      `campaign-tune-suggestions.ts` 各自定义了同样的 `normalizeStatus` / `parseNumberMap` /
      `parseStringMap`。未来 receipt status 定义变更（例如加 `'timeout'`）三处都要改，属「假件与 SQL 同步」
      同类事故模式，建议下沉到 `src/lib/flywheel/tune/` 下的共享 helper。

**Daily Plan 发布回执保护的后续**（PR [#1687](https://github.com/bigbigraydeng-maker/magic-engine/pull/1687) 已合并，2026-09-15；子牙 + 魏征复审留下）：

- [ ] **审核接口在带排队/发布回执时仍能改审核结论**（A 级，另一窗口已在修）—— `campaign-daily-plan/post-review/route.ts`
      不看 `publish_queue_meta` / `publish_meta`。排队后改结论会让发布报「排队回执过期」、重新排队又冲突，流程卡死；
      发布进行中改结论会让回执写不回库，帖子在线但只剩 HTTP 响应里的记录。
- [ ] **只读核查生产上是否已有「回执被藏起来」的旧行** —— #1687 之前查计划出错会新插一行。查同一 client + campaign 下
      `campaign_daily_v1` 行数 > 1、且较旧行带 `publish_meta` 的情况；有的话要人工判断怎么恢复，不许直接改数据。
- [ ] **计划版本链（产品限制的长期解）** —— 现在一个活动发过/排过一轮后，下一轮内容或改文案只能新建活动。
      长期应让读取方按 `plan_id` 取计划、而不是只取最新一行，或在回执已作废（例如全失败、零条上线）时允许覆盖。

## Phase 24 — Execution Loop Closure（执行闭环修复）📋 已登记，2026-06-06 启动

- [ ] P24.A.1 migration: `20260606000001_execution_items_zhuge_source.sql`
- [ ] P24.A.2 `action-persister.ts` 新增 `writeExecutionItems` + 接入 `persistZhugeActions`
- [ ] P24.A.3 `__tests__/action-persister.test.ts` 补充测试（TDD 先写）
- [ ] P24.B.1 `src/app/api/cron/zhuge-recalculate/route.ts`
- [ ] P24.B.2 `render.yaml` 追加 cron 定义
- [ ] P24.C.1 `deploy/page.tsx` + `DeploymentForm.tsx` 改造
- [ ] P24.C.2 `publish-geo-snippet/route.ts` 新增路由

## Phase 24.M — Leads 营销中心（多渠道 CRM · 拳头产品，与内容工厂同级）🔄 邮件已通，其余待开工

> PM 2026-08-02 定方向：CRM 要把邮件 / WhatsApp / Messenger / 电话收进一个地方，
> 客户从一处就能看到全部进度。给**所有** ME 客户用，不是 CTS 专属。
> 渠道优先级（PM 拍板）：**电话 · 邮件 · Messenger · WhatsApp 高**；短信和 newsletter 靠后（它们不是实时交流）。
> AI 客服路由（PM 拍板）：客户开通了 Meta AI 客服就默认用它（CTS 就是这么配的）；没开通的改用 WhatsApp Business API 接我们自己的客服中心。

- [x] M1 多渠道发送总线 `lib/messaging/channels.ts` + Messenger 适配器（PR #779）
- [x] M2 公司邮箱接进来：授权 + 读信 + 落成人 + 每小时同步（PR #774 / #780 / #781）
- [x] M2.1 「今天该联系谁」版式重做：三层带底色 + 批次缩进 + 铺满宽度（PR #788 / #792）
- [x] M2.2 销售的三个出口：推迟（到期自己回来）/ 他不买了 / 这批分错了（PR #792）
      **刻意不给「手动改分组」** —— 手动状态列必烂，见 CHANGELOG 2026-08-03
- [x] M2.7 **今天的名单一天之内不变**（PR [#985](https://github.com/bigbigraydeng-maker/magic-engine/pull/985)，合并提交 `096111a7`）——
      做完的就地变灰、不跳组不消失；推迟 / 推到成交同样留在原位（原 M2.7a 缺口一并补上）；
      「周五给报价」这类相对日期能自动排上下一步（解析器原先不知道今天几号）。
      判据在 `lib/crm/day-list.ts`：**只冻结我们做的动作，不冻结客人做的动作**。
      Codex 六轮 15 条：13 改 2 驳（理由在 PR 讨论里存档）。
- [x] M2.7b **卡片上直接敲一行，说个时间自动排上下一步**（PR [#989](https://github.com/bigbigraydeng-maker/magic-engine/pull/989)，合并提交 `a097a7f5`）——
      板桥要的那个：一手拿电话，卡上敲「三月两个人去南岛，周五给报价」，回车就完事。
      关键不在输入框，在**存完那句确认**（`lib/crm/next-step.ts`）：必须分得清「读懂了 →
      说出哪天」「没说下一步 → 别出声」「说了但没读懂 → **明说没排上**」。
      漏掉第三种 = 销售以为排好了、那天没人提醒 = 答应客人的事砸了。
      「有没有约下一步」交给解析器答（`mentioned_next_step`），正则只当兜底 ——
      正则版被改了四轮、其中一轮自己制造了反向的错，见该文件头。
- [ ] **M2.7c 三段式重排** —— 现在是 3 层 + 6 组 + 底栏 + 终端/同行开关 ≈ 10 个概念，
      CTS 员工要先学术语才能干活。改成「今天要联系的 / 今天联系过的 / 先放着」三段，
      分类词降级成卡片上一行「他为什么在这」。设计与三人评审意见见 PR #985 讨论。
      **M2.7 那三样里唯一没做的**；建议等 PM 线上用过 M2.7b/d 再动，免得照着想象改版式
- [x] M2.7d **页面内回私信后立刻变灰**（PR [#988](https://github.com/bigbigraydeng-maker/magic-engine/pull/988)，合并提交 `df2c818c`）——
      `messenger/send.ts` 发送成功后当场补写出站触点，**幂等键跟每小时同步用同一个**
      （`source='messenger'` + `source_ref='<convId>:out'`），所以同步再跑不会记两笔。
      时间只许往前推（`advanceOutboundTouch` 用两条原子语句，不做「先读再写」）
- [ ] **M2.7 收尾：等 PM 拍的一件事** —— 「说好周五给报价，这几天他还该不该出现在
      今天的名单上？」现在的行为是**照旧每天出现**（`segmentContact` 规则 3 只认
      `callbackAt <= now`，未到期的约定不改变任何事）。收起来能少打扰，也可能让一个
      本该趁热跟的客人凉三天 —— 这是生意决策不是实现选择，已上抛 PM，代码注释里存了理由
- [ ] **M2.7 已知后续项：重试时那句确认会降级** —— 第一次请求写入成功、但响应在
      传输中丢失，销售用一字不差的原文重试会命中去重，看到的是「之前已经记过了」
      而不是真正排上的那天。**笔记和排期都在，丢的只是确认**。要修得对，服务端得在
      命中去重时把已存那条触点的 metadata 读回来再生成确认（不能用重试请求的新解析
      结果，两者未必一致）—— 够单独一个小 PR。见 PR #989 讨论
- [x] M2.7e **号码打不通不等于这个人不要了**（PR [#995](https://github.com/bigbigraydeng-maker/magic-engine/pull/995)，合并提交 `79873161`）——
      线上 24 个被标坏号的人里 **23 个后来又来过消息**，15 个一直在跟我们邮件往来。
      判据分层：**联系方式是渠道属性，成不成是人的状态，两件事不许互相覆盖。**
      坏号只关掉电话那条路（卡片、抽屉、「全部客人」三处一起禁用拨号），
      只有真的一条路都没有才退出名单。坏号看**最后一次判决**，不是历史上出现过；
      拨到空号**不算「今天跟进过他」**（否则待办被折叠藏起来，铁律 3）。
- [x] M2.7g **「暂时不考虑」不再被当成「明确不要了」**（PR [#996](https://github.com/bigbigraydeng-maker/magic-engine/pull/996)，合并提交 `c9b466f2`）——
      PM 给的业务事实：leads 聊过之后分「暂时不感兴趣、还要继续营销」和「明确不要」两种，
      下场必须不一样。线上 17 个人被标成终结性的 `not_interested`。
      存量记录**读的时候重判一次**（不回填，不动客户数据），否则这次改动只对以后的笔记生效。
- [ ] **M2.7h 「暂时 / 最终」的判断交给解析器，正则只留兜底** —— 上面那条做完之后，
      Codex 连续八轮在同一个地方挑出边缘用例（`ready` → `yet` → `going` → `考虑一下` …），
      每收窄一次就冒一个新说法。**这不是规则不够细，是正则做不了语义判断。**
      本仓在 `lib/crm/next-step` 已经得出过完全相同的结论并留下「别再往它上面加规则」。
      要做的两件事：解析器多答一个「这是暂时的还是最终的」；解除 `parseNote` 对规则结果的
      **无条件覆盖**（现在模型读懂了也纠正不了）。跟 M2.7i 一起做最省事
- [x] 🔴 **M2.7i 让系统读到那 90% 的对话，自动填「跟进到哪一步」** —— PM 2026-08-16 拍板「读」。
      线上实测：系统只读得到**电话手记 295 条**，而**邮件正文 523 条、私信 2099 条
      （658 个会话）从来没被读过** —— 私信内容在 `conversation_messages` 里，
      触点表只写了一句「Messenger 私信（N 条往来）」。
      所以 583 个人里 **556 个阶段是空的**，不是规则不够细，是系统没读过他们说的话。
      已做：`lib/crm/stage-from-conversation`（判断）+ `lib/crm/stage-infer`（取数落库），
      挂在已有的 `messenger-brief-hourly` 上跑第三遍，不新注册 cron。
      三条硬线：**只填空着的**（写库那一刻再判一次，绝不覆盖人工判断）·
      **模型说不出逐字原话就整条丢掉**（铁律 8）· **终结档和涉及钱的档模型一律不许落**。
      不引入任何新数据源：读的全是我们自己的号两个月前就同步进来的东西。
      **还没验证的**：线上真实填出来的准确率 —— 第一轮跑完要抽查 `contact_stage_events`
      里 `changed_by = 'ai:conversation-read'` 那些，看判词和原话对不对得上
      **读不出来就进「新线索」**（PM 2026-08-16 拍的简化）：那本来就是他真实的
      位置。写下来他就不在候选里了 —— 不必记「上次什么时候试过」，也不必轮转
      队列，原本要为此加的那一列（`stage_inferred_at`）直接不用做了
- [ ] **M2.7j 给「正向意向」一个专门的信号** —— 现在「他现在想订了」只能落成兜底的
      `spoke`，跟系统群发写下的那一笔分不开。于是二选一：要么群发抹掉客人说过的
      「现在先不考虑」，要么后续真的谈热了也解不开。本次选了后者（保住客人的话）。
      正解是解析器多答一个 `wants_to_book`，或销售一键按钮。见 PR #996 讨论
- [ ] **M2.7k 抽屉里刚标完坏号要即时刷新** —— 现在那个 `tel:` 链接要等抽屉关掉才消失。
      危害最轻（销售刚亲手打完「这个号是空号」，不会转头去点），但牵扯抽屉里所有
      写操作的局部刷新，值得单独收口一次。见 PR #995 讨论
- [x] M2.7l **可能被误判成「永久别再联系」的人，已接进今日待办** ——
      旧词表把「不打算去」当成了「别再联系」，而那个标记的含义是**任何渠道都不许再发**。
      线上 13 个被永久拉黑的人里 8 个原话确实划过界限，**1 个只因为「不打算去」**。
      **刻意不写自动解除**：让正则去解开这个闸，万一原话里同时含着真拒绝，
      就会骚扰一个明确说过别联系的客人 —— 客户红线不该由规则来赌。
      按铁律 3 下半条下发成人工任务，**进今日待办**（`pm-todo/manual-items.ts`
      的 `dnc_maybe_wrong`），带直达那个人的链接；真说过「别再联系」的人一条都不打扰。
- [ ] **M2.3 用 `crm_segment_feedback` 改判据** —— 表建好了，还没有人去看它。
      攒够一批「分错了」之后要回去改 `lib/crm/segments` 的规则，否则这个按钮
      就变成一个只进不出的许愿池
- [x] M2.4 分批规则按「只认真实对话」重做；秒回=机器（Meta AI 回复不再冒充真人跟进）；
      打了没接 3 天转自动跟进；拿掉「快出行了」；号码坏了单独成组（PR #797）
- [ ] **M2.5 新人邮件（PM 规则 1，本次明确没做）** —— 客人第一次进来当天自动发一封。
      卡在两件事上：① 挑发信通道（Mailchimp / Resend）② 文案要按铁律 8 先 grounding
      客户官网、逐句标可溯来源，且发出去之前 PM 要看过。做完之后第二层才配叫
      「发过新人邮件」，现在老实叫「还没搭上话」
- [ ] **M2.6 确认 Meta 自动化消息的真实 tag** —— `lib/messenger/automation` 里
      `AUTOMATED_MESSAGE_SOURCES` 那两个值（`subscription` / `business_ai`）到今天
      **仍是猜的**，Meta 没公开文档。现在靠「秒回 = 机器」兜住了，但拿一条 CTS 真实
      收件箱的 Graph 返回确认一次，判据会更硬。这台开发机连不上 facebook.com，做不了
- [x] **M3 从 CRM 里回邮件** —— PR #1716（2026-09-15 合并）。没有接进 `lib/messaging/channels.ts` 那套总线——那套总线目前零生产调用方（连 Messenger 自己都没注册进去），照抄会议再造一层没人用的架子；改成照抄 `messenger` 那条真正在用的 reply 路由的形状（`src/lib/microsoft/mail-send.ts` + `POST /api/clients/[id]/email/conversations/[conversationId]/reply`）。三轮复审共同抓出：`Mail.ReadWrite` 权限漏申请（`Mail.Send` 只管发、不管建草稿）、多邮箱客户会拿错连接的令牌、回信可能把客人错发成自己（应只认 `direction=inbound` 的最后一封）、Graph 消息 id 在草稿变已发送时会漂移（需要 `Prefer: IdType="ImmutableId"`）。**已知未做**：审计沿用 `conversation_outbound_log` 的自由文本列，不是专用 schema；未接入 AI 自动回复（`messenger-agent/channel-dispatch.ts` 只认 `messenger`/`whatsapp`，是 M7 的范围）。**待办**：CTS 现有邮箱连接需要重新走一次登录同意才能拿到 `Mail.ReadWrite`（读信不受影响）；NAL（本轮选定的首个真实测试客户）尚未连接邮箱，功能未经真实邮箱验证
- [x]/[ ] **M4 邮件线程接进多渠道读取路径**（部分完成，PR #1719，2026-09-15）—— 排查发现这条本身已经过期：联系人时间线/往来记录早就是不挑渠道的了（PR #1038 修的），真正缺的只是"CRM 抽屉里能不能直接回邮件"这一个入口——抽屉里唯一的回复框硬编码只认私信。已补上：共享发送框 `ReplyBox.tsx` 改认 `channel` 参数、新增 `EmailReply.tsx` + 对应查询接口，跟私信框并排显示。**未做**：没有逐一审计其他列表/看板页有没有类似的隐藏 messenger 硬编码；邮件回复框现在不会因为"这个人没来过信"提前禁用，要点了发送才由服务端拒绝（子牙审查已确认非安全问题，纯体验优化，可后续小 PR 补）
- [ ] **M5 WhatsApp Business API（新号）** —— 申请清单已给 PM（`docs/sops/whatsapp-business-api-申请清单.md`）。⚠️ AU/NZ 单价未核实（这台开发机连不上 Meta 站点），拿到后台截图后补
- [ ] **M6 客户员工账号 + 角色 + 归属 + 转派 + 推手机** —— PM：「ME 的登陆系统需要给到 client 的员工层级」。`conversations` 已有 `owner_email` / `snooze_until` 两列待用，不需要 migration
- [ ] **M7 「谁来回」开关 + Meta AI 客服配置**（AI 先答 / 人工先答 / 分时段）
- [ ] **M8 IP 电话外呼 + 通话记录回流**（与 Phase 36 Voice Agent 合流）🔄 判断层已上线
      - [x] M8.1 判断层 `lib/threecx/call-plan.ts`（PR #821）—— 一通电话在 CRM 里意味着什么。
            **不依赖 3CX 接口长什么样**，所以对方还没开通也能先做完先审完
      > ⚠️ **2026-08-05 方案推翻重来**：3CX 那些读通话记录/录音的 REST endpoint
      > **官方不提供、没有文档、不保证长期可用，对方明确不建议用在生产环境**。
      > 改用官方支持的 **Data Connector**：我们开一个数据库给他们，3CX 最短
      > 每 15 分钟把通话记录 + 录音下载链接**推**进来。判断层不受影响（一行没改）。
      - [ ] **M8.2 落地库** —— 单独开一个 Postgres，**绝不能是主库**。方向反了：
            原来是我们拿他们的凭证去读，现在是**他们拿我们的凭证来写**，凭证泄露
            的代价从「读不到通话记录」变成「所有客户的数据」。同实例开个受限角色
            是「配置对了才安全」，单独一个库是「配置错了也还安全」—— 只选后者。
            **一个客户一张表 + 一个账号**（3CX 不知道我们的客户编号；混表靠字段区分
            = 对方配错一次，A 客户的通话记录落进 B 客户的 CRM）
      - [ ] **M8.3 取数层** `lib/threecx/landing.ts` —— 按水位线读新行 → 翻译成
            `CallRecord`。水位线要留重叠窗口（跟邮件同理：不留重叠，一次失败就在
            时间线上留一个永久的洞，而且不报错）
      - [ ] M8.4 落库层 —— 复用 `resolveContact`（电话身份）+ `contact_touchpoints`
            （`channel:'phone'` / `source:'threecx'` / `source_ref` = 通话编号）
      - [ ] M8.5 `/api/cron/call-sync` 每 15 分钟 + 同一个 PR 内加 `render.yaml` 调度条目
      - [ ] **M8.6 ⏳ 录音要不要留档 —— PM 拍板，有到期日** 推过来的是下载链接，
            录音本身在 3CX 那边**只存 3 个月**。默认做法是只存链接不复制音频
            （数据最少、风险最小、不花存储钱），代价是 3 个月前的通话将来听不回来。
            要不要复制进自己的存储是业务+隐私决策 —— **接通后第一个 3 个月内必须定，
            过了就不是改主意而是已经丢了**
      > 设计见 [`docs/specs/2026-08-04-threecx-call-ingest.md`](./specs/2026-08-04-threecx-call-ingest.md)
- [ ] M9 短信 · M10 从 ME 发 newsletter（优先级靠后，PM 明确）

**已知待补**（都不影响现在上线）：
- [ ] 设置页那个 ✅「私信正在同步」是写死的，没连也显示绿勾 —— 会骗人，要改成真状态
- [ ] `mailchimp-activity-sync` 没有 run-logging，断了看不出来
- [ ] segments / display-name 里有 3 处写死的旅游业措辞，接第二个行业前要抽出来

**M2.7n 「别再联系」判不准 —— 四张已开的票**（2026-08-17 从 PR
[#998](https://github.com/bigbigraydeng-maker/magic-engine/pull/998) 拆出，
与上面的 M2.7h / M2.7m 是同一件事的四个面，**票在 GitHub 上，这里只做索引**）：
- [ ] [#1019](https://github.com/bigbigraydeng-maker/magic-engine/issues/1019) 换掉「他是不是要求别再联系」的判据 —— **怎么判**
- [ ] [#1025](https://github.com/bigbigraydeng-maker/magic-engine/issues/1025) 🔴 Facebook 私信正文根本进不了这个判据 —— **喂什么进去**。
      私信是 CTS 客人说话最多的渠道（2099 条 / 658 会话），闸是硬的、闸后面是空的。
      ✅ **提示这一半已上线**（PM 2026-08-17 拍板 B 方案）：私信里像是说「别再联系」的人
      进今日待办「🙋 需要你动手」，销售点进去看原话再决定 ——
      `lib/crm/messenger-stop-signal.ts`，**一行写操作都没有**。
      ⏳ **接进判据自动封渠道那一半仍不做**，前提是 #1019 先把判据修准。
      两条已知代价（都写在模块文件头）：只看最近 30 天 · 每客户每轮最多 20 条。
      要做到「一条不漏又不重复骚扰」得加一列「已复核」（改 schema，A 级），单独立项
- [ ] [#1026](https://github.com/bigbigraydeng-maker/magic-engine/issues/1026) 中文「别再联系我」这类写法漏判
- [ ] [#1027](https://github.com/bigbigraydeng-maker/magic-engine/issues/1027) 「别打电话，只发邮件」记不住 —— 需要**按渠道**的信号。
      PO 2026-08-17 已拍板短期行为：这种人**继续发邮件、留在邮件营销池里**

**M2.7p 「点私信」开场白补档案的四条后续**（2026-08-17，PR
[#1031](https://github.com/bigbigraydeng-maker/magic-engine/pull/1031) 上线时逐条登记不修；
能力本身已上线，见 [CHANGELOG 2026-08-17](./history/CHANGELOG.md)）。
四条同源 —— **补档案与认亲该有自己的一轮设计，不该继续在同步链路里加分支**：
- [ ] 存量回填是逐个联系人串行查询，量级上去要改批量
- [ ] 给「试过、补不上」的人打标 —— 现在每轮都重扫这批人，看着在跑其实原地踏步
- [ ] 解绑了 Facebook 主页的客户跑不到本地回填（凭证闸之前那一步只覆盖已绑的）
- [ ] 只留电话没留邮箱时按电话认人 —— 现在会多出一条重复联系人。
      **刻意先不做**：认亲弄错是不可逆的（两个人并成一个），而重复联系人只是难看

> ✅ 原第五条「第一条入站消息没有『主语是我』这层保护」**已修**（2026-08-17）——
> 没有问候语时的门槛由两条标准字段提到**三条全齐**，见 CHANGELOG 同日条目。

## Marketing Plan 接入 Newsletter 邮件渠道（2026-09-08 登记，🔄 阶段 1 PR 待复审合并）

> CTS 过去两月 newsletter 回顾时发现一封邮件正文没放链接、点击率必然为 0（内容问题非技术
> 故障）。PM 提出要有"策划下一封发什么/何时发"的能力，经 me-platform-tier-gate（张良）判定：
> 不是新 L1，是补齐已有策略层骨架（`marketing_plans`/`execution_items`）欠的邮件渠道，
> 候选登记见 [platform-candidates.md](./registry/platform-candidates.md)（PR #1480）。
> 设计已过子牙（架构）+ 魏征（挑刺）复审。**跟 Phase 24.M 里"newsletter 优先级靠后"
> 那条 PM 拍板不冲突** —— 那条说的是 CRM 多渠道实时沟通总线的渠道排期，这条是
> Marketing Plan 策略层的内容规划能力，是两回事。

- [x] 阶段 1：策划——`MarketingPlanData` 新增可选 `email` 维度，AI 读 Mailchimp 历史表现
      （复用 `listSentCampaigns`，未新增 API 封装）自动建议下一封主题 + 发送时间；
      `requires_link` 强制校验环节写进 prompt + UI（"中国免签"事故教训编码进流程，
      不再只指望人记得）；没有邮件渠道的客户（Roman/Oztop）该字段天然是空壳。
      PR [#1482](https://github.com/bigbigraydeng-maker/magic-engine/pull/1482)，**待复审合并**
- [ ] 阶段 1 验收：合并后需实际对 CTS 跑一次 `/api/clients/[id]/marketing-plan/generate`，
      人工核对 AI 生成的邮件主题/时间建议是否合理，`requires_link` 判断是否准确
- [ ] 阶段 2（明确排除在阶段 1 之外，需要独立立项）：Mailchimp"建 campaign + 真发送"的
      API 写路径——现在只有只读封装 + `subscribeMember` 一条写路径。这是新的、不可逆的
      对外发布能力（邮件一发出去收不回），需要类似 Governed Reply Agent 的 fail-closed
      授权机制 + Inngest 异步接力设计，不能顺手跟阶段 1 一起做
- [ ] 自动欢迎序列碰撞检测目前是粗粒度的（只统计过去 7 天触达人数，不是精确逐联系人
      排期）——现有系统没有"某联系人当前处于欢迎序列第几步"的读取路径，如实标注
      口径不精确，需要更精确的方案时再补

## Phase 25 — Self-Serve Portal ⚠️ 已并入 Phase 20.0

- [ ] **P25.A.1** Migration：`public_scan_jobs` 加 `client_id` 可空 FK
- [ ] **P25.A.2** 新建 `POST /api/onboard/self`
- [ ] **P25.A.3** `/prospect` 页面加转化 CTA
- [ ] **P25.B.1** 新建 `/portal/[clientId]/discovery/page.tsx`
- [ ] **P25.B.2** Portal 首页加 Discovery 摘要卡
- [ ] **P25.B.3** PortalNav 加 Discovery 链接
- [ ] **P25.C.1** 新建 `/portal/[clientId]/diagnosis/page.tsx`
- [ ] **P25.D.1** 新建 `/portal/[clientId]/prescription/page.tsx`
- [ ] **P25.D.2** 新建 `/portal/[clientId]/plan/page.tsx`

## Phase 21 — AI Content Factory（旗舰能力 · FDE 默认产能引擎）📋 MVP 计划已登记，待开工 P21.1

- [ ] **P21.J.M1 地基**(≈1 周):migration 7 表 + `clients.brand_redline_phrases` + claim RPC + `content-factory` bucket(**一次 PM 拍板 apply,worker 严禁自行 apply**);`POST /api/factory/signals`;策略 agent 全闸(brief/goal 溯源 + 去重 + fail-closed)+ 工单生成。验收:模拟疲劳信号→带溯源+人话理由的工单;撞红线→人话拒绝;同 ad 重复信号→`duplicate_open_order`
- [ ] **P21.J.M2 生产线**(≈1.5-2 周):本地 worker(claim/heartbeat/complete/fail)+ Video Studio + Edit Engine 接入;独立审核 base `ME Factory Ops`(Factory Review + Winner Intake)+ 双向 sweeper + 审核人白名单;`BrandRedlinesPanel`;muapi 计费模式+视频上传权限双 spike(开工第一天)。验收:PM 在 Airtable 卡片内直接播片,过审/打回(分类+意见)全链路跑通
- [ ] **P21.J.M3 闭环**(≈1-2 周):发布($50 绝对硬顶 + publish_intent 幂等 + publish_failed 收敛)+ UTM 沿用 + 表现回流单链路 + winner 判定拆片入库 + 工厂内部自发疲劳信号。验收:真实成片上 CTS Meta 账户(**PM 显式 go 后才首发**,$10/天×3 天)+ 回流数据落 `flywheel_metrics` + 工作日志人话叙事无"工厂"字眼
- [ ] **开放项**:信号契约与 34.A 对齐冻结(M1 前置)· asset_gap 信号归属 · MTC 计费触点(v1 占位不扣)· Airtable 观测层↔ME 真值同步(M2 起)
- [ ] **P21.J.SEC 接口安全完整审计**:狄仁杰三审报"26 个 `/api/clients/[id]/*` 无鉴权",逐个核实后发现多数(ads 执行/cms 发布)其实已有锁、是误报,真裸奔仅 5 个已补。**需一次系统性复核**:grep 全部 access 守卫关键词 + 逐个确认,把"真裸奔"与"已有锁被误报"彻底分开,补齐真缺的。今天只是止血
- [x] 【已作废（Publer 已删除）】**P21.J.SEC-2 `/api/publer/create-post` 至今无鉴权**:任何人拿一个 `post_id` 就能把该客户的成片发到他的社媒账号。**不能像 schedule/draft 那样直接加登录鉴权** —— 这条同时被 Zapier/Airtable webhook 调用(仅 body 带 `post_id`,没有会话),加了就当场打断线上自动化。正解是 Bearer Token,而 token 要同时配到 Zapier 那边 = 需要 PM 动手一次。此项 2025 年就登记过(`docs/archive/AUTOMATION_SPEC.md` D-2),躺在 archive 里没人看,2026-08-05 补进主线。同批的 `/api/publer/schedule` 与 `/api/publer/draft/[assetId]` 只有后台一个调用方,已直接补上鉴权
  🔄 **2026-08-19 代码已写完,PR [#1081](https://github.com/bigbigraydeng-maker/magic-engine/pull/1081) 待复审,未合并**:读 `PUBLER_CREATE_POST_TOKEN` 环境变量做 Bearer 比对。**合并前需要 PM 配合两步,顺序不能反**:①先在 Render 生产环境变量加 `PUBLER_CREATE_POST_TOKEN` ②再去 Zapier 那个触发 create-post 的 webhook 步骤配上同一个密钥,两边都配完才能合并 PR——反过来的话线上自动发布会先被打断。
- [ ] **P21.J.UP 上传链接两取舍**:①无单条吊销(作废靠换 `UPLOAD_LINK_SECRET`,所有链接一起失效)②无速率限制(有真链接者可刷存储/烧 Vision 额度)。规模化前需补 per-client 限流 + 单链接吊销
- [ ] **本地 worker 没在认领**:今天 00:18 有 CTS 新工单卡在 `queued` 没人做 = 那台 Mac 的 worker 没跑/没连。工厂要真转,先确认 worker 进程在跑(仓库无 launchd/pm2 配置,`ps`/`pm2 list` 上机看)且已在 07-24 后重启(否则风格下发用旧逻辑)
- [ ] **`FACTORY_PUBLISH_LIVE` 未设 = 静默发草稿**:未配时片子 `status=published`+三落库全绿,FB 主页却只是没人看见的 DRAFT。验完草稿格式后 PM 显式在 Render 设 `=true` 才真发
- [ ] **`auto_order_enabled` 无客户开启**:调度器每天照跑但一单不下(安全默认)。要工厂自己下单,逐客户开;首个跑通客户 = CTS
- [ ] **`creative_profile` 无客户填**:出片风格仍全靠本地 JSON。CTS 现有风格(龙旗破云/golden_hour/短句大字/xfade 0.35)可抄进 ME 配置页接管
- [ ] **1 条 `rendered` 旧单**(CTS 07-12,有 caption)永久卡住:交付直连修复只对新单生效,这条旧单需手动迁 `in_review` 或归档(PM 判断)
- [ ] **P21.K.7 ad 级数据脊柱**(登记 2026-07-25,PM 拍板):日度 cron 补拉 **ad 级**(每条广告每天一行,复用 `ad_daily_insights` 的 `level='ad'`),让「某天新增了哪条广告 / 哪条在拖后腿」可被系统自查,不依赖 Meta MCP(Oztop 账户未开通)也不用人翻广告后台。**背书案例**:Oztop Lead Form Cold Broad 的 CPL 7/17 起翻倍,campaign 级只能定位到「填表率腰斩 + 出现出站点击」。含 `parent_id` 列(ad→campaign 归属,**migration 待 PM `go apply`**)+ 首拉 30 天回补 + 分页完整性守卫。顺带铺好 34.B Creative Lifecycle 要的作品层日度基础设施
- [ ] **P21.K.8 objective 感知 + 视频疲劳正向检测**(登记 2026-07-26,PM 拍板 `排`):把 P21.K 止血从「不误判视频广告」升级到「真正体检视频广告好不好」。需 ① `ad_daily_insights` 加 `objective` 列 + 采集时拉 campaign 节点 objective(**migration 待 PM `go apply`**)② 脊柱补拉视频完播指标(ThruPlay 完播成本 / CPM / video_p100)③ 按 objective 切换判定指标:视频/播放量目标用完播成本或 CPM,表单/流量目标保留 ctr+cost_per_result,拿不到 objective 或样本太少判 `insufficient_history`。价值:CTS 这类主打视频的客户,看完成本涨→主动提醒换素材。半天到一天。附:止血注释已在 `baseline.ts` 登记本项为 follow-up
- [ ] **P21.K.9 每日分析 cron 的候选客户名单仍只看主账户**(2026-09-13 子牙+魏征复审
      PR [#1595](https://github.com/bigbigraydeng-maker/magic-engine/pull/1595) 发现,同批
      发现的另一半已修):`readback-sweep.ts` 的每日安全巡检已改成同时看
      `clients.meta_ad_account_id` 和 `client_meta_ad_accounts`(见
      `getActiveClientsWithMetaAccounts`),但 `google-data-pullback-daily/route.ts`
      的每日分析/健康摘要 cron 没跟着改——如果某客户的主账户被清空、只剩登记在
      新表里的次账户,这条 cron 会把这个客户整个漏掉,`ad_daily_insights`/健康检查
      /每日摘要全部停摆(安全巡检不受影响,已经修好)。触发条件:今天 CTS 主账户
      还在,不会发生;一旦有人清空某客户主账户就会撞上。修法应该是这条 cron 的候选
      客户查询也换成 `getActiveClientsWithMetaAccounts`,并把主账户专属逻辑
      (30 天快照、token 解析里用到的域名/客户名)在"无主账户但有次账户"时优雅退化。
      未修原因:改动涉及这条 900 行 cron 的主循环结构,复审当天为控制风险没有仓促改
- [ ] **多视角对抗复盘工作流**(1-2 天,可后置):battle-plan §8 方法论固化成可复用 Workflow/agent(N 视角互相证伪前提 → 作战计划 → 喂鲁班),异常触发非每日跑
- [ ] **开放项**:三张新表 migration 逐次 PM `go apply`(`ad_daily_insights` / `ad_strategy_configs`+`_triggers` / `ad_health_narratives`)· P5 泛化首批客户(Oztop?)· 姊妹 spec Creative Lifecycle 同一 GHA 笔误待独立小 PR 修

## Creatomate L3 Connector · 最小可交付版 📋 2026-09-09 立项，PM 已订购

> 背景：本窗口延续 [CHANGELOG 2026-09-04](./history/CHANGELOG.md) 的 4 个已合 PR（#1351 配方对账 · #1360 imageToClip · #1367 分镜自检 · #1373 shot-guards），把 Creatomate 从 PM 手动开浏览器点导出的模式，接成 `src/lib/creatomate/` L3 Connector。走**最小版**（PM 2026-09-09 拍板），不做 quota 闸和后台 UI，跑起来后再加。

**PM 决定**（2026-09-09）：走最小版；已订 Creatomate Essential $54/月 + Muapi 起充；Spec 阶段和落地实施**另开新窗口做**（不在本窗口继续，避免混入归档窗口）。

- [ ] **Spec 起草**（1-2 天，C 级）：`src/lib/creatomate/` 客户端接口签名 · 模板 JSON 落库 · Inngest 工作流编排 · 错误恢复 · 幂等 · Reuse Statement（明确哪些复用 `imageToClip` / `shot-guards` / `factory` 既有能力）
- [ ] **三审并行**（半天）：子牙（架构）+ 鲁班（执行）+ 魏征（挑刺）· Spec 未过审前不动生产代码
- [ ] **L3 Connector 开发**（2 天，B 级）：`src/lib/creatomate/client.ts` 提交 · 轮询 · 转存 Supabase
- [ ] **模板 JSON 落库 + 参数化**（半天）：CTS 圣诞 / Golden China / 通用模板
- [ ] **Inngest 工作流串联**（2 天）：`video-render` 编排 `imageToClip` + `shot-guards.classifyRenderMode` + `creatomate.render` + Supabase 存
- [ ] **端到端联调 + PR 复审**（1 天）：用 CTS Golden China 场景跑一次

**砍掉的两块**（跑起来后再加）：
- ~~分档 AI 视频配额闸~~ — 已进 [`docs/registry/platform-candidates.md`](./registry/platform-candidates.md)，10-04 复查（PR #1396）
- ~~后台自助 UI~~ — 管理员触发即可，等真实客户需求验证后再加

**总时间预估**：4-5 工作日（不含 PM 审 Spec 和等 CI 时间）

**关联**：memory `[[project-creatomate-connector-b-min]]`（本项完整状态）· `[[reference-creatomate-silent-failures]]`（Spec 必写死的 5 个坑）· `[[project-social-video-i2v-muapi]]`（i2v 使用禁忌）

## Phase 18.E — Audience Asset Engine / 中介私域买家库 🔄 建池器已落地（2026-07-29 登记）

> 蓝图：[`specs/2026-07-28-audience-asset-engine.md`](./specs/2026-07-28-audience-asset-engine.md)（v0.3 · 魏征 + 板桥双审 + PM 四项拍板）
> 三段模型：冷广告灌池 → 暖池便宜转化 → 智能判断每人在哪一级并自动递进。
> 边界铁律：资产层**永不裁创意、永不动预算**，只输出信号（18.D 管创意生死 / Ad Strategy Engine 管账户健康）。
> A 线机制已验证：暖池 CPL NZ$6.65 vs 冷启动 NZ$11.12（**低 40%**，n=100/146，CTS campaign 级）。
> ⚠️ 反例：同一暖池投 Messenger 对话单次成本 NZ$38.53（n=5，已暂停）→ **优势只在表单 lead 上成立**，30 Kiteroa 走 Messenger 不可直接引用 40%。
> P18.E.0 建池器已完成（`src/lib/meta/audience-ladder.ts`，16 单测 + 3 变异测试）。

- [ ] **P18.E.1 语法验证** — 视频源规则（`video_view_15s` / `video_view_50_percent`）需用 Render 上的 `META_SYSTEM_USER_TOKEN` 实调验证；MCP 工具面建不了（错误 2654）但平台 UI 支持 + CTS 生产在用
- [ ] **P18.E.2 账本表** — `client_audience_assets`：`audience_id ↔ client_id / layer / ladder_stage / scope / owner_account / source_type(organic|paid)`。**存 id 不靠解析名字**（重名/改名会静默炸）。🔴 **migration 待 PM `go apply`**
- [ ] **P18.E.3 采集** — 池 size 快照 → `flywheel_metrics` 的 `ads.audience.*`；台账画**净增 = 新进 − 到期掉出**（受众是衰减存量，不能只画总量）。新 cron 必须 link `me-shared-cron-secret`。依赖 P18.E.2
- [ ] **P18.E.4 画像** — 现有 `google-data-pullback-daily` 加 `breakdowns=age,gender`（不新起 cron）
- [ ] **P18.E.5 归属交付** — 归属条款 + 隐私告知（IPP 3/6/7/9/**12 跨境披露**）+ 同意文书 → **必须在任何受众共享动作之前完成**。待 PM 定条款
- [ ] **P18.E.6 月报** — 《你的买家库月报》客户面渲染（客户永不见 `L0/L1` 代号）。依赖 P18.E.3
- [ ] **待 PM**：Roman vendor deck「500+ Chinese buyer database」口径 · 海外买家资格口径（OIA 2018）· 开发商合同数据条款

> PM 已拍板：①归属=中介（红线，删除「带不走」黏性论）②无独家，平行服务多 agent ③定价随 agent package 再定 ④Roman 只作结构样板。
> kill criteria：暖池 CPL 若相对冷启动无显著优势 → 产品叙事重估。**当前未触发**。

## Phase 21.L — 讲课式系列课 · 单讲工作台（大瑞 IP「AI海外获客」6 讲试点）✅ 首条成片定版（2026-08-02）

> 登记 2026-08-01 · 客户 = Magic Lab Class（`377468af`）· 形态：上课件 slide + 下真人的讲课式短视频。
> 层1-2（PR #726）、层3（PR #735）、录屏智能剪辑（#765）、PM 实拍反馈四修（#757/#772）已上线。
> **制作方案定版**：[sops/lecture-video-production.md](./sops/lecture-video-production.md)（客户三步 + 系统自动七件事 + 七个已修的坑 + 换客户要准备什么）。
> 第 1 讲成片 169 秒，PM 验收通过。

- [ ] **做片任务表防双击唯一索引** —— 动数据库，🔴 **PM `go apply`**
- [ ] **数字人首跑实测** —— 生成要花钱，需 PM 说一声再试
- [ ] **发布端按平台带不同 CTA 接线**

## Phase 22.E — SEO 盯梢体系（S15-S18）📋 2026-07-31 立项，按序推进

> PM 拍板四决定：①小修（标题/描述/旧文小更新）全自动 + 周报可见，新文章/新页面/内链进待办等点头 ②Blog 每家每周 1 篇 ③每周一人话周报邮件，大异常当天单发 ④**先修断的再上新的**。
> S14（盯梢复活三连修）已上线（PR #709）。

- [ ] **22.E.S15 内链 + 收录数据采集**（P1）— 补 R2/R5 的 pages 输入（site-audit 爬虫内链图 + GSC 收录状态）；内链改动按 PM 界线进待办审批，不全自动
- [ ] **22.E.S16 每周 Blog 恢复**（P1）— CTS/Oztop 每家每周 1 篇，自动选题（AI 可见度弱项 × R4 机会词），直调 `generateBlogPost` lib（禁内部 HTTP 自调用），产出进待办等 PM 点头发布
- [ ] **22.E.S17 CTS 自动执行手**（P1）— 照 `seo_meta_log` 队列模式，CTS Next.js 仓 meta 安全窄道 + applied 回执；blog 发布通道（自动 PR + 人 merge）单独估算
- [ ] **22.E.S18 每周一 SEO 周报邮件**（P1）— 排名变化/自动改动/待点头 + 社媒栏 + 社媒广告栏；每栏带数据新鲜度检查，**断流标注不装新鲜**
- [ ] **[P2] 22.E.S16 每周 Blog 链路没接自动化管理系统（Inngest）**（`src/lib/blog/weekly-blog.ts` + `src/lib/cms/blog-publisher.ts`，2026-09-09 CTS 会话审计发现）：这条链路（选题→写文章→查一遍→变成等 PM 确认的修改请求→PM 在客户仓合并）符合 CLAUDE.md 铁律 3「Inngest 工作流硬约束」明确点名的场景（内容生成→人审→发布→…→Outcome 回写），但现在完全没接，只有一行 `flywheel_actions` 日志。三个具体缺口：①每一步（选题/生成/查过关）没有机器能读的记录点，只有开始时那一行；②PM 在客户仓库点确认合并之后，magic engine 这边不知道点没点、什么时候点的；③文章上线后有没有效果（排名/AI 引用变化）完全没有回头看的机制，等于写完就扔了。ME 别的地方已经在用这套自动化系统（网站情报、每周 SEO 报告），这条写文章的链路建的时候没接进去，是遗留缺口不是从零造。**按 CLAUDE.md §11 资源优先级三维打分**：频率=中（每周固定跑一次，出问题不容易被发现）／IMPACT 闭环关键度=高（现在完全没有"发布后有没有效果"这一环，这块内容产出没法证明有没有用，Check/Tune 两段对这条链路完全空着）／收入关联度=中（不会马上导致客户投诉，但长期看没法拿数据证明这块工作值不值钱）。三项零"低"、仅一项"高"（未达两项以上）→ 按穷尽表落 **P2**。改动会碰多个文件、影响已上线功能，按铁律 4 属于「大任务」，动手前后各要子牙（架构）+ 魏征（挑刺）过一遍，不是随手接一下就行。

## Phase 27 — Visual Reference Library（视觉参考库）📋 已登记，待开发

- [ ] **P27.1** — DB migration：`visual_reference_library` 表
- [ ] **P27.2** — FDE 上传 UI：Assets 页面「参考库」标签，支持批量上传 + 标注来源（FDE/客户/竞品）
- [ ] **P27.3** — GPT-4o Vision 分析管道：提取配色 + 构图 + 元素类型 + 风格标签
- [ ] **P27.4** — 行业标签过滤 + 相似图搜索（pgvector embedding）
- [ ] **P27.5** — 视觉得分：参考 viral_score 逻辑，给每张图打 1-10 分
- [ ] **P27.6** — 竞品爬取接入：URL 输入 → Jina.ai 抓取 OG 图 → 自动入库分析
- [ ] **P27.7** — AI Factory 注入：图片/封面生成时，从参考库取 top-3 相似风格约束注入 prompt
- [ ] **P27.8** — 参考库浏览 UI：瀑布流展示 + 筛选 + 得分排序 + 删除

## Phase 28 — FDE Inbox（待处理收件箱）📋 已登记 · ⚠️ 待并入 Phase 20.D（统一看板扩展）

- [ ] **P28.1** — DB migration：4 张产物表各加 `reviewed_at TIMESTAMPTZ`
- [ ] **P28.2** — 执行看板顶部「📥 待处理」收件箱区域 UI（聚合查询 + 时间倒序）
- [ ] **P28.3** — 收件箱条目点击展开 + 「标记已读」动作（PATCH reviewed_at）
- [ ] **P28.4** — 「发送到看板」后写入 reviewed_at=NULL（已是默认，确认 reels_drafts 行为）
- [ ] **P28.5** — 收件箱 badge 计数：侧边栏「执行看板」入口显示未读数

## Phase 29 — Unified User Experience（统一用户体验 · Portal/Dashboard 合并 + Self-Serve 准入门）📋 已登记，待开工

- [ ] **P29.C.1** — Brief 填写页 `/dashboard/clients/[id]/brief`：5 字段表单 + 保存 → `brief_completed_at = NOW()`
- [ ] **P29.C.2** — `BriefGateBanner` 通用组件：检查 `isBriefComplete`，未完成时显示 Banner + 内容操作区覆盖半透明蒙层
- [ ] **P29.C.3** — 接入内容生成页（博客 / 社媒 / Reels Studio）
- [ ] **P29.C.4** — 接入执行看板顶部
- [ ] **P29.C.5** — 接入 Launch Hub
- [ ] **P29.D.1** — AI Agent 辅助补 Brief：给出公司名 / 网址后 AI 自动提议 5 字段（可编辑确认）
- [ ] **P29.D.2** — Brief 完成后可随时在 Settings 页完善为 Full Brief

## Phase 36 — Voice Agent（AI 电话销售/客服）🔄 建设中

- [ ] 首呼后校准 `mapRealtimeEvent`（需真呼一次才知实际事件名）
- [ ] **0. 真机 spike**（验 verbatim 哑巴模式，最先做 · 1d）— 决定后 3 周走法
- [ ] 1. **真实外呼发起**（现为 mock stub，provider 真拨号 API · 2–3d）
- [ ] 2. 浏览器↔通话实时通道（SSE 下行 + POST 上行 · 3–4d）
- [ ] 3. operator 编排层（STT→翻译/KB→注入 · 3–4d）
- [ ] 4. bridge 改造（逐字朗读 + 哑巴模式 + 垫场 · 4–6d）
- [ ] 5. 操作台 UI（纯语音，双语字幕+模式开关+价格确认+kill switch · 4–5d）
- [ ] 6. 操作员语音转文字 STT 接入（1–2d）
- [ ] 7. 安全（通道租户鉴权 + kill switch + 掉线兜底 · 2–3d）+ 狄仁杰攻击验证
- [ ] 8. 填充语/轮次管理/快捷话术打磨（2–3d）
- [ ] 9. 合规（披露脚本 + DNC + 录音，**过法务** · 1–2d + 法务）
- [ ] WhatsApp 文字 + 语音消息（P1）
- [ ] CRM adapter（接外部 CRM，现只内置权威）
- [ ] 全自动外呼 campaign（批量）+ suppression 逻辑
- [ ] 生产级知识库（OpenAI 向量库语义检索，替代关键词版）

---

## Platform Partner Outreach（ME 自己的上游渠道伙伴 BD，非客户能力）📋 2026-09-02 登记

> 背景：PM 提供 spec，要找 AU/NZ 已获 Meta/Google/TikTok 官方 partner 资质的公司，建立 ME 自己的上游渠道合作（不是找客户）。经 me-platform-tier-gate 判定为 L4 内部运营工具，不占用平台能力线；复用了 `src/lib/prospecting/`（Phase 35）的状态机/打分/AI草稿/人工审批架构模式，但因业务语义不同（客户漏斗 vs 上游伙伴漏斗）新建独立表，不与 `outbound_prospects` 混用。子牙 + 魏征双审已过，四条缺口（RLS checklist、认证状态防幻觉硬约束、独立合规页脚、domain 去重约束）已在代码里落实。

- [x] Migration `supabase/migrations/20260902010000_platform_partner_outreach.sql`（RLS 从一开始就写对 `TO service_role`）
- [x] `src/lib/partner-outreach/`（types.ts / score.ts / outreach.ts，24 条测试全绿，不 import `src/lib/email/sender.ts` —— 这一轮零发送路径）
- [x] 研究 25 家 AU/NZ 候选（Meta 8 / Google 10 / TikTok 7，去重 1 家跨平台重复），全部诚实标注 verified/unverified，无编造
- [x] Wave 1 选出 10 家、生成完整邮件草稿（人工撰写个性化句，未接 AI 调用路径，因为本次会话没有确认 `ANTHROPIC_API_KEY` 可用性）
- [x] migration 已跑到生产 Supabase（`glbdnayojixmexgofbsd` / CrazyContent，2026-09-02 PM 手动执行）；匿名 key 探针验证 RLS 正确锁定 service_role(对照 `outbound_prospects` 已知修复表，响应 signature 一致)
- [x] 24 条候选（10 drafted + 14 discovered）已写入生产表，同样探针复验 RLS 未松动
- [ ] **待办 1**：实际发送 —— 严格等 PM 逐家或批量明确说"发"，不自动发送
- [ ] **待办 2**：`generatePersonalizationLines()`（AI 调用路径）尚未在生产环境验证可用，目前 wave-1 草稿的两句个性化文案是人工按同一套规则手写的，不是 AI 生成的——下一批候选建议先确认 API key 可用再接上自动生成
- [ ] **待办 3**：回复分类 + follow-up 调度 + admin 审批 UI（spec §16-17）尚未实现，这一轮范围只到"草稿就绪待审"
- [ ] **待办 4**：Meta 官方 Partner Directory 需要登录态才能核验，公开调研工具查不到——8 家 Meta 候选全部卡在 unverified；如果 PM 有 Meta Business 账号登录态,可以人工核一遍这批公司

---

## 平台治理层 · me-platform-tier-gate 后续跟进 📋 2026-08-27 登记

> 背景：2026-08-27 因 HBay KOL 事故设立 [`me-platform-tier-gate`](../.claude/skills/me-platform-tier-gate/SKILL.md) skill，约束 agent 在提议新增 ME 能力线时的思考边界。经魏征（对抗挑刺）+ 子牙（架构）两轮复审，v1 落仓时已修必改项 owner 责任链（问题 1）与候选清单载体（问题 2，见 [`docs/registry/platform-candidates.md`](./registry/platform-candidates.md)）。以下 4 条子牙终审时提出、v1 未修、进本 ROADMAP 分批跟进。

- [ ] **P.G.1** 补 harness 层挂载 hook —— 子牙终审问题 3。当前挂载靠 agent 自觉读 CLAUDE.md，跟事故根因（agent 没自认为在做平台决策）同构。方案：`.claude/settings.local.json` 加 Stop hook，扫本轮产出文本命中 `能力线|智能层|分析层|新增支柱|XX Intelligence|加一条(能力|支柱|柱)` 且未见 `Platform Tier Classification` 章节时输出提醒（先不阻断）。硬约束只有 harness 层能给。
- [ ] **P.G.2** 改名 skill 避免与 `src/lib/kernel-approval/tier-gate.test.ts` 语义碰撞 —— 子牙终审问题 4。同仓库 "tier-gate" 缩写会永久混淆平台层级与 kernel 权限档位两套概念。建议改成 `me-capability-layer-gate` 或 `me-platform-layer-gate`。改点：SKILL.md 目录名、CLAUDE.md 第 8 行、`docs/registry/platform-candidates.md` 里对 skill 的引用。
- [ ] **P.G.3** 澄清 skill 在五道 Build Gate 中的位置为 Gate 0 / Pre-Gate —— 子牙终审问题 5。SKILL.md 现在"红线 6"与"与既有治理机制的关系"表两处对 skill 从属关系的表述矛盾（一说是 Gate 4 前置子步骤，一说强化 Gate 2）。改成"Gate 0 / Pre-Gate，不替代任何后续 Gate，分歧走 owner 仲裁"。
- [ ] **P.G.4** 抽 `docs/registry/pillars.md` 作为 6 支柱唯一名单来源 —— 子牙终审问题 6。当前 SKILL.md、CLAUDE.md 两处硬编码"SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品"，跟 skill 自己声明的"支柱数量是 PM 拍板项"直接冲突。建仓后 skill、CLAUDE.md、其他引用点全部改成引用 registry 文件。同类还有五道 Build Gate 顺序 / 客户名单，可一并统一到 `docs/registry/` 下。
- [ ] **P.G.5** 平台候选复查治理界面 —— Codex 复审 P2 遗留意见。当前 `platform_candidate_review_due` 待办的 href 指向 GitHub `blob` 只读页面，PM/FDE 收到待办后要同时改 `docs/registry/platform-candidates.md` 表 + `src/lib/pm-todo/platform-candidate-reviews.ts` 数组，非技术收件人做不了。要么建一个真正的治理界面（可以直接更新证据 + 推下次复查日），要么把 `platform-candidate-reviews.ts` 里的日期改为从 markdown 表自动派生。当前 workaround：接到待办后回一句 "把 X 候选复查日推到 YYYY-MM-DD"，由 agent 帮改两处并提 PR。

---

## ME 会员制度五档 · 免费 / $39 / $199 / $499 / 定制 📋 2026-08-31 PM 拍板，四张合同票均为 SPEC DRAFT

> 分档尺子是**「谁在干活」**（PM 原话，从旧三档沿用）：免费=系统搭好你自己用 · $39=系统把你摆出去 · $199=AI 替你干活 · $499=AI 替你花钱干活 · 定制=真人接管。
> **旧的 NZ$500 起步版 / NZ$2,500 高级企业版固定报价已于 2026-08-31 全部作废**（PR [#1279](https://github.com/bigbigraydeng-maker/magic-engine/pull/1279) 把 `docs/registry/pricing-playbook-enterprise-fde.md` 标为 RETIRED）。**定制 / Enterprise 档 case by case 逐单报价，代码与对外材料一律不挂数字。** 已签客户不受影响。
> 落地顺序是「先给客户一个网站和一个邮箱」，依赖 [#1269](https://github.com/bigbigraydeng-maker/magic-engine/issues/1269)（OpenSRS 域名 + 邮箱，Phase 0 未动）。

**四张票全部是 SPEC DRAFT —— 没有 `BUILD CONTROL — GO BUILD` 之前任何窗口不许动手。**

- [ ] **[#1273](https://github.com/bigbigraydeng-maker/magic-engine/issues/1273)** [风险 B] AI 单页站生成器 —— 免费档与 $39 档的第一块砖。
      🔴 **技术路线已冻结：AI 只出结构化 JSON，绝不出 HTML。** 版面由模板决定。AI 吐 HTML 则每次结构不同 → 没法断言 noindex / 角标 / 无编造事实 → 扫街跑几百个会坏掉几十个而无从定位。多样性靠「模板 × 配色 × 首屏版式」的**可枚举组合**，不靠 AI 即兴。
      🔴 **别重造**：`src/lib/tailor-made/` 已经是同形状流水线（AI 抽结构化数据 → 归一化 → 注入 HTML 模板 → 出成品，生产在跑行程单与画册），换的是对象不是形状。配套复用 `diagnostic/report-generator.ts` · `images/unsplash.ts` · `factory/stock-pipeline.ts` · `brief/jina.ts`。
      ⚠️ **最大短板是配图**：没有商家真实照片只能用图库，同一条街几家同业配到同一张图会直接毁掉扫街杀伤力，必须按行业 + 氛围选并去重。
      平台候选「AI 单页站生成器」已登记 `docs/registry/platform-candidates.md`（PR #1278 已合并）。
- [ ] **[#1274](https://github.com/bigbigraydeng-maker/magic-engine/issues/1274)** [风险 A] 免费档 —— 认领、隔离与永不删除的生命周期。免费站边界：永久能用能发链接，但 **noindex 不收录 + 带 ME 角标 + 无邮箱 + 无自有域名** —— 这四条正是 $39 档的卖点。
- [ ] **[#1275](https://github.com/bigbigraydeng-maker/magic-engine/issues/1275)** [风险 A] $39 订阅与四项解锁 —— **用 Stripe Billing，禁止自建订阅状态机**（承接 [#1122](https://github.com/bigbigraydeng-maker/magic-engine/issues/1122) 的 Build Control 决议）。$39 含自有域名 + **公司邮箱 1 个，第 2 个起 $9/月/箱**。`src/types/magic-engine.ts:7` 的 `ClientPlan` 需对齐五档，且 `custom` 档不许在代码里挂任何价格数字。
- [ ] **[#1276](https://github.com/bigbigraydeng-maker/magic-engine/issues/1276)** [风险 A] 扫街预建站管道 —— 先把网站做好再去谈。口径：**不公开 · 一商家一链接 · 只用公开事实 · 不用商家照片和 logo**。

**🔴 唯一卡住的数字**：CTS + Oztop 过去 30 天真实外部 API 消耗（美元）仍未到手（v0.4 就要求过）。**在它到位之前 $199 / $499 的具体额度不许写进代码**；任一档毛利 < 40% 就得调额度或加价。免费档与 $39 档不受此约束，可以先跑。

**⚠️ 对外仍挂着已作废的旧价**：公开收费页 `magic-engine-pricing.pages.dev` 还显示 NZ$500 / NZ$2,500 三档。源码不在当前主力 Mac 上（线上是 37KB 自包含 HTML，可 curl 抓下来当基线重建）。改页面前先解决 Cloudflare 账号权限：该项目在 `hello@magicengine.cloud` 名下，本机 wrangler 登录身份看不到它。

---

## AI 断电告警 · 上线后跟进（2026-09-23 开 PR，A 级；本体已做完，以下是**刻意没做**的部分）

主体改动见该 PR：AI 账户级失效识别 + 落库 + 下发今日待办、卡死任务进失败邮件、
`health.ts` 的 `failing` 接进待办、日报按「同任务同原因」去重。以下是两轮设计复审
（子牙 / 魏征）点出、但按 Scope 闸「只实现当前调用方需要的最小契约」**故意留下**的：

- [ ] **[P2] 验证 Cloudflare AI Gateway 到底代不代理 `/v1/responses`。**
      现状：全仓 40+ 个走网关的调用方 100% 用 `chat.completions`，而 7 处 `responses.create`
      **从来没有一次经过这个网关**（2026-09-23 核对，两组文件零交集）。所以这次收编它们时
      传了 `bypassGateway: true`：只拿失败拦截、不换路由。
      要做的事：拿真 key 对网关打一次 `responses.create`（**含 voice/knowledge 那个
      `file_search` + `vector_store_ids`**），通了就去掉这个开关，它们才能进网关的日志和缓存。
      不验就切 = 用一条没验证过的路由换掉七条在跑的链路，其中 6 处失败被 catch 吞掉。

- [ ] **[P3] 失败邮件只看最近 24 小时，卡死超过 24 小时的轮次进不了它。**
      今日待办那条按 48 小时窗口接住它，之后两边都看不见（attribution-cron 2026-09-02
      那次卡了 4 天）。两个窗口怎么对齐值得单独想一次，别顺手拍一个数。

- [ ] **[P3] `checkCronHealth()` 整体仍然没有单测。**
      这次把「查某任务窗口内卡死行」抽成了可注入的窄接口（`StuckProber`）、
      并给纯函数 `collapseStuckRuns` 补了 8 条断言，但**编排本身**（三个查询怎么合并成
      HealthReport）还是没覆盖。照 `DownstreamProber` 那套把另外两个查询也抽成窄接口就能测。

- [ ] **[P3] `src/lib/messenger/brief.ts:414` 仍然自己 `new OpenAI()`，绕开统一封装。**
      归另一个窗口（它的 `fallbackBrief` 是「只挡钥匙缺失、挡不住 429」的同一个病）。
      那条收口后，全仓就只剩 `ai-tracker/runners/perplexity.ts` 直连 —— 那个是 Perplexity，
      本来就不该走 OpenAI 的封装。

- [ ] **[P3] `voice/finalize.ts:131-137` 账户没钱时仍然安静回落 mock。**
      这次只是把**信号**接到了断电记录上（PM 会看见「AI 账户没钱」），
      但那一处自己的降级行为一个字没改。**别把「收编了」说成「这处不再静默」**，是两件事。

- [ ] **[P2] 「卡死」的 60 分钟阈值对 Inngest 那几条长流程可能是误报。**
      `health.ts` 里写的理由是「全仓最长 maxDuration 900 秒」—— 但 `maxDuration` 是
      Vercel 的旋钮，我们跑在 Render 的 `next start` 上，**根本不执行它**，这个论据不成立。
      实际反例（它们也写 `cron_run_logs`，新的失败邮件判据同样会扫到）：
      `conversion-daily-pipeline` 最坏情况（100 块 × 退避 65 秒）远超 60 分钟；
      `factory-creatomate-render`（15 分钟等事件 + 10 × 2 分钟轮询）最坏约 35-40 分钟。
      要做的事：给 registry 加一个「本来就长跑」的标记，或对 Inngest 来源的任务用更长阈值。
      **误报一旦成为常态，真出事那天也会被当噪音划掉** —— 这条不修迟早反噬。

- [ ] **[P3] `makeSupabaseStuckProber` 查询报错时返回 `[]`，等于「没有卡死」。**
      跟旁边的 `lastRunByJob` / `lastOutcome` 是同一个既有毛病（都吞错），
      但这正是本文件反复声讨的「主动报平安」。照 `DownstreamProbe` 那样加一条 error 通道。

- [ ] **[P3] 看板 `workflows-health/page.tsx:214` 的文案过期了。**
      它写「**最近一次**挂着 running」，而现在 `startedAt` 是 48 小时窗口内**最早**那一轮；
      而且新加的 `rounds`（卡了几轮）没渲染出来，看板比待办少一条信息。

## AI 可见度全挂告警 · 上线后跟进（PR [#1943](https://github.com/bigbigraydeng-maker/magic-engine/pull/1943)，2026-09-28 合并；代码已合并、单测已过，以下是三轮复审点出、**刻意没做**的部分）

主体改动：某客户 AI 可见度体检整周全挂时自动进今日待办，分供应商给修复指引，不用 PM 操心的原因单独
归开发栏。台账卡：[`docs/ledger/2026-09-23-ai-tracker-100pct-failure-pm-todo-alert.md`](./ledger/2026-09-23-ai-tracker-100pct-failure-pm-todo-alert.md)。
**尚未当场试跑完整链路**：本改动同时改了 `/api/cron/ai-tracker-weekly` 的失败计数，并依赖随后运行
的 `pm-daily-todo` 把失败读出来生成告警；按 CLAUDE.md「当场试跑」规则，这条「周检失败 → 待办生成」
链路需要拿替身数据手动触发一次、看到真实待办回执后才能算完整验证，目前还没跑过。台账卡 `verify_by`
定在 2026-09-30，届时用真实周检（或人为制造一次全挂）确认待办邮件里出现这条提醒，再把台账状态更新
为 `verified`；在此之前不应把这个功能说成「已验证可用」，只能说「本体代码已合并」。
以下按 §11：三条频率都低（都要撞上特定的低概率数据库/时序状态才会触发）、IMPACT 前两条中（真撞上
会让检测彻底失效）后一条低（会自愈）、收入都低（没有证据显示已经影响过真实客户）→ 三条都是 P3。

- [ ] **[P3] `ai_visibility_runs` 插入本身失败时，这行数据完全不落库，检测不到。**
      `orchestrator.ts` 的 `processOne` 在 DB insert 失败时只 `runs_failed++`，不写任何行；
      本模块的查询只读 `ai_visibility_runs`，一行没有 = 看起来跟「还没跑」一样。
      要做的事：读一份按客户记录的批次/定时任务回执作第二数据源，或者插入失败时也落一行
      占位记录（哪怕内容是空的）。

- [ ] **[P3] `ai_visibility_runs` 插入成功但更新失败时，那一行会被误读成「成功」。**
      `processOne` 第四步更新（写入解析结果/`parse_error_message`）失败时，`orchestrator.ts`
      正确记了 `runs_failed++`，但最初插入的那一行仍然带着两个空字段（`error_message` /
      `parse_error_message` 都是 `null`）——`isRunConclusive` 只看这两个字段，会把它当真成功。
      要做的事：给该表加一个能区分「还没解析」/「解析成功」/「更新失败」三种状态的字段，
      或者也用上面那条的批次回执来判定。

- [ ] **[P3] 待办查询可能撞上「这周的批次还没跑完」，误报一次全挂。**
      旧的 `ai-tracker-weekly` 定时任务周日 18:00 UTC 起跑、`pm-daily-todo` 一小时后就查；
      如果某客户当前批次只跑完前几条且都失败，会被误判成「全挂」，甚至给出充值指引，
      尽管剩下的探测随后会成功。属于低概率但会自愈的一类：下一天的检查会因为看到新的
      成功记录而自动撤回提醒，不会一直卡在错的结论上。要做的事：依据批次完成回执或
      预期探测数确认该周运行已结束后再生成告警（同上两条的批次回执可以一起解决）。

## 每日计划价格数字核对 · 审查后登记（2026-10-08，PR 2365）

**§11 打分**：频率中（每次发布都过）· IMPACT 关键度高（Act 外发出口）· 收入关联度高（错价 = 客户投诉）→ 以下为本 PR 审查中**未并入**的次要意见，记入待认领，不现在动。

- [x] 【已作废（Publer 已删除）】**[P2] Publer 三条发布路由（`/api/publer/create-post` `schedule` `quick-post`）没接价格数字核对**，只有旧的图来源闸。
- [ ] **[P2] 资料包由人手填，官网改价后会过期。** 官网事实快照（PR 2270）合并后，让核对改为对官网快照自动对账，并给资料加「核对日期」。
- [ ] **[P3] 资料包里任意字段里的数字都算事实**（过期早鸟价、单人房加价可被当团价放行）。收紧成只认带语义的价格字段。
- [ ] **[P3] 共享代码默认团名放在 `tour` 字段、破折号和括号出发地写法**，对旅游以外行业不通用；应改成 Industry Profile 或显式声明团名字段。没填资料包又写了价格的非旅游客户目前会被整批拦（待查哪些客户走每日计划发布）。
- [ ] **[P3] 资料读失败时，待办只写日志不出条目**（出口则 500 不放行）。待办侧也应出一条「读不到资料」。
- [ ] **[P3] 价格识别已知盲区**：无币种无提示词的 4 位裸价（含 1900–2099）、`块`、HTML 实体、`CNY`；「from 150 travellers」类老误伤现在会整批拦。
- [ ] **[P3] 待办只看每个客户最新一份计划**，同客户并行第二个活动的计划不会出待办（发布时仍被拦）。
- [ ] **[P3] `verifyPostPrices` 拆成「解析候选团」和「逐条核价」两段；`price-fact-items.ts` 的 `isRecord/readPath` 与 gate 重复。**
- [ ] **[P3] 设置页资料包没有字段名提示**（`tour` `url` 影响匹配，价格字段名随意），加占位符说明。
- [ ] **[P3] 魏征二审：新增的「带千分位逗号的数字都算价格」会多拦社交证明文案**（Join 2,500 happy guests、1,000 5-star reviews、1,500 bookings、up to 8,848 m）。补单位词表（customers/bookings/spots/rooms/m/tours/5-star reviews）；只会多拦、不会多放。
- [ ] **[P2] 已知缺口：`now 1999`、`was 2,699, now 1999` 这类 1900–2099 间不带逗号的促销价会被当年份放过**（NZ 团价常落在这一带）。让 was/now 后面的数字不再按年份排除即可堵上。

## SEO 负责人节奏 · 审查后续项（2026-10-08，设计稿 [docs/specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md)，待 PM 批准第一阶段后再排）

- [ ] 簇体检的「谁当主页」要有通用判据，不得写死客户页面（子牙）
- [ ] P2-B 月度竞品词差落地时需要存历史，那时要新表评审（子牙）
- [ ] P3 的 `seo.change.*` 事件补授权失效、幂等、重放规则（子牙）
- [ ] P1-C 询盘取数口径落地后补一张台账卡（子牙）
- [ ] 预诊断上线后，逐条核实 CTS 示范里「哪页在排这个词」的假设（魏征）
- [ ] 算出张家界「第 4 → 前 3」的点击差额（用现有点击率曲线，不编数）（魏征）
- [ ] 对账 42 号体检里「已过期清单卡」张数（§一写 4、§五写 3）（魏征）
- [ ] 先测「卡从出生到被批」中位天数的基线，再定 ≤7 天目标（魏征）
- [ ] 开源仓库的 SERP 重叠阈值用 CTS 实测校准后才可上线（设计稿 §11）

- [ ] **[待排] 谷歌搜索广告（SEM）专家工作节奏设计**（PM 2026-10-09 拍板与 SEO 分开管理，归广告支柱；SEO 第一阶段跑起来后再排，不开工）。SEO 设计稿 §12 已定义两边「对表」接口；台账卡 `2026-10-09-sem-expert-rhythm-design-todo`

## 广告负责人节奏 · 审查后续项（2026-10-10，设计稿 [docs/specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md)，待 PM 批准第一阶段后再排）

- [ ] **[P2] 把 `detectSpendSpike` / `detectClientSpendOverCap` 接到日循环上** —— 判据、阈值、fail-closed 防护全是现成的，生产里零个调用方；**先与 51 号窗口对口径**，别两边各写一套（魏征 D-2、卫青）
- [ ] **[P3] 频次阈值按角色分档**（拉新 vs 再营销）需先扩 `AdsPlaybook` 接口（`playbooks/types.ts:23` 不收判断规则），且阈值须用 CTS/NAL 真实数据校准，不用开源的数字（子牙）
- [ ] **[P2] W1 的「置信度」本期降级成「样本天数」**；真要做置信度得先定算法与取值域，否则实现出来是个凭感觉的字符串（子牙 6-3）
- [ ] **[P2] 把广告组 / 广告层的 `frequency_7d` 真正填上**（`daily-insights.ts` 现在直接写死 null），否则疲劳分类长期只能靠系列层（魏征 B-1）
- [ ] **[P3] `ad_entity_snapshots` 存按版位拆开的花费**，让 D9 能按真实花费判、不只按设置字段判（设计稿 §2.1 #4）
- [ ] **[P3] NZ 版合规规则库**（AU 那份 `src/lib/compliance/au-rules.ts` 已存在但零调用方，先把 AU 接上广告草稿闸再谈 NZ）；Meta 个人属性规则也没落成可比对清单（设计稿 §2.1 #6）
- [ ] **[P3] 命名规范自动校验**（CTS 一个账户里已有四种命名风格并存）（设计稿 §2.1 #2）
- [ ] **[P3] 卫青手册 §三 把 `ad_health_prescriptions` 改成实际存在的表名**（生产库没这张表，照它去查会白跑一轮）（设计稿 §2.6）
- [ ] **[P3] 季节性冲刺层排期（Q5）** 等 02 号窗口的 CTS 预算计划 PM 拍板后再排（设计稿 §3.4）
- [ ] **[P3] `src/lib/cron/registry.ts` 两处清单与 `render.yaml` 不一致**：`google-data-pullback-daily` 写 `0 3 * * *`（实际 `0 17 * * *`）、`ad-entity-snapshot` 写 `30 */3`（实际 `30 */6`）；`reel-batch-render` 调了运行记录没人认领监控。**本分支基线 `registry.test.ts` 已有 2 条红，不是广告改动造成的**，碰 registry 的 PR 会撞上（子牙 4.1）

## 广告 agent 手册 v1.0 · 审查后续项（2026-10-10，手册 [docs/sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md](./sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md)，等 PM 回第十节拍板后再排）

- [ ] **[P0] 授权红线落代码**：开投 / 加预算 / 改在投素材 / 改受众 / 关整系列永远只认 PM 身份审批接口；`winner-reel-sync-daily` 改只建 PAUSED（手册 §11 行 A1，A 级，等 PM 回第 1 问）
- [ ] **[P2] S-01 / S-02 / S-11 / C-07 判据补门槛**：「抢量」「预期周事件数」「出价偏差」「素材够几周」目前只有方向、缺可验证门槛（子牙审查）
- [ ] **[P3] 通用手册重号**：`playbook-ads-meta-general` 有两个 §十三、两个 §三十，建议改编号（记忆文件，不在本仓库）
