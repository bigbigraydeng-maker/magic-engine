# Magic Engine — Codex Agent 参考手册

> 本文件专为 Codex 设计，作为任务上下文注入。  
> 简洁、机器友好、无废话。每次给 Codex 派活时，将本文件作为上下文。

---

## 系统定位

Magic Engine 是 AU/NZ 营销执行平台（Next.js 14 + Supabase + Render）。
Codex 负责**精准修复/补测试/死代码清理**，不做架构决策。

---

## 10 个 Agent 速查表

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
| 达芬奇 | `src/lib/davinci/` | PM：挑战设计方案（只读，无执行权）|
| 魏征 | `src/lib/weicheng/` | 代码检查：CI关卡 + LLM审查 |

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

子牙给 Codex 派活时，任务 prompt 必须包含：

```
文件：[绝对路径 + 行号范围]
任务：[具体改什么]
验证：npx vitest run [测试文件路径]
预期：[测试数量] 个测试通过
Build：npm run build 必须通过
禁止动：[不能碰的文件列表]
交付：commit hash + 测试输出截图
```

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
| Publer | Publishing Hub |
