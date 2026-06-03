# Magic Engine — Agent 总架构

> 最后更新：2026-06-03  
> 权威来源：`src/lib/{ziya,zhangqian,huatuo,zhuge,luban,visual,blog,geo,davinci,weicheng,memory}/`  
> 本文件管**规则**；各 agent 的行为细节见同目录的单独文件。

---

## 一、总体结构

```
子牙 (Claude Opus)                    诸葛亮 (Claude Sonnet)
技术大脑                               业务大脑
src/lib/ziya/ [待建]                   src/lib/zhuge/
─────────────────────                 ─────────────────────
系统架构决策                           客户策略统筹
安全审查                               FDE 工作台
后台开发统筹                           客户业绩增长
cron / 批量 / 基础设施                 随时被 FDE / 客户调用
问：系统健不健康？                     问：客户下一步做什么？
        ↓                                      ↓
        └──────────────┬────────────────────────┘
                       ↓ 按任务路由
          ┌────────────┼──────────────────────────┐
       执行类         质量类                   工具类
  张骞/华佗/鲁班    马良/李白                达芬奇/魏征
```

**并联，不串联**：子牙和诸葛亮是两个独立入口，各自可调度下方 7 个工作 agent。

---

## 二、9 Agent 职责表

| Agent | 模型 | 职责 | 代码 | 状态 |
|-------|------|------|------|------|
| **子牙** | Claude Opus | 技术大脑：架构/安全/后台统筹 | `src/lib/ziya/` | 待建 |
| **诸葛亮** | Claude Sonnet | 业务大脑：客户策略/FDE工作台 | `src/lib/zhuge/` | ✅ |
| **张骞** | Claude Sonnet | 侦察：采集站点/关键词/AI可见度 | `src/lib/zhangqian/` | ✅ |
| **华佗** | Claude Sonnet | 诊断：6维度评分（0–100）| `src/lib/huatuo/` | ✅ |
| **鲁班** | Sonnet/4o-mini | 执行：flywheel adapter + 落数据 | `src/lib/luban/` | ✅ |
| **马良** | GPT-4o vision | 视觉学习：图片/视频质量 + 平台研究 | `src/lib/visual/` | 待扩展 |
| **李白** | Claude Sonnet | 文案质量 + 全系统提示词管理 | `src/lib/blog/` + `src/lib/geo/` | 待扩展 |
| **达芬奇** | Claude Opus | PM：挑战设计方案（只读，无执行权）| `src/lib/davinci/` | 待建 |
| **魏征** | Sonnet + CI | 代码检查：关卡 + LLM审查 | `src/lib/weicheng/` | 待建 |

### 垂直专项子模块（非独立 agent）

| 模块 | 代码 | 调用方 | 说明 |
|------|------|--------|------|
| SEO decision layer | `src/lib/seo-agent/` | 诸葛亮 | Codex 已建。读 Goal/Brief/关键词信号 → 输出 SeoOpportunity[]，不做内容生成 |
| GEO specialist | 待建 | 诸葛亮 | Phase 21/22 就绪后与 SEO/Ads 一起设计 |
| Ads specialist | 待建 | 诸葛亮 | 同上 |

---

## 三、诊断执行链（张骞→华佗→诸葛亮→鲁班）

```
子牙/诸葛亮 触发
      ↓
张骞 采集 → DiscoveryReport
      ↓
华佗 诊断 → DiagnosticFinding[] + DiagnosticScores
      ↓
诸葛亮 决策（可调 seo-agent 子模块）→ PriorityAction[]
      ↓
鲁班 执行 → flywheel_actions（必须落数据）
```

链内顺序不可跳过、不可逆向。

---

## 四、Handoff Schema

```typescript
// 链内数据流（权威类型见 src/lib/zhuge/types.ts）
DiscoveryReport        张骞 → 华佗
DiagnosticFinding[]    华佗 → 诸葛亮
PriorityAction[]       诸葛亮 → 鲁班
SeoAgentOutput         seo-agent → 诸葛亮（子模块）

ZhugeInput = {
  client: Client
  discoveryReport: DiscoveryReport
  diagnosticScores: DiagnosticScores
  findings: DiagnosticFinding[]
  businessContext: BusinessContext
  availableLubanTools: LubanTool[]
  memory?: MemoryContext          // Phase 23，子牙统一加载后透传
}
```

---

## 五、Phase 23 — Cross-Agent Memory Layer

### 5.1 四张表

| 表名 | 存什么 | 写入者 |
|------|--------|--------|
| `client_learned_preferences` | 客户内容偏好 | 23.B FDE标注 + 23.C 自动抽取 |
| `client_proven_patterns` | 已验证获胜模式 | 同上 |
| `client_failed_experiments` | 已知失败实验 | 同上 |
| `client_decision_history` | 诸葛亮决策记录 + outcome 回填 | 诸葛亮写，23.C 回填 |

### 5.2 读写接口（统一从 `src/lib/memory/index.ts` 导出）

```typescript
loadMemoryForClient(supabase, clientId, options?) → Promise<MemoryContext>
formatMemoryForPrompt(memory, options?) → string
saveProvenPattern / savePreference / saveFailedExperiment / saveDecisionHistory
```

### 5.3 各 Agent 注入规则

| Agent | 注入选项 |
|-------|---------|
| 子牙 | `preferences` + `recent_decisions`（路由参考）|
| 诸葛亮 | **全部四类**（默认全开）|
| 张骞 / 华佗 | `preferences` + `failed_experiments`（`includeRecentDecisions: false`）|
| 鲁班 | `preferences` + `proven_patterns`（`includeRecentDecisions: false, includeFailedExperiments: false`）|
| 马良 | `proven_patterns`（`flywheel: 'social'`）|
| 李白 | `preferences` + `proven_patterns`（`flywheel: 'seo'` 或 `'geo'`）|

### 5.4 写入权限（严格）

```
写 client_decision_history：  诸葛亮只读
写其余三张表：                  23.B FDE 手动标注 API + 23.C 自动抽取器
禁止写：                       子牙、张骞、华佗、鲁班（只读）
马良可写：                     client_proven_patterns（flywheel=social）
李白可写：                     client_learned_preferences + client_proven_patterns（flywheel=seo/geo）
```

---

## 六、飞轮数据模型（Phase 12.A）

```
flywheel_actions   ← 鲁班执行时写入
flywheel_metrics   ← adapter.pullMetrics() 定时写入
flywheel_outcomes  ← 归因 job 产出 → Phase 23.C 抽取 → Memory
```

4 飞轮：`seo` / `geo` / `ads` / `social`  
3 执行形态：`in_house` / `third_party` / `external_manual`  
词表：`src/lib/flywheel/vocabulary.ts`（action_type / metric_key 必须先注册）

详细：`docs/flywheel-architecture.md`

---

## 七、子牙混合路由规则

```
Step 1 — 规则匹配（0 LLM 成本）
  "诊断"         → 张骞→华佗→诸葛亮→鲁班
  "内容生产"     → AI Factory + 鲁班
  "数据采集"     → Data Engine adapter
  "Fix 执行"     → 诸葛亮 confirm → 鲁班 execute
  "代码审查"     → 魏征
  "方案挑战"     → 达芬奇

Step 2 — LLM 兜底（Opus，仅规则未匹配时）
  推理意图 → 选最近规则分支 → 记录日志（供归纳新规则）
```

---

## 八、Plugin 访问权限矩阵

| Agent | 可用 Plugin | 权限 |
|-------|------------|------|
| 子牙 | Supabase / Cloudflare / GitHub | 读写 |
| 诸葛亮 | Meta Ads / SEMrush / GA4 / Airtable / Publer / 所有 ME API | 读写 |
| 张骞 | Jina.ai / SEMrush / DataForSEO / AI Tracker | 只读 |
| 华佗 | Supabase（内部数据）| 只读 |
| 鲁班 | Publer / Meta Ads / Google Ads / Airtable / Atlas / Seedance | 读写 |
| 马良 | Higgsfield AI / Seedance / WaveSpeed / Meta Insights / TikTok Insights | 只读+写 Memory |
| 李白 | SEMrush / DataForSEO / Jina.ai | 只读+写 Memory |
| 达芬奇 | 所有文档（只读）| **无写权限** |
| 魏征 | Bash/shell / 代码仓库 | 读写（仅代码层）|

---

## 九、统一约束

- **SDK 初始化**：Anthropic/OpenAI client 必须在 handler 内部初始化，不允许模块级
- **封装名**：UI 层禁止出现真实供应商名（见 CLAUDE.md）
- **达芬奇触发场景**（强制）：新 Phase 规格完成 / 新 agent 手册完成 / schema 变更前 / 重大重构前
- **魏征通过**（强制）：每次 PR merge 前，Codex 产出代码必须经过两层

### 通用停手条件

任何 agent 遇到以下情况必须停，不自行决策：
- 付费变更（Stripe / API 额度）
- 数据库 schema 变更
- 第三方 OAuth 授权变更
- `reputation` / `competitor` 维度执行（FDE-only）

---

## 十、目录

```
docs/agents/
├── 00-architecture.md   ← 本文件
├── 10-ziya.md           ← 子牙手册
├── 20-zhuge.md          ← 诸葛亮
├── 30-zhangqian.md      ← 张骞
├── 40-huatuo.md         ← 华佗
├── 50-luban.md          ← 鲁班
├── 60-maliang.md        ← 马良
├── 70-libai.md          ← 李白
├── 80-davinci.md        ← 达芬奇
├── 90-weicheng.md       ← 魏征
├── CODEX.md             ← Codex 专用入口
└── prompt-library/      ← 李白管理的提示词库
```

---

## 十一、Scale-up 检查清单

加新 agent 或扩展功能时必须确认：

- [ ] 达芬奇已审查（有 BLOCKER 禁止继续）
- [ ] 子牙路由表已更新（新任务类型加入规则路由）
- [ ] Handoff schema 使用现有 types，不重复定义
- [ ] Memory 注入规则遵守权限矩阵
- [ ] 飞轮词表（`vocabulary.ts`）和 `execution-target.ts` 已更新
- [ ] UI 层使用封装名
- [ ] 魏征两层均已通过
