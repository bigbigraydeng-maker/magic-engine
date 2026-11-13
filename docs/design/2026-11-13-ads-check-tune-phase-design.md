# 广告线下一阶段：Check（查）与 Tune（调方）设计稿

> **日期**：2026-11-13  
> **风险级（本文档）**：B（纯设计，无代码）  
> **派活等级**：L2 / 写代码模型：本会话自写（文档）  
> **产品决策（Ray）**：广告线下一阶段重心放在 IMPACT 的 **Check**（执行后复盘 + 日复盘）和 **Tune**（按诊断开对症药方）；**暂不新增执行能力**（不扩 Meta 写入面、不新开自动执行通道）。  
> **权威指针**：产品定义见 `docs/strategy/ME_PRODUCT_DEFINITION.md`；平台化见 `docs/roadmap/2026-08-19-me2-platformization-principle.md`。

---

## 平台层级（跟班 · Inline）

- **归类**：既有广告支柱下的 **L1 Measurement / Verification**（Check）+ 既有处方/确认卡管道上的 **L3 Adapter 接线**（Tune 出新 remedy 类型，仍走确认卡与守卫，不自动改广告）。
- **不做什么**：不新开支柱、不新开第七条能力线、不把「换素材」做成新的执行内核（素材仍交社媒 agent 或人）。
- **共享 vs 客户**：判定规则与阈值契约平台共享；具体阈值默认值可进 `leads_config`，行业/playbook 只调默认，不写死客户名。

---

## 1. 现状盘点：今天各块能力盖到哪里

下面按「已经合并主干」「草稿 PR」「缺口」三类说清；括号内为台账或 PR 指针。

### 1.1 执行后回看 + 经验读回（#3803 · #3809 · #3814 草稿）

| 能力 | 做什么 | 代码 / 入口 | 覆盖边界 |
|------|--------|-------------|----------|
| **自动归因结论**（#3803，台账 `2026-11-12-ads-review-verdict-rules`） | 预算卡、暂停卡**执行完**并过观察窗后，按主成效 CPL 自动打「有用 / 没用 / 看不出」，写入 `client_learned_preferences` | `src/lib/flywheel/attribution/review-verdict-rules.ts`、`executed-review` 任务 | 默认预算观察 **7 天**、暂停 **3 天**、±15%、至少 5 个主成效；客户可在 `leads_config.ads_execution_review` 覆盖 |
| **开处方时读回经验**（#3809，台账 `2026-11-12-ads-review-experience-readback`） | 出调预算/暂停确认卡时，读近窗「有用/没用」次数，把「没用」够阈值的处方项往后排 | `ads-execution-prescription-experience.ts`、确认卡 scope | 只读，不调 Meta |
| **看板展示**（#3783，台账 `2026-11-10-ads-execution-review-dashboard`） | 广告门「今天」、确认卡页展示「改完后的成绩」 | `AdsExecutionReviewPanel`、`GET …/ads-execution-review` | 观察期未满只显示进度，不瞎猜 |
| **扩展更多卡类型回看**（#3814 草稿，叠 #3809） | 止损、成绩单降预算、机会挖降预算、D3 自动暂停确认、系列暂停（含日内封顶暂停）等**已执行**动作纳入同一套归因 | 扩展 `executed-review` 动作类型表 | 仍只读；**不包含**未执行的 D3 建议行 |

**没盖到的 Check**：没有「开投后第 1/3/7 天」固定节奏的全面复盘；没有按 CTR 走势、单素材时长、广告组结构做的**诊断型**结论（只有钱卡做完后的 CPL 归因）。

### 1.2 熔断 / 止损 / 日内封顶 / 放量退回（P-4）

| 能力 | 做什么 | 触发节奏 | 覆盖边界 |
|------|--------|----------|----------|
| **日熔断（breaker）** | CPL 超目标倍数、当日无线索但花了钱、花费超批准日上限、政策类错误 → **只出暂停确认卡** | 挂在每日拉数（`google-data-pullback-daily`）里的 `runAdsCircuitBreaker`，约清晨 **06:00** 量级；读 **日表** | 默认 CPL 倍数为 **2× 目标**（`cpl_multiple` 可配）；数据陈旧整户不出卡（台账 `2026-11-09-ads-circuit-breaker-propose-pause`） |
| **止损（stop-loss）** | 广告健康页人工「全停 / 降预算 20%」 | 人点按钮 → Kernel | 人工信封，**不**查 72h 闸门；与 D3 自动规则不同路径 |
| **日内封顶采样** | 每 **10 分钟**读花费，预测是否超批准日上限 → 超限确认卡 | `GET /api/cron/ad-intraday-spend-sample` | 当前样本字段主要是 **花费 + 展示**（`SpendDraft`）；采样末尾顺带跑封顶提议 |
| **放量阶段退回（scale-fallback / P-4）** | 连续两天 CPL 偏贵且花了一半预算仍无线索 → 退回稳住卡 | **仅**推广节奏为「放量」时 | 客户 C 案例在稳住/放量语义下才可能吃到；**不**看 CTR 趋势 |
| **草稿 #3827** | 日内采样结束后，用当天 CRM 线索 + 采样花费走**同一套**熔断判定（CPL / 零线索） | 10 分钟一轮 | 仍要 CPL 过倍数才停；**不**解决素材疲劳 |
| **草稿 #3828** | 闲置账户快照过期不再拖死全户暂停卡；快照读取改「每账户最新一批」 | 日熔断取数 | 修的是「卡出不来」，不是「该不该换素材」 |

### 1.3 处方（华佗）与 action_list（#3815 · #3819 草稿）

| 能力 | 做什么 | 状态 |
|------|--------|------|
| **华佗出方案** | 战略层处方，存 `prescriptions.content` | 日常广告起草多数不经华佗（台账 `2026-11-09-ads-playbook-play-preferences-paused-no-huatuo-plays`） |
| **AD-2 #3815 草稿** | 处方内 `action_list`：机器可读的暂停广告组、调广告组日预算（各最多 1 条） | 校验 + 规范化，**不发卡、不执行** |
| **AD-3 #3819 草稿** | 处方**同意后**按 `action_list` 出对应确认卡（暂停 / 调预算），仍不执行 | 叠在 AD-2 上；幂等键防重复出卡 |

**没盖到的 Tune**：没有「换素材 / 加素材 / 收窄人群 / 仅降预算」等 **remedy 类型**；没有自动把「素材疲劳」诊断接到处方或确认卡；创意类动作未交给社媒 agent 工单。

### 1.4 今日能力地图（一句话）

- **Act 之后**：只有「钱相关确认卡」做完的 CPL 归因 + UI 读回。  
- **每天**：日表上的 2× CPL 熔断 +（主干）日内封顶；（草稿）日内 CPL 卡 + 闲置账户不误杀。  
- **没有**：CTR 对自己基线的趋势、单创意投多久、落地页漏斗（点击→表单）变没变、ME 外改设置的归因纳入复盘。

---

## 2. 回放案例：客户 C 的组 A 为何第 6–14 天没抓到素材疲劳

> 公开表述：以下统称 **「客户 C 的组 A」**；金额一律相对目标或倍数，不写真实账户编号。

### 2.1 事实摘要（14 天）

- 广告组里长期 **只有 1 条广告 / 1 套创意** 在投。  
- 日频次约 1.2–1.4（无「频次爆炸」信号）；**7 日频次未落库**。  
- **CTR**：第 1 天约 5.66%，第 5 天约 4.9%，第 6–7 天约 4.1%，第 9–10 天约 3.81%，**第 11 天约 2.86%**（相对第 1 天约 **−49%**），第 12–13 天在 2.86%–3.15% 徘徊。  
- **CPC** 约升至早期的 **2.5×**；**CPM** 仍在正常带（约 ±15%）。  
- 点击→线索转化约 **5.6%–8.4%** 波动，说明落地页侧不是主因。  
- **CPL**：第 1–5 天约 **0.5× 目标**，第 6–10 天约 **0.75–0.85×**，第 11、13 天约 **1.05×**，第 14 天约 **2.1×**（线索变少，设置未在 ME 内改）。  
- 第 5 天在 ME **外**放宽年龄段（快照 hash 变，无 `action_runs`）；更早也有 ME 外加预算。第 7 天起并行 expansion 组 A 仍接近目标，**不能**用「互抢量」解释第 14 天恶化。  
- CRM 与平台线索 **日日对齐**（非入库问题）。

### 2.2 对照现有规则：为什么沉默到第 14 天

| 日次 | 现象 | 现有系统为何没说话 |
|------|------|-------------------|
| 6–7 | CTR 明显走低，CPL 仍优于目标 | 无「CTR 对自己 7 日均值跌 ≥30%」规则；熔断只看 **CPL > 2×** 且用 **日表**、清晨批跑 |
| 9–10 | CTR 继续走弱，CPL 仍 < 1× 目标 | 同上；日内采样（主干）只看 **封顶**，不看 CTR/CPL（#3827 草稿仍要 CPL 过线） |
| 11 | CTR 低点 + CPL 刚过 1× | 仍 **不到 2×**，breaker 不出的暂停卡；stop-loss / scale-fallback 依赖阶段或人工 |
| 整段 | 闲置账户陈旧曾 **压掉全户暂停卡** | 主干 bug；#3828 草稿修的是发卡管道，**不**新增疲劳诊断 |
| 14 | CPL ≈ 2.1× | 清晨熔断**理论上接近可触发**，但此前管道可能被陈旧账户挡住；且无「第 6 天就应给的换素材方」 |

**根因归纳（设计层面）**

1. **信号存不全**：10 分钟采样未存点击、CTR、版位、表单打开；日表有 CTR 但 **无「对自己基线」的趋势任务**。  
2. **规则偏钱不偏素材**：breaker / 日内 CPL 均 **滞后且高门槛**（2×），适合「已经亏很多」，不适合「创意正在过期」。  
3. **结构特征未用**：单广告组单创意投 ≥10 天 **无检查**。  
4. **ME 外改动不可见**：快照变 hash 未进入执行回看叙事。  
5. **Tune 断档**：即使人看出 CTR 掉，也没有标准 remedy 类型接到确认卡 / 社媒工单。

### 2.3 新阶段的验收标准（同案例）

上线 Check + Tune 后，对同一 anonymized 时间序列重放：

- **第 6–11 天之间**必须至少产出一条 **`素材疲劳/走弱`** 诊断（含：CTR 对自己基线跌幅、单创意天数、CPL 趋势辅助）。  
- 诊断应能挂接 Tune：**换素材或加素材** 的处方/任务（不要求自动发布）。

---

## 3. Check 设计

### 3.1 目标

在 **不新增自动执行** 前提下，让系统每天和开投后固定节点能回答：

- 创意是不是在过期？受众是不是在变浅？钱是不是在变差但还没到 2×？  
- ME 外有没有人动过设置？

### 3.2 执行后自动复盘（D+1 / D+3 / D+7）

**触发**：任意「推广动作」在 ME 内被确认执行（开投、调预算、暂停、后续 Tune 出的卡）后，登记 `check_schedule`（平台表或复用 `flywheel_actions` 扩展 payload，实现 PR 再定）。

| 节点 | 看什么 | 输出 |
|------|--------|------|
| D+1 | 花费是否异常、主成效是否归零、CTR 是否当日极端 | 简短状态 + 是否推迟 D+3 |
| D+3 | 同对象 3 日 CTR/CPL 相对执行前基线 | 与 #3803 归因并存；结论进广告门「今天」 |
| D+7 | 与 #3803 预算 7 日窗对齐或合并，避免双轨打架 | 统一 `reviewCase` 展示 |

**复用**：`review-verdict-rules`、日表、`ads-execution-review` UI；扩展动作类型见 #3814 思路。

**展示（默认，Ray 未反对前按此 · §8.3）**：对 **暂停卡**，D+1 / D+3 节点与 #3803 默认 **3 天暂停观察窗** 在广告门回看区 **同一区块合并展示**（一条时间线：第几天、规则/AI 结论、`reviewCase` 档位），不分两个 Tab。

**配置**：`leads_config.ads_execution_review` 增加 `post_exec_check_days: [1,3,7]` 开关与跳过条件（样本不足 → `unclear`）。

### 3.3 每日趋势判定（per-client 阈值 · 触发器 + 兜底）

**定位**：v1 设计里每条 Check **最终展示给 PM 的结论文本**优先来自 **§3.5 AI 分析层**；本节阈值规则只做 **何时叫醒 AI**、以及 **AI 失败/超时/JSON 不合法时的兜底结论**（不再充当唯一真相）。

**调度**：挂在现有 **日拉数完成之后**（与 breaker 同 cron，顺序：拉数 → 趋势 Check → breaker），或独立 `ads-daily-trend-check` cron（实现时二选一，避免重复扫表）。

**默认规则（均可被 `leads_config.ads_trend_check` 覆盖）**：

| 规则 ID | 条件（默认） | 诊断标签 |
|---------|----------------|----------|
| `ctr_vs_self_7d` | 广告或广告组：当日 CTR 较 **自己过去 7 日均值** 下跌 ≥ **30%**，且当日展示 ≥ 下限 | `素材疲劳/走弱`（主标签） |
| `cpl_vs_self_7d` | 7 日滚动 CPL 较自己 7 日前均值上升 ≥ **50%**，且花费 ≥ 下限 | `成本走强/需调方` |
| `single_creative_age` | 广告组内 **仅 1 条在投广告** 且连续 ≥ **10** 天 | `单创意老化`（强化疲劳） |
| `frequency_guard` | 可选：7 日频次 > 行业默认（若日后存 7 日频次再启） | 辅助，不当主因 |

**输出契约**（平台共享 JSON，客户可见页与待办共用）：

```text
diagnosis_code: creative_fatigue | cost_creep | single_creative_stale | …
subject: { level: ad|adset|campaign, id, name }
evidence: { ctr_drop_pct, baseline_days, cpl_ratio_to_target, … }
suggested_tune: [ swap_creative, add_creative, narrow_audience, lower_budget ]
severity: watch | act_soon
```

**与 breaker 关系**：趋势 Check 可出 **「观察 / 调方」** 级诊断和 Tune 提议；**暂停**仍只走现有确认卡与 2× CPL 熔断（避免双管道自动停投）。AI 层若建议 `pause`，同样只生成 **处方草稿 + 确认卡提议**，不直写 Meta。

### 3.4 扩展 10 分钟采样（**Ray 已定** · §8.2）

**本仓库（旧 ME / magic-engine）现状**：`SpendDraft` 仅 `spendMinor`、`impressions`（`src/lib/ads-strategy/intraday-spend/sample.ts`）。**未存**点击、版位、表单打开等（完整对比见 **§8.1**）。

**v1 做法**：**先在旧版补** — 在 `public.ad_intraday_spend_samples` **加列**（至少 `clicks`；理想态含广告层级与版位摘要）→ **PR-1 含 migration，A 级**；保留 10 分钟步长与封顶提议，为 AI 分析层提供日内点击序列。  
**以后**：再迁到新版 magic-engine-platform 采样（§8.2），本仓改为读统一数据服务或下线重复 cron，不在本阶段实现。

**回放案例**：在第 **6–11 天**窗口内，无论日规则是否触线，AI + 足够点击/impress 序列应能给出 **watch / act_soon**（客户 C 组 A 夹具）。

### 3.5 AI 分析层（Check 结论引擎）

**为什么要一层 AI**：纯阈值能抓「跌 30%」但说不清 **是不是素材、还是受众被稀释、还是 ME 外改设置**；客户 C 组 A 需要一句人话结论 + 可执行 next step，且要进 **卡回看区** 与 **今日待办**。

**原则**

- **AI 绝不直接改广告**（不调 Meta、不点 Kernel 执行、不绕过确认卡）。  
- 变差时可 **自动起草处方**（`swap_creative` / `add_creative` / `narrow_audience` / `lower_budget` / `pause`），仍只写入 `prescriptions` 草稿或 `action_list` 提议，并走 **既有确认卡 + 守卫 + 人工确认**。  
- 阈值规则（§3.3）= **触发 AI 跑一轮** 或 **AI 不可用时的 fallback 结论文案**。

#### 3.5.1 何时跑

| 场景 | 触发 |
|------|------|
| **已执行确认卡** | 卡 `wrote: true` 后：D+1 / D+3 / D+7 节点，以及卡观察窗内每次日更 | 
| **在投广告组/系列** | 每日日拉数后至少 1 次；若 §3.3 任一规则命中或日内 pace 告警（旧版或新版采样），**加急**再跑 1 次（同日上限见成本帽） |
| **兜底** | AI 失败时：只展示 §3.3 规则输出的 `diagnosis_code` + 固定模板文案，标记 `source: rules_fallback` |

#### 3.5.2 输入（只读）

组装 **单客户端、单主体**（卡或 adset/campaign）一份上下文包，不含任何可识别客户的 PII：

1. **10 分钟采样序列**（v1：**旧 ME** 表，§8.2）：近 48h（或当日）`spend`、`impressions`、`clicks`（或衍生 CTR）、`local_minute` 桶；有则带 `actions` 主成效计数。  
2. **日表**：近 14 日同对象 `ctr`、`cpc`、`cpm`、`spend`、`primary_results`、相对目标 CPL 比。  
3. **结构特征**：在投广告条数、创意年龄（天）、单创意标记、ME 外快照 diff 摘要（有则）。  
4. **卡上下文**（若是回看）：动作类型、执行日、观察窗、`reviewCase` 既有档位（不重复判有钱卡 attribution）。  
5. **客户配置**：`leads_config.ads_trend_check`、目标 CPL 倍数、主成效 ladder 名称（无金额目标原文）。

模型调用在 **handler 内**初始化 SDK；prompt 与响应 **不落客户可见文案中的供应商真名**（对外用「Strategy Engine」）。

#### 3.5.3 输出 JSON 契约

写入 `flywheel_actions.payload.ai_check` 或并列 `client_manual_items` 指针；UI **卡回看**与 **今日待办**共用同一结构。

| 字段 | 类型 | 说明 |
|------|------|------|
| `schema_version` | `string` | 固定 `"ads_ai_check_v1"` |
| `subject_kind` | `"executed_card" \| "live_adset" \| "live_campaign"` | 分析对象 |
| `subject_ref` | `string` | 内部键（非 Meta 广告编号对外展示时可脱敏为 slug） |
| `analyzed_at` | `string` | ISO 时间 |
| `verdict` | `"better" \| "worse" \| "unchanged" \| "unclear"` | 相对执行前或相对 7 日基线 |
| `headline_zh` | `string` | ≤80 字，待办标题用 |
| `reason_zh` | `string` | 2–4 句大白话 |
| `evidence` | `object` | 数值证据（见下） |
| `confidence` | `number` | 0–1 |
| `suggested_prescription` | `object \| null` | 仅草稿，见 §4 |
| `source` | `"ai" \| "rules_fallback"` | 是否 AI 成功 |
| `run_meta` | `object` | `tokens_in`、`tokens_out`、`model_tier`、`cost_usd_estimate`（内账） |

`evidence` 建议字段：`ctr_day_pct`、`ctr_vs_7d_pct`、`cpl_ratio_to_target`、`clicks_24h`、`impressions_24h`、`primary_results_24h`、`intraday_ctr_slope`（占位算法名）、`flags[]`（如 `single_creative_stale`）。

**示例（虚构数据，仅说明形状）**：

```json
{
  "schema_version": "ads_ai_check_v1",
  "subject_kind": "live_adset",
  "subject_ref": "fixture-adset-group-a",
  "analyzed_at": "2026-11-10T06:05:00Z",
  "verdict": "worse",
  "headline_zh": "素材疲劳、点击率走弱",
  "reason_zh": "近 7 日点击率从自己基线回落约四成，单次点击成本抬高，落地页转化率仍稳定，更像创意过期而非网页问题。",
  "evidence": {
    "ctr_day_pct": 3.81,
    "ctr_vs_7d_pct": -32.5,
    "cpl_ratio_to_target": 0.82,
    "clicks_24h": 42,
    "impressions_24h": 1100,
    "flags": ["single_creative_stale", "ctr_slide"]
  },
  "confidence": 0.78,
  "suggested_prescription": {
    "action_list": [
      {
        "action": "swap_creative",
        "reason_zh": "点击率持续走弱且仅单创意在投，建议换素材做对照",
        "observation_days": 7
      }
    ]
  },
  "source": "ai",
  "run_meta": { "model_tier": "short", "cost_usd_estimate": 0.02 }
}
```

**验收（客户 C 组 A 重放）**：在第 **6–11 天**任一日跑分析，须得到 `headline_zh` 含 **「素材疲劳」** 与 **「点击率走弱」**（或同等语义），且 `suggested_prescription` 含 **`swap_creative`**。

#### 3.5.4 成本帽与失败策略

| 限制 | 默认值 | 配置 |
|------|--------|------|
| 每客户每自然日（NZ） | 最多 **12** 次分析调用 | `leads_config.ads_ai_check.max_runs_per_day` |
| 单次运行 | 输入 prompt **≤ 6k tokens** 硬截断；超时 **45s** | 固定，防炸账单 |
| 每 run 预算 | 估算 **≤ USD 0.08**（短模）；超限则本 run 不调用，直接 fallback | 内账累计写 `run_meta` |

失败（超时、5xx、JSON schema 校验失败、confidence &lt; 0.35）→ **不写 AI 结论**，只写 `source: rules_fallback` + §3.3 诊断；待办仅在有规则命中时出条。

#### 3.5.5 展示与待办

- **卡回看区**（`AdsExecutionReviewPanel` / 确认卡详情）：在既有 `reviewCase` 下方增 **「AI 复盘」** 块，显示 `headline_zh`、`reason_zh`、`evidence` 摘要、`confidence`（内部账号可见数值；客户账号可只显示 headline + reason）。暂停卡 D+1/D+3 与 §3.2 合并展示规则一致。  
- **今日待办（默认 · §8.3）**：`verdict === worse` 且 `confidence ≥ 0.55` → 进 `pm-todo` 人工栏，`what` = headline，`how` = reason + 链到广告门对象；**不**自动发卡。排序：**熔断 / 止损类暂停确认卡** 始终排在 AI「变差」待办 **之上**（同栏内 priority 更高）。  
- **自动起草处方（默认 · §8.3）**：`ads_ai_check.auto_draft_prescription` 全平台默认 **关**；**首开仅 pilot 客户 C**（回放验收户，无额外实名）。该户为开时：若 `suggested_prescription` 非空则写 **draft** 处方，不等价于同意，更不执行。

### 3.6 Check 不做的

- 不自动暂停、不加预算、不替 Meta 改创意。  
- 不用频次单独定罪（客户 C 已证明频次可正常但 CTR 仍崩）。  
- 不新建支柱级「创意智能」；阈值规则进 `ads-strategy` 下可测试纯函数；**综合结论**进 AI 分析层（§3.5），非另一条支柱。

---

## 4. Tune 设计

### 4.1 目标

把 Check 的 `suggested_tune` 变成 **人可批、机器可追踪** 的药方，延续 Ray 决策：**不开新执行能力**，只扩展 **remedy 类型** 与发卡/工单管道。

### 4.2 新 remedy 类型（扩 AD-2 `action_list`）

在 #3815 已有 `pause_ad_set`、`adjust_adset_daily_budget` 之外增加（名称实现时与 Kernel action 对齐）：

| remedy | 含义 | ME 内行为 |
|--------|------|-----------|
| `swap_creative` | 换下走弱创意 | 出 **创意任务卡**（非 Meta 写入）：描述对象、原因、截止；交 **社媒 agent** 或人工 |
| `add_creative` | 加一条新创意对照 | 同上；可挂工厂/内容工作流入口链接 |
| `narrow_audience` | 收窄人群（年龄/地域/兴趣） | v1 **仅「设置变更建议卡」**（只读说明 + 人工去 Meta 改）；**不写 Meta**（默认 · §8.3）；日后接 Kernel 另开 A 级 PR |
| `lower_budget` | 只降预算不断投 | 复用 `adjust_adset_daily_budget`（降方向），与熔断降预算守卫一致 |

**发卡**：优先复用 AD-3「处方同意 → 出卡」；Tune 自动诊断出的 remedy 走 **`ads.tune_proposal` 确认卡**（新卡种，文案为调方非止损），lifetime 建议 `nz_day` 或 72h。

**守卫**：沿用 72h 改一次、单次加预算 ≤20%、花钱须 PM 等既有闸。v1 `narrow_audience` 无 Meta 写入，**PR-4 可按 B 级合**（§8.3）。

### 4.3 创意类交给社媒

- `swap_creative` / `add_creative` 执行面：**不在此阶段扩 Meta 广告创建 API**。  
- 发卡同时 `enqueue` 社媒 pillar 工单（Inngest 事件如 `social.creative_refresh.requested`，实现 PR 定名），带 diagnosis evidence。  
- 工单完成回执进入 D+3/D+7 Check。

### 4.4 ME 外改动纳入复盘

- 每日快照 diff（已有 hash）：若 `targeting` / `budget` 变而 **无对应 `action_runs`**，写入 Check 报告 `external_change_detected`，附 diff 摘要。  
- D+7 归因时注明「观察窗内存在 ME 外改动」，避免冤枉 ME 内动作。

### 4.5 Tune 不做的

- 不自动上传素材、不自动开新广告。  
- 不让华佗单独决定换创意（可先规则/模板，华佗后续再学写 `action_list`）。

---

## 5. 决策记录 + 回头看（Ray 2026-11-14 02:08）

> **Ray 原话**：「我不论今天的结论是什么，我需要广告 agent 有一个流程去记录决策，并且回头看。」

目标：广告 agent（诸葛亮/华佗链路上的 **ads 决策面**）对 **每一次** 投放判断留痕——含 **决定不动**、ME 外改动、创意调换——并在约定日复盘时由 **§3.5 AI Check** 对照预期，结论回流 **今日待办** 与 **经验库**，下次开处方可读回。

### 5.1 记什么（决策记录契约 · `ads_decision_v1`）

**每一条**决策（含「本轮不动作」）应有：

| 字段 | 说明 |
|------|------|
| `decided_at` | 决策时间（ISO，账户或 NZ 业务日可并列展示） |
| `decided_by` | `human` \| `agent_draft` \| `card_execution`；附操作者邮箱或内部 agent 角色名 |
| `subject` | 对象：`{ level: campaign\|adset\|ad\|account, ref, label_zh }`（`ref` 存内部 UUID/slug，**不进公开文档示例以外的真 ID**） |
| `decision_type` | `execute` \| `no_action` \| `creative_change` \| `audience_change` \| `budget_change` \| `external_noted` \| … |
| `what_done_zh` | 人话：做了什么或明确写「决定不调整」 |
| `evidence_at_decision` | 决策当场只读快照：相对 **目标 CPL** 的比值、CTR、花费趋势等（**不用真实金额字面量**） |
| `reasoning_zh` | 为什么这样选 |
| `expectation` | `{ metric, target: "≤ 目标 CPL" \| "≥ 1.8% link CTR" 等, horizon_days, object_scope? }` |
| `stop_or_rollback` | 触发停/回滚条件（如「单条新素材花费达 **~3× 目标 CPL** 且 0 线索则停该素材」） |
| `review_due_on` | 回头看日期（业务日） |
| `status` | `active` \| `pending_confirm`（agent 起草待 Ray 点认） \| `superseded` |

**创意调换**、**ME 外改设置**、**今天不动** 都必须能落成同一契约，避免只有「点了确认卡」才算决策。

### 5.2 入口（谁写入）

| 入口 | 行为 |
|------|------|
| **确认卡执行成功** | `action_runs` / `flywheel_actions` 已有执行行 → **自动**在 `payload.ads_decision_v1` 补全决策字段（从卡上 scope + 执行前证据拉取）；`decided_by: card_execution` |
| **人工 / ME 外** | 广告门「记一条决策」表单（FDE/PM）：如客户 C 组 A「旧视频继续跑 + 加 2 张静图」；不写 Meta |
| **Agent 起草** | §3.5 或处方 agent 产出 `ads_decision_v1` 草稿 → `status: pending_confirm` → 今日待办给 Ray **确认或改**；确认后才 `active` 并可选挂处方/工单 |
| **决定不动** | 显式选「本日不动作」+ 简短原因 + 可选 `review_due_on`（避免沉默被当成没决策） |

### 5.3 回头看（review）

到 `review_due_on`（及 D+1/D+3 与 §3.2 重叠时 **合并展示**）：

1. **§3.5 AI Check** 读日表 + 10 分钟采样，对照 `expectation` 与 `stop_or_rollback`。  
2. 写回同一条记录的 `review_result`：`met` \| `not_met` \| `unclear` + `reason_zh` + `suggested_next`（可指向 Tune remedy）。  
3. 进 **今日待办**（排序仍 §8.3：熔断暂停卡优先于 AI 变差/复盘条）。  
4. 结论 **upgrade** 进经验库：`client_learned_preferences`（`source: auto_extracted`，`extracted_from_table` 指向决策源行）；华佗/开处方时经 **#3809 同款 readback** 压低「没用」类重复建议。

AI **不**因复盘结果自动改广告；`not_met` 只出待办 + 可选处方草稿（§3.5.5 pilot 客户 C 开关）。

### 5.4 既有能力盘点（先复用，不平行再造）

| 已有 | 覆盖什么 | 缺口（相对 §5.1） |
|------|----------|-------------------|
| **#3803** `review-verdict-rules` + 归因 job | 已执行 **预算/暂停卡** 观察窗结束后 CPL 三档；`flywheel_actions.payload.reviewCase` | 仅 **卡执行** 且主要为 CPL；无 `expectation`/`stop`/创意类；**「不动作」不记** |
| **#3809** `ads-execution-prescription-experience` | 读 `client_learned_preferences` 压实处方顺序 | 只消费 **已写入** 的短文本经验，不读结构化决策 |
| **#3814**（草稿） | 扩更多 **已执行卡类型** 进同一 attribution | 仍非通用决策日志；无人工/ME 外/创意条目 |
| **`flywheel_actions`**（`20260517000001_flywheel_data_skeleton.sql` + 后续列） | 执行记账、`payload` JSONB、`expected_metric` / `executed_at`、可挂 `reviewCase` | 无统一 `ads_decision_v1`；无 `review_due_on`；无 `no_action` 行语义 |
| **`client_learned_preferences`**（`20260610000001_phase23_memory_tables.sql`） | 归因后 **一段话** 经验，`extracted_from_*` 指回 action | 非结构化；无独立 **回头看日程**；preference_type 无 `ads_decision` |
| **`client_decision_history`**（同 migration §4） | 诸葛亮 **战略选择** 与 `outcome_verdict` 回填位 | **非广告执行面**；缺广告对象、证据快照、停损条件 |

**推荐落地（v1）**

- **扩展** `flywheel_actions.payload.ads_decision_v1` + 新 `action_type` 如 `ads.decision_log`（含 `no_action` / 人工 / agent 确认后）→ **同一套查询与 UI**。  
- **不新建**平行「决策表」除非列表/待办查询证明 JSONB 不够；若需独立表 `ads_decision_records` + 外键 `flywheel_actions.id` 可选项 → 该 PR **A 级 migration**。  
- **复用** #3803 job：观察窗结束写 `reviewCase` 的同时 merge 进 `review_result`；#3809 读 preference 时优先匹配 `extracted_from` 决策行。

### 5.5 示例记录（虚构 · 客户 C 组 A · 加创意）

```json
{
  "schema_version": "ads_decision_v1",
  "decided_at": "2026-11-14T02:08:00+13:00",
  "decided_by": { "kind": "human", "label": "pm" },
  "subject": { "level": "adset", "ref": "fixture-adset-group-a", "label_zh": "客户 C 的组 A" },
  "decision_type": "creative_change",
  "what_done_zh": "旧视频广告继续投放；新增 2 条静态图广告（价格优先版、问句钩子版）；系列日预算不变。",
  "evidence_at_decision": {
    "cpl_ratio_to_target": 1.05,
    "ctr_vs_day1_pct": -42,
    "note_zh": "点击率走弱、获客成本略高于目标，转化链路稳定"
  },
  "reasoning_zh": "视频疲劳明显，先用两张静图测点击率，不换落地页、不动预算。",
  "expectation": {
    "items": [
      { "metric": "per_ad_link_ctr", "target": "≥ 1.8%", "horizon_days": 3, "scope": "each_new_static_ad" },
      { "metric": "cpl_ratio_to_target", "target": "≤ 1.0", "horizon_days": 3, "scope": "adset", "consecutive_days": 2 }
    ]
  },
  "stop_or_rollback_zh": "任一新静图花费约达 3× 目标 CPL 且 0 线索则暂停该广告；并观察 CRM「已报价」占比是否异常走低。",
  "review_due_on": "2026-11-17",
  "status": "active",
  "review_result": null
}
```

---

## 6. 实现拆分（含决策记录）

| 序号 | 标题 | 级别 | 依赖 | 验收标准（可观察） |
|------|------|------|------|-------------------|
| **PR-1** | 旧 ME 日内采样扩列：点击等 + 表 migration（§8.2 已定） | **A** | #3827 可选 | `ad-intraday-spend-sample?dry_run=1` 夹具含新字段；migration 过 CI；**不**改 breaker 判定逻辑 |
| **PR-2** | 日趋势规则引擎 + `leads_config.ads_trend_check`（触发/兜底） | **B** | 日表 CTR/CPL；采样路径已定 | 脱敏夹具 **第 6–11 天** 内规则可触发 `creative_fatigue`；`cron_run_logs` 有回执 |
| **PR-3** | D+1/D+3/D+7 执行后 Check + 广告门展示（规则结果；AI 来后叠加） | **B** | #3803/#3814 | 假动作登记后可见节点；与 `reviewCase` 不打架 |
| **PR-4** | Tune：`action_list` 新 remedy + 调方确认卡 + 社媒工单 | **B**（v1 narrow 仅建议卡 · §8.3） | AD-2/AD-3 | 诊断/处方草稿 → 确认卡；`narrow_audience` 无 Meta 写；幂等 + 守卫测试绿 |
| **PR-5** | 快照 diff 进 Check / 归因脚注 | **B** | 日快照 | hash 变无 `action_runs` → `external_change_detected` |
| **PR-6** | **AI 分析层**：读采样+日表 → 结构化结论 → 回看 + 待办 + 可选处方草稿 | **B** | PR-2；PR-1 有点击 | 客户 C 组 A 重放 **第 6–11 天**：`素材疲劳、点击率走弱` + `swap_creative`；直写 Meta **0** |
| **PR-7** | **决策记录 + 回头看**：`ads_decision_v1`、人工/不动作入口、到期 AI 复盘写回 + 经验库 | **B**（仅 JSONB 扩展）；**A**（若独立 `ads_decision_records` 表） | #3803/#3809；PR-6 写 `review_result` | 确认卡执行自动生成记录；组 A 示例 JSON 可手录入并到日到期待办；`client_learned_preferences` 有新 extracted 行；华佗 scope 可读摘要 |

**建议合并顺序**：PR-1 → PR-2 → **PR-7** 与 **PR-6** 可并行（PR-7 复盘调用 PR-6）→ PR-3/4/5。

**与既有草稿**：#3827、#3828 应先合入再叠 PR-2，避免管道仍吞卡；本设计 **不替代** 熔断，只补 **早于 2× CPL** 的诊断层。

---

## 7. Reuse Statement（设计稿）

| 问题 | 回答 |
|------|------|
| 复用了什么？ | 日拉数与日表、熔断判定框架、执行归因（#3803）、确认卡发卡（#3819）、日内采样 cron、`leads_config` 覆盖模式、`flywheel_actions` 记账、`client_learned_preferences` + #3809 读回 |
| 新增哪些是平台共享？ | 趋势规则纯函数、`ads_ai_check_v1`、`ads_decision_v1` 契约、AI 成本帽、`ads_trend_check`、Tune remedy 枚举、社媒工单事件名 |
| 行业 / 客户专属？ | 仅阈值默认值可进 playbook；客户 C 只作回归夹具，不进 runtime |
| 是否把客户事实写进 shared code？ | 否；夹具在 `__tests__/fixtures` 脱敏 |
| 学习记忆？ | 决策复盘结论写 `client_learned_preferences`；重复验证了才升 industry memory |

---

## 8. 十分钟采样盘点：旧 ME（本仓库）vs 新版（magic-engine-platform）

> 以下事实来自 **只读核对代码**（本仓库 + 新版私有仓描述），不含任何客户标识。

### 8.1 能力对照

| 维度 | 旧 ME（magic-engine · 本仓库） | 新版（magic-engine-platform · 私有仓） |
|------|--------------------------------|----------------------------------------|
| **调度** | Cron `ad-intraday-spend-sample`，约每 **10 分钟**（`cron-dispatch-frequent` 派发） | Worker 每 **60s** 扫描；任务 `ad_health.intraday`；每客户间隔 **0/10/15/20/30/60** 分钟，默认 10，`0`=关 |
| **Meta 拉数字段** | Insight：**adset** 级；仅 `adset_id`、`spend`、`impressions`；`level=adset`；账户本地日累计 | **campaign** 级；`campaign_id`、`campaign_name`、`spend`、`impressions`、`inline_link_clicks`、`actions`；另 **hourly**（`time_increment=1`，广告主时区） |
| **层级** | ACTIVE **广告组** 入库，并 **汇总到系列** | **仅系列**；无 adset/ad 级 10 分钟样本 |
| **成效** | 不拉 `actions` / 主成效 | `actions` 取 lead/message/purchase/registration **最大值**（非求和） |
| **存储表** | `public.ad_intraday_spend_samples`：`client_id`、`ad_account_id`、`account_day`、`sampled_at`、`local_minute`（10 的倍数）、`entity_level` campaign/adset、`entity_id`、`spend_minor`、`impressions`、`currency`、`timezone` | `core` 架构：`ad_intraday_rounds`（含失败与零花费轮次）、`ad_intraday_samples`、`ad_hourly_history`、`ad_intraday_state`；每轮最多 **50** 系列 |
| **未存储（共用缺口）** | 无账户级行、无 ad 级、无小时明细；无 clicks、CTR、reach、frequency、results/actions、**placements**、**表单打开** | 无 reach、frequency、**placements**、表单打开、Meta 原始 CTR（CTR/CPC/CPM **派生**） |
| **保留** | **14 天** | rounds/samples **35 天**；hourly **60 天** |
| **分析用途** | 收盘花费预测、超日封顶确认卡（`cap-proposal-run`）、广告门 live pacing、采样停摆告警 | 同时段 vs **7 日均**与昨日、收盘预测、派生 CTR/CPC、pace 告警（`pace_spend_high/low`、`pace_cost_high`、`pace_no_results`）off/dry/live；控制台与客户页；可选 no-results 自动处理 |
| **诊断** | 无 CTR 趋势、无创意疲劳、无 AI 结论 | 仍 **阈值规则**，无 AI 综合结论 |

**与本设计关系（Ray 已定 · §8.2）**：v1 在 **旧版加字段**（至少 clicks）→ **PR-1 A 级**；迁移新版后再读统一采样。两版都 **没有** reach/frequency/placements/表单打开/ad 级 10 分钟样本——§3.5 AI 层 v1 用 clicks/impress + 日表补叙事，版位/表单列为后续增量。

### 8.2 采样路线 · **Ray 已定 2026-11-14**

**决定**：**「采样先在旧版补，以后迁新版」**

1. **现在（v1）**：在 magic-engine（旧 ME）扩 `ad_intraday_spend_samples` + `ad-intraday-spend-sample` cron，至少增加 **clicks**（理想含 ad 级/版位）→ **PR-1（A 级 migration）**。  
2. **以后**：数据与读数迁到 magic-engine-platform 新版采样（或统一数据服务）；本仓重复 cron **退役或只读转发**，单独排期，不在 Check/Tune 首波 PR 内。

**曾考虑的备选（留档，本次不选）**：

| 选项 | 说明 |
|------|------|
| A · 复用新版采样 | 本仓只读拉新版 `ad_intraday_samples` / hourly；跳过 PR-1 migration，但要跨私有仓接线 |
| B · 先在旧版补 ✓ | 与熔断/封顶/#3827 同库；短期双轨维护，长期再迁 A |

**PR-6 AI 分析层** v1 读 **旧 ME 补完后的** 点击 + 展示序列 + 日表；版位/表单非阻塞。

### 8.3 产品默认 · **默认，Ray 未反对前按此**

下列为设计与实现的 **默认行为**（非 §8.2 级拍板；Ray 未明确反对则按表执行）：

| # | 默认 |
|---|------|
| 1 | **D+1 / D+3 回看** 与暂停卡 **3 天观察窗**（#3803）在 UI **合并一块**展示，一条时间线（§3.2）。 |
| 2 | **`narrow_audience` v1** 只出 **建议卡**，说明收窄方向；**从不写 Meta**（§4.2）；PR-4 按 **B 级**。 |
| 3 | **今日待办** 排序：熔断类 **暂停确认卡** 优先于 AI **`verdict: worse`** 条目（§3.5.5）。 |
| 4 | **`auto_draft_prescription`** 全户默认 **关**；**仅 pilot 客户 C** 可先开，用于回放验收与真网试跑（§3.5.5）。 |

### 8.4 待 Ray 拍板（决策记录 + 回头看）

1. **PR-7 存哪**：仅 `flywheel_actions.payload` JSONB（B）还是新建 `ads_decision_records` 表（A）？  
2. **人工录入权限**：仅 FDE/PM，还是客户 owner 也能记「ME 外改动」？  
3. **Agent 起草确认**：`pending_confirm` 决策是否必须 Ray 本人点认，还是任意 `paid_client` 操作员可认？  
4. **回头看与 #3803**：同一动作上 `reviewCase`（CPL 三档）与 `review_result`（自定义 expectation）**合并一条 UI** 还是上下两段？  
5. **CRM「已报价」占比**：v1 是否硬依赖 CRM 阶段统计进 AI 复盘，还是先写进 `expectation` 文本、数据后补？

---

## 9. 文档变更说明

- 本稿仅新增 `docs/design/` 下本文件；**不**强制新建台账卡（未改 `src/`，门卫不要求 ledger）。
