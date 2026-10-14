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

> **PM 只需要看 §0 和 §9。** 后面的章节是给工程师和审查员看的，里面有技术词，不用读。

**要做什么**：把现有的「营销计划」升级成「推广计划」，**不新建一套系统**。

**多出什么**
1. 计划里多一栏**广告**；
2. 计划分成几个**阶段**；
3. 每个阶段开始前有一张**检查清单**（工具通不通、节奏排了没、内容核实了没），没过关就不让你批准；
4. 每周自动给你一页**对账**（计划做了多少 / 实际做了多少）；
5. 你批准之前**什么都不会发生**；批准之后才一步步生成内容，最后落到每日计划里，由视频工厂、博客、邮件各自去干活。

**钱的保险**：任何版本里，广告最多只会被建成**「暂停」的草稿**，真正开投、花钱只有你本人点头才行。第一步（v1）连草稿都不建，只看不动账户。

**你每周要做的事**：打开一页，看红黄灰绿灯，点「按计划继续」或「批准下一阶段」。目标：不超过 2 分钟、最多 1 个决定。

**出错谁告诉你**：数据读不到时，页面头条会写「本周看不清」，并告诉你谁来补、点哪里；同时今日待办里会有一条带链接的提醒。

**分三步做（每步你单独点头）**

| 步骤 | 做什么 | 会不会动钱 |
|---|---|---|
| 第一步 v1 | 先上只读页面（广告栏、阶段、检查清单亮灯、每周对账），再单独加固「批准」（防重复派发、按阶段批准）；批准只派内部待办 | 不会，广告只展示 |
| 第二步 v2 | 阶段批准和检查结果留下不可改的记录；广告可建**暂停草稿**，开启仍只有你 | 只建暂停草稿 |
| 第三步 v3 | 社媒同一板块：展开成每日计划、视频工厂下单、博客出稿；邮件仍是人工待办 | 视频/博客可能产生费用，批准按钮旁会写金额 |

**为什么现在要这样做（调查结论，一句话版）**：现有的营销计划近两个月没有新增使用——一方面功能缺口（没广告栏、点两下批准会派两份活、做完不会自动打勾），另一方面最近一个「已批准」的计划是**高度疑似被人在后台直接改成已批准**的，系统没按流程派活，所以「批准了但什么都没发生」。所以设计的**第一优先是堵住这些后门**，其次才是加功能。细节见 §3。

**还有两件事要你（或 105）定**
1. 你说的「Go」是指哪个功能？我在代码里没找到叫 Go 的计划启动按钮（见 §3.4）。
2. 设计审完后你回哪个：回 **「同意设计」**，我们把本稿合进仓库（会告诉你 PR 编号，之后你也可以回「合 编号」）；回 **「做第一步」** 才开始写代码。**在你回复之前我不动手。**

**审查状态**：子牙（架构）、魏征（挑刺）、板桥（非技术视角）三位已审，意见和我的处理见 §13；其中旁路和批准竞态两项已改成第一步的**必做项**。

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

> 口径提醒（魏征）：这里的「没人用」只能说成「**没有新增使用**」——依据是最近一个计划 8/20、marketing_plan 来源的 289 张任务卡最后一张 6/8；我没查页面访问量。5 个已批准计划里 `d0000000-…` 疑似种子数据不该算分母；「1 对 5」是小样本，只用来说明旁路存在，不用来估比例。

库里 `marketing_plans` 共 31 行（draft 14 / approved 5 / archived 8 / completed 4）：

| 计划（已批准） | 创建 | 批准时间 | 计划里任务数 | 实际派出的任务卡 | 判断 |
|---|---|---|---|---|---|
| 3ed2807d | 5/31 | 5/31 11:06 | 25 | 25 | ✅ **唯一能证明走了批准按钮的**（有批准时间，计划数=派出数） |
| 79cd3473、d6fa990f | 6/8 | 空 | 0 | 各 6 | 手工置为已批准（无批准时间） |
| d0000000-…e001 | 5/28 | 5/30 | 0 | 0 | 疑似种子/测试数据 |
| **37ebacaa（Roman，最近一个）** | **8/20** | 8/21 00:00:00（整点） | **12** | **0** | ❌ **高度疑似绕过批准路由**：更新时间=创建时间、批准时间是整点、0 条任务派出（整点也可能是脚本批量设置——同样是旁路；不是证明） |

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
  ad_account_id: string                // 必填：目标广告账户；校验属于该客户，币种由账户快照解析，解析不到就 fail closed（不猜主账户）
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
- 灯有**四种**：绿 / 黄 / 红 / **灰（未核实 unknown）**。灰色必须是单独的颜色，不能混进黄或绿。
- 检查项分**硬门**和**软门**（审查后的修订）：
  - **硬门**（涉及花钱或对外的）：账户可用、日上限已设、「一条结果」口径已定、素材已批准、落地页上要推的东西真实存在。**硬门红或灰 → 本阶段不能批准。**
  - **软门**：其余。软门灰/黄可以批，但批准按钮旁列出全部「未核实」项，按钮文案带数量（例：「批准本阶段（3 项未核实）」）。
  - 词表里每一项带 `evidence` 字段；`evidence=single_client` 的项**默认只能当软门**，有第二家客户验证后才能升硬门（红线 3 在代码里强制，不只写在文档里）。
  - 靠人核实的项（落地页核对、客户确认等）由 FDE 点「已核实」，记下是谁、什么时候；v1 无新表，记在 `promo_state.checks[]`。
- **事实必须带 `as_of`（取数时间）**：超过剧本给的新鲜期就按灰处理——「读得到但是旧的」不能判绿（例：快照三周没同步）。
- 拦截在**接口层**也要做：批准接口同样拒绝「硬门红/灰」的阶段，不能只在前端藏按钮（否则直接调接口就能批）。
- **批准当时的灯要存下来**（随批准写入 `promo_state.gate_snapshot`），事后能证明「批的时候是什么状态」。
- v1 只亮灯、不碰广告账户（拦截账户 = v2，通过既有审批）。**首次上线预期大部分是灰**（例如自动发布授权库里 0 行）——页面要写「首次接入，多数项待核实」，别让它看着像坏了。
- 阈值（「覆盖几天」「素材至少几条」）= **剧本默认值**，计划可覆盖，共享代码里没有数字。

### 4.5 每周对账

`reconcileWeek(plan, weekIndex, facts)`（纯函数）输出 4–6 行，每行：**计划值 / 实际值 / 状态 on_track | behind | over | unknown / 数据来源与更新时间**。
- 花费：`ad_daily_insights`（**时间一律走 `ads-strategy/account-timezone.ts`**，不许把 UTC 戳直接跟本地日期比——10-10 能力图谱稿记过这个坑）。
- 结果：按 `primary_result` 口径；订位 `crm_bookings` 只在能拿到广告来源归因时才算，**拿不到写 unknown，不拿全量订位冒充**。
- 内容：计划每周条数 vs 每日计划实际 `published`、工厂 `PUBLISHED`、Blog 已发布数。
- 闸状态变化：上周绿、本周红了的项。
- 末尾给**一句建议**（继续 / 调整哪一项 / 暂停），建议不是动作。
- 数据缺失一律 `unknown`；**头条取最差的一行**：花费或结果任一核心行是 unknown，就不能写「基本按计划」，只能写「本周看不清」并附谁来补、点哪里。
- **「计划值」怎么来**（子牙）：计划里只有日预算和起止日期，没有「每周计划花费」。口径固定为：该周内处于运行阶段的天数 × 日预算（暂停日、阶段重叠日按计划里写明的日期算），并写单测固定。
- **结果要等「成熟期」**（魏征）：广告产生的订位常滞后几周。结果行只在花费日之后过了剧本给的成熟天数才判 behind；未到期标「未成熟」，不报警。Meta 自报结果与 CRM 订位**永不合并成一个数**，分两行并列。
- **近几天的广告数据未稳定**（平台会回补）：对账周排除最近 N 天或标「未稳定」，N 来自剧本。
- **时区**：`account-timezone.ts` 在没有快照时会静默回退 UTC；对账里时区缺失必须返回 unknown，不能走回退。
- **分母**：目标（goals）已过期/归档、或目标周期与计划阶段不重叠 → 明确报「目标不适用」，不用旧分母。

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
| 广告执行 | `draft-and-gate`（建暂停→回读→PM 批）、`/dashboard/ad-approval`；Kernel 现有 8 个广告动作（受限自治；注册表头注释还写六个，已过期） | v2：见 §6.2 |

### 5.2 第一步（v1）必做：先堵后门，再加功能（审查后改成的第一优先级）

魏征和子牙独立查出：今天「未批准什么都不做」只是口号，**至少 4 条旁路**。v1 开工的第一批工作是堵它们，**比加广告栏优先**：

1. **批准要有"抢占"，而且失败后能接着做**：批准接口今天是「先派发再改状态」，无事务无锁。**不能**用「把状态改成已批准」当一次性锁（Codex 指出：改完状态后派发失败，计划会永远显示已批准却没有任务，正是 Roman 那次的故障）。v1 改为带"租约"的三步（零迁移，状态存在 `plan_data.approval` 里）：
   ① **抢占**：条件更新 `promo_state.approval.state` 从空 / 租约已过期 → `dispatching`（写租约到期时间、请求号）；抢不到就返回"正在处理"；
   ② **派发**：按步骤号**先查后插**（已存在同 `promo_ref.step_id` 的任务卡就跳过），所以重试不会重复；
   ③ **收尾**：全部派完才把计划状态改成已批准、`approval.state='done'`，并写回执。
   进程中途挂掉：租约到期后，再点一次就从第②步接着做。
   - **租约/令牌/回执放哪里**（Codex 第三轮）：不能放在 `plan_data` 里——现有 `PATCH` 是用客户端提交的整个对象**整体替换** `plan_data`，一个基于旧页面数据保存后续阶段的请求就能把令牌和回执抹掉。所以 v1b 把它们放进**服务端专用的独立列 `marketing_plans.promo_state`**（jsonb，A 级迁移，写好、PM 同意才执行）：`PATCH` 永远不接受、不回写这一列；修改它只通过服务端的原子条件更新（带令牌）。`plan_data` 里只留可编辑的计划内容。
   - **旧请求没死透怎么办**（Codex 第二轮）：租约到期后新请求抢占，旧请求可能还在写，「先查后插」挡不住两边同时插。所以 ①每次抢占生成一个**令牌**，第③步收尾和每次写回执都带令牌做条件更新，令牌对不上（说明被别人抢占了）就拒绝；②**数据库层的唯一索引从 v2 提前到 v1 的批准加固那一步**（§7，A 级迁移，写好、只有你同意才执行），作为真正的「只派一次」保证——没有它，v1 的批准加固**不做**，只做只读页面。v2 再把这三步换成 Inngest 事件（§6.2）。
   - **按阶段批准（Codex）**：计划里有多个阶段时，"批准本阶段"**不等于批准整个计划**。v1 需要记录每个阶段自己的批准状态（`promo_state.approval.phases[阶段号]`，同样用租约抢占），**只派发该阶段的步骤**；现有批准路由一次派发全部 `plan_data.tasks` 的行为要拆成"按阶段派发"。没有这一步，后面阶段无法保证等检查清单通过才派发。
2. **批准后锁住「已批准的阶段」，没批准的阶段仍可改**（Codex 第二轮）：今天 PATCH 能随时整体改 `plan_data`。改为**按阶段锁**：批准某阶段时存该阶段内容的哈希；PATCH 拒绝改动已批准阶段的内容，**未批准的后续阶段照常可改**，所以「出现偏差→FDE 调整→再批」对后续阶段走得通。要改**已批准**的阶段：v1 就提供「**撤销本阶段批准**」——要**新写一个按阶段撤销的函数**（只删 `promo_ref.phase_id` 等于该阶段、且还没开始的待办）；**不能直接复用**现有 `revokePlanTasks(planId)`（Codex 第三轮：它只按计划号和状态过滤，撤销第二阶段时会把第一阶段还没开工的合法待办一起删掉）。撤销后该阶段回到可编辑，改完重批；已经开始做的任务卡不删，列在页面上交 FDE 处理。计划整体状态只在「所有阶段都批完」时才变成已批准，不再因为批了第一阶段就锁死整份计划。
3. **所有往 `execution_items`（来源 marketing_plan）写任务卡的入口都要查计划已批准**：①批准路由；②`POST /execution`（今天只查计划存在，不查状态——**草稿计划也能派活**）；③`save-to-board`（今天自动挂到「该客户最新已批准计划」，和批准的阶段无关）。三个入口列清单冻结，只许缩小。
4. **`PATCH` 的状态改写收紧**：今天只拦 approved，其余值随便改（含 completed）；`completed` 改为由阶段全部完成推导。
5. **PromoSpec 校验必须在 PATCH 和 approve 两个入口都跑**（不只在生成器里），畸形输入按「未批准」处理（fail-closed）；写 `schema` 版本号和升级策略。
6. **租户校验**：`goal_id`、`campaign_brief_id` 必须校验属于同一个客户（否则可以挂别家的目标、读到别家的目标值）；对账读取的每一张表都带 `client_id`；写单测。
7. **预算上限在服务端强制，且按"总额"算**（Codex）：`daily_budget_cap_cents` 是客户每日**总**上限，不是单个步骤的上限。保存、批准、（v2）开启三个时点都要把 ①本阶段**全部**广告步骤的日预算 ②该客户账户上**已在投放**的广告预算 加总，按账户和币种分别对照 `client_meta_ad_accounts` 的账户级日上限和 `ad_strategy_configs.daily_budget_cap_cents`，任一超出就拒绝；上限变更后已批准计划要重新核。写单测：两个步骤各自不超、合计超的情况必须被拦。**账户级上限那一列（`client_meta_ad_accounts.daily_budget_cap_cents`）生产库里现在已经有了**（2026-10-14 只读查过；Codex 引的 10-06 证据已过期）；但代码读取时仍要容错——列读不到或为空就把这一项判灰、不能批准，**不能跳过账户上限**。
8. **暂停整个计划**：v1 就要有「暂停（不再派发）」按钮；已批准阶段的撤销见第 2 条（按阶段、只撤还没开始的待办），更完整的撤销与回滚流程在 v2。
9. **批准留回执（v1 无新表）**：把派发结果（请求号、派发数、时间、操作者）写进 `promo_state.receipts`（追加，经服务端原子更新）——Roman 那次「批准了但什么也没发生」正是因为没有回执。
10. 其余沿用：生成器不动；「阶段+广告」草案由**人确认后**写入 `plan_data.promo`，v1 不让 AI 自动写广告预算；从 Goal 页进入的入口保留并带上 `goal_id`（Go，见 §5.4）。

> 数据库底层不能防「直接改库」（Roman 那次的做法）。**v1 的保证强度 = 应用层，防不住有库权限的人直接改**；DB 层兜底放 v2：校验「来源为 marketing_plan 的任务卡，其所属**阶段**有一条有效的批准回执（版本对得上）」，**不能**校验整份计划的状态——因为按阶段批准时，第一阶段派发那一刻计划整体还不是已批准，用计划状态会误拦合法派发（Codex 第三轮）。文档、PR、页面里**都不得**写成「代码保证未批准不执行」。

### 5.3 「未批准什么都不做」怎么保证（修订）

- **v1**：靠 §5.2 的 1–4（唯一批准路径 + 抢占 + 批准后锁内容 + 三个写口统一检查），守卫 `assertStepAuthorized` 先做成**读 `marketing_plans.status` + `plan_data.approval`（含内容哈希）**的纯函数：批准时存 `promo` 的 sha256，读取时对不上就当「未批准」。
- **v2**：守卫改读**不可伪造的东西**——追加式回执里的 `approved` 回执 + `plan_revision` 匹配，而不是读可被直接改的状态字段。
- 抛错的处理：守卫抛错在批量/待办路径里不能让整批失败，要转成一条待办（说了什么问题、怎么办、链接），不能只打日志。
- 架构测试：扫描「谁调用了下游入口却没调守卫」，冻结名单只许缩小（沿用 R4 的做法）；已知扫不到 SQL/脚本直写，所以写明上面那条强度声明。

### 5.4 Go 的处理（待确认）

按「Goal 页的启动入口」：Go = 从目标页发起推广计划。合并方式：目标页的入口改为创建「推广计划」草稿（带 `goal_id`），原「+ 生成 Marketing Plan」并入同一入口，不留两个按钮。若 Go 实际是别的东西，只影响入口位置，不影响模型。

---

## 6. 版本路线

### 6.1 v1（分两小步：v1a 只读页面 B 级；v1b 批准加固 A 级）

> Codex 第二轮指出：§5.2 要改审批、幂等、并发、状态机、租户隔离，按质量闸这些任一项就是 A 级，不能整个 v1 标 B。所以拆开：
> - **v1a（B 级）**：推广计划页、检查清单亮灯、每周对账、待办提醒——**纯读取，不改任何现有写入口**；可以先单独上线。
> - **v1b（A 级）**：§5.2 全部加固（抢占令牌、按阶段锁、三个写口统一检查、预算总额校验、去重唯一索引迁移）；需要真实数据库并发测试（并发批准只派一次、跨客户隔离）、变异验证、子牙+魏征+板桥复审，迁移只有 PM 同意才执行。
> 页面上的「批准本阶段」按钮**到 v1b 才接上**；v1a 阶段页面只显示灯和对账，批准仍走现有入口。

- 内容：`plan_data.promo` 类型+校验；闸检查纯函数+只读事实适配器；`reconcileWeek`；推广计划页（一页纸，见 §9）；`promo_week_review` 待办（拉模式）。
- 批准：沿用现有批准路由——派出的是**内部任务卡**；**广告步骤只展示、不执行、不建草稿**。
- 不含：新表、新定时任务、Kernel 改动、对外副作用（不碰广告账户）。
- **Inngest 例外要如实写**（魏征指出原表述不严）：v1 的批准仍会往 `execution_items` 写内部任务卡（内部写入、属"计划→任务卡接力"），所以 v1 不上 Inngest 的**原因**是「没有对外副作用、没有跨步骤异步接力、不花钱」；**替代回执**放在 `plan_data.receipts`（见 §5.2-9）；**恢复条件**：进入 v2（出现广告草稿这种对外副作用）时必须上 Inngest。待办提醒是页面打开/今日待办读取时现算的**拉取**，不是定时任务，所以 v1 没有"当场试跑"的定时对象。
- 验收：旅游客户与地产客户各用真实只读数据跑出灯和对账，**两家的共享代码不改一行**（红线 4/5 的实证）。注意 Roman 库里的计划是绕过流程写入的，数据形态不正常，只能证明「不用改代码」，证明不了词表泛化——所以另加一份合成测试数据当第二证据。

### 6.2 v2（A 级，审批留痕，接 Kernel）

- 新表 `promo_plan_receipts`（追加式回执，见 §7）+ `marketing_plans.plan_revision`（批准绑定计划版本，沿用每日计划自动发布授权的做法）。
- Inngest 事件（业务可读名）：`promo_plan.phase.approved`、`promo_plan.gate.evaluated`、`promo_plan.step.dispatched`、`promo_plan.ads_draft.requested`、`promo_plan.week.reconciled`；每一阶段有机器可读回执（request id、client id、plan/phase/step id、状态、`no_publish`/授权状态、provider 影响、created_at）。人工点头只推进到下一事件，不等于发布授权。
- 每周对账由 Inngest 自带定时器按客户派单（先例 `flywheel-seo-weekly`：定时在 Inngest，路由只留手动补触发），**不新增 render.yaml 条目**；但要照先例保留一个手动补触发入口，并登记到 `src/lib/cron/registry.ts`。
- 广告执行（推荐方案）：
  - **v2a**：广告步骤「建暂停草稿」仍走现有 `draft-and-gate`（PM 在 `/dashboard/ad-approval` 开启，这是唯一能花钱的开关，不改）；回执里记 `flywheel_actions.id` **和它当时的状态**（`awaiting_approval / activating / blocked / failed / active / rejected / paused` 要逐个映射，不能只记号码——否则卡在 failed/activating 时回执还显示「已派发」），实现「计划步骤→草稿→批准→开启」整条链可追溯。
  - **v2b**（单独立项、4 审含狄仁杰）：先澄清 `draft-and-gate.ts` 里的 `ads.create_ad` 只是账本里的动作类型字符串、不是 Kernel 的动作 key（避免出现两套同名语义）；再在 Kernel 注册 `ads.create_paused_draft_from_plan`（只建暂停对象）和 `ads.activate_from_plan`（approval=人工，**不进受限自治信封**，永远要 PM），把 `publishDraftPaused/activatePublished` 作为 capability handler，才算真正「执行进 Kernel 留痕」。这与 R4（PR #2381，工厂 Reel 自动起草暂停广告，后续事项 5「Kernel 收编」）是同一件收编工作，**两边一起收编，不各做一套**。
- 是否把 v2b 一起做、还是 v2a 先行：技术项，由子牙/魏征审定，不抛 PM。

### 6.3 v3（B/A，社媒同板块）

- `social_cadence` 步骤→批准后在 `social_plans` 里写 `campaign_daily_v1` 槽位**草案**（带 `promo_ref`）；真正发布仍只走每日计划既有的「审核→发布队列→PM 授权」（Facebook Post 已通；story/reel 仍是草案）。
- 视频：只写一条工厂需求信号，**视频一律走工厂**（CLAUDE.md §8 红线）。注意：`factory/outlets.ts` 里 `daily_plan connected:false`（等 Remotion 在 CTS 稳定两周）——v3 在这条解除前，Reel 步骤只出工厂单、不接每日计划。
- Blog：调现有异步入口出**草稿**（有 MTC 计费：`blog_seo` 40 / `blog_dual_signal` 60——批准阶段时页面显示将产生的费用）。
- Newsletter：继续人工任务卡（`requires_link` 硬检查沿用）。
- **已核实（子牙）**：`campaign_daily_v1` 的校验是普通对象（非 strict），多带的 `promo_ref` 会在解析时被**静默丢掉**；且每份每日计划固定 7 天、绑单个 campaign。所以 ①`promo_ref` 必须在 schema 里显式加字段；②一个跨多周的社媒步骤必须**每 7 天拆成一份**每日计划，不是"展开槽位"一句话的事——v3 的工作量比 §0 看起来大。

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
-- 追加式必须由触发器强制（service_role 会绕过 RLS，光不开 UPDATE/DELETE 的业务路径挡不住）：
-- 照仓库已有范式 authorization_decisions_append_only() / ads_circuit_events_append_only_trigger，
-- 加一个拒绝 UPDATE / DELETE / TRUNCATE 的触发器；纠错 = 追加一条新回执。
ALTER TABLE marketing_plans ADD COLUMN plan_revision int NOT NULL DEFAULT 1;
-- v1b（A 级）：服务端专用状态列，PATCH 永不接受/回写；只经带令牌的原子条件更新修改：
ALTER TABLE marketing_plans ADD COLUMN promo_state jsonb NOT NULL DEFAULT '{}'::jsonb;
-- 派发防重复（共享表 execution_items，A 级）：
-- 这个唯一索引属于 v1b（A 级），不再等到 v2；写好、PM 同意后才执行。
-- 步骤号存放位置只有一处：steps_json.promo_ref.step_id（嵌套路径），索引和谓词都读这个路径：
-- CREATE UNIQUE INDEX ... ON execution_items (marketing_plan_id, (steps_json->'promo_ref'->>'step_id'))
--   WHERE source='marketing_plan' AND steps_json->'promo_ref' ? 'step_id';
-- 且校验器保证"步骤号在同一计划内唯一"。
```
- `goal_id` 在 v2 提成 `marketing_plans` 的真列并加外键（放在 jsonb 里没有外键，目标被删/改状态无人知道）；v1 只在应用层校验同客户。
- 生产库实查（2026-10-14，只读 `pg_policies`）：`marketing_plans`、`execution_items`、`social_plans` 的访问策略**都只对 service_role 开放**。注意 `20260524000003_marketing_plans.sql` 的迁移文件里漏写了 `TO service_role`（子牙发现），生产库实际是对的（可能后来修过）；新表一律照模板写全。
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

## 9. PM 每周怎么用（一页看懂、点按钮或回一句话）

**入口**：今日待办里，每个在推广的客户有一条「本周推广对账 · 待你看」，带直达链接 → 打开该客户的「推广计划」页。数据读不到时也会有一条待办，写明谁来补、点哪里。

**页面从上到下（手机也能看）**
1. **一句话头条**，只会是这三种之一：「第 3 周 · 基本按计划」/「第 3 周 · 广告花费落后 40%，要你决定 1 件事」/「本周看不清：缺 XX，由某某负责，几号前」。花费或结果任一项读不到，就**不会**写「基本按计划」。
2. **四行对账**：广告花费、结果数、本周发了几条内容、下一阶段的检查清单——每行「计划 / 实际 / 灯 / 数据更新于」。结果还没到该看的时候，写「未成熟」，不报警。
3. **下一阶段的检查清单**：工具 / 节奏 / 内容三组，灯有四种——**绿**（通过）、**黄**（有风险）、**红**（没过）、**灰**（还没核实）。点开每一项看谁负责、几号前。
4. **按钮只有两个**：
   - **「按计划继续」**：对账没有异常时要点的唯一一个。点了系统只做一件事——记一条"这周 PM 看过、没意见"的记录，不改计划、不动钱。
   - **「批准本阶段」**：第一步（v1）里，它只会派出内部待办，**广告不会自动投放**，按钮旁边会写这句话；第二步起才会建**暂停**的广告草稿，真正开投仍要你在广告审批页再点一次。
     - 有**红**，或有**灰色的"花钱相关"项** → 按钮是灰的，旁边写「暂时不能批：缺 X，由某某负责，几号前」。
     - 只有**其他灰/黄** → 可以批，但按钮写成「批准本阶段（3 项未核实）」，**默认别批，或先找负责人问清楚**。
     - 会产生费用的批准（例如博客出稿）按钮旁边写金额。
5. 对账出现偏差时多一个输入框「要调整什么」，你写一句话（例：「预算降到上限的一半」），由 FDE 改进计划，改完你再批一次。

**回话方式统一**：页面上点按钮是主路径；你在聊天里想快点，就回 **「按计划」** 或 **「批 阶段2」**，效果和点按钮完全一样。要调整就直接说人话，由 FDE 去改。
**每周你的工作量**：一页、不超过 2 分钟、最多 1 个决定。

---

## 10. 风险级别、验证与审查

| 版本 | 级别 | 理由 | 验证强度 |
|---|---|---|---|
| v1a | B | 新读取接口（客户隔离）+ 纯函数 + 页面；无迁移、不改任何写入口 | 核心单测 + 少量集成；闸与对账各做变异验证；Impeccable 过页面 |
| v1b | **A** | 审批、幂等、并发、状态机、租户隔离、预算上限；含去重唯一索引迁移 | 强验证：真实数据库并发测试、跨客户隔离测试、变异验证；子牙+魏征+板桥复审；迁移单独授权 |
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
5. **PromoPlaybook 回退**：客户行业为空或不在 key 里时，**回退 `default` 剧本，且 `default` 的数值只能是保守空值/占位（不填旅游经验）**；页面标"未选行业剧本"。
5b. **预留成本字段**：数据结构里先放 `cost_estimate`（v3 批准阶段要显示 MTC 费用），免得 v3 改结构；所有会扣费的批准按钮旁写金额。
5c. **提醒只靠今日待办是拉取**：PM 不打开就没人知道。出错（读不到数据、对账失败、灯变红）也要生成一条带链接的待办；v2 再加主动通知。
5d. **与 R4（#2381）撞车**：两边都要收编进 Kernel → 一起做，不各做一套。
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

## 13. 审查记录（2026-10-14 三审已跑完，修改已并入）

| 审查 | 结论 | 主要意见 → 我的处理 |
|---|---|---|
| **子牙（架构）** | 无需推翻；3 项决定：v2a/v2b 拆法**同意**、"步骤引用不合表"**同意**、"jsonb 存阶段步骤"**v1 同意、v2 前状态要离开 jsonb** | ①守卫不能读可被改的状态字段、v1 别宣称"代码保证" → §5.2/5.3 已改，强度声明写明；②批准后 PATCH 可改内容 → 已列必做；③批准无抢占 → 已列必做；④未核实项不拦批 → 已分硬门/软门；⑤"计划值"口径未定义 → §4.5 已补；⑥首次全灰 → 已写预期；⑦草稿状态映射 → §6.2 已补；另：Kernel 实为 8 个广告动作、`ads.create_ad` 非 Kernel key、daily-plan 校验会丢字段且固定 7 天 → 已改；**marketing_plans 迁移漏 TO service_role → 生产实查已是对的**，已记 |
| **魏征（挑刺）** | 方向对，"未批准什么都不做"今天有 ≥4 条旁路 | 25 条意见：必改项（旁路、批准竞态、硬软门、数据时效、结果成熟期、Inngest 例外的替代回执、租户校验）**全部并入 §4.4/4.5/5.2/6.1**；"Roman 直接写库"已降为"高度疑似"，"没人用"降为"没有新增使用"；优先级改为**先堵旁路再加功能**。未采纳/延后：把当场试跑对照改成自动化断言（可选，v1 实施时再定）；DB 层触发器兜底放 v2 |
| **板桥（非技术）** | §0 原版只能看懂约 60% | §0 整段按大白话重写；顶部加"PM 只看 §0 和 §9"；"闸"改"检查清单"；灰色 unknown 单独成色；按钮文案 v1 不叫"批准开投"（见 §9）；"合 N"改成"同意设计 / 做第一步"；出错谁通知写进 §0；风险级 A/B 从 PM 页面拿掉 |

| **Codex 第三轮（4 条 P1）** | 全部成立，已改 | ①按阶段撤销要新写、不能复用整计划撤销 → §5.2-2；②租约/令牌/回执不能放会被整体替换的 `plan_data` → 独立服务端列 `promo_state`（§5.2-1，v1b 迁移）；③广告步骤缺目标账户 → `ad_account_id` 必填（§4.2）；④数据库兜底要校验阶段回执而非计划状态 → §5.2 末注。注：这是第 3 轮机器人意见，按 #964「普通最多两轮、机器人新评论不自动授权继续修」，本轮因 4 条都是设计缺陷且改动很小才并入，**之后的机器人轮次我不再自动跟进**，由 PM/18 号决定。 |
| **Codex 第二轮（4 条 P1）** | 3 条成立已改、1 条证据过期 | ①锁整份计划导致后续阶段无法调整 → §5.2-2 改按阶段锁并提供撤销本阶段；②租约方案缺令牌/原子去重 → §5.2-1 加令牌，唯一索引提前到 v1b；③账户预算列生产缺失 → **生产已有该列**（只读核实，引用的 10-06 证据过期），仍要求代码容错；④v1 应判 A 级 → §6.1/§10 拆成 v1a（B）/v1b（A） |
| **Codex 第一轮（PR #2649，5 条 P1）** | 全部成立，已改 | ①v1 要真正按阶段批准、只派该阶段步骤 → §5.2-1；②预算上限要按账户/客户**总额**算 → §5.2-7；③回执"不可改"要靠触发器 → §7；④去重索引要读嵌套的 `promo_ref.step_id` → §7；⑤"先抢占后派发"失败后不可恢复 → §5.2-1 改成带租约、可重试、先查后插 |

**未跑的审查**：狄仁杰（攻击验证）——按规则在 v2 实施后补，本设计阶段不需要。
**我自己没复核的**：调查代理引用的 `DECISIONS.md` 行号、CHANGELOG 未勾选项（已在 §3.3 标明"沿用"）。

---

## 14. Reuse Statement

- **复用**：Marketing Plan（表、页面、批准路由、任务派发）、`goals`、`campaign_briefs`、`ad_strategy_configs`、`ad_daily_insights`、`account-timezone.ts`、广告行业剧本的 key 与选择方式、`client-promo-readiness` 三道门词表、每日计划（`social_plans`/审核/发布队列/自动发布授权）、视频工厂 order-scheduler、Blog 异步入口、`pm-todo` 三件套与车道表、`draft-and-gate` 与 `/dashboard/ad-approval`、Kernel 注册表与回执惯例、Inngest 定时器先例（`flywheel-seo-weekly`）。
- **新增 platform-shared（均未实现，仅设计）**：`PromoSpec`/校验、闸检查与判灯、`reconcileWeek`、`assertStepAuthorized` 守卫、推广计划页、1 个待办 kind；v2 另有 1 张追加式回执表 + 1 列 + 1 个部分唯一索引。
- **industry-specific**：阶段模板/观察期/节奏范围/阈值默认值，只以剧本数据形式存在，标 `evidence: single_client`。
- **client-specific**：目标、预算、受众、素材、日期、各阶段内容——全在计划实例与既有客户配置。
- **客户名/ID/行业判断进 shared runtime**：设计要求无；本稿示例用虚构；唯一出现的真实客户名在证据表（库里实际计划的归属），不进任何代码。
- **学习**：本设计的教训（流程被绕过比功能缺口更致命、`unknown` 不当绿）暂存客户/平台私有，不升行业/全局记忆；闸词表作为 L1 候选子项沿用 105 的登记，等 PM 回「记」。
- **与 tier-gate 决策对账**：设计阶段无实现，落点即 §2 的分类；实施时必须再对一次。
