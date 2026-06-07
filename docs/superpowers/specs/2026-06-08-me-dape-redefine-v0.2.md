# ME DAPE 核心引擎重定义 · v0.2

> **状态**: 飞毛腿延续 · 5-agent live 复审中
> **作者**: PM × 子牙 × 板桥 × 魏征 × 狄仁杰 × 诸葛亮
> **日期**: 2026-06-08
> **前身**: brainstorm-notes v0.1 (子牙独裁，已废)
> **复审治理**: 本文档每节子牙起草 → 4 agent 当场过 → 修订 → 下一节 (CLAUDE.md "大任务 ≥ 2 审")

---

## §0 治理纪律（最优先）

本 spec 是 ME 治理示范。任何 DAPE 改造的 PR 必须遵守:

1. **大任务 ≥ 2 审**: 子牙 + (魏征 / 板桥 / 狄仁杰) 至少 2 个
2. **面向 C 端**: 板桥必须参与
3. **触碰安全/隔离**: 狄仁杰必须参与
4. **agent prompt 改动**: 诸葛亮必须参与 (它就是 ME 后台 agent)
5. **任何重大判断前**: grep 项目 memory + grep 现有代码（板桥铁律 v1.1）

PM 验证标准: spec 每节末尾必须有 4 agent 签字（或反对意见）。

---

## §1 现状真相（不修饰版）

### 1.1 ME 已有资产 — DB 层

**24 张表已存在**:

| 类别 | 表 | 注 |
|---|---|---|
| GIMPT 核心 5 表 | goals / initiatives / campaign_briefs / marketing_plans / execution_items | 业务流核心 |
| 诊断/处方 4 表 | diagnostic_runs / diagnostic_findings / diagnostic_narratives / prescriptions | A + P 段已有数据 |
| 行业 memory 5 表 | industry_benchmarks / industry_brand_canonical / industry_ai_visibility_questions / industry_ai_visibility_runs / industry_ai_visibility_snapshots | Phase 30 产物 |
| 全局 baseline 4 表 | market_baseline / baseline_domains / baseline_domain_score_history / baseline_cron_runs | 全局基准 |
| 客户级 memory 2 表 | client_learned_preferences / feedback_data | Phase 23 产物 |
| outcome 回流 4 表 | flywheel_actions / flywheel_metrics / flywheel_outcomes / prescription_outcomes / zhuge_feedback_events | 学习闭环 |

### 1.2 ME 后台 AI agent 实际读 memory 的真相 ⚠️

子牙 grep 验证 (2026-06-08 强制查):

| Agent | 客户级 memory<br>(client_learned_preferences) | 行业级<br>(industry_benchmarks) | 全局<br>(market_baseline) | feedback 学习<br>(zhuge_feedback_events) |
|---|---|---|---|---|
| **huatuo** (诊断/处方) | ❌ 不读 | ✅ 读 (benchmarks.ts) | ❌ 不读 | ❌ 不读 |
| **zhuge** (执行编排) | ❌ 不读 | ❌ 不读 | ❌ 不读 | ❌ 不读 |
| **memory service** | ✅ 读 (extractor.ts) | — | — | — |

**真相**: client_learned_preferences / zhuge_feedback_events 表存在，但**没有 agent 真用**。Memory 学了等于没学。

### 1.3 引出的结论

**子牙之前 v0.1 议题 3 写"memory 已通底层" = 半假**：
- ✅ DB 表完整
- ❌ agent prompt 不读 = AI 学习闭环断
- ✅ memory service 有 API
- ❌ huatuo / zhuge 不调 service = API 空转

→ DAPE 议题 3 不是 0 成本，**真实工作量 = "改 huatuo/zhuge prompt + 调 memory service"**。

---

### 🗣️ 5-agent 第 1 节复审

**魏征**: ✅ 同意第 1 节，挑刺达到目的。补一条 — "memory service API 跑过 N 次 ≠ memory 真被 agent 用"。spec 必须区分这两层。
→ 子牙修订: §1.2 改为同时记 "service 跑过 N 次" 跟 "agent 调 service N 次"，下次跑 metrics 验证。

**板桥**: ✅ 同意，加一条客户视角 — "客户付费 6 月，AI 还没学他的偏好"是商业违约风险。CTS 付费第 1 月期间 zhuge_feedback_events 表已经有数据，但下个月 zhuge 还是不会读。**这条必须在 spec 第 1 段就告诉 PM**，不能埋在工程细节里。
→ 子牙修订: 在 §1.3 加 "**商业风险**: 客户付费购买的 AI 学习能力当前未交付"，作为 P0 警示。

**狄仁杰**: ✅ 同意，**这条是飞毛腿到现在最有价值的一击**。比 BUG-FMT-CORE-1 还致命。要求 §1 末尾加 "现状真相 5 个判断" 让 PM 直接拍。

**诸葛亮**: 自己作为 zhuge agent，**承认** §1.2 真相 — "我是不读 memory 的"。但提一个细节 — `src/lib/zhuge/proactive.ts` 有读 `client_learned_preferences` 的代码痕迹但被注释掉了。这意味着**已有人想做但没做完**。
→ 子牙待办: 下个 session 验证此痕迹，补到 §1.2。

### 1.4 现状真相 5 个判断（PM 拍）

1. **DB 层完整** — 24 张表已有 ✅
2. **AI 学习闭环断** — 主流 agent (huatuo / zhuge) 不读核心 memory ❌
3. **memory service 有 API 但空转** — 没人调 ⚠️
4. **客户付费购买的能力未交付** — 商业风险 🔴
5. **DAPE 改造 ≠ 重做 = "接通已有 memory 到 agent prompt"** ✅

PM 拍 1-5 → 进 §1.5。

---

### 1.5 双轨业务模式（PM 强约束 · DAPE 必须保留两轨）

**PM 原话**:
> "普通客户进 ME 输入域名跳后台, 自己点配置数据源, 自己用分析/处方/execution, 全程耗 Magic Token。
> FDE 客户跟我们坐下来对话, 我们后台配 goal/initiative/campaign/marketing plan 等等执行, 也扣 Magic Token, 客户月付 token 已充足。
> **这个业务逻辑不能打翻**。"

#### 1.5.1 双轨定义

| 维度 | 自助客户 (Self-Serve) | FDE 客户 (Monthly Paid) |
|---|---|---|
| 入口 | `/portal/register` 域名注册 | ME 团队对话签约 (非 self-register) |
| 谁操作 | 客户自己 | PM/FDE 代操作 |
| 配置 | 自助 wizard (4 connectors 点开就连) | 后台对话深度定制 (Goal/Initiative/Campaign/Plan) |
| 使用 | 客户自助 Analysis / Prescription / Execution | FDE 在 Kanban 执行 + 客户看仪表板 |
| Token | 全程消耗 MTC, 客户充值 | 全程消耗 MTC, 月付套餐 token 充足 |
| client_portal_users.access_type | `self_serve` | `both` / `paid_client` |
| 当前 ME 实现 | ✅ 已落地 (p0-fixes #384-#407) | ✅ 已落地 (CTS / Oztop / PM bigbigraydeng@gmail.com) |

#### 1.5.2 DAPE 4 段在双轨下的差异（不打翻业务）

| 段 | 自助客户 | FDE 客户 |
|---|---|---|
| **D Discovery** | 自助 wizard 4 步: 域名→连数据源→选行业→点"开始扫描"。AI 自动给 5 个发现议题 (limit per token). | FDE 后台对话定制 Discovery 输入源 (含客户 brief + KOL 监控 + 季节性). AI 跑完整 memory. |
| **A Analysis** | 一次性 6 维诊断 (扣固定 MTC). 报告自动生成, 客户自己看. | FDE 触发, 跑深度多源 (含 Apify scrapers 全开). 报告 PM/FDE 二次解读. |
| **P Prescription** | AI 一次性出处方 (扣固定 MTC). 客户自己看. 不滚动更新. | huatuo 跑完后, PM/FDE 二次对话精修. 月度/季度滚动. |
| **E Execution** | 客户自己点"生成内容" (扣 MTC/次). Kanban 客户自己看. | FDE 在 Kanban 编排. AI 自动跑 + FDE 手动. |

#### 1.5.3 DAPE 不能打翻的 5 条业务底线

1. **入口分流必须保留**: `/portal/register` (self-serve) vs FDE 签约后导入 (non-self-register), 两条入口都不能去掉
2. **MTC 扣费必须保留**: 当前 p0-fixes 8 个 API 已接通, DAPE 改造不能跳过 MTC 预检 / 扣费 / 退款逻辑
3. **客户视角层必须支持自助操作**: 自助客户**就是自己的 FDE**, 客户视角不能只读, 必须含 Analysis/Prescription/Execution 入口
4. **FDE 视角层不能向自助客户暴露**: 自助客户**看不到** PM 后台对话定制功能, 只看到自助 wizard
5. **Token 套餐机制不变**: `mtc_purchases` + `client_portal_users.access_type` schema 不动, DAPE 在它之上加 UI/UX 分流

#### 1.5.4 引出的修订 — 子牙之前 v0.1 议题 5 三视角分层有问题

| v0.1 错误 | v0.2 修订 |
|---|---|
| "客户视角只看 4 层 (诊断/处方/执行/Outcome), Campaign/Plan/Kanban 隐藏" | ❌ 不对自助客户 — 自助客户必须能用 Kanban (他们就是自己的 FDE) |
| "FDE 视角 5-7 层切片" | ✅ 对 FDE 客户的 PM/FDE 视角 |
| 没区分两轨 | 三视角扩成**四视角**: 自助客户 / FDE 客户老板 / FDE 内部 PM/FDE / 数据层 |

#### 1.5.5 修订后的四视角分层

```
═══════════════════════════════════════════════
视角 1 · 自助客户 (客户自己操作, 类似 Stripe 仪表板)
═══════════════════════════════════════════════
入口: /portal/register
看到: DAPE 4 段进度卡 + 自助 wizard + Kanban (简化版) + MTC 余额
能做: 一键 Analysis / 一键 Prescription / 自助点生成内容
不看到: PM 后台对话 / FDE 内部工具

═══════════════════════════════════════════════
视角 2 · FDE 客户老板 (CMO/老板看, PDF/Demo)
═══════════════════════════════════════════════
入口: 客户登录 portal (paid_client 视角)
看到: 4 段呈现 (诊断报告 PDF / 处方 PDF / 月度进度 / Outcome)
能做: 看 + 反馈 + 调整 Goal
不看到: Kanban (太细) / Campaign / Plan 工作流

═══════════════════════════════════════════════
视角 3 · FDE 内部 PM/FDE (Magic Lab 团队操作)
═══════════════════════════════════════════════
入口: admin cockpit (PM bigbigraydeng@gmail.com)
看到: 全部 DAPE + 全部 GIMPT 工具 + Kanban + Campaign + Plan
能做: 给 FDE 客户代配 Goal/Initiative/Campaign/Plan
能做: 监控所有客户 + 切换客户
不看到: 内部 DB 直填 (不应该 SOP 化数据库直填)

═══════════════════════════════════════════════
视角 4 · 数据层 (DB schema, 24 表)
═══════════════════════════════════════════════
不动现有表
唯一新加: execution_items.prescription_id (F22)
```

#### 🗣️ 5-agent §1.5 复审

**魏征**: ✅ 同意。补一刀 — **MTC 扣费 schema 是否能支撑双轨细差**? 自助客户每次"一键 Prescription"扣 N MTC, FDE 客户的 huatuo 跑可能扣 N×10 (深度多源). 当前 `mtc_purchases` 表 + 8 API 是否支持这种差异化扣费? 需 grep `src/lib/mtc/*` 确认。
→ 子牙待办: §2 撰写前先 grep MTC 扣费实现。

**板桥**: ✅✅ 同意，**这是飞毛腿到现在最值钱的一击**。子牙之前差点把自助轨打翻 (说"客户视角隐藏 Kanban"). 加客户老板视角细化 — 自助客户的"老板"就是自己, 而 FDE 客户的"老板"跟操作 FDE 是分开的。**自助轨的客户视角 = FDE 视角合一** (一人多角色), 这条要写进 §5 三视角.

**狄仁杰**: ✅ 同意。加一条**安全审计** — 自助轨跟 FDE 轨的 RLS/权限隔离: 自助客户不能误进 FDE 客户数据 (BUG-P0F-001/002/003 的 P0-J PR-1 已做止血). DAPE 改造期间任何 RLS policy 改动必须狄仁杰审。
→ 写进 §0 治理纪律加一条。

**诸葛亮**: ✅ 同意。补 — 自助客户的 AI 调用应该用**短 prompt 模式** (节省 token), FDE 客户用**长 prompt + 深度 memory** (服务成本高). huatuo / zhuge prompt 需要双模式支持。
→ 写进 §2 + §3.

#### 1.5.6 双轨业务约束 6 个判断（PM 拍）

1. **入口分流保留** — `/portal/register` + FDE 签约导入 两条都不动 ✅
2. **MTC 扣费保留** — 8 个 API + p0-fixes 沉淀全部保留 ✅
3. **自助客户视角含 Kanban** — 不再"隐藏 Kanban" ✅
4. **四视角分层** — 自助客户 / FDE 客户老板 / FDE 内部 / 数据层 ✅
5. **AI prompt 双模式** — 短模式 (自助省 token) / 长模式 (FDE 深度) ✅
6. **DAPE 之上的 UI 分流，不动 schema** — schema 完全不变 ✅

PM 拍 1-6 → 进 §2 DAPE 4 段定义.

---

## §2 DAPE 4 段定义（含独立输入源契约）

> PM 已拍 §1 + §1.5 共 11 OK · 5-agent live 复审中
> 魏征击 1 修法: 每段独立输入源契约 (防 D/A 重叠)
> 诸葛亮击 (§1.5): 短/长双模式 prompt
> §1.5 4 视角约束: 自助客户 + FDE 客户老板 + FDE 内部 + 数据层

### 2.0 预热验证 (grep 已有)

- ✅ MTC lib 完整: balance / budget-guard / charge / deduct / refund 全套已落地
- ❌ zhuge proactive 无 memory 注释痕迹 (诸葛亮 §1 判断错, 子牙校正记录)
- ✅ huatuo 读 industry_benchmarks (benchmarks.ts)
- ❌ huatuo 不读 client_learned_preferences / zhuge_feedback_events
- ❌ zhuge 完全不读任何 memory

### 2.1 D — Discovery 发现

#### 2.1.1 一句话定义

ME 主动找客户"今天/本周该关注什么"的 N 个 议题, 每个议题带置信度 + 证据.

#### 2.1.2 独立输入源契约 (魏征击 1 修法)

| 输入源 | 数据来源 | 现有 ME 实现 | 跟 A 段重叠? |
|---|---|---|---|
| 客户经营数据原始信号 | GA4 / GSC / Meta API / publer Atlas | ga4_traffic_snapshots / gsc_performance_snapshots 已有 | ❌ 不重叠 (A 用诊断指标, D 用原始信号变化) |
| 客户主动反馈 | workbench-feedback / 邮件 / 对话 | zhuge_feedback_events / feedback_data 已有 | ❌ 不重叠 (A 不读反馈) |
| 行业大事件 | KOL 动作 / 政策 / 季节 / industry_ai_visibility_runs 异常 | industry_ai_visibility_snapshots 已有 | ❌ 不重叠 (A 是单客户评分) |
| 上轮 outcome 异常 | flywheel_outcomes 不符预期的 verdict | 已有 (虽然只 2 条) | ❌ 不重叠 (A 是当前快照, D 是 outcome 回流) |

**契约**: D 段 **不消费** diagnostic_runs / diagnostic_findings / dimension_scores. 这些是 A 段产物.

#### 2.1.3 输出契约

```json
{
  "client_id": "uuid",
  "discovery_run_id": "uuid (新表? 或复用 diagnostic_runs 加 type='discovery')",
  "issues": [
    {
      "title": "string (大白话, 客户能看懂)",
      "evidence": [{ "source": "ga4|gsc|reviews|industry|outcome", "snapshot": "..." }],
      "confidence": 0.0-1.0,
      "suggested_dimension": "seo|social|ads|reputation|ai_visibility|competitor (引导 A 段优先扫)"
    }
  ],
  "generated_at": "timestamp",
  "agent_version": "string",
  "prompt_mode": "short|long (自助 vs FDE)"
}
```

#### 2.1.4 谁看 / 谁用

| 用户 | 看到 | 能做 |
|---|---|---|
| 自助客户 | 4 段进度卡顶部 1 个 banner "今天的 3 个发现" (短模式 prompt, 限 token) | 点议题 → 触发 A 段诊断 (扣 MTC) |
| FDE 客户老板 | 客户仪表板 "本月 5 个发现" + 详细议题页 | 看 + 反馈 + 跟 FDE 沟通 |
| FDE 内部 PM/FDE | admin cockpit 看所有客户 D 段议题 | 触发完整 Discovery (长模式) + 编辑议题 + 派 A 段 |

#### 2.1.5 现有 ME 改造

- ❌ 当前**没有独立 D 段模块** — 散落在 master_briefs (品牌) + AI Tracker (industry_ai_visibility) + 直觉
- ✅ 数据已有 (4 个输入源对应的表)
- ⭐ **DAPE 改造**: 新加 1 个 D 段页面 + 1 个 discovery agent prompt (短/长双模式)
- 不新加 DB 表 (复用 diagnostic_runs 加 `type` 字段, 或最多新加 1 张 discovery_issues 轻表)

#### 2.1.6 AI prompt 双模式 (诸葛亮击修法)

| 模式 | 谁用 | Prompt 长度 | Memory 调用 | 输出议题数 | MTC 扣费 |
|---|---|---|---|---|---|
| 短模式 | 自助客户 | ~500 tokens | 仅客户级 memory | 3 | 固定 5 MTC |
| 长模式 | FDE 客户 (PM/FDE 触发) | ~3000 tokens | 客户级 + 行业 + 全局 memory | 5-10 | 月付套餐内 |

---

### 2.2 A — Analysis 分析

#### 2.2.1 一句话定义

ME 拿 D 段议题 (或客户/FDE 主动触发) + 6 维数据, AI 给客户**透明评分** (公式 + 数据源 + baseline 对照).

#### 2.2.2 独立输入源契约

| 输入源 | 来源 | 现有 ME 实现 |
|---|---|---|
| D 段议题 (引导扫描方向) | discovery_issues 输出 | 上节定义, 新加 |
| 6 维 collector 数据 | GA4 / GSC / Apify scrapers / DataForSEO / Meta Ads / industry_ai_visibility_runs | 已有 (phase23 reputation 多源 / Phase 30 baseline) |
| 行业 benchmark | industry_benchmarks | 已有 (huatuo 已读 ✅) |
| 客户级历史 | 上一次 diagnostic_runs (趋势对比) | 已有 |

**契约**: A 段 **不消费** prescriptions / execution_items. 这些是 P + E 段产物.

#### 2.2.3 输出契约 (修 BUG-FMT-S14)

```json
{
  "dimension_scores": {
    "seo": { "score": 31, "formula": "string", "data_source": "string", "industry_p50": 67, "evidence": [...] },
    "ads": { "score": 31, ... },
    "competitor": { "score": null, "skipped_reason": "no collector configured" }
  },
  "findings": [{ "dimension": "...", "severity": "...", "title": "...", "evidence": [...] }],
  "narrative": "string (DAPE 改造: 复用 diagnostic_narratives 表, 当前 0 行, 跑起来)"
}
```

**关键改动**:
- ❌ 无数据 → null + 显式 skipped_reason (不再"默认满分 100")
- ✅ 每分附 formula + data_source + industry_p50 baseline
- ✅ narrative 段 LLM 生成大白话总结

#### 2.2.4 谁看 / 谁用

| 用户 | 看到 | 能做 |
|---|---|---|
| 自助客户 | 6 维卡片 + "为什么是 X 分" hover + narrative 段 | 点 finding → 触发 P 段处方 (扣 MTC) |
| FDE 客户老板 | 月度 Analysis PDF (复用 diagnostic_runs / findings + narrative + 行业对照) | 看 + 反馈 |
| FDE 内部 | admin cockpit 完整 6 维 + 多 run 趋势对比 + Apify 原始 evidence | 编辑 findings + 重跑 + 派 P 段 |

#### 2.2.5 现有 ME 改造

- ✅ 数据层完整 (diagnostic_runs / findings / narratives)
- ❌ UI 缺公式 / 数据源 / baseline 对照 (BUG-FMT-S14, 已派簇 B)
- ❌ narrative 0 行 (没 agent 写)
- ⭐ **DAPE 改造**: huatuo 加 narrative 段输出 + UI 加 hover + competitor null 修法 + 完整报告 PDF 重做 (BUG-FMT-S16)

#### 2.2.6 prompt 双模式

| 模式 | Memory 调用 | MTC 扣费 |
|---|---|---|
| 短 (自助) | 仅 industry_benchmarks | 固定 20 MTC |
| 长 (FDE) | + client_learned_preferences + zhuge_feedback_events + 跨 run 趋势 | 月付内 |

---

### 2.3 P — Prescription 处方

#### 2.3.1 一句话定义

ME 拿 A 段 findings + Goal period + budget + 客户能力, AI 出**战略地图**: 该做什么 / 不做什么 / 为什么 / 资源怎么分.

#### 2.3.2 独立输入源契约

| 输入源 | 来源 |
|---|---|
| A 段 findings | diagnostic_findings |
| Goal | goals 表 (跟 Goal 一对一, 修 v0.1 错位 BUG-FMT-F19) |
| Budget | goals.budget_amount + goals.budget_currency |
| 客户能力 | master_briefs (FDE 容量 / 内容生产能力 / 渠道账号) |
| 客户偏好 | **client_learned_preferences (huatuo 当前不读, DAPE 接通)** ⭐ |
| 历史处方 outcome | **zhuge_feedback_events / prescription_outcomes (huatuo 当前不读, DAPE 接通)** ⭐ |

**契约**: P 段 **不消费** execution_items 当前状态. P 是战略快照, E 是执行实例.

#### 2.3.3 输出契约 (修 BUG-FMT-F19/F20/F21)

```json
{
  "prescription_id": "uuid",
  "goal_id": "uuid (跟 Goal 一对一)",
  "version": 1,
  "supersedes_id": "uuid (滚动 v1/v2/v3)",
  "phases": [
    {
      "name": "string (跟 Initiative title 一致, 不再 '止血/建设/护城河')",
      "weeks": "动态 (Goal period × budget_percent), 不写死 4 周",
      "initiative_seed": { "type": "...", "posture": "...", "budget_percent": 70 },
      "actions": [...]
    }
  ],
  "self_grade": { "overall": 7.1, ... },
  "weaknesses": [...]
}
```

**关键改动**:
- ✅ 处方跟 Goal 一对一 (不再 1 处方覆盖所有 Goal)
- ✅ 版本化 (supersedes_id 滚动 v1/v2/v3, prescriptions 表已有此字段 ✅)
- ✅ phases 动态 (跟 Initiative 数量 + Goal period 对齐)
- ✅ Initiative 由处方派生 (phases[].initiative_seed), 不再 FDE 手动建

#### 2.3.4 谁看 / 谁用

| 用户 | 看到 | 能做 |
|---|---|---|
| 自助客户 | Prescription 页 (短模式生成的简化版) + "采纳建议→自动派 Kanban" 按钮 | 一键接受处方 → 自动派 Initiative + execution_items |
| FDE 客户老板 | Prescription PDF (季度战略地图, 长模式生成) | 看 + 反馈 + 跟 FDE 调整 |
| FDE 内部 | admin cockpit 完整处方页 (现有 F4 截图基本可用, 加 Goal 一对一 + 版本化) | 编辑 + 派 Initiative + 跟 huatuo 多轮对话精修 |

#### 2.3.5 现有 ME 改造

- ✅ prescriptions 表完整 (含 supersedes_id 版本字段)
- ✅ huatuo agent + prompt + self_grade 机制完善 (F4 截图 7.1 证明)
- ❌ huatuo 不读 client_learned_preferences / zhuge_feedback_events (诸葛亮击 1)
- ❌ Goal 一对一未实现
- ❌ Initiative 手动建, 非处方派生
- ⭐ **DAPE 改造**:
  1. huatuo prompt 加读 client_learned_preferences + zhuge_feedback_events
  2. prescription_create API 加 goal_id 必填
  3. Initiative 自动派生 (phases[].initiative_seed → initiatives 表 batch insert)
  4. UI 修 BUG-FMT-F19/F20/F21 (3 阶段固定 → N 阶段动态)

#### 2.3.6 prompt 双模式

| 模式 | Memory | 输出 | MTC |
|---|---|---|---|
| 短 (自助) | industry_benchmarks + master_briefs | 简化 3 phases × 5 actions | 固定 50 MTC |
| 长 (FDE) | + client_learned_preferences + zhuge_feedback_events + 跨 prescription 趋势 + 行业 Top outcome | 完整 N phases × N actions + KPI + 资源匹配 | 月付内 |

---

### 2.4 E — Execution 执行

#### 2.4.1 一句话定义

ME + FDE 把 P 段处方翻译成可做的动作, 跑掉, 回流.

#### 2.4.2 独立输入源契约

| 输入源 | 来源 |
|---|---|
| P 段 actions | prescriptions.content jsonb |
| Initiative | initiatives 表 (由 P 段派生) |
| Campaign | campaign_briefs (FDE 配 / 自助客户跳过) |
| Marketing Plan | marketing_plans (FDE 编辑 / 自助客户简化版) |
| 当前 Kanban 状态 | execution_items (含 4 status) |

**契约**: E 段 **不消费** Discovery / Analysis / Prescription 原始数据. 通过 prescription_id 反向追溯.

#### 2.4.3 输出契约 (修 BUG-FMT-F22)

```sql
ALTER TABLE execution_items ADD COLUMN prescription_id uuid REFERENCES prescriptions(id);
```

**唯一 schema 改动**. 其他全 UI/UX 层.

#### 2.4.4 谁看 / 谁用

| 用户 | 看到 | 能做 |
|---|---|---|
| 自助客户 | Kanban 简化版 (按 dimension 6 列 / 按 status 4 列切换) + "今天 AI 推荐 3 件" (短 prompt 生成) | 点卡片生成内容 (扣 MTC) + 拖卡片改 status |
| FDE 客户老板 | 月度执行进度 (完成率 / 关键 Action 列表) | 看 + 反馈 |
| FDE 内部 | 完整 Kanban (现有 87 卡片 + filter + Campaign + Plan 切片) + "AI 推荐 3 件 (长 prompt)" | 拖卡 / 派 Plan / Campaign 关联 / 触发内容生成 |

#### 2.4.5 现有 ME 改造

- ✅ Kanban 已上线 (CTS 87 卡片 + funny-goodall P33 多 filter)
- ❌ 抽屉关闭失焦 (BUG-FMT-F25-L1, 已派)
- ❌ AI 推荐 3 件未做 (F25-L2)
- ❌ Launch Hub ↔ Kanban 工作流反向 (BUG-FMT-F29, 降级 P2, 等社媒发布重做)
- ⭐ **DAPE 改造**:
  1. execution_items 加 prescription_id 字段 (1 行 migration)
  2. Kanban 加 "AI 推荐 3 件" 卡 (短/长模式 prompt)
  3. Kanban 加 prescription filter
  4. Launch Hub 不动 (PM 决定何时重做社媒发布)

#### 2.4.6 prompt 双模式

| 模式 | 推荐算法 | MTC |
|---|---|---|
| 短 (自助) | 按 deadline + dimension 平衡, 简化 LLM | 固定 5 MTC |
| 长 (FDE) | LLM 综合 client_learned_preferences + 上周 outcome + Initiative 优先级 + Goal verdict 临近度 | 月付内 |

---

### 2.5 §2 4 段全景图

```
═══════════════════════════════════════════════════════
D - Discovery
═══════════════════════════════════════════════════════
输入: GA4/GSC/Meta 原始信号 + 客户反馈 + 行业事件 + outcome 异常
输出: 议题列表 (带 confidence + evidence)
新加: 1 个 D 段页面 + 1 个 discovery agent (短/长双模)
不动表: ✅ (复用 diagnostic_runs 加 type='discovery' 或新加 1 张轻表)

═══════════════════════════════════════════════════════
A - Analysis
═══════════════════════════════════════════════════════
输入: D 议题 + 6 维 collector + industry_benchmarks + 历史趋势
输出: 6 维评分 (含 formula / data_source / baseline / narrative)
改: BUG-FMT-S14 透明 + S16 PDF + S15 filter (已派簇 B)
新加: narrative 段 LLM 生成 (复用 diagnostic_narratives 表)

═══════════════════════════════════════════════════════
P - Prescription
═══════════════════════════════════════════════════════
输入: A findings + Goal + budget + 客户能力 + client_learned_preferences + zhuge_feedback_events
输出: 处方 (跟 Goal 一对一 + 版本化 + Initiative 派生)
改: huatuo prompt 接通已有 memory + UI 修 F19/F20/F21
新加: 0 表 (已有 prescriptions.supersedes_id ✅)

═══════════════════════════════════════════════════════
E - Execution
═══════════════════════════════════════════════════════
输入: P actions + Initiative + Campaign + Plan + Kanban 状态
输出: 完成 actions + outcome 数据
改: 抽屉失焦 (F25-L1, 已派) + AI 推荐 3 件 (F25-L2) + prescription filter
新加: execution_items.prescription_id 1 个字段 (唯一 schema 改)

═══════════════════════════════════════════════════════
跨段回流
═══════════════════════════════════════════════════════
E outcome → flywheel_outcomes / prescription_outcomes 回流
→ D 段下轮议题来源 (循环)
→ huatuo / zhuge / discovery agent 学习 (memory 接通后真正学)
```

### 2.6 §2 4 个判断 (PM 拍)

1. **D 段独立输入契约清晰** — 4 输入源 + 不跟 A 重叠 ✅
2. **A 段 BUG-FMT-S14 修法对齐** — formula + data_source + baseline + narrative ✅
3. **P 段 Goal 一对一 + 版本化 + Initiative 派生** — 修 F19/F20/F21 ✅
4. **E 段唯一 schema 改 = 1 字段 (F22)** + 其他全 UI/UX ✅

PM 拍 1-4 → 进 §3 (AI Memory 3 层).

#### 🗣️ 5-agent §2 复审

**魏征**: ✅ 独立输入契约写清楚了 (击 1 解决). 补 1 刀 — **D 段输出契约说"复用 diagnostic_runs 加 type 字段, 或新加 1 张轻表"** — 这个二选一不能拖, 必须在 §3/§4 决定. 子牙: 待 §4 GIMPT 表 map 时拍.

**板桥**: ✅ 双模式 prompt 把双轨业务接住了. 补 1 条 — 自助客户的 P 段简化版"3 phases × 5 actions" 是否够? 客户期望 1 张 A4 纸的战略图, 不要 15 个 actions. 子牙: §5 实施路径加 "客户视角 mockup 验证" 时具体确定.

**狄仁杰**: ✅ schema 改动收敛到 1 字段是最大成就. 补 1 条 — **migration 执行时 CTS 87 卡片必须先 backfill prescription_id** (从 marketing_plans.initiative_id 反查 prescription_id), 否则旧数据 NULL. 子牙: §5 实施路径加 backfill SOP.

**诸葛亮**: ✅ huatuo / zhuge / discovery 三个 agent 都明确 prompt 双模式 + memory 接通. 自校正 §1 错判 (proactive 无注释痕迹). 提一刀 — discovery agent 是新 agent, 取个名字方便 ME 团队叫 (huatuo / zhuge 已有, discovery 叫什么?). 子牙: 留给 §6 (飞毛腿 Bug 按 DAPE 分桶) 时定名.

---

## §3 AI Memory 3 层（最短路径 · 接通已有）

> PM 强约束: 加速冲刺出全文, 4-agent live 复审写在节末

### 3.1 核心判断

**DAPE 不新加 memory 表**. 已有 14 张表覆盖完整, 工作量在**接通 agent prompt 到 memory service**.

### 3.2 3 层 memory 现状 + 接通方案

```
═══════════════════════════════════════════════
Layer 1 · 客户级 (per-client)
═══════════════════════════════════════════════
现有表: master_briefs / clients (primary_keywords / brand_aliases / 
         competitor_domains) / client_learned_preferences / feedback_data /
         zhuge_feedback_events
现状: ✅ 数据齐 / ❌ huatuo + zhuge 不读
接通方案:
  - huatuo agent.ts 加 memoryService.list(client_id) 调用
  - prompt 模板加 client_learned_preferences + zhuge_feedback_events 注入
  - 1-2 文件改, ≤50 行

═══════════════════════════════════════════════
Layer 2 · 行业级 (per-industry) ⭐ PM 核心护城河
═══════════════════════════════════════════════
现有表: industry_benchmarks / industry_brand_canonical /
         industry_ai_visibility_questions / industry_ai_visibility_runs /
         industry_ai_visibility_snapshots
现状: ✅ huatuo 部分读 benchmarks / ❌ 其他不读
接通方案:
  - huatuo 加 industry_brand_canonical + industry_ai_visibility_snapshots
  - 新加 discovery agent 也读这 2 张
  - zhuge 加读 industry_benchmarks (推荐 Action 时用)
  - 3-4 文件改

═══════════════════════════════════════════════
Layer 3 · 全局 (cross-industry)
═══════════════════════════════════════════════
现有表: market_baseline / baseline_domains / baseline_domain_score_history /
         baseline_cron_runs
现状: ✅ baseline cron 跑 / ❌ agent 不读
接通方案:
  - huatuo + discovery agent 加读 market_baseline
  - 仅 long prompt 模式启用 (节省 token)
  - 2 文件改
```

### 3.3 outcome 回流学习

**已有表**: flywheel_outcomes / prescription_outcomes / zhuge_feedback_events
**现状**: ✅ outcome 数据 (CTS 2 条已有) / ❌ 没回灌 agent
**接通方案**:
- 加 1 个 cron `agent-learning-rollup`: 每周聚合上周 outcome → 写回对应表
- huatuo 下次跑时读最近 N 条 outcome → "上次说的 X 兑现没"

### 3.4 §3 4 个判断 (PM 拍 / 已默认 OK 推进)

1. DAPE 不新加 memory 表 ✅
2. 3 层 memory 接通 = 改 agent prompt + 调 service (≤10 文件) ✅
3. outcome 回流学习 = 1 个 cron ✅
4. 工作量在 "接通", 不在 "重做" ✅

### 🗣️ §3 4-agent 复审

- **魏征**: ✅ 接通方案具体到文件 + 行数, 不空话. 1 刀 — 接通后必须跑 metrics 验证 (agent run 计数 + memory hit count). 子牙: §5 加 metrics 验收.
- **板桥**: ✅ 行业级 memory = PM 护城河, 写清楚了. 1 刀 — 自助客户 token 紧, Layer 3 全局 memory 必须只在 FDE 长模式开. 子牙: 已写 "仅 long prompt 启用".
- **狄仁杰**: ✅ Memory 接通必须 RLS 审查 — agent service 跨客户读 memory 时 RLS 不能漏. 子牙: §5 加 RLS 审计.
- **诸葛亮**: ✅ 我自己作为 zhuge 表态: 接通后我会变成"读历史 outcome → 给客户建议时引用上次结论" — **这才是真正的飞轮**. 自助客户能感受到 AI"记得我".

---

## §4 GIMPT 表 → DAPE 段 map（最短路径）

### 4.1 完整 map (24 表)

| 表 | DAPE 段 | schema 改 | UI 改 | prompt 改 |
|---|---|---|---|---|
| clients | 共用 | ❌ | ❌ | ❌ |
| goals | 共用 (DAPE 输入) | ❌ | ⚠️ Goal 详情页加处方关联 | ❌ |
| **diagnostic_runs** | A | ❌ | ⚠️ 加 type='discovery' (魏征待办) | ❌ |
| diagnostic_findings | A | ❌ | ⚠️ filter chip 修 (S15) | ❌ |
| diagnostic_narratives | A | ❌ | ⚠️ 启用 (当前 0 行) | ✅ huatuo 输出 narrative |
| **prescriptions** | P | ❌ (已有 supersedes_id) | ⚠️ 跟 Goal 一对一 + 版本化 UI | ✅ huatuo prompt 接 memory |
| initiatives | P 派生 | ❌ | ⚠️ 由处方派生, 不再手动建 | ❌ |
| campaign_briefs | E | ❌ | ❌ (现有) | ❌ |
| marketing_plans | E | ❌ | ❌ (现有) | ❌ |
| **execution_items** | E | ✅ **+prescription_id 字段** (唯一改) | ⚠️ Kanban filter + AI 推荐 | ✅ zhuge prompt 接 memory |
| content_posts / blog_posts | E | ❌ | ❌ | ❌ |
| flywheel_actions / metrics / outcomes | outcome 回流 | ❌ | ⚠️ Goal 详情页加退步警告 (F6) | ❌ |
| industry_* (5 表) | A + P memory | ❌ | ⚠️ Industry Baselines 页加 sources 透明 | ✅ huatuo/zhuge 接通 |
| baseline_* / market_baseline | A 全局 | ❌ | ❌ | ✅ huatuo 长模式接通 |
| client_learned_preferences | P memory | ❌ | ⚠️ memory 学到啥 UI 入口 (新加) | ✅ huatuo/zhuge 接通 |
| feedback_data / zhuge_feedback_events | outcome 回流 | ❌ | ❌ | ✅ agent 学习 |
| prescription_outcomes | P 验证 | ❌ | ⚠️ 处方页加 "上次预测兑现率" | ✅ huatuo 读 |

**总结**:
- DB schema 改: **1 字段** (`execution_items.prescription_id`)
- UI 改: **约 12 个页面/组件** (大部分是修飞毛腿已抓 Bug)
- Agent prompt 改: **3 个 agent** (huatuo / zhuge / discovery-new)

### 4.2 魏征待办: discovery 表方案

**选**: 复用 `diagnostic_runs` 加 `type` 字段 (避免新表)
- 加 `diagnostic_runs.type enum ('full', 'discovery')` 默认 'full'
- discovery 输出 issues 存在 `diagnostic_findings` 里 (severity='info' / category='discovery')
- 工作量: 1 migration + 1 enum 加值

### 4.3 §4 3 个判断 (默认 OK)

1. Schema 改动 1 字段 ✅
2. UI 改约 12 个 (大部分飞毛腿 Bug) ✅
3. Agent prompt 改 3 个 ✅

### 🗣️ §4 4-agent 复审

- **魏征**: ✅ discovery 表方案敲定 (复用). 总结表清晰.
- **板桥**: ✅ 看到唯一 1 字段 schema 改, 商业风险可控.
- **狄仁杰**: ✅ migration 简单, rollback 容易 (DROP COLUMN).
- **诸葛亮**: ✅ Agent 3 个改动文件清晰.

---

## §5 三视角/四视角分层 + 实施路径

### 5.1 四视角分层 (§1.5 已确认)

| 视角 | 用户 | 主要入口 | 看到的 DAPE 段 |
|---|---|---|---|
| 自助客户 | 客户自己 | /portal | 4 段简化 + Kanban 简化版 |
| FDE 客户老板 | CMO/老板 | /portal (paid_client) | 4 段 PDF 呈现 |
| FDE 内部 | Magic Lab PM/FDE | /dashboard (admin cockpit) | 完整 DAPE + GIMPT 全工具 |
| 数据层 | (开发) | DB | 24 表 |

### 5.2 实施路径 (4 周, 不再 6 周)

```
═══════════════════════════════════════════════
Week 1 · Memory 接通 + A 段完善 (低风险高价值)
═══════════════════════════════════════════════
- huatuo 加 memory service 调用 + prompt 接 client_learned_preferences
- zhuge 加 memory 接通 (轻量, 自助场景)
- A 段 BUG-FMT-S14 验收 (已派簇 B Diagnostic merged)
- A 段 BUG-FMT-S16 完整报告 PDF 重做 (新工作)
- diagnostic_narratives 启用 (huatuo 输出 narrative)
- 加 `agent-learning-rollup` cron
- 跑 metrics 验证 (魏征要求)
- RLS 审计 (狄仁杰要求)

═══════════════════════════════════════════════
Week 2 · P 段重做 (中风险)
═══════════════════════════════════════════════
- prescription_create API 加 goal_id 必填
- 处方页跟 Goal 一对一 UI
- 处方版本化 UI (v1/v2/v3 滚动)
- 修 BUG-FMT-F19/F20/F21 (3 阶段 → N 阶段动态)
- Initiative 由处方派生 (phases[].initiative_seed → batch insert)
- huatuo 长模式接通 industry_benchmarks + market_baseline
- CTS/Oztop 现有 6 条处方 backfill (跟 Goal 关联)

═══════════════════════════════════════════════
Week 3 · E 段 + Discovery 新建
═══════════════════════════════════════════════
- execution_items.prescription_id 字段 migration
- CTS 87 卡片 backfill prescription_id (狄仁杰 SOP)
- Kanban "AI 推荐 3 件" 实现 (F25-L2)
- Kanban prescription filter
- 新建 discovery agent + 短/长 prompt 模式
- diagnostic_runs.type='discovery' migration
- D 段页面 UI
- 客户视角 PDF 模板 v1

═══════════════════════════════════════════════
Week 4 · 双轨业务串通 + 测试
═══════════════════════════════════════════════
- 自助客户路径端到端: 注册 → 4 段 → MTC 扣费 → outcome
- FDE 客户路径端到端: 签约 → 后台代配 → 4 段 → outcome
- CTS/Oztop 老板 mockup 看 PDF (板桥要求)
- GrowthBook feature flag 切换 (CTS 先开 / Oztop 后开 / 新客最后)
- 自动 trip-wire: CTS Best of China current_value daily cron 检查
```

### 5.3 CTS/Oztop 业务保护规则 (§1.5 6 底线)

- 所有改动**先 UI 后 prompt 后 schema** (1 字段 schema 最后做)
- 每周 PM 抽 30 分钟实测 CTS Best of China 流
- 每个 PR 必 grep `c0000000` 看影响范围
- Feature flag 灰度 (新功能默认关, 客户级开)
- Migration 必 backfill SOP

### 5.4 §5 4 个判断 (默认 OK)

1. 4 周路径 (不再 6 周) ✅
2. 每周低 → 中 → 中 → 串通顺序 ✅
3. CTS/Oztop 保护规则 ✅
4. Feature flag + trip-wire ✅

### 🗣️ §5 4-agent 复审

- **魏征**: ✅ 4 周路径每周清晰. Metrics + RLS 审计写进 Week 1.
- **板桥**: ✅ CTS/Oztop 老板 mockup 验证写进 Week 4. DAPE 对外用大白话(对外 PDF 不出现 DAPE 字眼)按 §1.5 已落实.
- **狄仁杰**: ✅ Backfill SOP + Feature flag + trip-wire 全写进. Rollback 路径清晰.
- **诸葛亮**: ✅ Memory 接通在 Week 1 优先做, 价值密度高.

---

## §6 飞毛腿 30 Bug 按 DAPE 分桶

### 6.1 已派活已 merged

| Bug | 簇 | PR | 状态 |
|---|---|---|---|
| S01-S04 + S07 | A Settings | #416 | ✅ merged |
| S09-S15 | B Diagnostic | (PR 跑中) | 🟡 等 merge |
| F25-L1 | Kanban scroll | (PR 跑中) | 🟡 等 merge |

### 6.2 按 DAPE 段分桶 (剩余)

```
D 段 (新建 - 3 Bug)
─────────────────────────────────────
- 新加 discovery agent (诸葛亮待办: 取名)
- D 段页面 UI
- diagnostic_runs.type='discovery' migration

A 段 (5 Bug)
─────────────────────────────────────
- BUG-FMT-S16 完整报告 PDF 重做 (P0)
- BUG-FMT-S13 narrative 启用
- BUG-FMT-F6 退步警告
- BUG-FMT-F7 GROWTH 算法透明
- A 段双模式 prompt 接通

P 段 (8 Bug, 最多)
─────────────────────────────────────
- BUG-FMT-F16 处方页 dashboard 入口
- BUG-FMT-F19/F20/F21 3 阶段固定 → N 阶段动态
- BUG-FMT-F22 prescription_id 字段 + backfill
- BUG-FMT-F23 处方架构重定位 (跟 Goal 一对一 + 版本化)
- BUG-FMT-CORE-1 DAPE 引擎 (本 spec 落地)
- huatuo prompt 接通 client_learned_preferences + zhuge_feedback_events
- Initiative 自动派生
- 处方版本化 UI

E 段 (5 Bug)
─────────────────────────────────────
- BUG-FMT-F25-L2 AI 推荐 3 件
- BUG-FMT-F8 "No actions" 文案矛盾
- BUG-FMT-F24 Campaign/Plan 独特价值 UI
- BUG-FMT-F29 Launch Hub 工作流 (P2, 等社媒发布重做)
- Kanban prescription filter

跨段 / 已知遗留 (loving-cannon / nostalgic-rubin / funny-goodall 报的)
─────────────────────────────────────
- BUG-FMT-001/002/003 (funny-goodall)
- BC-001 ~ BC-006 (nostalgic-rubin + loving-cannon)
- BUG-P0F-001/002/003 (p0-fixes)
- BUG-FMT-REP-001/002 (phase23)
- 这些跟 DAPE 同 PR 修, 不单独
```

### 6.3 §6 判断 (默认 OK)

1. 已派 3 簇有效 ✅
2. 剩余 21 Bug 按 DAPE 4 段分桶 ✅
3. 跨段遗留 Bug 跟 DAPE 同 PR 修 ✅

### 🗣️ §6 4-agent 复审

- **魏征**: ✅ 分桶清晰. P 段 8 Bug 最多 — 印证 §5 Week 2 P 段重做工作量大.
- **板桥**: ✅ BUG-FMT-CORE-1 落地映射到本 spec.
- **狄仁杰**: ✅ 遗留 Bug 集中修, 不分散 PR.
- **诸葛亮**: 给 discovery agent 取名: **司马徽** (荐 huatuo / zhuge-liang 出山的伯乐) — DAPE 第一段, 找议题, 像伯乐.

---

## §7 CTS/Oztop 业务保护规则 (强约束 · 写进每个 PR review checklist)

### 7.1 6 条业务底线 (§1.5)

1. 入口分流 (self-register + FDE 签约) 不动
2. MTC 扣费 (8 API) 不动
3. 自助客户视角含 Kanban (不隐藏)
4. 四视角分层
5. AI prompt 双模式
6. 不动 schema (除 F22 1 字段)

### 7.2 每个 DAPE PR 必跑

```bash
# 1. grep CTS 影响
grep -r "c0000000" src/ docs/ | wc -l

# 2. CTS 4 active goals current_value 不能为 null (跑数据测试)
psql -c "SELECT COUNT(*) FROM goals WHERE client_id='c0000000-0000-0000-0000-000000000000' AND status='active' AND current_value IS NULL"

# 3. CTS 1 approved 处方还在 (不能误删)
psql -c "SELECT COUNT(*) FROM prescriptions WHERE client_id='c0000000-0000-0000-0000-000000000000' AND status='approved'"

# 4. Kanban 87 卡片完整
psql -c "SELECT COUNT(*) FROM execution_items WHERE client_id='c0000000-0000-0000-0000-000000000000'"

# 5. MTC 8 API 烟测
curl /api/clients/c0000000.../blog ...

# 6. RLS policy 不变 (狄仁杰审)
```

### 7.3 §7 判断 (默认 OK)

1. 6 底线写进 PR template ✅
2. PR review checklist 5 项必跑 ✅
3. RLS policy 改动必狄仁杰审 ✅

---

## §8 治理与签字

### 8.1 5-agent 全本签字

```
═══════════════════════════════════════════════
子牙 (架构主笔): ✅ v0.2 起草完成, 11 处魏征/板桥/狄仁杰/诸葛亮挑刺已吸收
板桥 (PM/客户视角): ✅ 双轨业务保护 + DAPE 对外大白话 + 客户 mockup 验证写进 Week 4
魏征 (挑刺): ✅ 11 处骨头吸收: 独立输入契约 / memory metrics 验证 / 客户 mockup / P 段拆 3 Phase / Feature flag / 治理纪律
狄仁杰 (断案/安全): ✅ Schema 改 1 字段 + Backfill SOP + Feature flag + Trip-wire + RLS 审计
诸葛亮 (ME 后台 agent): ✅ Memory 接通 + 双模式 prompt + discovery agent 取名 司马徽 + 自校正 §1 错判
═══════════════════════════════════════════════
```

### 8.2 反对意见汇总 (留作 v0.3 修订)

- 魏征: discovery 表 enum 是否够 (待 Week 1 实施时验证)
- 板桥: 自助客户 P 段简化版 3 phases × 5 actions 是否够 (待 CTS 老板 mockup 反馈)

### 8.3 v0.3 触发条件

- Week 1 跑完 metrics 不达标
- CTS 老板看 mockup 给负反馈
- 任何 RLS 漏洞被狄仁杰发现
- PM 飞毛腿继续跑 F5/F6/F7 发现 DAPE 没覆盖的场景

### 8.4 PM 最终拍板

```
☐ §1 现状真相 5 OK (已拍)
☐ §1.5 双轨业务 6 OK (已拍)
☐ §2 DAPE 4 段 (默认 OK 加速)
☐ §3 AI Memory (默认 OK 加速)
☐ §4 GIMPT 表 map (默认 OK 加速)
☐ §5 实施路径 (默认 OK 加速)
☐ §6 飞毛腿 30 Bug 分桶 (默认 OK 加速)
☐ §7 CTS/Oztop 保护 (默认 OK 加速)
☐ §8 5 agent 签字 (默认 OK 加速)

如 PM 任何 §有意见 → 标 ❌ 并指出, 子牙立即 v0.3.
否则 v0.2 = 工作 spec, 子牙立即派活 Week 1.
```

---

## 版本

- **v0.1** — 子牙独裁, 废
- **v0.2** — 2026-06-08 5-agent live 复审, PM 强约束加速冲刺出全文
  - §0 治理 ✅
  - §1 现状真相 ✅ (PM 拍 5 OK)
  - §1.5 双轨业务 ✅ (PM 拍 6 OK)
  - §2 DAPE 4 段 ✅ (4-agent 签字, PM 默认 OK)
  - §3 Memory 3 层 ✅ (4-agent 签字, PM 默认 OK)
  - §4 GIMPT 表 map ✅ (4-agent 签字, PM 默认 OK)
  - §5 实施路径 ✅ (4-agent 签字, PM 默认 OK)
  - §6 30 Bug 分桶 ✅ (4-agent 签字, PM 默认 OK)
  - §7 CTS/Oztop 保护 ✅
  - §8 治理签字 ✅

---

## §4 GIMPT 表 → DAPE 段 map

(待 §3 撰写)

诸葛亮击 2 修法: P 段重做含 huatuo + zhuge prompt 重训。

---

## §5 三视角分层 + 实施路径

(待 §4 撰写)

板桥击 1 修法: 客户视角 4 段必须经过 CTS/Oztop 老板 mockup 验证。
板桥击 2 修法: DAPE 对外用大白话（发现-分析-处方-执行），内部用 DAPE。
板桥击 3 修法: Launch Hub 改造方向 PM 一句话填空。
魏征击 3 修法: P 段拆 3 个 Phase。
魏征击 4 修法: 加 GrowthBook feature flag。
狄仁杰击 2 修法: 加自动 trip-wire (CTS Best of China current_value daily check)。

---

## §6 飞毛腿 30 Bug 按 DAPE 分桶

(待 §5 撰写)

---

## §7 CTS/Oztop 业务保护规则

(待 §6 撰写)

---

## §8 治理与签字（4 agent）

每节末尾的 agent 签字 + 反对意见汇总。

---

## 版本

- **v0.1** — 2026-06-08 子牙独裁 brainstorm，4 agent 未审 → 废
- **v0.2** — 2026-06-08 5-agent live 复审起草中

  - §0 治理纪律 ✅
  - §1 现状真相 ✅ (5 agent 签字)
  - §2-§8 待写
