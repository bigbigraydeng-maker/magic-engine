# Ad Strategy Engine · 投放师大脑 · spec v0.2

> 起草:子牙 · 2026-07-13 · Track B(ME 产品化)· v0.2 吸收魏征(needs_rework→修 2 P0)+ 板桥(approve_with_fixes,C 端 2 P0)双审
> 载体样例:CTS Tours NZ(Meta 广告 pilot)—— **CTS 只是第一个真实案例,不是产品本身**。全 spec client-agnostic,所有 CTS 具体值(campaign ID / 触发阈值 / 预算锁 / 漏斗层结构)都是**per-client 配置的初值**,不是产品硬编码。
> 原型:`docs/clients/cts/2026-07-12-ad-battle-plan.md` §8(方法论)+ `~/.claude/scheduled-tasks/cts-meta-daily-selfcheck/SKILL.md`(手工前身)
> 姊妹 spec(作品层,不重复):`docs/superpowers/specs/2026-07-11-creative-lifecycle-engine.md`
> DAPE 定位:**A(华佗评分)+ P(诸葛亮处方)为主 · D(司马徽发现异常)为触发 · 喂 E(鲁班执行)** · 6 支柱 = **广告柱** · 轨道 = **FDE** · AI memory = 客户级 + 行业级
> 状态:v0.2 起草候选,**未实现任何代码/migration**

---

## 0. 一句话

把一个资深投放师每天盯广告账户的脑子产品化:**每天自动拉账户级真实数据 → 判每条 campaign 和每层漏斗是健康还是疲劳 → 命中触发线就出处方(默认非预算杠杆)→ 落库进账户健康叙事 → 一张仪表盘 + 一封日报推给 PM**。它管的是**账户/campaign/漏斗层**(投放师视角),不是单条创意的生死(那是 Creative Lifecycle Engine 的活)。

激进的不是烧钱,是**判定的确定性**:每个 🔴 告警都必须先过多视角对抗验证(证伪「单日噪音 / 投放饥饿 / learning 期噪音 / 假信号」)才成立 —— 防盲调、防仓促决策。交付层的全部价值在于**让一个不懂投放的 PM 敢信、每天愿意看**,不是把投放师视角原样糊他脸上。

---

## 1. 与 Creative Lifecycle Engine 的分工(广告柱两半)⭐

「广告柱产品化」= 两个引擎,一个管账户,一个管作品:

| | **Ad Strategy Engine**(本 spec · 策略层 · 账户大脑) | **Creative Lifecycle Engine**(姊妹 spec · 作品层) |
|---|---|---|
| **判定单元** | campaign / 漏斗层 / 整账户 | 单条 creative |
| **核心问题** | 账户健不健康?哪层疲劳?哪层被预算饿着?预算该不该在层间流动? | 这条创意该活该死?晋升还是退役? |
| **典型裁决** | 「Reborn 频次爬到 2.6 + CTR 连跌破 2% → 换创意」「日均掉出 8/天 → 深查」 | 「G1:hold rate 置信上界 < 65% → kill」「G4:晋升进 L3」 |
| **节奏** | 每日 1 次自检(轻量确定性)+ 异常触发深度复盘 | 每 6h 判 G1 / 每日判 G3 疲劳 |
| **DAPE 侧重** | A 评分 + P 处方(账户战略) | 主要是 E 执行层自动化(作品流水线) |
| **落库** | `ad_health_narratives`(账户级日叙事,独立表,见 §6.3) | `creative_autopsy`(作品级尸检) |

**共用地基**(两半都吃,不重复造):
- **Meta 数据脊柱**:同一套 server-side per-client token 解析路径(见 §6)。策略层要 campaign 级日度;作品层要 ad 级 6h。一个脊柱两个消费者。
- **winner-sync 执行层**(Phase 34.A)。
- **诊断 collector**(`ads-collector.ts`)+ 6 支柱 'ads' 维度。

**handoff 契约**(策略层「哪层要补、补几条、什么调性」→ 作品层「补哪几条具体 creative」):
- 数据载体 **v0.3 定义,本期不实现**。候选:新建 `creative_supply_requests`(策略层写、作品层读)或复用 `winner_reel_sync_config` 加字段。**本期只做口头契约 + 显式标注未落 schema**(学姊妹 spec 对 organic 加权的诚实标注,不假装有)。P5 联调前必须补此 schema,否则两引擎无承接字段。
- **winner-sync feed 读权 owner**:`winner_reel_sync_log` 两个引擎的仪表盘都**只读**展示,无双写。策略层仪表盘展示「昨夜结果」,作品层展示「作品生命周期」,同源不同视角。

**边界铁律**:创意死活 → 作品层。campaign 疲劳 / 漏斗层饥饿 / 层间预算调度 → 策略层。策略层**永不**直接裁一条 creative 生死;作品层**永不**动 campaign 预算或跨层调度。两者只通过 handoff 契约交互,不互写对方的表。

---

## 2. 现状与缺口(已核实的 ME 代码库事实)

| 能力 | 现状 | 缺口 |
|---|---|---|
| **数据** | `meta_ads_snapshots`(手动触发 + 期级,非日度)· `flywheel_metrics` 有 7 个**账户级**日指标(`google-data-pullback-daily` cron 写) | 🔴 **没有每日 campaign/ad 级自动拉取 cron** —— 触发线要 7d 滚动 freq、连续日 CTR/CPL,现有日度只到账户级 |
| **诊断** | `diagnostic_runs` / `findings` / `narratives` 已有 · 6 支柱含 `ads` 维度 · `ads-collector.ts` 已在 | `diagnostic_narratives` **不适合**放日度叙事(schema 冲突,见 §6.3)→ 新建独立表 |
| **执行** | `AdsAuditSection` + `/api/clients/[id]/meta-ads/execute` 已能 pause / 调价 / 重激活 + 审计留痕 | 🟡 改预算后**不自动重激活**——撞 force-pause 坑(§10);且无 budget_policy 硬闸 |
| **winner-sync** | `winner_reel_sync_config` / `_log` 已上线(Phase 34.A),**Render Cron** 每日 03:00 NZST server-side 跑 | 无(直接复用) |
| **Meta token** | 存在 **env var**(`META_SYSTEM_USER_TOKEN_<KEY>`),`getMetaTokenForClient()` 按 domain→env-key 解析(不在 DB) | token 到期无自动探活(靠人肉);改走「拉取失败/401 → 活信号」(§8.3) |
| **邮件** | ME 已集成 **Resend**(`src/app/api/contact/route.ts`) | Zapier Gmail 免费额度撞 402,**弃用**,改走 Resend |
| **DAPE agent** | huatuo(华佗)/ zhuge(诸葛亮)/ luban(鲁班)已建 + 接 memory | simawei(司马徽,D 发现)未建(Phase 35);本引擎 D 段先用规则触发 |

> ⚠️ **v0.1 两处 P0 事实错误已修正**(魏征核实):
> 1. **cron 栈**:winner-sync **已从 GitHub Actions 迁到 Render Cron**(PR #542/#545,迁移原因正是 GHA scheduled 是 best-effort、2026-07-11 15:00 UTC 那次没触发)。本引擎 cron **用 Render Cron**(与 winner-sync + google-data-pullback 同栈,都在 `render.yaml`),**绝不用 GHA**(重蹈已修复的漏跑事故)。姊妹 spec 有同一「沿用 GHA」笔误,需单独小 PR 修(见 §14)。
> 2. **落库**:`diagnostic_narratives` 的 `kind` 是 CHECK 约束(非 enum)+ `run_id NOT NULL REFERENCES diagnostic_runs` + UNIQUE(run_id,kind,dimension) —— 日度账户叙事塞不进去。改用独立表(§6.3)。

---

## 3. 架构总览

```
                        ┌─────────────────────────────────────────────┐
                        │  每客户配置(ad_strategy_configs + UI · §11)  │
                        │  漏斗层定义 / campaign→层映射 / 触发阈值 /     │
                        │  预算策略 / delivery门槛 / PM收件人 / enabled  │
                        └───────────────────┬─────────────────────────┘
                                            │ 驱动全流程(client-agnostic)
   ┌────────────────────────────────────────▼──────────────────────────────────────┐
   │ P1 数据脊柱 · Render Cron 每日拉取(复用 getMetaTokenForClient env 路径)         │
   │   Graph API insights level=campaign(+account) daily 增量                        │
   │   + 额外一次 date_preset=last_7d(拿 7d frequency,不聚合日度)                   │
   │   + effective_status / learning_stage_info / delivery(learning & 限投探测)      │
   │   → 时序表 ad_daily_insights                                                     │
   └────────────────────────────────────────┬──────────────────────────────────────┘
                                            │ 日度时序 + 7d 窗口值
   ┌────────────────────────────────────────▼──────────────────────────────────────┐
   │ P2 大脑 · 触发线引擎                                                             │
   │   D 司马徽:扫时序,发现越线异常(持续/多日 · 冷启动不足 N 天→insufficient_history)│
   │   A 华佗:每条 campaign + 每层漏斗打 verdict(🟢/🟡/🔴 + 人话为什么)             │
   │   P 诸葛亮:命中→出处方(按 budget_policy;locked=非预算杠杆 · execute 层硬闸)     │
   │   §7.1 对抗守门:🔴 成立前证伪(单日噪音 / 投放饥饿 / learning 期噪音)            │
   │   → 落库 ad_health_narratives(账户级日叙事,payload 供日报+仪表盘同源)          │
   └────────────────────────────────────────┬──────────────────────────────────────┘
             ┌──────────────────────────────┼──────────────────────────────┐
             ▼                              ▼                              ▼
   ┌──────────────────┐        ┌──────────────────────┐      ┌──────────────────────┐
   │ P3 仪表盘(方案C-a)│        │ P4 Resend 日报(方案C-b)│      │ 异常触发 → 深度复盘   │
   │ 分层:PM默认视图    │        │ 倒金字塔·只讲例外       │      │ 多视角对抗工作流(§7.2)│
   │ + 专业下钻         │        │ 全绿降频·抗疲劳         │      │ → 作战计划 → E 鲁班   │
   └──────────────────┘        └──────────────────────┘      └──────────────────────┘
```

**两个节奏**:①**每日自检**(引擎 P1–P4):轻量、确定性、always-on。②**异常深度复盘**(工作流 §7.2):重量级、多视角对抗、异常触发或按需。日检发现真异常 → 触发深度复盘 → 出处方 → 执行 = DAPE 一个完整循环。

---

## 4. DAPE 四段映射

| 段 | agent | 本引擎做什么 | 落点 |
|---|---|---|---|
| **D** 发现 | 司马徽(未建,先规则触发) | 每日扫时序,发现越线异常:freq 爬升 / CTR 连跌 / CPL 连续多日高 / 某层被预算饿着 / 日均掉出目标线 / campaign 卡 learning 或限投 | finding 候选 |
| **A** 分析 | 华佗 ✅ | 给 `ads` 支柱打分:每条 campaign + 每层漏斗 verdict + **人话为什么**(读真实时序,不臆测) | `ad_health_narratives` |
| **P** 处方 | 诸葛亮 ✅ | 命中触发线 → 出处方 + **下一步归属**(§8.2)。按 budget_policy(§11):`locked` 只出非预算杠杆 | narrative 处方段 + 深度复盘作战计划 |
| **E** 执行 | 鲁班 ✅ | 翻译成 `/meta-ads/execute` 动作(pause / 调价 / 重激活,经 §10 加固 + budget_policy 硬闸)+ winner-sync 补创意;三落库归因 | 执行看板 + 归因链 |

**AI memory 闭环**:华佗 + 诸葛亮已接客户级 + 行业级 memory。触发线定标(§12)是客户级 learned preference;每次 verdict 的 outcome(处方执行后指标有没有回落)+ **PM 的「误报驳回」反馈**(§8.1)经周度 `agent-learning-rollup` cron 回灌 `client_learned_preferences`,让阈值随客户历史自校准。

---

## 5. P1 · 数据脊柱(每日 campaign 级拉取)

**目标**:补掉「没有每日 campaign/ad 级自动拉取」缺口,给触发线引擎喂日度时序。

- **cron**:**Render Cron**(与 winner-sync + google-data-pullback 同栈,`render.yaml`)。参照 winner-sync 的 `curl -H 'Authorization: Bearer <CRON_SECRET>' https://app.magicengine.com.au/api/cron/...` pattern。时刻 04:00 NZST(winner-sync 03:00 之后,拿当日完整数据 + winner-sync 结果)。**窗口按广告账户 NZST/AEST 对齐**,cron 时刻只是触发器不是窗口边界。**绝不用 GHA**(§2 事故教训)。
- **拉取**:server-side Graph API `insights`,复用 winner-sync 的 **env-based per-client token 解析路径**(`getMetaTokenForClient()`,domain→env-key;token 在 env 不在 DB)。
  - `level=campaign`(策略层触发线主食)+ `level=account`(综合掉线线)
  - **日度增量**:`date_preset=yesterday` 落一天(spend / impressions / reach / ctr / outbound_clicks / actions[leads + messaging_conversation_started] / cost_per_action / date_start)
  - **7d 窗口值**:**额外一次 `date_preset=last_7d`** 拿 **7d frequency**(⚠️ Meta 的 `frequency` 是账期内累计 reach 派生,**不能把 7 个日度 frequency 相加/平均** —— 那是错的;7d frequency 必须从 7d 窗口单独取,或存日度 reach+impressions 让引擎算)
  - **账户健康探测**(P2-1 遗漏项补齐):`effective_status` / `configured_status`(实体状态)+ ad_set 层 `learning_stage_info`(learning / learning_limited)+ delivery 状态(是否限投 / disapproved / 支付失败)
  - **合并调用**:`insights level=campaign` 一次拉全账户所有 campaign(BUC 积分制友好)
- **落库**:时序表 `ad_daily_insights`(新建 migration 待 PM 拍板)。主键 `(client_id, level, entity_id, insight_date)`。`level ∈ account/campaign`(作品层 34.B 若要 `ad` 级复用同表加 `level='ad'`)。RLS **service-role 模板**(不引用 workspace_id / client_team / auth.uid)。
- **降级**:某客户 token 失效/401 → 该客户当日跳过 + 落 `pull_failed` 状态(**真活信号**,喂 §8.3 token 预警),**不让整个 cron 挂**(多客户隔离)。

---

## 6. P2 · 大脑(触发线引擎 + verdict + 落库)

### 6.1 触发线判定(核心纪律 + 冷启动)

引擎每日读时序,对每条 campaign 按其**配置的触发线**(§11,per-client)逐条判。**最高纪律**(继承 SKILL 步骤 5):

> **单日坏数据 ≠ 触发**。必须「持续/多日」才算真信号。**频次和 CTR 趋势比单日 CPL 可信**(真疲劳 = 频次爬升 + CTR 下行,不是 CPL 单日跳)。

**冷启动纪律**(P1-4):rolling window 数据点 **< 触发线要求的 N 天** → 该触发线输出 `insufficient_history`,**不报 🔴**(对齐姊妹 spec `insufficient_delivery` 同款纪律)。新客户/新表头几天静默积累,不误报。

**7d frequency 来源**(P1-5):来自 §5 的 `last_7d` 窗口拉取,**不是日度 freq 聚合**。仪表盘「freq 趋势图」画的是**每日的 7d 滚动 frequency**(每天一个 7d 窗口值),不是日度瞬时 freq —— 两者不是一个东西,实现须一致。

三档 verdict:🟢 健康 / 🟡 观察(接近线或历史不足) / 🔴 告警(持续越线且过对抗守门)。

### 6.2 漏斗层视图(层结构本身也是 per-client 配置)⭐

不止看单条 campaign,还看**层间关系**(battle-plan §1 判断 4 产品化):每层聚合 CPL + freq,发现「哪层被预算饿着 / 哪层打透」→ 处方预算该往哪层流(受 budget_policy 约束)。

> ⚠️ **client-agnostic 硬修**(P1-3):漏斗层的**数量和命名本身**是 per-client 配置 `funnel_layers: [{key, label, order}]`,**不是硬编码四层**。CTS pilot 恰好是「冷/温/蓄水/转化」四层;电商客户可能只有一层转化、无蓄水;B2B 可能有 CTS 没有的「MQL 培育层」。campaign→层映射引用配置的 layer key。仪表盘/日报按客户配置的层**动态渲染**,不写死列数。否则 P5 泛化每客户都要改代码 = 没产品化。

### 6.3 落库:独立表 `ad_health_narratives`(不塞 diagnostic_narratives)⭐

> ⚠️ **P0 修正**(魏征核实 `20260518000002_diagnostic_narratives.sql`):`diagnostic_narratives` 有三重约束堵死日度叙事 —— `kind` 是 CHECK(非 enum,加值要 DROP/ADD CONSTRAINT)、`run_id NOT NULL REFERENCES diagnostic_runs`(每条强制挂一次诊断跑,日检没有这个 run)、UNIQUE(run_id,kind,dimension)。日度账户叙事和「一次 6 支柱诊断跑的 narrative」是两种生命周期,硬塞会被 run_id + UNIQUE 拧死。

**新建独立表 `ad_health_narratives`**(migration 待 PM 拍板):
- 主键 `(client_id, insight_date)`(无 run_id 依赖)· RLS service-role 模板
- `overall_verdict`(🟢/🟡/🔴)+ 结构化 `payload`(JSON)+ `email_status`(sent/failed/skipped)
- **payload 一份供日报 + 仪表盘同源**(不重算):
  ```
  { overall: {verdict, headline, action_items:[...]},
    campaigns:[{id, name, layer_key, verdict, why_plain, metrics, series_7d, trigger_hits, prescription:{action, ownership}}],
    funnel:[{layer_key, label, cpl, freq, diagnosis_plain}],
    winner_sync:{ads_added, ads_paused, guards_hit},
    dismissed:[...] }   // PM 驳回记录
  ```
- `series_7d`:每条 campaign 的**近 7 天原始值序列**(供 §8.1 信任核对,不只折线)

### 6.4 处方纪律(不臆测业务 + budget_policy 硬闸)

- 处方只出**动作类型**(换创意 / 降频次 / 改 offer / 层间调预算),具体业务方向(推哪个团、什么文案)必须来自 `master_briefs` + 真实数据,**绝不凭空注入**(CLAUDE.md + memory `feedback-masterbrief-before-content-planning`)。
- **budget_policy 硬闸**(P1 client-agnostic 复核):`locked` 客户拦截加预算处方,**拦截点在 execute 层硬校验**(读 config.budget_policy,`locked` 时任何 `daily_budget` 增加的 execute 请求直接拒绝 + 审计留痕),**不是**只靠诸葛亮 prompt 软约束(LLM 会漏)。参照姊妹 spec「校验放最里层」纪律。

---

## 7. 多视角对抗式验证(可复用能力 · 防盲调)⭐

battle-plan §8 方法论固化成 ME 可复用能力,防「拉了点数据就拍脑袋调」和「单日噪音触发仓促决策」。

### 7.1 日检 verdict 守门(轻量,内嵌引擎)

每个 🔴 告警在成立前,自动过前提证伪:
- 「单日噪音?」→ 查是否持续多日(§6.1)
- 「投放饥饿不是疲劳?」→ 查 spend/impressions 是否达 **per-client delivery 门槛**(§11 配置项,campaign 级,CTS 初值见 §12;比姊妹 spec 单 ad 门槛高)
- 「learning 期噪音?」(P2-1)→ campaign/ad set 卡在 learning / learning_limited(尤其刚被改预算 force-pause+重激活的,§10)→ **learning 期坏数据不触发疲劳 verdict**
- 「假信号?」→ CTR/CPL 量级是否够判(小样本抛硬币不算)

过不了证伪 → verdict 降级 🟡 观察,不触发动作。

### 7.2 异常深度复盘(重量级,按需/异常触发)

日检发现持续真异常(如综合掉线线命中)→ 触发完整作战计划生成(battle-plan §8 产品化):

```
数据地基自动拉取(master_brief + 账户现状 + Ad Library 竞品)
   ↓  关键生意事实收敛(只问客户 source-of-truth:目标/客单价/旺季/复购)
   ↓  N 视角并行推演(增长反推 / 漏斗 / 内容 / 预算 / 竞品)
   ↓  每视角独立证伪其他视角前提(对抗,不附和)
综合作战计划(预算表 + 创意清单 + 时间表 + 每日看板 + 风控阈值)→ 喂 E 鲁班
```

- **载体**:ME 内 Workflow / agent 能力(fan-out N 视角 → 每视角证伪 → 综合),**不是手搓**。
- **对抗性硬要求**:N 视角不互相附和,每个必须尝试**证伪**主张前提(「perspective-diverse verify」模式:每 verifier 不同 lens)。
- **触发**:综合掉线线命中 / PM 按需 / Day-N 定标复盘。**不每日跑**。
- **产出**:作战计划存客户文档 + 关键决策进 `ad_health_narratives`,喂 memory 供下次复用。

---

## 8. 交付层(方案 C · PM 2026-07-13 拍板)⭐

> 交付层的全部价值 = 让不懂投放的 PM **敢信、每天愿意看**。以下四件事(可读 / 可执行 / 可信任 / 抗疲劳)是硬要求,不是收尾功能(板桥总评)。

### 8.1 (a) 仪表盘 `/dashboard/clients/[id]/ads-health`(分层,不平铺)

消费 §6.3 payload。**分两层视图**(P2-2:非技术 PM 一屏六块 = 不知先看哪):

- **PM 默认视图(顶部)**:一句话整体结论 + 需要动手的事(与日报同源)+ 每条 campaign 的 verdict 卡。
  - **verdict 卡**必含「**近 7 天原始值序列**」小数字条(P1-3 信任):如「频次:1.2→1.5→1.9→2.3→2.6(一路在爬)」—— 让 PM **自己看到数字往坏走**,不只是折线 + 机器说辞。第一次信任靠「我亲眼看到」。
  - 每条 verdict 卡有「**驳回/标记忽略**」按钮:PM 判断是噪音 → 一键驳回,该反馈回灌 memory(§4)+ 记进 payload.dismissed。给 PM 驳回出口 = 维持信任的关键(被误报坑一次不给出口就永久不信)。
- **专业下钻视图(折叠/二级 tab)**:触发线状态灯、漏斗层面板、winner-sync feed、趋势折线 —— 给懂的人展开,**不默认糊 PM 脸**。
- **趋势图**必配「这条在变好/变坏」的自然语言注解(P0:非技术 PM 不自己解读折线)。
- 复用 `AdsAuditSection` 执行按钮(经 §10 加固 + budget_policy 硬闸),🔴 可就地执行。
- **漏斗处方用生意语言不用漏斗语言**(P2-3):不说「温层被饿着」,说「已经对你感兴趣、快下单的这批人没被充分触达,是浪费」。locked 客户面前**统一非预算语言**(别一会儿「喂钱」一会儿「不能加钱」绕晕 PM)。

### 8.2 (b) Resend 日报(倒金字塔 · 只讲例外)⭐

用 ME 自己的 Resend(已集成),日检 cron 尾发。**替代 Zapier Gmail**(免费额度撞 402,弃用)。

- **主题**:`[<客户名> Ad 自检] {日期} · {状态}`(状态:`🟢 全绿` / `🔴 N 项告警` / `🟡 N 项提醒`)—— PM 看标题就能 triage。
- **正文 wireframe**(P0:必须画实际长相,否则实现期会平铺 payload 导致过载):

  **全绿版**(一行,不过载):
  ```
  🟢 今天你的 4 条广告全部健康,无需动手。
  本周引擎替你盯着,省下 N 次盲调 · Retargeting 仍是全场最低成本 $5/询盘。
  → 想看细节:[仪表盘链接]
  ```

  **🔴 版**(倒金字塔,第一屏只讲例外,≤3 条):
  ```
  🔴 今天有 2 件事要看:

  1. Reborn(冷启动广告)· 看腻苗头
     同一个人平均看了 2.6 次(上周 1.2),点击率连跌破 2% —— 观众开始疲了。
     建议:换新素材。→ ME 已通知创意流水线补 2 条,预计明天到位,你无需动作。

  2. WhatsApp 对话广告 · 转化偏低
     每个对话 $25 且这周没转成询盘。
     建议:换个更具体的开场诱因。→ 这条需要你定方向,建议找 Baker 拟文案。

  ✅ 其余 2 条(温层/蓄水)健康,无需动手。
  → 逐条明细 + 趋势:[仪表盘链接]
  ```
  campaign 逐条明细、趋势、运维项**全部收到「详情看仪表盘」之后**,不进第一屏。

- **处方带「下一步归属」**(P0:处方到执行的断层)—— 每条处方标清三类之一:
  1. **就地/自动做** → 「点这里执行」+「这一步 ME 自动做 / 你点一下就好」
  2. **需作品层供创意** → 「已自动通知创意流水线补 X 条,预计 Y 到位,**你无需动作**」(让 PM 知道不是甩他活;命中「遇卡点必自动化」红线)
  3. **需 PM 定方向** → 「这条需要你定方向,建议找 X」
- **抗疲劳**(P1:天天全绿 PM 三天就免打扰,真 🔴 躺已读堆)—— 配置项:
  - **全绿降频**(默认开):全绿只在**状态变化**(绿转黄/黄转红/首次转红)时即时发;持续全绿改**每周一封**「本周持续健康」摘要。让每封落 PM 邮箱的邮件都值得点开。
  - 全绿摘要给**正反馈价值**:「本周省下 N 次盲调 / Retargeting 仍全场最低 CPL」—— 不是「又没事的一天」而是「引擎在替你盯且有战果」。
- **收件人**:per-client 配置(§11),不硬编码。
- **Resend 免费额度**:100/天、3000/月,每客户每天一封远够;实现期确认**发件域名已验证**(否则进垃圾箱)。
- **降级**:Resend 失败**不重试不上抛不让 cron 挂**(narrative 已落库,仪表盘仍可见)。

### 8.3 token 到期 → FDE 运维告警(移出 PM 日报)⭐

> P1 修正(魏征)+ P3(板桥)汇合:`token_expiry_date` 手填死数字与 env 真实 token **零联动**(是假指标),且 token 是运维事项 PM 看不懂也不该他续 —— **双重理由移出 PM 日常日报正文**。

- token 探活**改用真活信号**:§5 的 `pull_failed`/401 → 「数据连接可能断了」告警。
- 告警**发给能续 token 的 FDE/技术侧**(单独渠道,非 PM 日常日报)。
- 只有真断了(连续 pull_failed)才在 PM 日报里用人话提一句「你的广告数据连接中断,ME 团队正在处理」—— 不放每天倒计时。

---

## 9. 术语翻译表(内部黑话 → PM 面前人话)⭐

强制契约(类比「第三方服务封装名」表):渗进 UI/日报的投放术语必须翻译,否则 §8 的「大白话」是空头支票(P2)。

| 内部字段/术语 | PM 面前人话 | 规则 |
|---|---|---|
| frequency | 「同一人看这条广告的次数 / 看腻程度」 | 翻译 |
| CPL | 「每个询盘花了多少钱」 | 翻译 |
| CTR | 「多少人看了会点」 | 翻译 |
| CPM / 完播成本 / hold rate / learning phase / BUC | —— | **纯内部词,绝不出现在 PM 面前**,只留诊断日志 |
| ThruPlay / CTWA / Reborn / Retargeting | 「视频蓄水 / WhatsApp 对话广告 / 冷启动广告 / 再营销」 | campaign 代号配人话注解 |
| budget_policy: locked/scale/free | 「锁死预算(引擎绝不建议加钱)/ 允许扩量 / 完全放开」 | UI 三态用人话 |
| 漏斗层(冷/温/蓄水/转化) | 用生意语言描述人群阶段(§8.1) | 翻译 |

---

## 10. `/meta-ads/execute` force-pause 守卫(顺带加固)⭐

**坑**(memory `reference-meta-mcp-budget-update-forces-pause`):`ads_update_entity` 改 `daily_budget` 会 **force pause**,必须配对 `ads_activate_entity`。现 execute 改预算后不自动重激活。

**守卫**:execute 处理**含预算变更**动作时:
1. 改预算前记录 entity 原 `effective_status`
2. 改完**用 entity read 回读 status**(非 insights —— insights 有 15min-3h 延迟,entity 状态即时;但翻转偶有传播延迟 → 加**短重试**,P2-4)
3. 原为 active 而改后 paused(force-pause 命中)→ **自动重激活**
4. 审计留痕记录

- **同时接 budget_policy 硬闸**(§6.4):`locked` 客户的加预算 execute 请求直接拒绝。
- 测试覆盖:①改预算 force-pause → 自动重激活 ②本就 paused 改预算 → **不**误激活 ③非预算动作 → 不走此路径 ④locked 客户加预算 → 拒绝。
- **可独立于 P1–P5 先合**(降 pilot 期人工执行踩坑)。

---

## 11. 每客户配置 + UI(CLAUDE.md 红线 + 非技术 PM 友好)⭐

**红线**:FDE/PM 客户级字段**必须连 Settings UI 一起做完**,绝不「进 Supabase 直填 SQL」。

**配置项**(建议表 `ad_strategy_configs` + 子表 `ad_strategy_triggers`,DDL 待 PM 拍板 migration · RLS service-role):

| 配置 | 类型 | CTS pilot 初值(样例) |
|---|---|---|
| `enabled` | bool | true |
| `budget_policy` | enum locked/scale/free(UI 人话) | **`locked`**(Track A) |
| **`funnel_layers`** | JSON [{key,label,order}] | 冷/温/蓄水/转化(**其他客户各自定义**) |
| campaign→层映射 | JSON | Reborn=冷 / Retargeting=温 / ThruPlay=蓄水 / CTWA=转化 |
| 每 campaign 触发线 | 子表行 | 见 §12 |
| **campaign 级 delivery 门槛** | 子表列 min_spend / min_impr | CTS 初值见 §12(比姊妹 spec 单 ad 高) |
| `pm_email_recipients` | text[] | per-client |
| 全绿降频 | enum daily/on_change_weekly | on_change_weekly(默认) |
| 综合掉线线 | 数值 | 日均 leads+询盘 连续 3 天 < 8 |

> ❌ **删除 `token_expiry_date`**(§8.3:假指标,改活信号)。

**配置 UI 对非技术 PM 友好**(P1,板桥):
1. **自动定标预填,不给空框**:新客户上线,引擎先跑 2 周基线(§13 校准)→ **自动算建议阈值预填**,PM 只做「确认/微调」不做「从零填」。配置 UI 默认流程 = 自动定标 → 预填 → PM 确认。
2. **每阈值旁一句人话 + 当前值参照**:「频次:同一人平均看几次。超过 X 说明看腻。你这条现在 1.15。」
3. `budget_policy` / campaign 名 / 漏斗层 全用人话 label(§9 术语表)。
4. UI 复用 chip + add-input(`CompetitorDomainsPanel`/`PrimaryKeywordsPanel` pattern)+ 对称 GET/PATCH `/api/clients/[id]/ad-strategy-config`。

**productization 本质**:SKILL 把 CTS campaign ID + 阈值 + Track A 锁 + 四层漏斗**硬编码在提示词**;产品化 = 全搬进 per-client 配置,一套引擎跑 N 客户。

---

## 12. 触发线定标(CTS pilot 实测基线 · 直接用)

**CTS pilot 配置初值**(SKILL 步骤 5,2026-07-13 实测锚定)。**其他客户不套用** —— 每客户上线用自己 2 周真实数据定标(§13)。

| 层 | Campaign(CTS) | 🔴 告警线(持续/多日) | 健康基线(7/13) | delivery 门槛 | 命中处方(locked=非预算) |
|---|---|---|---|---|---|
| 冷 | Reborn Lead Form | freq(7d) >2.5 **或** CTR 连续 <2% **或** CPL 连续 4 天 >$12 | freq 1.15 / CTR ~3.3% / CPL $12.20 | spend≥$30 & impr≥3000/日 | winner-sync 池挑 1-2 条 Lead Form 版**加进** ad set(不替换、不加预算) |
| 温 | Retargeting Warm | freq(7d) >3 | freq 1.66 / CPL $5.06 | spend≥$10 & impr≥1000/日 | 打透 → 预算**回调 $25**(降,不加) |
| 蓄水 | ThruPlay Pool | 完播成本 >$0.05 **或** 花不出预算 | $0.015/完播 | spend≥$8 & impr≥800/日 | winner-sync 生命周期轮换,不加预算 |
| 转化 | CTWA WhatsApp | 单对话成本连续 3-5 天 >$25 **且** 无一转 lead | $15.36/对话 / freq 1.75 | spend≥$8 & impr≥800/日 | 先改 offer/文案提转化,不加预算 |

> delivery 门槛为 CTS 初值示例(campaign 级 min spend/impr),供 §7.1 对抗守门用;实现期按真实 CPM 复核。

**综合掉线线**:日均 leads + WhatsApp 询盘**连续 3 天 < 8** → 触发 §7.2 深度复盘。

**判定纪律**:Reborn 单条 $80/天出 3–12 lead,一个坏日子把当日 CPL 冲到 $30 —— 噪音不是疲劳。必须频次爬升 + CTR 下行的**持续趋势**才算真疲劳。

---

## 13. 分阶段实施

| 阶段 | 内容 | 前置 | 工作量 |
|---|---|---|---|
| **P1 数据脊柱** | Render Cron 每日拉取(复用 `getMetaTokenForClient` env 路径)+ 日度增量 + last_7d frequency + learning/delivery 探测 + `ad_daily_insights` 表(RLS service-role)+ 多客户隔离降级 | winner-sync token 路径可复用 | 1.5-2 天 |
| **P2 大脑落库** | 触发线引擎(config 驱动 + 冷启动 insufficient_history + 7d freq 正确算法)+ 漏斗层视图(per-client layers)+ §7.1 对抗守门(含 learning 证伪)+ budget_policy 硬闸 + 落 `ad_health_narratives`(新表) | P1 有 ≥7 天时序 | 2-2.5 天 |
| **P3 仪表盘** | `ads-health` 分层视图(PM 默认 + 专业下钻)+ verdict 卡(近7天原始值序列 + 驳回按钮)+ 趋势注解 + 漏斗生意语言 | P2 payload | 2-2.5 天 |
| **P4 Resend 推送** | 日报(倒金字塔 wireframe + 处方归属 + 全绿降频抗疲劳)+ 术语翻译落 UI + 域名验证 + 降级 | P2 payload + Resend | 1 天 |
| **P5 跨客户** | 配置 UI(§11 红线 + 自动定标预填)+ funnel_layers per-client + 泛化到有 Meta 账户的客户 + handoff schema(`creative_supply_requests`)+ 每客户定标 | P1–P4 CTS 稳定 ≥2 周 | 2-3 天 |
| **顺带(先合)** | §10 execute force-pause 守卫 + budget_policy 硬闸 | 无 | 0.5 天 |
| **深度复盘工作流** | §7.2 多视角对抗作战计划(Workflow/agent) | P2 能报异常 | 1-2 天(可后置) |

**时序**:CTS pilot 先 P1→P2→P3→P4 端到端,稳定 2 周 + 真实数据校准后再 P5 泛化。**司马徽(D)建成前** D 段用规则触发顶;Phase 35 司马徽上线接管。

---

## 14. 风险与护栏

| 风险 | 护栏 |
|---|---|
| 盲调 / 单日噪音 / learning 期噪音触发 | §7.1 对抗守门:🔴 必过前提证伪(持续多日 + delivery 达标 + 非 learning 期) |
| 冷启动无历史误报 | §6.1 `insufficient_history` |
| 7d frequency 算错 | §5/§6.1:单独拉 last_7d,不聚合日度 |
| 臆测业务数据 | §6.4:处方只出动作类型,方向必来自 master_brief |
| 给 locked 客户加预算 | §6.4/§10:execute 层**硬闸**校验 budget_policy(非 LLM 软约束) |
| 改预算 force-pause | §10:entity read 回读 + 短重试 + 自动重激活 |
| cron 单客户 token 挂拖垮全体 | §5 多客户隔离,`pull_failed` 跳过 |
| Resend 进垃圾箱/失败 | §8.2 域名验证 + 失败降级 |
| **PM 三天弃用日报** | §8.2 倒金字塔 + 全绿降频 + 处方归属;§8.1 分层 + 原始值核对 + 驳回出口 |
| migration 事故 | 新表 RLS service-role;migration **PM 拍板后手动 apply**;`ad_daily_insights`/`ad_strategy_configs`/`ad_health_narratives` 三张新表 |
| CTS 假设漏进产品 | §6.2 funnel_layers per-client;§11 全配置化;§12 明标「其他客户不套用」 |
| 越界写对方引擎表 | §1 边界铁律 + handoff 契约 |
| cron 用错栈(GHA 漏跑) | §5 Render Cron,不用 GHA |

---

## 15. 未决 / PM 拍板项

只上抛业务/不可逆:

1. **交付层方案 C 方向** —— PM 2026-07-13 已拍板 ✅
2. **预算策略默认 `locked`**(CTS Track A ✅);其他客户上线逐客户定 policy(business input)
3. **三张新表 migration apply**(`ad_daily_insights` + `ad_strategy_configs`/`_triggers` + `ad_health_narratives`)—— 待 PM 显式 `go apply`
4. **P5 泛化首批客户**(Oztop?)—— business 优先级
5. **姊妹 spec GHA 笔误修正** —— Creative Lifecycle Engine spec 有同一「沿用 GHA」错误,登记单独小 PR 修(不在本 PR 顺手改无关文件)

---

## 16. 签字栏

| Agent | 角色 | 状态 |
|---|---|---|
| 子牙 | 架构主笔 | ✅ v0.2(吸收魏征 P0×2 + 板桥 P0×2) |
| 魏征 | 挑刺评审 | ✅ v0.1 needs_rework → v0.2 已修 2 P0(cron 栈 + 落库 schema)+ 5 P1 + 遗漏项;待复审 |
| 板桥 | C 端 / 非技术 PM 视角 | ✅ v0.1 approve_with_fixes → v0.2 已补日报 wireframe + 处方归属 + 抗疲劳 + 信任核对 + 术语表;待复审 |
| **PM · 业务拍板** | ①方案 C 方向 ②migration apply ③P5 泛化范围 | ⏳ 需显式 `go` |

---

## 附:与 Creative Lifecycle Engine 合起来 = 广告柱产品化

```
                         广告柱产品化(DAPE × ads 支柱)
        ┌──────────────────────────────┬──────────────────────────────┐
        │   Ad Strategy Engine(本 spec) │  Creative Lifecycle Engine     │
        │   策略层 · 账户大脑            │  作品层 · 创意生死             │
        │   campaign/漏斗/账户健康       │  单条 creative 生命周期        │
        └───────────────┬──────────────┴───────────────┬──────────────┘
                        │        共用地基               │
              Meta 数据脊柱 · winner-sync 执行 · ads-collector · 6 支柱 'ads'
                        │                               │
                   handoff:策略层「哪层要补」→ 作品层「补哪几条 creative」
                        (v0.3 落 creative_supply_requests schema)
```

一句话:**投放师大脑管账户战略,作品流水线管创意生死,两半接在同一条 Meta 数据脊柱 + winner-sync 执行层上,合起来才是完整的「广告柱」。CTS 是第一个真实案例,产品是引擎。**
