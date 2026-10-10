# CRM + AI 客服接入 —— 构建控制室（Build Control Room）

> 本文档是**控制记录**，不是实现 issue，不当分支/PR 范围用。仿照 `docs/specs/2026-08-10-me2-wp00-contract-freeze-v1.0.md`
> 与 [issue #870](https://github.com/bigbigraydeng-maker/magic-engine/issues/870)（ME2 构建控制室）的既有模式——本仓库已经有一次
> "多窗口并行、没人管全局，结果互相踩"的教训（见下方"已发生的真实冲突"），这次是把同一套治理搬到 CRM/AI 客服这条线。

## 目的（PM 2026-09-15 拍板）

让 ME 的 CRM 系统兼顾：
1. AI 客服接入 Facebook Messenger（WhatsApp 范围见下方"范围已拍板"）
2. 用户（客户联系人）信息管理
3. CAPI 数据回传（广告归因闭环）
4. 知识库训练（AI 该说什么/不该说什么的事实源）
5. 接收邮件、Messenger、WhatsApp 的对话信息（统一收件——**收件**跟"AI 主动接
   WhatsApp Business 客服"是两件事，收件不受下面这条范围决定影响）

**范围已拍板（2026-09-15）**：PM 确认维持 issue #1290 原有冻结决定——**先只做 Messenger
一条路，WhatsApp Business 的 AI 客服接入暂不启动**，等真的有 ≥2 个客户要用再抽公共
Adapter。构建控制/任何窗口看到"要不要现在做 WhatsApp AI 客服"，答案是"不做，按老计划"，
不用再问 PM。

**PM 需要的不是新功能，是一个不会让自己"lost"的控制点** —— 现在有 6+ 个并行窗口在碰这条线的不同角落，PM 自己拼不出全貌，容易重复授权、重复花钱、或者漏掉冲突。

## 角色

- **产品负责人**：PM（Ray）—— 业务、优先级、花钱、风险接受度、"WhatsApp 现在要不要做"这类范围决定
- **构建控制**：一个专门开的窗口/会话，只做协调，不写代码——职责见下"构建控制的日常工作"
- **实现窗口**：任意 Claude Code 窗口——领活前必须先来这份文档 + 对应 issue 核对现状，不许凭记忆开工
- **铁律**：一个窗口 = 一个 issue/PR，同一个 issue 同时只许一个窗口在动

## 工作原则（照抄 #870，验证过有效）

- 不搞 Agent 群魔乱舞——先看现有能力能不能扛，不是每个新需求都建一个新模块
- **写方案不等于批准**，**批准不等于执行**——merge / apply migration / 上线开关 / 接通调用方，永远是分开的、需要 PM 显式 `go` 的动作
- GitHub issue / PR / 数据库记录是窗口之间**唯一**的交接方式——不许靠聊天记录或者"我以为"传状态
- 每次有实质进展，**当场**在对应 issue 上评论 + 勾掉 checklist，不许拖到"最后汇总"再补

## 现状全景（2026-09-15，逐条 `gh issue/pr view` 核实，不是抄旧文档）

### 已经做完、可以复用的地基

| 能力 | 状态 | 位置 |
|---|---|---|
| 客户知识库（AI 该说什么/不该说什么的双签事实源） | ✅ 6 步全部合并 | `src/lib/knowledge/`，issue #1643-#1648 均已关闭，详见 [ROADMAP.md](../ROADMAP.md) |
| Messenger webhook 接收 | ✅ 已合并 | issue #1640 |
| WhatsApp webhook 退订+事件接线 | ✅ 已合并 | issue #1637 |
| 渠道查表分发（channel-dispatch） | ✅ 已合并 | issue #1636 |
| 跨渠道退订检测 | ✅ 已合并 | issue #1625 |
| 对话分类逻辑 | ✅ 已合并 | issue #1621 |
| CAPI 支持 Facebook 私信身份（PSID）第三种匹配键 | ✅ 已合并（NAL 客户） | PR #1684 |
| NAL 私信 → CAPI 有效咨询同步（dry_run） | ✅ 已合并，未切真发送 | PR #1675/#1689，等 PM/FDE 决定要不要审这批 `pending_review` |
| Verifier 框架 + CTS 七道闸（AI 说的话过最后一道数字核实） | ✅ 已合并（2026-09-15，merge commit `65efbfa0`） | issue #1579，PR #1638 —— 改接新 `getClientKnowledge` 完成，子牙 CONDITIONAL PASS（[#1726](https://github.com/bigbigraydeng-maker/magic-engine/issues/1726) 跟踪，P3 不阻塞）+ 魏征 ✅ 通过，PM 拍板后合并 |
| Messenger AI 客服核心（prompt.ts + 3 只读工具） | ✅ 已合并（2026-09-15，merge commit `2c05d77f`） | issue #1580，PR #1639 —— 同上改接完成，子牙 ✅ 通过，PM 拍板后合并 |
| Inngest 编排 F3 批准中继 + 门户批准/拒绝/改后发送端点 | ✅ 已合并（2026-09-15，merge commit `7e938eb6`） | issue #1586，PR #1741 —— 子牙+魏征各一轮，两边独立发现同一个真实并发漏洞（双人/双击可能导致"DB 说拒绝、批准通知却已经真发出"的不一致）已修复为数据库层原子条件更新，魏征用真实测试+变异测试核实通过，PM 拍板后合并。**依赖的 #1585（F2）当天稍晚也已合并**——F1-F4 全链路代码已完整，但见下方"数据库层今天才真正齐全"一节，代码合并不等于数据库能跑 |

### 🔴 数据库层今天才真正齐全（2026-09-15 下午发现并修复，别再假设"合并 = 数据库有这张表"）

**代码全部合并 ≠ 数据库能用**——这条线依赖的 **8 个迁移在今天下午之前从未 apply 到生产库**：
`conversation_reply_drafts`、`client_knowledge_facts` 全系列（含萃取水位/客户确认请求/rollout
阶段机）、双 kill switch 列、F4 健康告警表全部不存在。也就是说，F1-F4、待批准草稿 UI、PM
daily-todo、紧急停按钮这些"✅ 已合并"的功能，**在今天下午之前即使合并了代码，数据库层面也
跑不起来**——这不是理论风险，是 issue #1590 回滚演练开工时实测发现的真实状态（8 张/列全部
缺失）。PM 已授权，8 个迁移今天已全部 apply 到生产库（独立核对 `list_migrations` 确认：
`20260913095601_conversation_reply_drafts` 等 8 个迁移的 apply 时间戳全部是今天）。**这行之前
的任何"已上线"说法，都要带上这条前提——现在才是真的成立。**

### 依赖状态一览（2026-09-15 全面核实，`gh issue view` + `gh pr list --state all --search` 逐条重查，不是抄旧文档）

| 能力 | issue | PR | 现状 |
|---|---|---|---|
| ~~Inngest 编排 F1 自动应答~~ | #1584 | [#1739](https://github.com/bigbigraydeng-maker/magic-engine/pull/1739)（已合并） | ✅ 已完成 |
| ~~Inngest 编排 F2 生成草稿（主函数）~~ | #1585 | 已合并 | ✅ 已完成——F3 依赖的这一环已打通 |
| ~~Inngest 编排 F3 批准中继~~ | #1586 | [#1741](https://github.com/bigbigraydeng-maker/magic-engine/pull/1741)（已合并） | ✅ 已完成，见上表 |
| ~~Inngest 编排 F4 健康心跳~~ | #1587 | 已合并（`src/lib/messenger-agent/health-heartbeat.ts`） | ✅ 已完成 |
| ~~PM daily-todo UI + 紧急停按钮~~ | #1589 | [#1747](https://github.com/bigbigraydeng-maker/magic-engine/pull/1747)（已合并） | ✅ 已完成 |
| ~~待批准草稿 UI（三按钮）~~ | #1588 | [#1751](https://github.com/bigbigraydeng-maker/magic-engine/pull/1751)（已合并） | ✅ 已完成 |
| 回滚 SOP 真实演练 + 渠道级判断文档化 | [#1590](https://github.com/bigbigraydeng-maker/magic-engine/issues/1590) | [#1765](https://github.com/bigbigraydeng-maker/magic-engine/pull/1765)（已合并） | ⚠️ **大部分完成，保持 OPEN**——见下方专项说明，不是"没人在动" |
| T-14d 端到端 dry-run + 长度阈值真实验证 | [#1591](https://github.com/bigbigraydeng-maker/magic-engine/issues/1591) | 无 | 🔧 **另一个窗口在做**，别重开——本次核实无匹配 PR、issue 无新评论，进度需直接问那个窗口 |
| Delivery day 灰度切换（Messenger/WhatsApp 分开） | [#1592](https://github.com/bigbigraydeng-maker/magic-engine/issues/1592) | 无 | 没人在动，**且不该现在排期**——依赖 #1591 先做完 |

**#1590 专项说明（保持 OPEN 的真实原因，不是漏关）**：这次演练发现代码本身没问题、但有三个
真实技术债——TD.20（批准按钮不检查渠道 kill switch 状态）、TD.21（缺批量拒绝待审批草稿的
入口）、TD.22（缺"中止在途 Inngest 任务"机制）。关键结论：**关开关本身秒级生效（实测
<10s），但已经在"待审批"状态的草稿不会被自动处理**——回滚必须手动逐条拒绝，推翻了早前
"5 分钟内可回滚"的说法。这次演练用数据库模拟"任务卡在待审批"的状态测试安全网，**不是**
真正端到端触发过一次 Inngest 事件（开发环境没有触发密钥）——保持 OPEN，等一个能连生产
Inngest 环境的窗口/人补一次真实端到端实测。

**新增两块范围（原 9 项之外）**：
- 邮件渠道 AI 客服（[issue #1745](https://github.com/bigbigraydeng-maker/magic-engine/issues/1745)，OPEN）——接入方案调研中，是本文档"范围问题已拍板"一节记录的唯一例外（详见下方）。
- 从历史对话提炼接待风格/标准应对（issue #1760，已关闭）——[PR #1766](https://github.com/bigbigraydeng-maker/magic-engine/pull/1766) 已合并，扩展现有客户知识库萃取管道，只对 CTS 生效，尚未接自动触发器（手动/脚本调用）。

**CAPI 每日同步现状（来自构建控制窗口报告，本窗口未独立核实细节）**：每日自动同步+人工审核
已上线，今天发现一次因后台任务清单被覆盖导致没跑的问题，已重新登记，计划 2026-09-17 核实
是否稳定——需要建日历提醒的应在那次报告的窗口里处理，这里只记录现状指针。

> ⚠️ 核实方法：`gh issue view <号>` 查真实 state；`gh pr list --state all --search "<号>"` 逐个查有没有
> 已开/已合并/已关闭的 PR（`gh pr list` 默认只列 open，漏了 `--state all` 会把已合并的 PR 也判成"没人在动"）。
> **这份核实是这次改动时的快照，会过期**——下一个进这条线的窗口领活前仍要自己重跑一遍上面两条命令，
> 不能直接信这张表；数据库层面也要核实（`list_migrations` 或直接查表存不存在），不能只信"issue 关了"。

### 已知的真实冲突/重复劳动（本 session 已实测抓到，别再踩一次）

1. **#1622 vs #1629 vs #1623**：三个 PR 修的是同一个"AI 私信回复冒充 CTS 身份"的问题，各开各的，最后 #1629 合并、其余关闭 credit——如果当时有构建控制室先查一遍开着的 PR，这两次重复工作能省掉。
2. **迁移版本号撞车两次**（PR #1678、#1711 各修过一次）：两个窗口各自"猜"下一个可用的时间戳版本号，猜中同一个数字，合并后才发现——现在有自动检测测试（`src/lib/kernel/__tests__/architecture.test.ts`），但**事前核对 `ls supabase/migrations | tail -20` 比事后修更便宜**。
3. **`brief.ts` 和 `stage-from-conversation.ts` 同款硬编码 CTS 身份 bug**（issue #1627 待修，跟 brief.ts 那次是同一类问题，还没人补）——同一个 bug 模式在两个文件出现，说明"查一遍全仓库还有没有同款问题"这一步经常被漏掉。
4. **6 个客户知识库 issue 合并后没关闭、ROADMAP.md 没更新**（今天由另一个窗口读文档时发现并指出）——PR 描述里没写对 `Closes #xxxx` 格式，导致"已经做完"和"看起来还没做"长期对不上，浪费了一个窗口的排查时间。

## 构建控制的日常工作（这是给"构建控制"窗口本身的操作手册）

每次有人（PM 或另一个窗口）问"现在到底做到哪了"，按这个顺序回答，不许凭记忆：

1. `gh issue view <相关 issue号>` 查真实 state（不信 ROADMAP.md 的文字，那是快照，会过期）
2. `gh pr list --state all --search "<关键词>"` 查有没有已开/已合并/已关闭、可能重复的 PR
   （不加 `--state all` 会漏掉已合并的 PR）
3. 对答案里任何"已合并"的说法，补一句它有没有真的在生产 apply / 启用（合并 ≠ 上线，这条铁律本仓库反复踩过）
4. 发现两个窗口在动同一个东西——立刻在两边 issue 上留言 @ 对方，不要等 PM 发现

## 范围问题已拍板（2026-09-15，记录不再重问）

issue #1290（CTS Governed Lead-Reply Agent 主设计）此前拍板的 4 个岔口第一条：**"MVP 覆盖：
只 CTS · Messenger 一条路 · WhatsApp 等真接凑 ≥2 客户证据再抽"**。当天 PM 就"CRM 要不要同时
接 WhatsApp AI 客服"这个疑似冲突当场确认：**维持原决定，先按老计划走，WhatsApp AI 客服接入
不启动**。WhatsApp 相关 issue（#1300/#1309/#1455/#1304）保持"设计已存在、暂不启动"状态，
不用再为这件事去问 PM。

（"接收 WhatsApp 对话信息进统一收件"跟"AI 主动用 WhatsApp Business 回复客户"是两件事——前者
本来就在 #1637 里做完了，不受这条范围决定影响；受影响的只是"让 AI 客服本身去说话"这一层。）

**唯一的例外（PM 2026-09-15 当场拍板）**：邮件渠道 AI 客服（[issue #1745](https://github.com/bigbigraydeng-maker/magic-engine/issues/1745)）是这条"Messenger-only"范围冻结的例外，只适用于邮件这一条——**WhatsApp 仍按上面的原冻结决定，不做**。这条例外不代表范围冻结整体松动，下一个窗口看到别的渠道（WhatsApp/短信等）想比照 #1745 扩范围，答案还是"不做，按老计划"。

## 不受范围决定影响的外部阻塞

**Meta 企业验证仍未通过**（issue #1299，需要 PM 本人上传公司文件）——不管 Messenger 这条路
代码做到多完整，真正对客户生效那天都卡在这一步，需要 PM 处理，不是代码能解的。
