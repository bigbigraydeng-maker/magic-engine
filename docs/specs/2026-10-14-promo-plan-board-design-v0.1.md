# 「推广计划」板块 · D1 调查与设计稿 v0.1（只是设计，没写代码）

- 日期：2026-10-14 · 窗口：113 号 · 统筹：18 号 · 推广负责人：105 号
- 风险级别：设计稿本身 C（纯文档）；它描述的实现 v1 = B、v2 = A、v3 = B/A（见 §10）
- 范围：只调查、只出设计。**没写代码、没建表、没应用迁移、没动任何账户、没发布。** 数据库只做了只读查询（2026-10-14，生产库只读 SELECT）。
- 起因：PM 2026-10-15 指示（105 转述）——广告计划和社媒计划不能再在对话框里做，要做成 ME 后台的工具板块、用代码控制。这是 PM 对「暂停新功能」的例外，**只到出设计为止**。
- PM 三条补充：①先有计划，未批准什么都不做，批准后才生成内容；②调整现有 Marketing Plan 和 Go，看代码怎么合并；③最终生成每日计划，借视频工厂、Blog、Newsletter 统一干活。
- PM 对 CTS 两份一页纸（PR 2644）回「不批」：它们只当第一个客户的样例参考，**不是依据**。本稿没有用它们的任何数字。

**读了哪些（说不出来 = 没读）**：`CLAUDE.md`、`docs/STATE.md`、`docs/ENGINEERING_QUALITY_GATES.md` §2/§11、`.claude/skills/me-platform-tier-gate/SKILL.md`、`.claude/skills/client-promo-readiness/SKILL.md`、105 号已合并的 `docs/specs/2026-10-14-client-promo-readiness-gate-tier-report.md`、`docs/specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md`（头部）、`docs/ledger/2026-10-10-daily-plan-auto-publish-design.md`；代码：`src/lib/marketing-plan/*`、`.../marketing-plan/[planId]/approve/route.ts`、`src/lib/campaign/daily-plan.ts`、`src/lib/kernel/registry-ads.ts`、`src/lib/ads-strategy/playbooks/types.ts`，其余由只读调查逐文件核对（见 §3 证据）。
**没读到的**：105 号说的任务书 `docs/specs/2026-10-15-promo-plan-board-tier-report-and-design-brief.md`——我查了 main、`origin` 全部分支名、全部 15 个打开的 PR 和代码搜索，**都没有这个文件**（可能还在 105 本机、没推上来）。所以 §2 的层级报告是我独立做的，没有照抄也没法对照；请 105 把任务书推上来后我再对一遍。
**没核实的**：「Go」指哪个功能——全仓搜不到叫 Go 的计划启动功能（见 §3.4），需要 105/PM 指一下。

---

## 0. PM 版结论（先看这里）

**一句话**：不用新造一套系统。把**现有的 Marketing Plan 升级成「推广计划」**——加上「广告」这一栏、把计划切成「阶段」、每个阶段前加一道「开投条件闸」、每周自动对账；批准之前什么都不会发生，批准之后才一步步生成内容；每日计划继续是最后的落地层。

**四个调查发现（都是查库、查代码得来的，不是猜的）**

1. **Marketing Plan 近两个月没人用，两个原因都有**：
   - **流程被绕过**：库里 5 个「已批准」的计划，**只有 1 个**能证明是走「批准按钮」批出来的（5/31，有批准时间、计划 25 条=派出 25 张任务卡）。最后一个（Roman，8/20）是**直接写进库里就标成已批准**，12 条任务一条都没派出去——所以它「批准了但什么都没发生」。
   - **功能本身有缺口**：没有广告栏；批准时没有防重复；没有任何「完成」的自动判定；计划不直接挂目标；Newsletter 只能出一张人工卡，因为代码里压根没有 Mailchimp 的建信/发信能力。
   - 而且日常内容已经改走了「推广活动 → 每日计划」这条新路（DECISIONS 已定），Marketing Plan 不在新主路径里，没人回头用它。
2. **任务卡（execution_items）和每日计划不是同一套任务模型，不合并，用「引用」接起来**：任务卡是给人（FDE）派的活，1,664 行；每日计划是存在 `social_plans` 里的「每天发什么」日历，有自己的审核和自动发布授权。两者今天唯一的连线是 `social_plans.execution_item_id` 这一列，每日计划的代码**一次都没用它**。
3. **目标真相源 = `goals` 表；`campaign_briefs` 是「推什么、对谁、卖点」的内容真相源，不是目标**。`campaign_briefs` 没有目标字段；它和目标之间只有一条弱连线（`initiatives.campaign_ids` 数组，不是外键）。推广计划要**同时硬挂两个**：挂 `goal_id`（要达成什么）和 `campaign_brief_id`（推什么）。
4. **广告执行今天分两条路**：新建广告/开启广告**直走**广告发布器（`draft-and-gate`，PM 在审批页点头）；调预算/暂停这些「受限自治」动作才走 Kernel。**Kernel 里没有「建广告」这个动作，桥接表里也没有任何广告条目。**

**建议的三步走（每步 PM 单独点头）**

| 版本 | 做什么 | 动账户吗 | 风险级 |
|---|---|---|---|
| **v1** | 计划加广告栏+阶段+开投闸（只读灯）+每周对账页；批准后只派内部任务卡；广告步骤只展示不执行 | **不动** | B |
| **v2** | 阶段批准、开投闸、每周对账留回执（新表）；广告「建暂停草稿 → PM 开启」接入 Kernel 留痕 | 只建**暂停**草稿；开启仍只有 PM | **A** |
| **v3** | 社媒同板块：计划步骤展开成每日计划的日历、视频工厂下单、Blog 出稿；Newsletter 仍是人工卡 | 不动广告 | B/A |

**要 PM 回的话**：设计经子牙+魏征+板桥审完（见 §13）后，PM 回 **「合 N」** 即把本稿合进仓库；回 **「做 v1」** 才开工写代码。**没回之前我停手。**

---

## 1. 开工基线（我核了）

- 工作区 `/home/user/magic-engine`，分支 `claude/gallant-turing-ql93ts`，基线 HEAD `371650bb8`（= `origin/main`，2026-10-14 已 `git fetch` 刷新，合并了 #2644）。无未提交改动。
- 生产库：Supabase 项目 `glbdnayojixmexgofbsd`，**只读 SELECT**，没有任何写入。
- 优先级判断（§11）：本任务是 PM 直接下达的唯一任务，不存在要排序的竞争项，**不需要排序**。仅供参考，如果将来 v1 与别的事抢资源：按 §11：频率 中（每周一次）/ IMPACT 高（卡 Prescribe→Act 的闸与 Check 的对账）/ 收入 高（直接管广告花费与客户推广）→ 高高中 → P0。

---

## 2. 平台层级报告（Platform Tier Classification · Full）

**被判定对象**：「推广计划」——把「计划→阶段→每步设定→开投条件闸→每周对账」用代码表达，并和每日计划、广告执行衔接。

**建议层级（分三层，不是一个整块）**
- 计划/阶段/步骤的数据结构、闸的检查词表和判灯逻辑、每周对账算法、板块页面 → **L1，扩展既有「策略层（Marketing Plan）」+ Governance 闸**。不是新支柱、不是新能力线（红线 1）：它是给已有的 Marketing Plan 加一个广告维度和一道开投前的闸。
- 阶段模板、节奏范围、闸门阈值默认值 → **L2 行业剧本（Promo Playbook，数据文件）**，沿用广告剧本已有的行业 key 和「按 `clients.industry` 选、不认客户名」的做法。
- 具体客户的目标、预算、受众、素材、日期、每个阶段做什么 → **L4 客户配置**，落在计划实例（`plan_data`）和已有的客户配置里。
- 对外执行（建广告、开启、调预算）→ **L3 Connector（既有 Meta Ads Connector）**，不新增连接器。

**归属**：既有支柱「广告」+「社媒」+「SEO（Blog）」之上的**策略层 / Governance**；平台基础设施，不新增第 7 支柱。

**换客户测试：骨架 ✓，数字 ✗（下沉）**
- CTS（旅游）：阶段=预热/主推/收尾，闸要查「班期上线官网」→ 闸词表里的通用项 `landing.item_live`（要推的东西在落地页真实存在），具体班期是客户数据。
- Roman（地产，库里有一个已批准计划，可作真实对照）：同一个闸变成「要推的楼盘在官网存在」，**骨架不用改**。
- 地产悉尼新客户：阶段数、节奏、预算全是计划里的数据；若某条代码里出现「班期」「询盘」字样，就是漏下沉（和广告剧本现状同类问题，已有 `resultNoun` 先例）。

**换行业测试：骨架 ✓，细项 ✗（进 L2）**
- 旅游：学习期之后看多久出结果、班期销售截止日；地产：楼盘状态、合规披露；物流（NAL）：看消息不看留资。这些每个行业不同，只能是剧本数据。

**智能层 or 执行手**：智能层（计划+闸+对账）；执行手是既有的发布器/工厂/Blog，本板块只调度、不新造。

**红线检查**
- 红线 1（禁包装升级）：✓ 叫「推广计划」是 Marketing Plan 的升级，不叫「推广智能层」，不新设能力线。
- 红线 2（客户/行业事实不进共享）：✓ 设计要求：共享代码零客户名、零 ID、零具体天数/金额；这些来自 L2 剧本和 L4 计划。
- 红线 3（禁单客户直建 L1）：⚠ **要老实说**：105 号 10-14 的层级报告把「三道门」判为「L1 候选、只有 CTS 一家证据、先只做 skill 不做代码」。本设计**不新建 L1**，是扩展已经跨三个客户（oztop、CTS、Roman；库里有这三家的计划行）的 Marketing Plan；但「开投闸」的检查项来源仍只有 CTS 一轮经验。**处理办法**：①闸词表在 v1 就用 Roman（地产）的真实只读数据跑一遍当「第二客户证据」；②词表里每一项标 `evidence: single_client` 直到有第二家验证；③PM 的明确指示（10-15）是动设计的授权，**不等于**越过红线 3——v1 开工前仍需把这一条写进 PR。
- 红线 4/5：见上，骨架过，数字下沉。
- 红线 6：不新增 L1 能力；但 v2 动 Kernel/新表，走 A 级审（见 §10）。
- 红线 7（L2 只装行业级）：✓ 剧本里不写 CTS 的任何事实；CTS 一页纸（#2644 已被 PM 否决）不用于填剧本。

**PM 待拍板项**：①Go 指哪个功能（§12）；②v2 动 Kernel 时「建暂停草稿」是否也进 Kernel（§6.2，技术项，由子牙/魏征定，不抛 PM）。无商业决策。

**与 105 报告的关系**：105 的结论「现阶段只做 skill、不做代码」在 10-15 PM 指示之后被覆盖为「出设计」。本稿保持其边界：门红只**提示**，v1 不自动拦截广告账户；自动拦截属于 v2，且仍走既有审批。

**结论**
- 原本想法层级：新板块 L1。
- Skill 判定层级：**L1 扩展（既有 Marketing Plan + Governance）+ L2 剧本数据 + L4 客户配置**；不登记为新 L1 候选（它是既有 L1 的扩展）；「闸词表」是 L1 候选的子项，沿用 105 的候选登记，等 PM 回「记」。
- 下一步：本稿送审 → PM「合 N」→ PM「做 v1」。

---

## 3. 三个必须先回答的合并问题（证据）

> 标记：**我核了** = 本窗口 2026-10-14 实读代码/只读查库；**沿用** = 别处汇报。下面全是我核了的，除非注明。

### 3.1 execution_items 与每日计划是不是同一套任务模型？——**不是**

| | execution_items（任务卡） | 每日计划 |
|---|---|---|
| 存在哪 | 表 `execution_items`（1,664 行：zhuge 1,070 / marketing_plan 289 / diagnostic 263 / fde_manual 31 / proactive_signal 11） | 复用表 `social_plans`，`plan_data.plan_kind='campaign_daily_v1'`（库里 6 行；其余 89 行是旧波次批量计划）。**没有 `campaign_daily_plan` 这张表**（任务书里的名字不准） |
| 是什么 | 给人（FDE）派的活：标题、描述、`fix_type`、状态 pending/in_progress/completed/skipped(+superseded) | 每天 post/story/reel 三个槽位的内容草案 + 审核 + 发布队列 + 自动发布授权（`daily_plan_auto_publish_auth/attempts`，库里 0 行） |
| 谁写 | `task-dispatcher.ts`、执行看板、诊断/诸葛亮 | `src/lib/campaign/daily-plan*.ts` |
| 连线 | `social_plans.execution_item_id` 外键（28 行有值，多是旧波次） | 每日计划自己的代码**不引用** execution_items 和 marketing_plan |

**结论**：两套模型各有用途，**不合并**。设计里把「计划步骤（step）」放在它们**上游**：一个步骤可以展开成 ①一张给人的任务卡、②每日计划里的若干天槽位、③一次工厂下单/Blog 出稿、④一个广告草稿。步骤→下游靠**引用**（`step_id` 写进下游记录），不靠合表。
- 副证：marketing_plan 来源的 289 张任务卡，最后一张创建于 **6/8**；这之后社媒日常生产转到「推广活动→每日计划」。

### 3.2 campaign_briefs 与 goals/initiatives，谁是目标真相源？——**goals**

- `goals`：意图、主指标、基线、目标值、周期、预算、状态；每客户只允许一个 active（库里 active 4 / draft 10 / expired 11 / archived 6）；Kernel 的 `action_runs.goal_id` 也外键到它。**目标真相源。**
- `campaign_briefs`：offer、受众细节、卖点、主 CTA、渠道目标文字、视觉方向、有效期；**没有 goal 外键**（库里 active 24 / archived 5）。**「推什么、对谁」的内容真相源**，不是目标。
- `initiatives.campaign_ids[]`：弱连线（数组，非外键；库里 18 行有值，其中 14 行未归档）——有人在用，但删 campaign 不会级联清理。
- `marketing_plans`：有 `initiative_id`、`campaign_id`，**没有 `goal_id`**——只能经 initiative 间接到目标；不从 Goal 页进来的计划根本挂不上目标。
- **设计决定**：推广计划硬挂 `goal_id`（必填）和 `campaign_brief_id`（必填，复用现有 `campaign_id` 列）；`initiative_id` 保持可选。对账永远拿 `goals` 的目标值做分母。

### 3.3 Marketing Plan 近两个月没人用：功能问题还是流程被绕过？——**两者都有，流程绕过更直接**

库里 `marketing_plans` 共 31 行（draft 14 / approved 5 / archived 8 / completed 4）：

| 计划（已批准） | 创建 | 批准时间 | 计划里任务数 | 实际派出的任务卡 | 判断 |
|---|---|---|---|---|---|
| 3ed2807d | 5/31 | 5/31 11:06 | 25 | 25 | ✅ **唯一能证明走了批准按钮的**（有批准时间，计划数=派出数） |
| 79cd3473、d6fa990f | 6/8 | 空 | 0 | 各 6 | 手工置为已批准（无批准时间） |
| d0000000-…e001 | 5/28 | 5/30 | 0 | 0 | 疑似种子/测试数据 |
| **37ebacaa（Roman，最近一个）** | **8/20** | 8/21 00:00:00（整点） | **12** | **0** | ❌ **更新时间=创建时间，批准时间是整点：直接写库就标成已批准，绕过了批准路由，一条任务也没派** |

- 派出去的 289 张任务卡里：completed 17 / in_progress 10 / pending 73 / skipped 116 / superseded 73——**一多半被跳过或被替换**，说明派出的活和实际工作流对不上。
- 流程缺口（代码核对）：批准路由是「先派发再改状态」，**无事务、无防重复**（并发点两次会重复派）；`completed` 没有任何自动转换；PATCH 能把状态改成除 approved 外的任意值；没有 goal 外键；newsletter 只能出人工卡（Mailchimp 只有只读封装）；**没有广告维度**（`PlanTaskKind` 只有社媒/博客/邮件）。
- 入口并没有被藏：客户首页「工具」tab、Goal 页「+ 生成 Marketing Plan」都还在（调查代理读代码所得，我抽查了批准路由与调用方列表）。ROADMAP/CHANGELOG 里 9/8 newsletter 阶段 1「合并后需对 CTS 实际跑一次 generate」的验收**未勾选**，以及 DECISIONS 把 Campaign 定为社媒统一入口（沿用调查代理引用，行号 `DECISIONS.md:35-48`，**我没逐行复核**）。
- **没核实**：那 2 个 6/8 的「已批准」具体是怎么批的（库里没留痕——这本身说明缺回执）。

### 3.4 「Go」是什么——**没找到**

全仓搜 `go-plan / launch-plan / 一键启动 / \bGo\b`，没有叫 Go 的计划启动功能。最接近的有三个：执行看板的「⚡ 一键量产」（`ai-factory/fan-out`，只吃 marketing_plan 来源的任务）、Goal 页 Initiative 卡的「+ 生成 Marketing Plan」、每日计划的「通过并授权自动发布」。**请 105/PM 指一下 Go 是哪个**；在回答前，设计按「Goal 页的启动入口」处理（§5.4）。

---

## 4. 设计：计划→阶段→每步设定→开投条件闸→每周对账

### 4.1 一张图

```
目标(goals) ─┬─ 推广计划(marketing_plans，升级) ── 阶段1 ── 步骤 ─┬─ 广告步骤  → 草稿(暂停) → PM开启
内容(campaign_briefs)┘      │ 先 draft，PM批准才生效     │ 开投闸(灯)   ├─ 社媒步骤  → 每日计划槽位 → 既有审核/授权/发布
                            │                         │ PM批准阶段   ├─ 博客步骤  → Blog 出稿(草稿)
                            └─ 每周对账 ← 实际数据      └─ 阶段2…      └─ 邮件步骤  → 人工任务卡(无发信能力)
```

### 4.2 数据结构（草图，v1 不建表：放进 `marketing_plans.plan_data`，加一个可选字段，旧计划不受影响）

```ts
// plan_data.promo —— 可选；没有它就是旧计划，行为完全不变
interface PromoSpec {
  schema: 'promo_v1'
  goal_id: string                  // goals.id（目标真相源）
  playbook_key: string             // 来自 clients.industry，只记录，不认客户名
  weekly_review_weekday: number    // 每周几对账（配置）
  phases: PromoPhase[]
}
interface PromoPhase {
  id: string; name: string
  start_date: string; end_date: string       // 客户数据，不是共享默认
  gate: GateCheckRef[]                        // 本阶段开始前要过的闸（从封闭词表选）
  steps: PromoStep[]
}
type PromoStep =
  | { id; kind: 'ads_campaign'; settings: AdsStepSettings }   // 广告
  | { id; kind: 'social_cadence'; settings: SocialCadence }   // 展开成每日计划槽位
  | { id; kind: 'blog_article'; settings: { topic; primary_keyword; due } }
  | { id; kind: 'newsletter_email'; settings: {...; requires_link: true} }  // 沿用现有字段
interface AdsStepSettings {            // 全部是「这个计划实例的数据」
  objective_key: string                // 引用 ad_strategy_configs 的主结果口径，不在这里重定义
  daily_budget_cents: number           // 不超过 ad_strategy_configs.daily_budget_cap_cents
  audience_ref: string                 // 引用现有受众池/配置，不复制
  creative_refs: string[]              // 引用 creative_pool 里已批准的素材 id
  placements: string[]
  observe_after_days: number           // 改动后冻结/观察几天（默认来自剧本）
}
```
- 步骤 `id` 在计划内稳定，**下游所有记录（任务卡、每日计划日、工厂工单、广告草稿）都带 `promo_ref = {marketing_plan_id, phase_id, step_id}`**——这就是「接起来」的全部机制，不合表。
- 这些全放 jsonb：沿用 Marketing Plan 的做法，**v1 不需要迁移**。

### 4.3 阶段状态

`locked`（上一阶段没完/闸红）→ `ready`（闸全绿）→ `approved`（PM 点头）→ `running` → `done`。
- v1：状态**现算**（根据日期+闸+计划状态），不落库；批准阶段仍等于「批准整个计划」（沿用现有路由）。
- v2：阶段批准、闸判定、派发都落**追加式回执**（§7），当前状态=回执折叠。

### 4.4 开投条件闸

- 词表**复用 `client-promo-readiness` 的三道门**（工具门 T1–T9、节奏门 R1–R8、内容门 C1–C8）作为封闭词表。每项变成一个**纯函数检查**：输入「事实快照」，输出 `green/yellow/red/unknown` + 原因 + 来源。
- v1 只实现**能从现有库直接读到事实**的项，其余显示 `unknown`（**绝不当成绿，也不当成 0**）。能自动取的（举例）：
  - 账户可用/日上限已设：`ad_strategy_configs`（`daily_budget_cap_cents`、`autonomy_mode`）+ `ad_entity_snapshots`
  - 「一条结果」口径已定：`ad_strategy_configs.primary_result`
  - 素材已批准：`ad_strategy_configs.creative_pool`
  - 社媒节奏已排：`social_plans` 里 `campaign_daily_v1` 往后覆盖几天
  - 自动发布授权有效：`daily_plan_auto_publish_auth`
  - 落地页/商品核对、对外措辞许可、客户确认类：**读不到 → unknown，生成给人的 how+href 待办**（管道不许断头）
- 规则：**阶段内任一项红 → 本阶段「不能批准开投」；有 unknown 或黄 → 可批，但页面把它列在批准按钮旁边写明「未核实」。** v1 只亮灯，不拦截账户（拦截 = v2，且通过既有审批）。
- 阈值（「覆盖几天」「素材至少几条」）= **剧本默认值**，计划可覆盖，共享代码里没有数字。

### 4.5 每周对账

`reconcileWeek(plan, weekIndex, facts)`（纯函数）输出 4–6 行，每行：**计划值 / 实际值 / 状态 on_track | behind | over | unknown / 数据来源与更新时间**。
- 花费：`ad_daily_insights`（**时间一律走 `ads-strategy/account-timezone.ts`**，不许把 UTC 戳直接跟本地日期比——10-10 能力图谱稿记过这个坑）。
- 结果：按 `primary_result` 口径；订位 `crm_bookings` 只在能拿到广告来源归因时才算，**拿不到写 unknown，不拿全量订位冒充**。
- 内容：计划每周条数 vs 每日计划实际 `published`、工厂 `PUBLISHED`、Blog 已发布数。
- 闸状态变化：上周绿、本周红了的项。
- 末尾给**一句建议**（继续 / 调整哪一项 / 暂停），建议不是动作。
- 数据缺失一律 `unknown`；整张对账里 unknown 超过一半时，头条写「本周看不清，先补数据」而不是「正常」。

---

## 5. 与现有东西怎么合并（最小新增 vs 复用）

### 5.1 复用 / 新增清单

| 事项 | 复用什么 | 最小新增 |
|---|---|---|
| 计划本体与状态 | `marketing_plans`、`/marketing-plan` 页面与 API、批准路由 | `plan_data.promo`（jsonb 可选字段）+ 类型/校验（v1 无迁移） |
| 广告维度 | `ad_strategy_configs`（口径/日上限/素材池）、`ads-strategy/playbooks` 的行业 key | `AdsStepSettings` 类型；只读展示 |
| 阶段+闸 | `client-promo-readiness` 三道门词表、`account-timezone.ts` | 闸检查纯函数 + 事实读取适配器（只读） |
| 每周对账 | `ad_daily_insights`、`goals.current_value`、每日计划/工厂/Blog 现有读取 | `reconcileWeek` 纯函数 + 页面 |
| 待办入口 | `pm-todo` 的 what/how/href 三件套、`LANE_OF_KIND` | 1 个新 kind（如 `promo_week_review`，车道 weekly）+ 1 个只读 pusher |
| 任务卡派发 | `task-dispatcher.ts`（改：加防重复键、带 `promo_ref`） | 去重键（v2 加唯一索引=迁移，A 级） |
| 每日计划 | `social_plans` 的 `campaign_daily_v1`、既有审核、发布队列、自动发布授权 | v3：按 `social_cadence` 步骤生成槽位草案 + `promo_ref` |
| 视频工厂 | `order-scheduler`/`content_demand_signals`、`dashboard/factory` | v3：由步骤写一条需求信号（`request.notes`），不指定角度 |
| Blog | `generateBlogPost`、`POST /api/clients/[id]/blog`（异步、MTC 计费） | v3：由步骤调用现有入口 |
| Newsletter | `PlanTaskKind='newsletter_email'` 人工卡 | **不新增**；建信/发信能力不存在，属于 Connect 缺口（另议，不在本设计内） |
| 广告执行 | `draft-and-gate`（建暂停→回读→PM 批）、`/dashboard/ad-approval`；Kernel 六个受限自治动作 | v2：见 §6.2 |

### 5.2 改动现有 Marketing Plan 的地方（合并时必须顺手修的缺口）

1. 批准路由：加「幂等键 + 先写状态再派发 / 或派发带去重」——今天无事务无防重复。
2. 批准路由是**唯一**能到 `approved` 的路径；PATCH 的任意状态改写收紧（今天只挡了 approved 一个值，其余都放行）。
3. `completed` 由阶段全部 done 推导，不再靠手改。
4. 生成器：不动（继续出社媒/博客/邮件草案）；新增的「阶段+广告」草案由 **人确认后**写入 `plan_data.promo`，v1 不让 AI 自动写广告预算。
5. 从 Goal 页进入的入口保留，并把 `goal_id` 带进计划（Go 的处理，见 §3.4）。

### 5.3 「未批准什么都不做」怎么在代码里保证

- 所有下游入口（任务卡派发、每日计划展开、工厂下单、Blog 出稿、广告草稿）**只接受带 `promo_ref` 的调用**，且入口第一行调用同一个守卫 `assertStepAuthorized(promo_ref)`：计划不是 `approved`、阶段未批、闸红、或回执缺失 → **抛错、不静默跳过**。
- 守卫是纯函数 + 一个读取，有单测；架构测试扫描「谁调用了下游入口却没调守卫」，冻结名单只许缩小（沿用 R4 广告草稿的做法）。

### 5.4 Go 的处理（待确认）

按「Goal 页的启动入口」：Go = 从目标页发起推广计划。合并方式：目标页的入口改为创建「推广计划」草稿（带 `goal_id`），原「+ 生成 Marketing Plan」并入同一入口，不留两个按钮。若 Go 实际是别的东西，只影响入口位置，不影响模型。

---

## 6. 版本路线

### 6.1 v1（B 级，只读，不动账户）

- 内容：`plan_data.promo` 类型+校验；闸检查纯函数+只读事实适配器；`reconcileWeek`；推广计划页（一页纸，见 §9）；`promo_week_review` 待办（拉模式）。
- 批准：沿用现有批准路由——派出的是**内部任务卡**；**广告步骤只展示、不执行、不建草稿**。
- 不含：新表、新定时任务、Kernel 改动、对外副作用。因此 v1 **不需要 Inngest**（纯展示+同步读取，属 CLAUDE.md §3 的例外，PR 里写明）。
- 验收：CTS（旅游）与 Roman（地产）各用真实只读数据跑出灯和对账，**两家的页面共享代码不改一行**（红线 4/5 的实证）。

### 6.2 v2（A 级，审批留痕，接 Kernel）

- 新表 `promo_plan_receipts`（追加式回执，见 §7）+ `marketing_plans.plan_revision`（批准绑定计划版本，沿用每日计划自动发布授权的做法）。
- Inngest 事件（业务可读名）：`promo_plan.phase.approved`、`promo_plan.gate.evaluated`、`promo_plan.step.dispatched`、`promo_plan.ads_draft.requested`、`promo_plan.week.reconciled`；每一阶段有机器可读回执（request id、client id、plan/phase/step id、状态、`no_publish`/授权状态、provider 影响、created_at）。人工点头只推进到下一事件，不等于发布授权。
- 每周对账由 Inngest 自带定时器按客户派单（先例 `flywheel-seo-weekly`），**不新增 `/api/cron/*` 与 render.yaml 条目**。
- 广告执行（推荐方案）：
  - **v2a**：广告步骤「建暂停草稿」仍走现有 `draft-and-gate`（PM 在 `/dashboard/ad-approval` 开启，这是唯一能花钱的开关，不改）；回执里记 `flywheel_actions.id`，实现「计划步骤→草稿→批准→开启」整条链可追溯。
  - **v2b**（单独立项、4 审含狄仁杰）：在 Kernel 注册 `ads.create_paused_draft_from_plan`（只建暂停对象）和 `ads.activate_from_plan`（approval=人工，**不进受限自治信封**，永远要 PM），把 `publishDraftPaused/activatePublished` 作为 capability handler，才算真正「执行进 Kernel 留痕」。这与 R4（PR #2381，工厂 Reel 自动起草暂停广告，后续事项 5「Kernel 收编」）是同一件收编工作，**两边一起收编，不各做一套**。
- 是否把 v2b 一起做、还是 v2a 先行：技术项，由子牙/魏征审定，不抛 PM。

### 6.3 v3（B/A，社媒同板块）

- `social_cadence` 步骤→批准后在 `social_plans` 里写 `campaign_daily_v1` 槽位**草案**（带 `promo_ref`）；真正发布仍只走每日计划既有的「审核→发布队列→PM 授权」（Facebook Post 已通；story/reel 仍是草案）。
- 视频：只写一条工厂需求信号，**视频一律走工厂**（CLAUDE.md §8 红线）。注意：`factory/outlets.ts` 里 `daily_plan connected:false`（等 Remotion 在 CTS 稳定两周）——v3 在这条解除前，Reel 步骤只出工厂单、不接每日计划。
- Blog：调现有异步入口出**草稿**（有 MTC 计费：`blog_seo` 40 / `blog_dual_signal` 60——批准阶段时页面显示将产生的费用）。
- Newsletter：继续人工任务卡（`requires_link` 硬检查沿用）。
- 需先确认 `campaign_daily_v1` 的 zod 是否允许多带 `promo_ref` 字段（**没核实**，开工前读 `daily-plan.ts` 的 schema）。

---

## 7. 数据库草案（A 级，**只写不应用**；以下仅为 v2 设计示意，仓库里没有迁移文件）

```sql
-- v2 示意，不应用。RLS 一律 service-role 模板，漏 TO service_role = 对匿名访客敞开读写。
CREATE TABLE promo_plan_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  marketing_plan_id uuid NOT NULL REFERENCES marketing_plans(id),
  plan_revision int NOT NULL,
  phase_id text NOT NULL,
  step_id text,
  event text NOT NULL CHECK (event IN ('phase_approved','gate_evaluated','step_dispatched',
                                       'ads_draft_requested','week_reconciled','phase_revoked')),
  request_id text NOT NULL,
  actor_email text,
  payload jsonb NOT NULL DEFAULT '{}',
  no_publish boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (marketing_plan_id, request_id)
);
ALTER TABLE promo_plan_receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY promo_plan_receipts_service_role ON promo_plan_receipts
  FOR ALL TO service_role USING (true) WITH CHECK (true);   -- 必须有 TO service_role
-- 追加式：不开 UPDATE/DELETE 的业务路径；纠错=追加一条新回执。
ALTER TABLE marketing_plans ADD COLUMN plan_revision int NOT NULL DEFAULT 1;
-- 派发防重复（共享表 execution_items，A 级）：
-- CREATE UNIQUE INDEX ... ON execution_items (marketing_plan_id, (steps_json->>'step_id'))
--   WHERE source='marketing_plan' AND steps_json ? 'step_id';
```
- 只有一张新表+一列+一个部分唯一索引；**不新建「阶段表」「步骤表」**（阶段和步骤在计划 jsonb 里，状态靠回执折叠）。
- 索引上线前须先查现有 289 行没有冲突（含 `steps_json` 没有 `step_id` 的旧行不受部分索引影响）。

---

## 8. 平台 / 行业 / 客户三层（共享代码不得写死 CTS）

| 层 | 放什么 | 放哪 |
|---|---|---|
| **平台（共享代码）** | `PromoSpec` 类型与校验、闸检查词表和判灯、`reconcileWeek`、守卫 `assertStepAuthorized`、页面 | `src/lib/marketing-plan/promo/`（新子目录；不进 `ads-strategy/`，因为它跨广告+社媒+博客） |
| **行业（L2 剧本，数据文件）** | 阶段模板、学习期/观察期天数、节奏范围、闸阈值默认值、「结果」叫什么 | `src/lib/marketing-plan/promo/playbooks/{default,travel,real_estate,retail,logistics}.ts`，key 与 `clients/industries.ts`、广告剧本一致，**按 `clients.industry` 选，不认客户名/ID** |
| **客户（L4）** | 目标、预算、受众、素材、日期、每个阶段做什么、哪个语言投 | 计划实例 `plan_data.promo` + 既有 `ad_strategy_configs`、`clients.factory_config`、`clients.leads_config` |

- 剧本里每个值标 `evidence`：目前旅游只有 CTS、物流只有 NAL → 全部标 `single_client`，页面和文档里按「候选参考」呈现，**不当已验证定论套用**（CLAUDE.md 对行业手册的要求）。
- CTS 一页纸（#2644，PM 已否）不灌进任何剧本；示例/测试一律用虚构客户。
- 「换客户自检」：明天把 CTS 换成悉尼地产客户，共享目录里应零改动；若要改，说明有数字或词没下沉。

---

## 9. PM 每周怎么用（一页看懂、一句话批准）

**入口**：今日待办里每个在推广的客户一条「本周推广对账 · 待你看」（带直达链接）→ 打开该客户的「推广计划」页。

**页面从上到下（手机也能看）**
1. **一句话头条**：「第 3 周 · 基本按计划」/「第 3 周 · 广告花费落后 40%，要你决定 1 件事」/「本周看不清，先补数据」。
2. **四行对账**：广告花费、结果数、本周发了几条内容、下阶段的闸——每行「计划 / 实际 / 灯 / 数据更新于」。
3. **下一阶段的三盏灯**：工具门 / 节奏门 / 内容门，红黄绿；点开看每一项、谁负责、几号前（沿用 what/how/href）。
4. **按钮只有两个**：
   - 「按计划继续」（对账无异常时唯一要点的）；
   - 「批准开投 第 N 阶段」——**只在三盏灯无红时出现**，旁边列出所有「未核实」项。
5. 出现偏差时多一个文本框「要调整什么」，PM 写一句（例：「预算降到上限的一半」），由 FDE 落到计划里再由 PM 批。

**PM 一句话回法**：`按计划` / `批 阶段2` / `调 预算 减半`。其余全由系统和 FDE 做。
**每周 PM 总工作量目标**：一页、≤2 分钟、≤1 个决定。

---

## 10. 风险级别、验证与审查

| 版本 | 级别 | 理由 | 验证强度 |
|---|---|---|---|
| v1 | B | 新读取接口（客户隔离）+ 纯函数 + 页面；无迁移、无外部副作用 | 核心单测 + 少量集成；闸与对账各做变异验证；Impeccable 过页面 |
| v2 | **A** | 新表、改共享表索引、Kernel 注册、不可逆副作用（广告草稿） | 强验证；子牙+魏征+板桥+狄仁杰；迁移单独授权才 apply |
| v3 | B（展开草案）/ A（工厂下单与 Blog 计费） | 写每日计划、花钱 | 按触碰面分级 |

- 大任务≥2 审：设计阶段子牙（架构）+ 魏征（挑刺）+ 板桥（非技术视角，面向 PM/客户界面）；v2 实施后再审并加狄仁杰。**审查结果见 §13，没跑完的不写成已审。**
- 写代码默认交 DeepSeek；v2b 的 Kernel/授权部分走「A 级安全核心」例外由 Claude Code 自写，PR 写明原因。

---

## 11. 当场试跑方案（交付前必做，CLAUDE.md 当场试跑条款）

**v1（无定时任务，所以试跑 = 在真实数据上只读跑一遍完整链路）**
1. 脚本 `scripts/promo-plan-trial.ts`（只读，不写库）：对 CTS、Roman 各取一份计划（没有则用虚构 fixture + 真实客户的只读事实），输出：每阶段闸灯（含 unknown 项）+ 一周对账 4–6 行 + 一句头条。
2. 对照：把输出与人工用 SQL 算的同一周花费/结果核对一致（时区用账户时区）。
3. 页面：本机起服务，用测试数据在浏览器打开，手机宽度截图；Impeccable 检查前后数字写进 PR。
4. PR「## 当场试跑」写：触发方式、时间、退出码、输出摘要（几项绿/黄/红/unknown，对账几行）。

**v2（有 Inngest 函数和写回执）**
- Inngest 函数用 `dry_run` 模式当场触发一次完整链路：批准→闸判定→派发→（广告步骤）起草**演练**→对账→回执；用替身 Meta（沿用 R4 的离线彩排办法），断言 Meta 侧 0 个 POST、0 个 ACTIVE。
- 真建一次暂停草稿需要 PM 点头 + 一条测试账号，单独列「未跑原因与谁来决定」，不能说「做好了」。
- 每周 Inngest 对账首次自动运行当天登记台账卡 `verify_by`。

---

## 12. 风险与不做的事

**风险**
1. **证据只有一个旅游客户**（红线 3）：闸词表和剧本数值会带 CTS 偏见 → 全标 `single_client`；v1 验收强制用地产客户第二家跑。
2. **又做成没人用的功能**：Marketing Plan 的教训。对策——入口并进今日待办和 Goal 页、PM 每周只一页、批准路径唯一且有回执；v1 上线后 4 周看有没有 PM 点「按计划继续」，没有就回头查原因，不继续加功能。
3. **读不到的事实被当成绿**：规则写死 `unknown` 不当绿不当 0；unknown 过半不出「正常」。
4. **一个计划里同时管广告和社媒，范围蔓延**：v1 只做广告栏的**展示+闸+对账**，不做自动生成；v3 才接社媒落地。
5. **与 R4（#2381）撞车**：两边都要收编进 Kernel → 一起做，不各做一套。
6. **Roman 的「已批准但没派发」旧计划**：不自动补派（会凭空产生一批过期任务），v1 页面只标「这是旧计划」；是否补派由 FDE/PM 另决定。

**不做**
- 不自动开启任何广告、不改预算（v1/v2 都是 PM 才能开启）。
- 不新增能力线/支柱/Connector；不建 Mailchimp 建信/发信（Connect 缺口，另立项）。
- 不合并 `execution_items` 与每日计划；不退役每日计划。
- 不用 CTS 一页纸（#2644 已被 PM 否）填任何剧本或默认值。
- 不新建 `/api/cron/*`（v2 用 Inngest 定时器）。
- 不让 AI 自动写预算/受众；不替 PM 选「补钱/提上限/收缩目标」。
- 本稿不创建迁移文件、不 apply 任何东西。

---

## 13. 审查记录

> 状态：待审。子牙（架构）+ 魏征（挑刺）+ 板桥（非技术视角）审完后在此补充：每位的结论、必改项、我怎么改的。**没跑完不写成已审。**

---

## 14. Reuse Statement

- **复用**：Marketing Plan（表、页面、批准路由、任务派发）、`goals`、`campaign_briefs`、`ad_strategy_configs`、`ad_daily_insights`、`account-timezone.ts`、广告行业剧本的 key 与选择方式、`client-promo-readiness` 三道门词表、每日计划（`social_plans`/审核/发布队列/自动发布授权）、视频工厂 order-scheduler、Blog 异步入口、`pm-todo` 三件套与车道表、`draft-and-gate` 与 `/dashboard/ad-approval`、Kernel 注册表与回执惯例、Inngest 定时器先例（`flywheel-seo-weekly`）。
- **新增 platform-shared（均未实现，仅设计）**：`PromoSpec`/校验、闸检查与判灯、`reconcileWeek`、`assertStepAuthorized` 守卫、推广计划页、1 个待办 kind；v2 另有 1 张追加式回执表 + 1 列 + 1 个部分唯一索引。
- **industry-specific**：阶段模板/观察期/节奏范围/阈值默认值，只以剧本数据形式存在，标 `evidence: single_client`。
- **client-specific**：目标、预算、受众、素材、日期、各阶段内容——全在计划实例与既有客户配置。
- **客户名/ID/行业判断进 shared runtime**：设计要求无；本稿示例用虚构；唯一出现的真实客户名在证据表（库里实际计划的归属），不进任何代码。
- **学习**：本设计的教训（流程被绕过比功能缺口更致命、`unknown` 不当绿）暂存客户/平台私有，不升行业/全局记忆；闸词表作为 L1 候选子项沿用 105 的登记，等 PM 回「记」。
- **与 tier-gate 决策对账**：设计阶段无实现，落点即 §2 的分类；实施时必须再对一次。
