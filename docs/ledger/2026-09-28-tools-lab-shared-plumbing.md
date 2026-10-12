---
id: 2026-09-28-tools-lab-shared-plumbing
title: 工具实验室两个已上线工具（网站免费诊断 + Facebook 广告体检）去重共用底层——访客识别、请求体读取、限流原子计数、留资记录四处重复代码各收成一处；留资第一次接进「今日待办」；加一道跨工具全站每月合计花费上限
status: done
owner: agent
decided_on: 2026-09-28
source: session:4bb834a6
done_on: 2026-09-28
done_ref: pr:2163
verify_by: 2026-10-12
verify_how: 合并部署后：① 正式网站跑一次网站诊断，确认结果与花费回执一切照旧（不应有任何访客可见的行为变化）；② 广告体检自助客户首次打开体检页，确认今日待办里出现一条「工具实验室有人留资」的待办；③ 查一次今日待办邮件，确认没有出现新的、意料之外的条目类别。
last_checked: 2026-10-12
check_note: 夜巡盖章：本晚未取到 verify_how 所需的线上/生产证据，不翻状态，仅盖章
---

不是新功能，是整理已上线两年内的两个工具（`website_lead_events`/`discovery_leads` 相关代码）的重复实现。范围与验收条件由统筹窗口按子牙+魏征定的六条执行，逐条对照：

1. **访客识别**（`visitor.ts`）、**请求体大小限制**（`readSmallJson`/`boundedBody`）、**原子计数**（`consumeQuota`）三处重复代码收成一处：`src/lib/tools-lab/visitor.ts`（按 tool 参数区分命名空间，网站诊断原有的哈希值逐一验证过不变）、`src/lib/http/bounded-body.ts`、`src/lib/zhangqian/rate-limiter.ts`（新导出 `consumeQuotaBucket`，两种失败策略——网站诊断失败关闭、旧的公开扫描工具失败开放走旧逻辑——各自保留，不强改成一种）。`git grep` 逐项核对，每样都只剩一处定义。
2. **留资记录**收成一处：`recordToolSignupOnce`（仅广告体检）泛化成 `recordToolLead`（两个工具共用），新增下游消费者 `src/lib/pm-todo/tool-lead-items.ts`——`website_lead_events` 这张表以前写完从没人读过，现在会作为「需要你动手」的一条待办出现。报告生成逻辑本身不抽（按验收条件②明确交代，留在各自实现里）。
3. **跨工具全站每月花费上限**：`src/lib/tools-lab/spend-cap.ts`，新桶 `tools_ai_calls_month`，网站诊断和广告体检赞助分析共用；网站诊断自己的 1500 次/月不受影响，广告体检赞助分析以前只有单客户上限（$1.25–25/月）、没有全站合计上限，现在加了一道 2000 次/月的合计封顶（约多留 500 次给广告体检那边，worst case 约 $60–125/月）。**这是一道计数上限，不是实时美元加总**——现有的原子计数函数只能 +1，做美元加总要新的数据库函数（属于迁移，按规矩算 A 级，不在本次范围）。**`#2128`（另外关掉两个无关的无鉴权计费接口）没合并前，不能说「所有会花钱的接口都封顶了」**——本次只封了这两个工具。**魏征复审发现**：自助客户激活时 `sponsored_analysis_enabled` 默认就是 true（不是一小撮特批客户），这道共用桶被广告体检那边吃满、连累网站诊断访客被一起挡下的风险比设计时以为的更真实——已加 `src/lib/pm-todo/tools-wide-budget-items.ts`，用到 80% 就下发今日待办提醒，PM 能在真正撞上限之前看到，不用等访客反馈才发现。
4. **不做连接抽象层**：Meta 只读连接逻辑原样留在原地，等出现第二个真正的只读连接场景再抽（按验收条件④明确决定不做）。
5. **走 Inngest 留回执**：留资捕获（`tools_lab/lead.captured`）与网站诊断报告邮件发送尝试（`tools_lab/report_email.attempted`）各发一次事件，新函数 `src/lib/inngest/functions/tools-lab-lead-followup.ts` 各留一条回执。**报告邮件本身仍然同步发送、同步告诉访客成没成功**——不能为了"上 Inngest"把这一步改成异步，那样访客会带着假的"已发出"感觉离开。**留资没有进 CRM `contacts` 表**：读过 CRM 代码后发现那张表按客户分租户，是"客户自己的客人"，不是"Magic Engine 自己的潜在客户"的地方，硬塞进去要么瞎编一个客户 ID 要么语义不对；现阶段"今日待办"就是唯一确实有人会看的地方。这属于产品决策（要不要给 ME 自己建一套潜在客户 CRM），不在本次范围。
6. 本次合并本身就是"≥2 工具在用共用层"的证据（网站诊断 + 广告体检两个已上线工具）。

**验证（2026-09-28，两轮，数字取最后一轮实跑）**：`npx vitest run`（相关 11 个目录，退出码 0，155 个文件里 151 个通过、2369 条用例里 2362 条通过，7 条失败是已知无关基线——`page-posts.test.ts` ×3、`daily-plan-post-story-resolve.test.ts`、`post-measurement-contract.test.ts`、`public-copy.test.ts` ×2，`git stash` 核对过改动前同样失败）；`npx tsc --noEmit`（20 条基线错误，本次改动文件 0 条新增）；`npx eslint`（worktree 插件冲突用 `root:true` 同内容配置绕过，退出码 0）；故意改坏 22 处关键判断——访客命名空间隔离 ×2、请求体上限 ×3、限流失败关闭 ×2、guards 重导出、留资去重键 ×2、留资邮箱落库、留资失败不发事件、全站封顶 ×2、赞助分析全站封顶 ×2、自助开通计数条件、留资待办路由分支、留资 dedupeKey 被 extraMetadata 覆盖、限流 RPC 返回畸形数据时的失败策略——全部被对应名字的测试抓住。

**子牙+魏征第一轮复审**：均无 BLOCKER。子牙 3 条 SHOULD（共用桶未分区风险、留资字段合并顺序风险、`analysis.ts` 新增对 site-check 私有模块的反向依赖）已修；魏征 3 条 SHOULD（限流 RPC「成功但返回畸形数据」这一边界情况的失败策略被centralise时悄悄改了、共用桶换算前提比实际更脆弱——自助客户默认就开赞助分析、台账卡验证数字与实跑不一致）已修，另指出一处工作区脏状态（本会话中断留下的半成品，已在本轮补全并提交）。

**写入者**：本会话自写（未走 DeepSeek）——属 CLAUDE.md §5 例外①，需要同时理解多个文件（两个已上线工具的既有实现）才能正确合并，不是机械改写。

**合并状态**：子牙+魏征第一轮已过（均无 BLOCKER，SHOULD 已修完）；按 CLAUDE.md §4「大任务」判据合并前保持草稿，等 PM 确认后合并（B 级，不需要板桥/狄仁杰那套 A 级三方审）。
