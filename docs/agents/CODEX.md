# Magic Engine — Codex Agent 参考手册

> 项目协作唯一入口：根目录 [CLAUDE.md 的 AI 协作流程](../../CLAUDE.md#ai-协作流程全项目共用)。本文件保留 Codex 技术参考和已采用 GitHub 流程时的补充要求，按需读取，不反复整份注入聊天。

---

## 系统定位

Magic Engine 是 AU/NZ 营销执行平台（Next.js 14 + Supabase + Render）。
Codex 按任务说明承担规划、实现或审查；与 Claude Code、CMUX DeepSeek 的写入分工遵循根指引 §5，用户可直接派活。

---

## 9 个 Agent 速查表

| Agent | 代码位置 | 职责一句话 |
|-------|---------|-----------|
| 子牙 | `src/lib/ziya/` | 技术大脑：架构/安全/后台统筹（Claude Opus）|
| 诸葛亮 | `src/lib/zhuge/` | 业务大脑：客户策略/FDE工作台（Claude Sonnet）|
| 张骞 | `src/lib/zhangqian/` | 侦察：采集站点/关键词/AI可见度证据 |
| 孙子 | `src/lib/seo-agent/` | SEO编排：把 Goal/Brief/关键词信号变成本周 SEO 优先级 |
| 华佗 | `src/lib/huatuo/` | 诊断：6维度评分（0–100）|
| 鲁班 | `src/lib/luban/` | 执行：flywheel adapter + 落数据 |
| 马良 | `src/lib/visual/` | 视觉学习：图片/视频质量 + 平台研究 |
| 李白 | `src/lib/blog/` + `src/lib/geo/` | 文案质量 + 全系统提示词管理 |
| 魏征 | `src/lib/weicheng/` | 代码检查：CI关卡 + LLM审查 |

> 达芬奇已撤（PM 2026-09-24 拍板）：其"方案挑战"审查清单并入子牙自审，见 [`10-ziya.md`](./10-ziya.md) §四b；不再作为独立 agent 调度，见 [`80-davinci.md`](./80-davinci.md)。

---

## 强制约束（违反 = 魏征拒绝 merge）

```typescript
// ❌ 禁止
const any_var: any = ...
const client = new Anthropic()           // 模块级初始化
import { OpenAI } from 'openai'          // 模块级变量

// ✅ 正确
function handler() {
  const client = new Anthropic()         // handler 内部初始化
}
```

- TypeScript strict mode，无 `any`
- 文件 < 800 行，函数 < 50 行
- SDK client 必须在 handler/function 内初始化
- UI 文案禁止出现：OpenAI / Anthropic / WaveSpeed / Seedance / SEMrush（用封装名）
- Commit message 格式：`feat(module): desc [PXX.Y]`

### 风险分级质量闸（开工前必做）

先读 [`docs/ENGINEERING_QUALITY_GATES.md`](../ENGINEERING_QUALITY_GATES.md)，声明 A / B / C 级后再编码：

- **A 级**：安全、隔离、Kernel、migration、资金、外部发布等高风险边界；需要强测试、真实边界证据和关键 mutation；
- **B 级**：普通业务逻辑/API/报表；核心单测、1–2 条集成、type/lint/build、一次集中 review；
- **C 级**：UI/文案/原型；smoke/截图/build，保持快速。

Codex 必须检查：风险有没有被故意降级、实现是否超过当前调用方的最小契约、非 blocker 是否被错误升级成新修补轮次。完整 mutation 默认只用于 A 级，并且只在冻结 head 上跑一次。Review 按 [#964](https://github.com/bigbigraydeng-maker/magic-engine/issues/964) 收敛，机器人新 finding 不等于继续修改授权。

---

## Memory Layer 接口（Phase 23）

```typescript
// 所有 agent 读 memory 的标准方式
import { loadMemoryForClient, formatMemoryForPrompt } from '@/lib/memory'

const memory = await loadMemoryForClient(supabase, clientId, {
  flywheel?: 'seo' | 'geo' | 'ads' | 'social',
  maxRecentDecisions?: number,   // 默认 5
  minConfidence?: number,        // 默认 0.6
})

const memoryBlock = formatMemoryForPrompt(memory, {
  includePreferences: true,
  includeProvenPatterns: true,
  includeFailedExperiments: true,
  includeRecentDecisions: true,   // 只有诸葛亮需要 true
})
```

**写权限矩阵（严格）：**
- `client_decision_history`：只有诸葛亮（conductor）写
- 其余三张表：只有 23.B FDE 标注 API + 23.C 自动抽取器写
- 张骞/华佗/鲁班/马良/李白：禁止写 Memory

---

## 飞轮落数据（鲁班执行后必须写）

```typescript
import { getAdapter } from '@/lib/flywheel/adapters/registry'

const adapter = getAdapter(flywheel)  // 'seo' | 'geo' | 'ads' | 'social'
const action = await adapter.execute({
  client_id,
  flywheel,
  action_type,     // 来自 vocabulary.ts 词表，不能自创
  execution_mode,  // 'in_house' | 'third_party' | 'external_manual'
  expected_metric,
  expected_delta,
})
```

---

## 常用文件位置

```
src/lib/memory/          → Phase 23 记忆层（读写接口）
src/lib/flywheel/        → 飞轮数据模型（adapters/vocabulary/attribution）
src/lib/anthropic/       → Claude 统一入口（callClaudeChat / callClaudeWithDocs）
src/lib/zhuge/types.ts   → ZhugeInput / PriorityAction 类型定义
src/types/               → 全局类型（Client / DiagnosticDimension 等）
supabase/migrations/     → 数据库变更历史
docs/agents/             → 所有 agent 手册（本目录）
```

---

## Codex 任务标准格式

使用根 [CLAUDE.md](../../CLAUDE.md) 内嵌的短任务说明，不另建一份 Codex 合同。代理自行核实文件路径、调用方及真实验证命令；交付未提交的 diff 时如实报告，不为凑 commit hash 或测试数量擅自提交或虚报。

---

## GitHub Task Contract Protocol（已采用 Issue / PR 的工程任务）

历史协议见 GitHub Issue **#1100**：`[Build Control Governance] GitHub Task Contract Protocol — Issue = Contract, PR = Implementation`。

### 1. 长工程任务使用单一权威说明

对已有 GitHub 合同且获准使用该流程的工程任务，将根指引的短任务说明集中维护在 Issue 当前 BUILD CONTROL 说明中；正文和旧评论作背景，不维护重复合同：

1. **Issue = Task Contract / Work Package Contract**
2. **Issue 当前 `BUILD CONTROL — ...` 说明 = 已确认范围；用户最新明确要求变化时同步更新，不以旧评论抵消新要求**
3. **PR = Implementation Artifact / 实际 diff 与验证证据**
4. **PR review threads = 实现 finding 与修复记录**
5. Chat 只负责启动、澄清、PO 决策，不再作为长期工程合同

没有 Issue 时先使用已有任务文档或当前会话的短说明，不因协议自动新建 Issue、Codex Project、独立 task、repo 或 worktree，也不阻塞已获授权的小任务。跨会话按根指引保存短检查点，不堆长聊天历史。

### 2. Codex 给另一个窗口/Claude 的交接输出

不要输出整份长提示词。默认只输出：

```text
Issue: #XXXX
建议窗口名：<name>

启动词：
你负责 Magic Engine Issue #XXXX。
开工前：
1. 按 CLAUDE.md §6 只读核实仓库/分支/HEAD/工作区，记录远端是否刷新
2. 读取 AGENTS.md 指向的 CLAUDE.md，按需读 docs/agents/CODEX.md
3. 读取 Issue #XXXX 当前任务说明与最新检查点，按需查阅旧评论
4. 核对用户最新明确要求、授权边界和唯一写入者

沿用指定工作区，按文件分配唯一写入者。
不扩大 scope。
完成后按任务授权交付本地 diff 或 Draft PR；远端汇报也须在授权内。
```

除非用户明确要求“把完整提示词贴出来”，否则不要再把 Issue 正文复制回聊天。

### 3. 每个 Codex 窗口的标准回报格式

每次阶段性或最终工程回报都按下面顺序，避免不同窗口各说各话：

```text
repository / branch / HEAD: <path / branch / full sha>
remote fetched at: <timestamp / 本次未刷新> · origin/main SHA: <本地快照 full sha / 不存在>
working tree: <已有改动 / 本次未提交 diff 标识>

## Scope / Contract
- 权威任务说明：Issue #XXXX / 文档路径 / 本会话任务说明
- 当前 BUILD CONTROL 决议：...
- branch / worktree / PR: ...

## 结论
- GO / PATCH REQUIRED / DEFER / STOP / READY FOR REVIEW

## 木桶自审
- 本次解锁哪条完整闭环或哪一段
- 当前最短板是什么
- 本组件做到什么程度已经够用
- 为避免局部过度开发主动推迟了什么

## Exact changes
- 精确 changed files
- 没改什么（关键 non-goals）

## Verification
- targeted tests
- architecture / mutation（按风险级别）
- type-check
- build
- git diff --check
- 每条检查附命令、目录、时间、SHA/diff、退出码和输出摘要；未运行/阻塞单列
- baseline failure 如有，明确同环境同命令的 pre-existing 证据；无证据写归因未确认

## Reuse Statement
- reused what
- new truly reusable capability
- industry-specific?
- client-specific?
- deliberately not generalized?
- production write?

## Next gate
- 下一步只写 Build Control 需要决策的一个 gate；不得自动开下一项施工
```

必须报告可核验的 repository SHA；无法读取或无提交时如实标记限制。不得借用另一分支/提交的验证结果。

### 4. Issue / PR 分工

**Issue 负责 WHY / WHAT / BOUNDARY：**
- 为什么现在做
- 当前最短板
- scope / non-goals
- runtime facts
- safety / authorization boundary
- acceptance / STOP conditions

**PR 负责 WHAT ACTUALLY CHANGED：**
- exact changed files
- implementation notes
- tests / type-check / build / diff-check
- review findings
- Reuse Statement
- production-write statement
- head/base SHA

PR 描述不得重新发明第二套架构 spec。

### 5. 一窗口纪律

按根指引 §5–6 执行：**每项代码变更一个写入者，复用一份任务说明**。已批准的并行工程隔离可继续使用既有 worktree；不把新建工作区作为只读审查或小任务的前置条件。

发现新的真实 blocker 但不在 Issue scope：

```text
DEFER — <real blocker>
```

在权威说明记为后续事项；仅阻塞受影响步骤，继续不受影响的已授权工作。确与验收冲突时只向用户提出一个必要问题，不顺手解决或把第二个 WP 塞进同一 PR。

### 6. 木桶原则

每个 Codex 窗口必须优先回答：

1. 当前阻止最小真实闭环跑通的最短板是什么？
2. 本次改动是否直接补强最短板或紧邻下一环？
3. 当前组件是否已满足本轮最小验收？满足就立即停止。
4. 上游还提供不了、下游还消费不了、Measurement 还验证不了的精度，不提前建设。

原则：**先跑通窄闭环，再逐段加深；只抬最短板，不继续加高最长板。**

例外：安全、授权、法律合规、数据完整性、成本硬顶、幂等和失败恢复是结构板，不能用“避免过度开发”跳过。

### 7. 默认生产红线

除非用户明确授权，且适用的 Build Control / 合并审批已满足：

- NO merge
- NO deploy
- NO migration apply
- NO production write
- NO provider write
- NO secret changes
- NO irreversible operation

有提交/推送/开 PR 授权时停在 Draft PR；否则停在已验证的本地 diff，不因本协议自动提交或推送。

---

## 封装名对照（UI 层必须用封装名）

| 真实服务 | 封装名 |
|---------|--------|
| OpenAI GPT-4o-mini | Content Engine |
| Anthropic Claude Sonnet | Strategy Engine |
| WaveSpeed / Atlas | Visual Studio |
| Seedance | Video Studio |
| HeyGen | Avatar Studio |
| SEMrush | Keyword Intelligence |
| Jina.ai | Site Analyzer |
| Airtable | Content Workspace |
| Publer | Publishing Hub（Publer 已于 2026-10 删除） |
