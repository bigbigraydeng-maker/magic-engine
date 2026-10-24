# Magic Engine — Roadmap（未完成事项）

> 最后整理：2026-10-24。仓库 `main` @ `d81d3fcc5509b568a59841323194c4b5d3b10c11`（与 `origin/main` 一致，fetch 于 2026-10-24）。
> 对齐的现行文件：[产品定义](./strategy/ME_PRODUCT_DEFINITION.md)、[系统现状](./STATE.md)、[平台化原则](./roadmap/2026-08-19-me2-platformization-principle.md)、[平台线索 S0 与迁移账本](./roadmap/2026-10-12-platform-lead-s0-and-migration-ledger-v0.md)、[CRM 构建控制](./roadmap/2026-09-15-crm-ai-agent-build-control.md)、[广告 WP3.1b 重做方案](./roadmap/2026-09-27-ads-wp3-1b-v2-redo-plan.md)、[Agent 自治运行计划](./specs/2026-09-24-agent-autonomy-operating-plan-v1.md)（名单以这份为准；[旧架构总表](./agents/00-architecture.md) 自己标了过时）、[最小闭环骨架](./specs/2026-10-18-me-closed-loop-skeleton-min-cost.md)、[功能地图与人机分工](./specs/2026-10-16-feature-map-and-human-ai-division-v1.md)、调度目录 `src/lib/cron/dispatch/catalog.ts`（PR #3071）。
> **计数**：未完成 **355** 条（近期 65，其余 290）。冻结 / 暂停 **89** 条（老阶段 70，NAL 暂停 15，未排期 4）。本次移出 **47** 条（已完成 42，已作废 4，定案更正 1）。移出前未完成是 **491** 条。原文件头写「2026-08-01 · 162 条」，作废。
> 已勾选、本来就不在这 491 条里的旧完成项，只留在归档，这里不重列。
> 旧全文：[archive/ROADMAP-2026-10-24-before-realign.md](./archive/ROADMAP-2026-10-24-before-realign.md)。事项列是要点，逐字原文以归档对应行为准。
> 本次只重排、去重、标状态。没有新功能、没有新计划。优先级沿用原文；原文没打分的仍写「—」。

已上线的功能见 [history/CHANGELOG.md](./history/CHANGELOG.md)。系统现在跑着什么见 [STATE.md](./STATE.md)。`STATE.md` 里「51 条定时服务」是 2026-10-24 凌晨那次审计的句子；同一天的 PR #3071 之后，`render.yaml` 只声明 3 个调度入口。以 `render.yaml` 和 `catalog.ts` 为准。

未完成项仍受 [平台化原则](./roadmap/2026-08-19-me2-platformization-principle.md) 约束。六支柱是 SEO、社媒、广告、口碑、AI 可见度、竞品。线索和客服是 Connector。行业差异进行业层，客户差异进客户配置。

优先级分布（只计未完成 355 条，不含冻结）：P0 19 · P1 8 · P2 22 · P3 32 · 未打分 274。

---

## Current priorities (2026-10-24 PM handoff)

目标：把最小的 IMPACT 闭环跑通一整圈。记下客户要什么 → 量出现状 → 给出处方 → 执行 → 回头看效果 → 用效果改下一轮。

顺序：先平台，再行业，再企业。企业验证目前只做 CTS。NAL 暂停，NAL 专属条目在文末「暂停」一节，恢复前不开工。

做法：复用已经有的能力，只补缺口，不另起一套。

**近期第 1 件：CTS「2027年3月四团招募」。** 目标记着 49 个座位、NZD 7,619，已批准计划「三月团投流v5」。要把「公司已确认订金」按团期的座位数写回这个目标的进度。

- 座位算法已经在 `src/lib/crm/sales-progress/load.ts` 和 `calc.ts`：`company_confirmed` 按人数相加，并且按团期（销售单元）分开。
- 目标进度今天的算法在 `src/lib/strategy/auto-fetch.ts` 的 `fetchBookings`：数的是 `me_sale_outcomes` 里成交记录的条数，不数座位，也不限定这四个团期。
- 进行中：[#3065](https://github.com/bigbigraydeng-maker/magic-engine/pull/3065)（分支 `feat/1986-company-confirmed-bookings`，未合并）。[#3066](https://github.com/bigbigraydeng-maker/magic-engine/pull/3066) 叠在 #3065 上，给推广草稿加按素材的订金上下文，自己不改目标进度。
- 两份 PR 的正文写的是广告健康页 / 草稿上的「公司已确认预订」张数，并写明这个数不是旅客人数。交接要的是把座位写回目标进度。路线图按交接把目标进度记为第 1 件；PR 正文仍以 PR 自己的范围为准，合并前把这两句对上。
- 这一件补在企业验证上：复用已有的目标自动取值和已有的销售进度。团名和团期留在客户配置，不写进共享规则。

调度收口已经决定，还差验收：3 个调度入口取代几十个旧定时任务（PR #3071）。验收方式写在 [台账](./ledger/2026-10-24-render-cron-dispatcher.md)，核对日 2026-10-31。

自治计划里 B4（待办先改人话）和 B5（SEO 不问就能改的范围）仍等广告跑稳两周，见下方「尚未到点」。

---

## 已定案（2026-10-24 19:55 NZDT）

合并规则：Ray 原话：「普通改动机器自动合并。」保留仓库现有 [合并规则](../.github/merge-authorization.md)，普通改动由机器自动合并。本次不改那份文件。

与这句矛盾的「PR 一律不自动合并」作废。依据就是上面这句原话。R003、R157 已按此改状态，不再列在下面的拍板清单里。

---

## 需要 PM 拍板

下面只列还挡着进度的决定。每条在后面的正文里还有一行，这里不重复成第二份工单。回一句就能用的，直接回。

### 生产库还要不要动

- **R028**（P0，近期）AI 可见度周快照：aggregateSnapshot 过滤失败 run（已核实代码已用 isRunConclusive 过滤）；补 failed_runs 列；collector mentions_count===0 加 guard
- **R060**（P0，近期）`client_meta_ad_accounts` 缺 `currency` 列 —— 账户级 `daily_budget_cap_cents` 的币种是隐含的、靠 `ad_entity_snapshots.currency` 反查。今天不出问题纯因 CTS/NAL 实测全 NZD。多币种客户接入前…
- **R160**（—，其余未完成）次要（魏征复审发现，非阻塞）：`discovery_leads` 表建表起没有任何 migration 显式 `enable row level security`/加 policy，虽然 service-role 调用不受 RLS 影响、暂无实际泄露，但应补一条独立 RLS migration 让…
- **R172**（—，其余未完成）[2026-08-14 Meta 方向审计（[docs/aud] AD-CUR-1 广告花费表都没有币种列 —— 跨客户金额全是混币种加总【影响面最大，且是三张表】：2026-08-14 实读账户 `currency`：Oztop `（长编号见归档）` = AUD，CTS / Roman / 混账户 = NZD；…
- **R023**（—，其余未完成）欠账：lead-sheets 只吃 meta_lead_form（改名或加 source_channel 列）
- **R035**（P3，其余未完成）Meta Ads AI 换人接手已连接授权永久卡死：revoke() 改为无依赖时 DELETE，或改触发器/专用 RPC

R019、R031 已从清单移出：2026-10-24 较晚的核查认为线索表路由和 Kernel 认领函数的修复已经在生产库里。较早的盘点曾写「还没应用」。以较晚的核查为准。本次没有再查生产库。

另：`client_audience_assets` 的建表迁移已在仓库（R386 因此移出），策略是 `FOR ALL USING (true)`，没有写成只给服务角色。要不要另开修复由你定。本次不改数据库。

### 密钥和外部账号

- **R052**（—，其余未完成）需要人工操作：在 Render `crazycontent` web 服务配置 `TYPESAFE_API_KEY`（TypeSafe Jev 判断模型密钥，对外封装名 Compliance Engine），配完跑一次真实工单交付验证 `output.quality_flags` 确实产出竞品品牌/…
- **R158**（—，其余未完成）🔴 需 PM 在 Cloudflare 后台（独立账号，本仓无法访问）给 magicengine.com.au 的 Pages 项目补 `SUPABASE_URL`=`https://glbdnayojixmexgofbsd.supabase.co`、`SUPABASE_SERVICE_KEY`=（…
- **R007**（P0，近期）Magic Lab Class / NAL 两客户主页令牌缺 pages_read_engagement：补齐权限或正式标停用
- **R131**（—，其余未完成）Meta 企业验证仍未通过（issue #1299，需要 PM 本人上传公司文件）——不卡继续开发，但卡 Messenger/WhatsApp webhook 真正上线那天

R007 里 NAL 那一半随 NAL 暂停。Magic Lab Class 的主页权限仍要补上，或正式标成停用。R116、R117、R118、R119 在 NAL 暂停区：WhatsApp 权限、令牌和「先确认 NAL 能收到消息」先不动。企业验证本身仍是 R131。

### 广告策略和花钱

- **R087**（—，其余未完成）[待做清单] PM 审批门：执行前发「审批卡」（Portal 通知 或 Telegram bot）；批准后由 Kernel 写入 append-only `authorization_decisions` 记录（含真实 PM 身份与时间戳），Inngest 拿到该 Kernel 授权记录才能触发执行——没有 Ke…
- **R090**（—，其余未完成）[待做清单] `ad_health_narratives` 新增 `executable_actions` 字段：结构化表达哪些处方是机器可执行的（带动作类型、adset_id、参数）——目前处方是自然语言，Act 层需要机器可读的格式。
- **R190**（—，其余未完成）[2026-08-14 Meta 方向审计（[docs/aud] AD-ADV-1 `ad-publisher.ts:116` 写死 `advantage_audience: 0`：无差别关掉 Advantage+ 受众，是 ME 代码唯一与 Andromeda 打法正面冲突处。现有两种 `DraftKind`（…
- **R193**（—，其余未完成）[2026-08-14 Meta 方向审计（[docs/aud] AD-EXPL-1 多角度测试要设"每臂最低探索量"，否则学不到东西【决定「找出赢家」这个卖点成不成立】：把 5–8 个角度塞进同一个 ad set 让 Meta 分配，拿到的是投放优化，不是可比较的角度实验 —— Oztop 那 14 条 hoo…
- **R195**（—，其余未完成）[2026-08-14 Meta 方向审计（[docs/aud] AD-FRAG-1 每条帖子一个 campaign + 一个 ad set，学习数据被打散：CTS 账户 26 个 ad set 里 14 个是 `帖子："…"` 型 boost，单条 $2–$37。这不是"按兴趣拆人群"那种碎片化，但后果一样 —…
- **R067**（P0，近期）WP3.3 Check + Tune + Jev + 日报两段：韩信在 `runAction` 成功后写 `flywheel_actions`（加 `action_run_id` 列）；attribution 加 `ads_check` 评估器（扩 `flywheel_outcomes_evalua…
- **R001**（P0，近期）B1 广告 WP3（Inngest 链、孔明预检、韩信、Check/Tune、Jev、五段日报、autonomy_mode 同步、G11 熔断）

NAL 的版位、3PL、加预算（R112、R113、R114）在暂停区，不在这份花钱决定里做。

R066 已按「韩信编排不做」移出，依据是未合并的文档 PR [#2860](https://github.com/bigbigraydeng-maker/magic-engine/pull/2860)。R067 还留在广告近期里，等你确认要不要跟着作废。

### NZCPE（展会在 11 月）

- **R199**（—，其余未完成）[NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-1 推广方向口径待 PM 一句话定死 —— 网站 SEO 已按 PM 2026-08-05 拍板改回 B2B（中国企业出海 / NZ 企业对华采购），而广告与社媒计划仍冲 To C 的 15,000 公众访客目标。两条线现在方向不同：是…
- **R200**（—，其余未完成）[NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-2 GBP 建档 地址挂 NZICC（101 Hobson Street, Auckland CBD）—— To C 推广也吃自然搜索流量
- **R201**（—，其余未完成）[NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-3 确认 `plan_tier` 现设 `starter`，无预算信号，PM 确认后再调
- **R202**（—，其余未完成）[NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-4 广告账户挂谁 NZCPE 自建 vs Magic Engine `（长编号见归档）` 代投 —— PM 待拍板
- **R203**（—，其余未完成）[NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-5（可选，PM 决定要不要做） 关键词调研发现 `things to do with kids auckland`（1900/月·低难度）比品牌词好抓，可做网站博客 / `news.html` 扩展 —— 但这跟 NZCPE-1 的方向…
- **R212**（—，其余未完成）[三位 agent 复审剩下的（2026-08-05，已修的不] NZCPE.5 NZCPE 2026 网站+FB 内容规划+广告计划已出草案，见 docs/clients/nzcpe/content-and-ads-plan.md。待 PM 拍板：广告预算量级、广告账户挂谁、要不要做"things to do …

要定的是：推广给同行还是给游客、广告账户挂谁、预算多少。没定之前不开工。

### 冻结区

文末老阶段（Phase 7、下半年 Phase 8–10、Phase 11、Phase 27/28、会员五档、语音、伙伴拓展）请一句决定：作废，或继续冻着。没这句话之前保持冻结，不删除。

---

## 近期仍在推进（65）

服务上面的最小闭环。P0 / P1，以及 10 月仍有效的广告、SEO、社媒审查尾巴。未授权的行业项不放这里。

### 广告 · 卫青（26）

权威仍是 [WP3.1b 重做方案](./roadmap/2026-09-27-ads-wp3-1b-v2-redo-plan.md) 和 [广告负责人节奏](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md)。开投、加预算、换在投素材只认 PM。韩信编排见已移出的 R066 和未合并的 PR #2860。R056 的止损接线已合并，表里标部分完成。R480 要拿 NAL 的真实数据校准，NAL 暂停期间先不动。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R001 | P0 | 部分完成 | 卫青 | B1 广告 WP3（Inngest 链、孔明预检、韩信、Check/Tune、Jev、五段日报、autonomy_mode 同步、G11 熔断） | [归档 L30](./archive/ROADMAP-2026-10-24-before-realign.md#L30) |
| R056 | P0 | 部分完成 | 卫青 | 止损已改成经 Kernel 提交。2026-10-24 核查：PR #2205 已合并，并称生产已有走 Kernel 的暂停成功记录。还没验证的是熔断被拒绝的那一半。本次未重查生产库。 | [归档 L342](./archive/ROADMAP-2026-10-24-before-realign.md#L342) [止损接线台账](./ledger/2026-09-30-ads-stop-loss-kernel-wiring.md) |
| R057 | P0 | 未完成 | 卫青 | WP3.1b 欠账（本轮明确没做，逐条登记，不许只留在台账里）： | [归档 L343](./archive/ROADMAP-2026-10-24-before-realign.md#L343) |
| R058 | P0 | 未完成 | 卫青 | 系列级 / 自动化三条旁路真收编（`meta-ads/execute`、`meta-ads/boost-post`、`winner-reel-sync`）—— 需新增 4 个 ActionKey + capability handler，PR B / C 承载；`winner-reel-sync` … | [归档 L344](./archive/ROADMAP-2026-10-24-before-realign.md#L344) |
| R059 | P0 | 部分完成 | 卫青 | 2026-10-24 核查：只读探针每天会算「这个客户全部账户加起来对总闸」（PR #2830），只观察、不拦截。运行时强制还没做。 | [归档 L345](./archive/ROADMAP-2026-10-24-before-realign.md#L345) |
| R060 | P0 | 未完成 | 卫青 | `client_meta_ad_accounts` 缺 `currency` 列 —— 账户级 `daily_budget_cap_cents` 的币种是隐含的、靠 `ad_entity_snapshots.currency` 反查。今天不出问题纯因 CTS/NAL 实测全 NZD。多币种客户接入前… | [归档 L346](./archive/ROADMAP-2026-10-24-before-realign.md#L346) |
| R061 | P0 | 未完成 | 卫青 | 熔断 #4 Jev 连续低分接线 —— 数据源 `prescription_evaluations` 按 v2.2 §9.3/§11.8/§12 是 WP3.3 才建；3.1b 判据打桩恒返回 undeterminable（不熔不放），表就绪后接线 | [归档 L347](./archive/ROADMAP-2026-10-24-before-realign.md#L347) |
| R062 | P0 | 未完成 | 卫青 | admin 熔断解除看板页 —— 3.1b 只交付 API（`guardGlobalAdmin` 保护），UI 延后 | [归档 L348](./archive/ROADMAP-2026-10-24-before-realign.md#L348) |
| R063 | P0 | 未完成 | 卫青 | `ads.pause_unit` 缺专属审批入口 → 批准没有绑定保护 —— 人按的止损在 `observe` 客户上落成 `pending_approval` 后走通用审批页，而通用页的 `expectedDecisionId` 是可选参数（默认 `{}`），所以「批准的人看到的就是他批的那份」这… | [归档 L349](./archive/ROADMAP-2026-10-24-before-realign.md#L349) |
| R064 | P0 | 未完成 | 卫青 | 让 `triggeredBy: 'human'` 不可自报 —— `SubmitActionInput.triggeredBy` 是提交方必填、`runner.ts:194` 原样写库、零校验；而人工止损信封刻意不看学习期 / 72h 冷却 / 变动 ≤20% / 日上限，所以谁能填 `'human… | [归档 L350](./archive/ROADMAP-2026-10-24-before-realign.md#L350) |
| R065 | P0 | 未完成 | 卫青 | provider-write 闸的 AST 化 —— 狄仁杰实测那道闸能被 barrel 转发 + 同目录相对 import 绕过（9 种写法里架构测试只认得 1 种）。修法在 `architecture.test.ts` 同文件里已有（341 行起的 AST 版 `moduleRefsIn`），存… | [归档 L351](./archive/ROADMAP-2026-10-24-before-realign.md#L351) |
| R067 | P0 | 未完成 | 卫青 | WP3.3 Check + Tune + Jev + 日报两段：韩信在 `runAction` 成功后写 `flywheel_actions`（加 `action_run_id` 列）；attribution 加 `ads_check` 评估器（扩 `flywheel_outcomes_evalua… | [归档 L354](./archive/ROADMAP-2026-10-24-before-realign.md#L354) |
| R082 | P0 | 未完成 | 卫青 | P0 遗留：CTS 网站仓库草稿 chinatravel#136 关或合、CTS 自动化策略 `5d66c469` 没有结束日期（P0-3）；Oztop 2026-08-16 那行 `level='adset'` 孤行来自旧电脑手写 SQL 的 `oztop-meta-daily-monitor` … | [归档 L380](./archive/ROADMAP-2026-10-24-before-realign.md#L380) |
| R489 | P0 | 未完成 | 卫青 | [P0] 授权红线落代码：开投 / 加预算 / 改在投素材 / 改受众 / 关整系列永远只认 PM 身份审批接口；`winner-reel-sync-daily` 改只建 PAUSED（手册 §11 行 A1，A 级，等 PM 回第 1 问） | [归档 L1933](./archive/ROADMAP-2026-10-24-before-realign.md#L1933) [docs/sops/2026-10-10-ads-a…](./sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md) |
| R085 | P1 | 未完成 | 卫青 | [待做清单] 五个动作各自挂真实 rollback handler，不能只挂声明（⚠️ Codex P1 复审结论）：`src/lib/kernel/gateway.ts:238-257` 的 `assertRollbackHandlerAssembled` 只保证「`outward` + `provider_n… | [归档 L422](./archive/ROADMAP-2026-10-24-before-realign.md#L422) |
| R479 | P2 | 部分完成 | 卫青 | 2026-10-24 核查：花费尖刺和客户总闸这两条判据已接进每日拉数（PR #2830），观察期不触发熔断。真正拦住花费还没做。 | [归档 L1920](./archive/ROADMAP-2026-10-24-before-realign.md#L1920) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R481 | P2 | 未完成 | 卫青 | [P2] W1 的「置信度」本期降级成「样本天数」；真要做置信度得先定算法与取值域，否则实现出来是个凭感觉的字符串（子牙 6-3） | [归档 L1922](./archive/ROADMAP-2026-10-24-before-realign.md#L1922) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R482 | P2 | 未完成 | 卫青 | [P2] 把广告组 / 广告层的 `frequency_7d` 真正填上（`daily-insights.ts` 现在直接写死 null），否则疲劳分类长期只能靠系列层（魏征 B-1） | [归档 L1923](./archive/ROADMAP-2026-10-24-before-realign.md#L1923) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R490 | P2 | 未完成 | 卫青 | [P2] S-01 / S-02 / S-11 / C-07 判据补门槛：「抢量」「预期周事件数」「出价偏差」「素材够几周」目前只有方向、缺可验证门槛（子牙审查） | [归档 L1934](./archive/ROADMAP-2026-10-24-before-realign.md#L1934) [docs/sops/2026-10-10-ads-a…](./sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md) |
| R480 | P3 | 未完成 | 卫青 | [P3] 频次阈值按角色分档（拉新 vs 再营销）需先扩 `AdsPlaybook` 接口（`playbooks/types.ts:23` 不收判断规则），且阈值须用 CTS/NAL 真实数据校准，不用开源的数字（子牙） | [归档 L1921](./archive/ROADMAP-2026-10-24-before-realign.md#L1921) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R483 | P3 | 未完成 | 卫青 | [P3] `ad_entity_snapshots` 存按版位拆开的花费，让 D9 能按真实花费判、不只按设置字段判（设计稿 §2.1 #4） | [归档 L1924](./archive/ROADMAP-2026-10-24-before-realign.md#L1924) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R484 | P3 | 未完成 | 卫青 | [P3] NZ 版合规规则库（AU 那份 `src/lib/compliance/au-rules.ts` 已存在但零调用方，先把 AU 接上广告草稿闸再谈 NZ）；Meta 个人属性规则也没落成可比对清单（设计稿 §2.1 #6） | [归档 L1925](./archive/ROADMAP-2026-10-24-before-realign.md#L1925) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R485 | P3 | 未完成 | 卫青 | [P3] 命名规范自动校验（CTS 一个账户里已有四种命名风格并存）（设计稿 §2.1 #2） | [归档 L1926](./archive/ROADMAP-2026-10-24-before-realign.md#L1926) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R486 | P3 | 未完成 | 卫青 | [P3] 卫青手册 §三 把 `ad_health_prescriptions` 改成实际存在的表名（生产库没这张表，照它去查会白跑一轮）（设计稿 §2.6） | [归档 L1927](./archive/ROADMAP-2026-10-24-before-realign.md#L1927) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R487 | P3 | 待 PM 决定 | 卫青 | [P3] 季节性冲刺层排期（Q5） 等 02 号窗口的 CTS 预算计划 PM 拍板后再排（设计稿 §3.4） | [归档 L1928](./archive/ROADMAP-2026-10-24-before-realign.md#L1928) [docs/specs/2026-10-10-ads-…](./specs/2026-10-10-ads-lead-capability-map-and-rhythm-v0.1.md) |
| R491 | P3 | 未完成 | 卫青 | [P3] 通用手册重号：`playbook-ads-meta-general` 有两个 §十三、两个 §三十，建议改编号（记忆文件，不在本仓库） | [归档 L1935](./archive/ROADMAP-2026-10-24-before-realign.md#L1935) [docs/sops/2026-10-10-ads-a…](./sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md) |

### AI 可见度 · 孟子（2）

周快照的失败过滤已经在代码里。下面是还没补上的列、城市定位和告警尾巴。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R028 | P0 | 部分完成 | 孟子 | AI 可见度周快照：aggregateSnapshot 过滤失败 run（已核实代码已用 isRunConclusive 过滤）；补 failed_runs 列；collector mentions_count===0 加 guard | [归档 L201](./archive/ROADMAP-2026-10-24-before-realign.md#L201) |
| R029 | P1 | 待做（已核实代码仍是 "{City},{Country}"） | 孟子 | 行业 AI 可见度：除奥克兰外城市 100% 失败（DataForSEO location_name 写法错）——改 serp.ts CITY_DISPLAY_NAME 或改用 location_code | [归档 L214](./archive/ROADMAP-2026-10-24-before-realign.md#L214) |

### SEO · 孔子（13）

标题周循环已上线。P1 的盯梢 S15–S18 仍开着。10 月负责人节奏的审查尾巴等第一阶段批准，批准前不把那些尾巴当成开工令。谷歌搜索广告节奏是 R478，在冻结区。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R395 | P1 | 未完成 | 孔子 | 22.E.S15 内链 + 收录数据采集（P1）— 补 R2/R5 的 pages 输入（site-audit 爬虫内链图 + GSC 收录状态）；内链改动按 PM 界线进待办审批，不全自动 | [归档 L1700](./archive/ROADMAP-2026-10-24-before-realign.md#L1700) |
| R396 | P1 | 未完成 | 孔子 | 22.E.S16 每周 Blog 恢复（P1）— CTS/Oztop 每家每周 1 篇，自动选题（AI 可见度弱项 × R4 机会词），直调 `generateBlogPost` lib（禁内部 HTTP 自调用），产出进待办等 PM 点头发布 | [归档 L1701](./archive/ROADMAP-2026-10-24-before-realign.md#L1701) |
| R397 | P1 | 未完成 | 孔子 | 22.E.S17 CTS 自动执行手（P1）— 照 `seo_meta_log` 队列模式，CTS Next.js 仓 meta 安全窄道 + applied 回执；blog 发布通道（自动 PR + 人 merge）单独估算 | [归档 L1702](./archive/ROADMAP-2026-10-24-before-realign.md#L1702) |
| R398 | P1 | 未完成 | 孔子 | 22.E.S18 每周一 SEO 周报邮件（P1）— 排名变化/自动改动/待点头 + 社媒栏 + 社媒广告栏；每栏带数据新鲜度检查，断流标注不装新鲜 | [归档 L1703](./archive/ROADMAP-2026-10-24-before-realign.md#L1703) |
| R471 | P3 | 未完成 | 孔子 | P3 的 `seo.change.*` 事件补授权失效、幂等、重放规则（子牙） | [归档 L1908](./archive/ROADMAP-2026-10-24-before-realign.md#L1908) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |
| R469 | — | 未完成 | 孔子 | 簇体检的「谁当主页」要有通用判据，不得写死客户页面（子牙） | [归档 L1906](./archive/ROADMAP-2026-10-24-before-realign.md#L1906) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |
| R470 | — | 未完成 | 孔子 | P2-B 月度竞品词差落地时需要存历史，那时要新表评审（子牙） | [归档 L1907](./archive/ROADMAP-2026-10-24-before-realign.md#L1907) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |
| R472 | — | 未完成 | 孔子 | P1-C 询盘取数口径落地后补一张台账卡（子牙） | [归档 L1909](./archive/ROADMAP-2026-10-24-before-realign.md#L1909) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |
| R473 | — | 未完成 | 孔子 | 预诊断上线后，逐条核实 CTS 示范里「哪页在排这个词」的假设（魏征） | [归档 L1910](./archive/ROADMAP-2026-10-24-before-realign.md#L1910) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |
| R474 | — | 未完成 | 孔子 | 算出张家界「第 4 → 前 3」的点击差额（用现有点击率曲线，不编数）（魏征） | [归档 L1911](./archive/ROADMAP-2026-10-24-before-realign.md#L1911) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |
| R475 | — | 未完成 | 孔子 | 对账 42 号体检里「已过期清单卡」张数（§一写 4、§五写 3）（魏征） | [归档 L1912](./archive/ROADMAP-2026-10-24-before-realign.md#L1912) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |
| R476 | — | 未完成 | 孔子 | 先测「卡从出生到被批」中位天数的基线，再定 ≤7 天目标（魏征） | [归档 L1913](./archive/ROADMAP-2026-10-24-before-realign.md#L1913) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |
| R477 | — | 未完成 | 孔子 | 开源仓库的 SERP 重叠阈值用 CTS 实测校准后才可上线（设计稿 §11） | [归档 L1914](./archive/ROADMAP-2026-10-24-before-realign.md#L1914) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |

### 社媒与内容 · 苏东坡 / 马良 / 李白（17）

社媒 Check→Tune 仍以 [Issue #1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413) 为准。价格核对是发布前的事实闸。发布本身仍要人授权。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R459 | P2 | 未完成 | 李白 | [P2] 资料包由人手填，官网改价后会过期。 官网事实快照（PR 2270）合并后，让核对改为对官网快照自动对账，并给资料加「核对日期」。 | [归档 L1893](./archive/ROADMAP-2026-10-24-before-realign.md#L1893) |
| R468 | P2 | 未完成 | 李白 | [P2] 已知缺口：`now 1999`、`was 2,699, now 1999` 这类 1900–2099 间不带逗号的促销价会被当年份放过（NZ 团价常落在这一带）。让 was/now 后面的数字不再按年份排除即可堵上。 | [归档 L1902](./archive/ROADMAP-2026-10-24-before-realign.md#L1902) |
| R460 | P3 | 未完成 | 李白 | [P3] 资料包里任意字段里的数字都算事实（过期早鸟价、单人房加价可被当团价放行）。收紧成只认带语义的价格字段。 | [归档 L1894](./archive/ROADMAP-2026-10-24-before-realign.md#L1894) |
| R461 | P3 | 未完成 | 李白 | [P3] 共享代码默认团名放在 `tour` 字段、破折号和括号出发地写法，对旅游以外行业不通用；应改成 Industry Profile 或显式声明团名字段。没填资料包又写了价格的非旅游客户目前会被整批拦（待查哪些客户走每日计划发布）。 | [归档 L1895](./archive/ROADMAP-2026-10-24-before-realign.md#L1895) |
| R462 | P3 | 未完成 | 李白 | [P3] 资料读失败时，待办只写日志不出条目（出口则 500 不放行）。待办侧也应出一条「读不到资料」。 | [归档 L1896](./archive/ROADMAP-2026-10-24-before-realign.md#L1896) |
| R463 | P3 | 未完成 | 李白 | [P3] 价格识别已知盲区：无币种无提示词的 4 位裸价（含 1900–2099）、`块`、HTML 实体、`CNY`；「from 150 travellers」类老误伤现在会整批拦。 | [归档 L1897](./archive/ROADMAP-2026-10-24-before-realign.md#L1897) |
| R464 | P3 | 未完成 | 李白 | [P3] 待办只看每个客户最新一份计划，同客户并行第二个活动的计划不会出待办（发布时仍被拦）。 | [归档 L1898](./archive/ROADMAP-2026-10-24-before-realign.md#L1898) |
| R465 | P3 | 未完成 | 李白 | [P3] `verifyPostPrices` 拆成「解析候选团」和「逐条核价」两段；`price-fact-items.ts` 的 `isRecord/readPath` 与 gate 重复。 | [归档 L1899](./archive/ROADMAP-2026-10-24-before-realign.md#L1899) |
| R466 | P3 | 未完成 | 李白 | [P3] 设置页资料包没有字段名提示（`tour` `url` 影响匹配，价格字段名随意），加占位符说明。 | [归档 L1900](./archive/ROADMAP-2026-10-24-before-realign.md#L1900) |
| R467 | P3 | 部分完成 | 李白 | [P3] 魏征二审：新增的「带千分位逗号的数字都算价格」会多拦社交证明文案（Join 2,500 happy guests、1,000 5-star reviews、1,500 bookings、up to 8,848 m）。补单位词表（customers/bookings/spots/rooms/… | [归档 L1901](./archive/ROADMAP-2026-10-24-before-realign.md#L1901) |
| R307 | — | 未完成 | 苏东坡 | Gate B/4（A 级 · 需 PM 单独授权） —— 保存下一份 Daily Plan 时，记录本次采纳/拒绝了哪条 Tune 建议 | [归档 L1375](./archive/ROADMAP-2026-10-24-before-realign.md#L1375) [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413) |
| R308 | — | 未完成 | 苏东坡 | evaluator cohort 全 0 时的 caveat 缺口（魏征复审 #2，PR #1453 review）—— cohort 全部 `ok/partial` | [归档 L1378](./archive/ROADMAP-2026-10-24-before-realign.md#L1378) [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413) |
| R309 | — | 未完成 | 苏东坡 | 阈值比较未走 roundTo 的浮点边界（魏征复审 #3）—— `social-post-evaluator.ts` 的 | [归档 L1381](./archive/ROADMAP-2026-10-24-before-realign.md#L1381) [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413) |
| R310 | — | 未完成 | 苏东坡 | `normalizeStatus` 三处复制（魏征复审 #6）—— `social-post-cohort.ts` 与 | [归档 L1384](./archive/ROADMAP-2026-10-24-before-realign.md#L1384) [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413) |
| R311 | — | 未完成 | 苏东坡 | 审核接口在带排队/发布回执时仍能改审核结论（A 级，另一窗口已在修）—— `campaign-daily-plan/post-review/route.ts` | [归档 L1391](./archive/ROADMAP-2026-10-24-before-realign.md#L1391) [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413) |
| R312 | — | 未完成 | 苏东坡 | 只读核查生产上是否已有「回执被藏起来」的旧行 —— #1687 之前查计划出错会新插一行。查同一 client + campaign 下 | [归档 L1394](./archive/ROADMAP-2026-10-24-before-realign.md#L1394) [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413) |
| R313 | — | 未完成 | 苏东坡 | 计划版本链（产品限制的长期解） —— 现在一个活动发过/排过一轮后，下一轮内容或改文案只能新建活动。 | [归档 L1396](./archive/ROADMAP-2026-10-24-before-realign.md#L1396) [#1413](https://github.com/bigbigraydeng-maker/magic-engine/issues/1413) |

### 线索与受治理客服 · Connector（2）

挂在既有 Connector 上，不升成第七支柱。构建控制见 [CRM 构建控制](./roadmap/2026-09-15-crm-ai-agent-build-control.md)。WhatsApp 智能客服仍按 2026-09-15 的冻结：等真有两家客户要用再抽公共适配。NAL 专属项已挪到暂停区。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R007 | P0 | 待做 | 客服构建控制 | Magic Lab Class / NAL 两客户主页令牌缺 pages_read_engagement：补齐权限或正式标停用 | [归档 L45](./archive/ROADMAP-2026-10-24-before-realign.md#L45) |
| R014 | P0 | 待做 | 客服构建控制 | Meta AI 客服自动回复被当成「已联系」挤掉新线索：用 conversation_outbound_log 反查真人出站（修法 1），并收回 lead-followup-due/digest 两处权宜之计 | [归档 L113](./archive/ROADMAP-2026-10-24-before-realign.md#L113) |

### 共享底盘 · Kernel / 调度 / 待办（3）

定时任务已收成 3 个入口（PR #3071，`src/lib/cron/dispatch/catalog.ts`）。验收记在 [台账](./ledger/2026-10-24-render-cron-dispatcher.md)，核对日 2026-10-31。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R162 | P0 | 未完成 | 鲁班 / 子牙 | 🔴 [P0] `price_claim_unbacked` 落地页读写错了表（`src/lib/pm-todo/manual-items.ts` `pushPriceGateItems`）：这条待办检查的是 `visual_assets` 表按 `post_id` 关联的配图，但 href 指向的 … | [归档 L995](./archive/ROADMAP-2026-10-24-before-realign.md#L995) |
| R163 | P0 | 未完成 | 鲁班 / 子牙 | 🔴 [P0] `factory_worker_idle` 落地页无法远程启动 worker（`src/lib/pm-todo/manual-items.ts` `pushFactoryWorkerItems` + `/dashboard/factory`）：待办的 how 要求「在那台 Mac 上跑… | [归档 L996](./archive/ROADMAP-2026-10-24-before-realign.md#L996) |
| R027 | P1 | 待做 | 鲁班 / 子牙 | Meta/TikTok/商家页/Google Ads/GTM 授权没有心跳：调用成功后盖 last_synced_at 或定义新鲜度探针 | [归档 L191](./archive/ROADMAP-2026-10-24-before-realign.md#L191) |

### 运行计划 · 尚未到点（2）

自治计划原文：广告跑稳两周之后才开。现在不要提前做。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R004 | P2 | 待广告跑稳两周且 B2 后再开 | 板桥 | B4 板桥待办人话闸：今日待办条目先过板桥改人话 | [归档 L33](./archive/ROADMAP-2026-10-24-before-realign.md#L33) |
| R005 | —（待打分） | 未开工 | 孔子 | B5 孔子 SEO 笼子：给 SEO 改文案划「不问就能做」范围 | [归档 L34](./archive/ROADMAP-2026-10-24-before-realign.md#L34) |

---

## 其余未完成（290）

仍开着，但不是这轮最小闭环的第一批。状态和优先级沿用原文。

### 广告 · 卫青（57）

执行层补全、首投前清单和其他未打成 P0/P1 的广告欠账。不新开一轮大设计。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R081 | P2 | 未完成 | 卫青 | 广告决策原因留痕（P2）：2026-09-16 CTS 顾问窗口交互式调整预算/定向后，把"为什么"临时塞进 `ad_entity_snapshots.targeting_summary` 的 note 键——用错了字段（该表是机器设置快照，非人工决策日志）。设计判断见 2026-09-16-ad-… | [归档 L379](./archive/ROADMAP-2026-10-24-before-realign.md#L379) [2026-09-16-ad-decision-log…](./specs/2026-09-16-ad-decision-log-review.md) |
| R033 | P3 | 待 PM 操作 | 卫青 | CTS 每日广告日报定时任务：在 App 里把权限模式锁成「全自动执行」 | [归档 L252](./archive/ROADMAP-2026-10-24-before-realign.md#L252) |
| R035 | P3 | 待认领 | 卫青 | Meta Ads AI 换人接手已连接授权永久卡死：revoke() 改为无依赖时 DELETE，或改触发器/专用 RPC | [归档 L277](./archive/ROADMAP-2026-10-24-before-realign.md#L277) |
| R070 | — | 未完成 | 卫青 | 合并上线后正式站验证（登录后台页）：`/dashboard/ad-engine`「汇总数字有没有在骗人」出数据；客户设置页「广告结果怎么算」面板能存。 | [归档 L368](./archive/ROADMAP-2026-10-24-before-realign.md#L368) |
| R071 | — | 未完成 | 卫青 | FDE 给在投客户配结果阶梯（NAL / CTS / Oztop）：没配之前「花钱没结果」「钱和结果错配」会一直判不了，内部日报会提醒。 | [归档 L369](./archive/ROADMAP-2026-10-24-before-realign.md#L369) |
| R072 | — | 未完成 | 卫青 | 客户真实情况待确认（P0-4 剩余，Roman HU / 30 Kiteroa 已了结见 CHANGELOG 2026-09-20）：Oztop 8/19 起零花费是有意停投还是付款/审核问题——2026-09-20 实查每日回流仍报 Oztop 的 Meta 账户读不到（`getAdAccount… | [归档 L370](./archive/ROADMAP-2026-10-24-before-realign.md#L370) |
| R073 | — | 未完成 | 卫青 | 老接口鉴权：`/api/clients/[id]/ad-strategy-config` PATCH 已改成只许内部员工（`8e4d2210`）；`domain` 绑定接口同类问题未查。 | [归档 L371](./archive/ROADMAP-2026-10-24-before-realign.md#L371) |
| R074 | — | 未完成 | 卫青 | 主页改绑补全：查「这个主页是否已绑给别的客户」+ 写 `client_binding_audit`（复用 #1649 引入的审计表，#1649 合并后做）。 | [归档 L372](./archive/ROADMAP-2026-10-24-before-realign.md#L372) |
| R075 | — | 未完成 | 卫青 | 共用账户根治（G15 / M9）：落广告系列级归属表；之前共用账户只做账户级诊断；老的系列级/广告级日数据同步仍会把共用账户写进两个客户名下。2026-09-22 补充：新增的 D9 诊断（纯播放广告漏排除 Audience Network，PR #1874）同样受这条限制——共用账户（CTS 跟 … | [归档 L373](./archive/ROADMAP-2026-10-24-before-realign.md#L373) |
| R076 | — | 未完成 | 卫青 | 行业词表加 `logistics`（物流剧本目前选不中），`E-commerce …` 自由文本行业值归一。 | [归档 L374](./archive/ROADMAP-2026-10-24-before-realign.md#L374) |
| R077 | — | 未完成 | 卫青 | L3 Meta Connector 收口：Graph 版本统一（v19/v20/v21 混用）；`src/lib/meta/client.ts` 已超 800 行需拆文件；快照取令牌（`getMetaTokenForClient`）与每日同步 cron 的令牌口径统一。 | [归档 L375](./archive/ROADMAP-2026-10-24-before-realign.md#L375) |
| R078 | — | 未完成 | 卫青 | 内部日报先影子跑几天、人工核对：回放验收造不出「开着但不花钱」「白天被暂停」两种情况，不能证明生产不误报。 | [归档 L376](./archive/ROADMAP-2026-10-24-before-realign.md#L376) |
| R079 | — | 未完成 | 卫青 | 诊断后续：D7 补令牌有效期、主页令牌权限、像素触发、自动化身份任务四项体检；诊断结果从体检记录迁到诊断自己的表；D2（按角色的疲劳模型，学习期排除）、D6（行业先验，需 ≥2 客户证据）；Meta 实验排除扩展到止损与素材同步（§14 M7，写路径，阶段 2 收口）；诊断事件链接 Inngest（… | [归档 L377](./archive/ROADMAP-2026-10-24-before-realign.md#L377) |
| R080 | — | 未完成 | 卫青 | 阶段 2（内核 + 执行）/ 阶段 3（客户版 + 剧本 + 调优）：按设计 §4.1 硬前置与 §14 K1–K14、C1–C9 推进。 | [归档 L378](./archive/ROADMAP-2026-10-24-before-realign.md#L378) |
| R083 | — | 未完成 | 卫青 | [待做清单] `src/lib/meta/targeting-mutations.ts`（路径经 Codex 复审纠正，原写 `meta-ads/` 是错的）：把上表五种操作从一次性脚本搬成有类型约束的模块函数，其中四个改 adset targeting 的函数签名带 `adAccountId`/`adsetId… | [归档 L420](./archive/ROADMAP-2026-10-24-before-realign.md#L420) |
| R084 | — | 未完成 | 卫青 | [待做清单] 执行前对目标账户跑 `findSharedAdAccounts` 核对，命中共用账户一律 fail-closed（⚠️ Codex P1 复审结论）：`campaign-ownership.ts:14-18` 的归属校验明确说明只能挡「`campaign_id`/`ad_account_id` 完全… | [归档 L421](./archive/ROADMAP-2026-10-24-before-realign.md#L421) |
| R086 | — | 未完成 | 卫青 | [待做清单] Inngest function `ads/act-executor`：监听 `ads/prescription.ready` 事件；解析处方里的 `executable_actions` 字段；每个动作单独 `step.run()` 经 Kernel gateway/action bridge 注… | [归档 L423](./archive/ROADMAP-2026-10-24-before-realign.md#L423) |
| R087 | — | 未完成 | 卫青 | [待做清单] PM 审批门：执行前发「审批卡」（Portal 通知 或 Telegram bot）；批准后由 Kernel 写入 append-only `authorization_decisions` 记录（含真实 PM 身份与时间戳），Inngest 拿到该 Kernel 授权记录才能触发执行——没有 Ke… | [归档 L424](./archive/ROADMAP-2026-10-24-before-realign.md#L424) |
| R088 | — | 未完成 | 卫青 | [待做清单] 执行结果写 Kernel action/outcome 记录，不写 `client_decision_history`（⚠️ Codex P2 复审结论）：`client_decision_history` 是单写者表，只有诸葛亮 conductor 在选择动作时写入（`docs/agents/CO… | [归档 L425](./archive/ROADMAP-2026-10-24-before-realign.md#L425) |
| R089 | — | 未完成 | 卫青 | [待做清单] 执行后自动建 Google Calendar 事件：`review_at` 字段驱动，标题写人话动作（如「查 NAL 排除受众网络版位效果」），描述写「查什么 / 怎么算成 / 不成怎么办」。 | [归档 L426](./archive/ROADMAP-2026-10-24-before-realign.md#L426) |
| R090 | — | 未完成 | 卫青 | [待做清单] `ad_health_narratives` 新增 `executable_actions` 字段：结构化表达哪些处方是机器可执行的（带动作类型、adset_id、参数）——目前处方是自然语言，Act 层需要机器可读的格式。 | [归档 L427](./archive/ROADMAP-2026-10-24-before-realign.md#L427) |
| R091 | — | 未完成 | 卫青 | [待做清单] Codex 代码审核（开工前必做）：子牙审架构、魏征挑刺。特别检查：① 令牌泄露风险（`META_SYSTEM_USER_TOKEN` 不得进日志）；② 共用账户隔离——不只是「不同客户的 ad_account_id 不许混用」这种字面校验，必须实测「命中 `findSharedAdAccounts… | [归档 L428](./archive/ROADMAP-2026-10-24-before-realign.md#L428) |
| R092 | — | 已作废 | 卫青 | [待做清单] outcome 回填机制复用现有 `flywheel_metrics` evaluator，不能让 `ads/outcome-checker` 自己另插一次 `flywheel_outcomes`（⚠️ Codex P1 复审结论，2026-09-16 三轮修正）：`memory-extractor… | [归档 L429](./archive/ROADMAP-2026-10-24-before-realign.md#L429) |
| R093 | — | 未完成 | 卫青 | [待做清单] `flywheel_actions` 的 `action_run_id` 关联写入必须幂等（⚠️ Codex P2 复审结论）：`flywheel_actions.action_run_id` 目前只有普通索引，没有唯一约束（`supabase/migrations/（长编号见归档）_m… | [归档 L430](./archive/ROADMAP-2026-10-24-before-realign.md#L430) |
| R170 | — | 未完成 | 卫青 | [广告引擎中心 — 已上线部分的收尾（2026-08-05）] P21.J.M4 起草那一步现在只有 API，没有任何调用方 —— 得有个地方（AI 或 UI）真的产出一份草案，否则整条链路空转。优先接 Roman：留资表单 + 视频养受众各一条 | [归档 L1031](./archive/ROADMAP-2026-10-24-before-realign.md#L1031) |
| R171 | — | 未完成 | 卫青 | [广告引擎中心 — 已上线部分的收尾（2026-08-05）] P21.J.M5 素材上传还没接：`imageHash` / `videoId` 要人先传到 Meta 才有。要么接 `ads_creative_upload_*`，要么从 ME 已有的成片直传 | [归档 L1032](./archive/ROADMAP-2026-10-24-before-realign.md#L1032) |
| R172 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-CUR-1 广告花费表都没有币种列 —— 跨客户金额全是混币种加总【影响面最大，且是三张表】：2026-08-14 实读账户 `currency`：Oztop `（长编号见归档）` = AUD，CTS / Roman / 混账户 = NZD；… | [归档 L1039](./archive/ROADMAP-2026-10-24-before-realign.md#L1039) |
| R173 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] 🔴 AD-ORPH-1 被闸门拦下和被人否决的草案，Meta 那边的实体没人收 —— 既不删也不下发人工任务（第四十三轮发现，`AD-GATE-1` 的同一段生命周期）：`publishDraftPaused` 成功后 campaign / ad … | [归档 L1050](./archive/ROADMAP-2026-10-24-before-realign.md#L1050) |
| R174 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] 🔴 AD-QUEUE-1 审批页按"最近 50 条"截断后才在内存里筛待办 —— 早的待批草案会从唯一入口永久消失（第四十三轮发现，首投前置）：`ad-approval/page.tsx:34-44` 的查询不带任何状态条件，只 `.order('… | [归档 L1060](./archive/ROADMAP-2026-10-24-before-realign.md#L1060) |
| R175 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] 🔴 AD-ATTR-1 归因取数不按来源过滤 —— Meta 和 Google Ads 共用同一批 `ads.account.*` key【隐患已武装，Oztop 两边都配了】（第四十二轮发现，`AD-CUR-1` 的前置）： | [归档 L1064](./archive/ROADMAP-2026-10-24-before-realign.md#L1064) |
| R176 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-PLAY-1 两个建广告调用点没传 `play` / `playSource`，打法账本恒为 NULL：`boost-post/route.ts:122` 与 `winner-reel-sync/engine.ts:214` 都调了 `lin… | [归档 L1070](./archive/ROADMAP-2026-10-24-before-realign.md#L1070) |
| R177 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-CUR-2 写预算的入口都写死 AUD、却不读账户币种 —— 两个入口，其中一个已上线在用：Meta 一律按账户币种解释传进去的数字，而 CTS/Roman 账户是 NZD（已实读）。 | [归档 L1075](./archive/ROADMAP-2026-10-24-before-realign.md#L1075) |
| R178 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-GATE-1 `approveDraft` 激活前不重新回读：只查 `payload.status` 就 `activatePublished`，不重跑 `fetchAdSetReadback` / `checkLaunch`。草案在共用账户… | [归档 L1082](./archive/ROADMAP-2026-10-24-before-realign.md#L1082) |
| R179 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] 🟠 AD-ISO-1 生产同步把整账户数据写成单个客户的 —— 同步路径允许跨客户污染，隐患已上线在跑，损害尚未证实【已上线在跑】（第二十八轮发现；标题第五十轮更正 —— 原写"正在污染"，与本条自己第 31 轮的实测结论自相矛盾）： | [归档 L1090](./archive/ROADMAP-2026-10-24-before-realign.md#L1090) |
| R180 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] 🔴 AD-PKG-1 交付物里的「广告」那一栏从上线起就是空的 —— 写和读都指向一个不存在的列，两边都不报错【已上线在跑】（第三十一轮发现）：实查 `information_schema`，`meta_ads_snapshots` 的 16 列里… | [归档 L1112](./archive/ROADMAP-2026-10-24-before-realign.md#L1112) |
| R181 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] 🔴 AD-SPEC-1 房源广告没声明「住房」特殊类别 —— 建的时候不声明、回读也不查【投第一条真广告前必修，须与 `AD-GEO-0` 一起定】（第三十八轮发现）： | [归档 L1129](./archive/ROADMAP-2026-10-24-before-realign.md#L1129) |
| R182 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] 🔴 AD-GEO-0 `targetingFor` 把国家和城市一起发出去，城市半径形同虚设 —— ME 建的广告从一开始就投整个国家【投第一条真广告前必修】（第二十七轮发现，比 `AD-GEO-1` 更根本）：`ad-publisher.ts:1… | [归档 L1135](./archive/ROADMAP-2026-10-24-before-realign.md#L1135) |
| R183 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-GEO-1 `geo_mismatch` 闸门只到国家级，抓不到它自己写明的那次事故（第二十五轮发现）： | [归档 L1144](./archive/ROADMAP-2026-10-24-before-realign.md#L1144) |
| R184 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-SEC-1 实体归属校验缺失 —— 五个入口，其中三个已上线在跑【本次审计发现的最严重一条】：混账户下（CTS/Oztop 同账户）任何"只校验 URL 里的客户、实体 id 却取自请求体"的写路径，都能被 A 客户的调用方拿去动 B 客户的… | [归档 L1151](./archive/ROADMAP-2026-10-24-before-realign.md#L1151) |
| R185 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-SEC-2 通用 `meta-ads/draft` 不校验素材归属：`...(body as AdDraft)` 整体展开，`leadFormId`/`imageHash`/`videoId` 原样来自请求体，客户没配主页时 `pageId`… | [归档 L1171](./archive/ROADMAP-2026-10-24-before-realign.md#L1171) |
| R186 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-FACT-1 事实来源从不校验，却盖"官网可溯"章：`assertFacts` 只查 `sourceUrl` 非空，从不抓页面核对价格/地址/战绩，而 `traceClaims` 把原样传入的字段标成"官网可溯"。第一条付费广告就会带着未核实… | [归档 L1173](./archive/ROADMAP-2026-10-24-before-realign.md#L1173) |
| R187 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-OBS-1 创意变体数不可观测：`ad_daily_insights` 的 ad 级行无 `creative_id` / `asset_feed_spec`，`ad-level-breakdown.ts` 也只到 ad 级 —— "我们到底投… | [归档 L1187](./archive/ROADMAP-2026-10-24-before-realign.md#L1187) |
| R188 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-OBS-2 攒池测试无法按 hook 归因：`client_audience_assets` 按 `audience_id` 唯一、无创意维度，而 `videoEventRule` 把一批 videoId 灌进同一个池 → `P18.E.3`… | [归档 L1188](./archive/ROADMAP-2026-10-24-before-realign.md#L1188) |
| R189 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] 🔴 AD-LOG-1 `record()` 漏读 `error`,而且失败时会留下失联的暂停实体【投第一条真广告前必修 —— 第四十五轮补入首投前置】（第二十七轮升级,原写"小 bug 顺手修",低估了）：`const { data } = awa… | [归档 L1189](./archive/ROADMAP-2026-10-24-before-realign.md#L1189) |
| R190 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-ADV-1 `ad-publisher.ts:116` 写死 `advantage_audience: 0`：无差别关掉 Advantage+ 受众，是 ME 代码唯一与 Andromeda 打法正面冲突处。现有两种 `DraftKind`（… | [归档 L1193](./archive/ROADMAP-2026-10-24-before-realign.md#L1193) |
| R191 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-DRAFT-1 `listing-draft-builder` 硬写单条创意：`creatives: [creative]`（`:193`/`:254`），而 `AdDraft.creatives` 是数组、publisher 已在循环建。同… | [归档 L1194](./archive/ROADMAP-2026-10-24-before-realign.md#L1194) |
| R192 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-FORM-1 选表单时不看语言，英文广告可能把买家送进中文表单【首条真钱广告的前置】：`draft-listing/route.ts:82-105` 的 `pickForm(forms, wanted?)` 不接语言参数，且该主页只有一个可用… | [归档 L1195](./archive/ROADMAP-2026-10-24-before-realign.md#L1195) |
| R193 | — | 待 PM 决定 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-EXPL-1 多角度测试要设"每臂最低探索量"，否则学不到东西【决定「找出赢家」这个卖点成不成立】：把 5–8 个角度塞进同一个 ad set 让 Meta 分配，拿到的是投放优化，不是可比较的角度实验 —— Oztop 那 14 条 hoo… | [归档 L1197](./archive/ROADMAP-2026-10-24-before-realign.md#L1197) |
| R194 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-EVID-1 补读 Oztop + Roman 两个账户的 targeting【审计结论覆盖率的前置】：本次审计的 broad/Advantage+ 结论只覆盖 3 家客户里的 1 家（CTS）、17 条 campaign 里的 6 条（⚠️… | [归档 L1198](./archive/ROADMAP-2026-10-24-before-realign.md#L1198) |
| R195 | — | 未完成 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-FRAG-1 每条帖子一个 campaign + 一个 ad set，学习数据被打散：CTS 账户 26 个 ad set 里 14 个是 `帖子："…"` 型 boost，单条 $2–$37。这不是"按兴趣拆人群"那种碎片化，但后果一样 —… | [归档 L1202](./archive/ROADMAP-2026-10-24-before-realign.md#L1202) |
| R196 | — | 待 PM 决定 | 卫青 | [2026-08-14 Meta 方向审计（[docs/aud] AD-LINK-1 `creative_ref` 的身份粒度要按 variant 不按素材：5–8 个角度常共用同一张图，按素材 id 记会让所有角度写同一个 `creative_ref`，角度归因归零。需 variant 稳定 id + 素材关系… | [归档 L1207](./archive/ROADMAP-2026-10-24-before-realign.md#L1207) |
| R385 | — | 未完成 | 卫青 | P18.E.1 语法验证 — 视频源规则（`video_view_15s` / `video_view_50_percent`）需用 Render 上的 `META_SYSTEM_USER_TOKEN` 实调验证；MCP 工具面建不了（错误 2654）但平台 UI 支持 + CTS 生产在用 | [归档 L1673](./archive/ROADMAP-2026-10-24-before-realign.md#L1673) |
| R387 | — | 未完成 | 卫青 | P18.E.3 采集 — 池 size 快照 → `flywheel_metrics` 的 `ads.audience.*`；台账画净增 = 新进 − 到期掉出（受众是衰减存量，不能只画总量）。新 cron 必须 link `me-shared-cron-secret`。依赖 P18.E.2 | [归档 L1675](./archive/ROADMAP-2026-10-24-before-realign.md#L1675) |
| R388 | — | 未完成 | 卫青 | P18.E.4 画像 — 现有 `google-data-pullback-daily` 加 `breakdowns=age,gender`（不新起 cron） | [归档 L1676](./archive/ROADMAP-2026-10-24-before-realign.md#L1676) |
| R389 | — | 待 PM 决定 | 卫青 | P18.E.5 归属交付 — 归属条款 + 隐私告知（IPP 3/6/7/9/12 跨境披露）+ 同意文书 → 必须在任何受众共享动作之前完成。待 PM 定条款 | [归档 L1677](./archive/ROADMAP-2026-10-24-before-realign.md#L1677) |
| R390 | — | 未完成 | 卫青 | P18.E.6 月报 — 《你的买家库月报》客户面渲染（客户永不见 `L0/L1` 代号）。依赖 P18.E.3 | [归档 L1678](./archive/ROADMAP-2026-10-24-before-realign.md#L1678) |
| R391 | — | 待 PM 决定 | 卫青 | 待 PM：Roman vendor deck「500+ Chinese buyer database」口径 · 海外买家资格口径（OIA 2018）· 开发商合同数据条款 | [归档 L1679](./archive/ROADMAP-2026-10-24-before-realign.md#L1679) |

### AI 可见度 · 孟子（3）

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R456 | P3 | 未完成 | 孟子 | [P3] `ai_visibility_runs` 插入本身失败时，这行数据完全不落库，检测不到。 | [归档 L1868](./archive/ROADMAP-2026-10-24-before-realign.md#L1868) [#1943](https://github.com/bigbigraydeng-maker/magic-engine/pull/1943) |
| R457 | P3 | 未完成 | 孟子 | [P3] `ai_visibility_runs` 插入成功但更新失败时，那一行会被误读成「成功」。 | [归档 L1874](./archive/ROADMAP-2026-10-24-before-realign.md#L1874) [#1943](https://github.com/bigbigraydeng-maker/magic-engine/pull/1943) |
| R458 | P3 | 未完成 | 孟子 | [P3] 待办查询可能撞上「这周的批次还没跑完」，误报一次全挂。 | [归档 L1881](./archive/ROADMAP-2026-10-24-before-realign.md#L1881) [#1943](https://github.com/bigbigraydeng-maker/magic-engine/pull/1943) |

### SEO · 孔子（16）

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R399 | P2 | 未完成 | 孔子 | [P2] 22.E.S16 每周 Blog 链路没接自动化管理系统（Inngest）（`src/lib/blog/weekly-blog.ts` + `src/lib/cms/blog-publisher.ts`，2026-09-09 CTS 会话审计发现）：这条链路（选题→写文章→查一遍→变成等 … | [归档 L1704](./archive/ROADMAP-2026-10-24-before-realign.md#L1704) |
| R037 | — | 未完成 | 孔子 | 重新打开 CTS 的开关：先用 `POST /api/cron/seo-meta-cycle-trigger` 带 `{"dry_run": true, "client_id": "<CTS>"}` 跑一次演练，把「这一轮会改哪些页、改成什么字、依据的搜索量/难度/前 3 标题」给 PM 看；PM … | [归档 L294](./archive/ROADMAP-2026-10-24-before-realign.md#L294) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R038 | — | 未完成 | 孔子 | 1. AI 生成标题那步没包 try —— 一个候选失败会让整个第 4 步重跑，应只跳过这一个 | [归档 L297](./archive/ROADMAP-2026-10-24-before-realign.md#L297) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R039 | — | 未完成 | 孔子 | 2. 重试时发现这条改动的 PR 已开过且已合并，代码什么也不做 —— 应补写 `seo_meta_log` 基线记录，不能让改动凭空消失 | [归档 L298](./archive/ROADMAP-2026-10-24-before-realign.md#L298) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R040 | — | 未完成 | 孔子 | 3. 查对手标题的 DataForSEO 调用被重试会重复付费 —— 缓存，或拆成独立步骤 | [归档 L299](./archive/ROADMAP-2026-10-24-before-realign.md#L299) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R041 | — | 未完成 | 孔子 | 4. 写 `seo_meta_log` 失败没检查错误 —— 失败要计入回执失败数，不能永远显示 0 | [归档 L300](./archive/ROADMAP-2026-10-24-before-realign.md#L300) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R042 | — | 未完成 | 孔子 | 5. 第 4、5 步回执内容重复，考虑合并 | [归档 L301](./archive/ROADMAP-2026-10-24-before-realign.md#L301) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R043 | — | 未完成 | 孔子 | 6. 现在先标「已回查」再写待办，写待办失败则回归没人知道 —— 顺序反过来 | [归档 L304](./archive/ROADMAP-2026-10-24-before-realign.md#L304) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R044 | — | 未完成 | 孔子 | 7. 老记录 `pr_url` 为空时，待办仍写「点开这个 PR 链接」—— 改指向页面改动历史，或明说没有 PR 链接 | [归档 L305](./archive/ROADMAP-2026-10-24-before-realign.md#L305) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R045 | — | 未完成 | 孔子 | 8. 判回归前先确认谷歌数据是改动之后才更新的，避免拿旧数据误判「没变化」 | [归档 L306](./archive/ROADMAP-2026-10-24-before-realign.md#L306) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R046 | — | 未完成 | 孔子 | 9. 取待回查记录时排除没有基线曝光数据的历史补录，免得占每周名额 | [归档 L307](./archive/ROADMAP-2026-10-24-before-realign.md#L307) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R047 | — | 未完成 | 孔子 | 10. 「有没有效果」的样本门槛（现 30 次曝光）按实际噪音再评估 | [归档 L308](./archive/ROADMAP-2026-10-24-before-realign.md#L308) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R048 | — | 未完成 | 孔子 | 11. 删掉已无人调用的 `readMetaForSlug` | [归档 L311](./archive/ROADMAP-2026-10-24-before-realign.md#L311) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R049 | — | 未完成 | 孔子 | 12. `roster.ts` 精简（`toClientConfig` 重复代码；`run-one` 只读当前客户；`isoWeekKey` 重复导出） | [归档 L312](./archive/ROADMAP-2026-10-24-before-realign.md#L312) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R050 | — | 未完成 | 孔子 | 13. 手动补跑被跳过的客户时，别覆盖「最近跑过」时间戳（会误伤下周正常那次） | [归档 L313](./archive/ROADMAP-2026-10-24-before-realign.md#L313) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |
| R051 | — | 未完成 | 孔子 | 14. 设计文档里关键词来源、学习记忆几段没跟上最新代码，需同步 | [归档 L314](./archive/ROADMAP-2026-10-24-before-realign.md#L314) [#1807](https://github.com/bigbigraydeng-maker/magic-engine/issues/1807) |

### 社媒与内容 · 苏东坡 / 马良 / 李白（61）

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R052 | — | 未完成 | 苏东坡 | 需要人工操作：在 Render `crazycontent` web 服务配置 `TYPESAFE_API_KEY`（TypeSafe Jev 判断模型密钥，对外封装名 Compliance Engine），配完跑一次真实工单交付验证 `output.quality_flags` 确实产出竞品品牌/… | [归档 L319](./archive/ROADMAP-2026-10-24-before-realign.md#L319) |
| R094 | — | 未完成 | 马良 | 找 Creatomate 客服或后台账单确认超出 2,000 credits/月后的真实计费行为（硬顶拒绝还是继续扣钱）（spec §6.2） | [归档 L456](./archive/ROADMAP-2026-10-24-before-realign.md#L456) |
| R095 | — | 未完成 | 马良 | `pickRealPhoto`/`loadRankableClientAssets` 补一道质量分门槛（`client-asset-pool.ts` 的 `MIN_QUALITY=5` 口径目前真实照片路径没用上） | [归档 L457](./archive/ROADMAP-2026-10-24-before-realign.md#L457) |
| R096 | — | 未完成 | 马良 | `PreparedScene.visualSource` 接入人工分镜自检表 UI，让 FDE 逐镜看时能分清"这镜是真图" | [归档 L458](./archive/ROADMAP-2026-10-24-before-realign.md#L458) |
| R097 | — | 未完成 | 马良 | `pickRealPhoto` 内部调用 `rankAssetsByPrompt` 的 `gpt-4o-mini` 排序成本（分钱级）没有计入 `content_factory_render_jobs.cost_usd` | [归档 L459](./archive/ROADMAP-2026-10-24-before-realign.md#L459) |
| R098 | — | 未完成 | 马良 | Still-5/Still-6 的 `caption`（大字标题）Creatomate 元素名还没核实——本地 `.env.local` 没有 `CREATOMATE_API_KEY`，Chrome 里登录的 Creatomate 账号也找不到生产用的那个模板，需要能进生产 Creatomate 账… | [归档 L461](./archive/ROADMAP-2026-10-24-before-realign.md#L461) |
| R099 | — | 待 PM 决定 | 马良 | PR #1655 待 PM 拍板合并：`rankAssetsByPrompt` 加"没把握就别选"的置信度门（`requireConfidentMatch`），修复"素材库有对的照片，排序器却选了完全文不对题的图，还写了个听着很确定的理由"这个问题（2026-09-14 用真实脚本诊断发现）。已过 … | [归档 L462](./archive/ROADMAP-2026-10-24-before-realign.md#L462) [#1655](https://github.com/bigbigraydeng-maker/magic-engine/pull/1655) |
| R100 | — | 待 PM 决定 | 马良 | PM 拍板"AI 配音统一用 ElevenLabs"，账号免费版无法通过 API 调用任何声音——PM 2026-09-13 拍板暂不升级付费，先维持现状；CTS 出片全程仍未真正测过配音这一步 | [归档 L464](./archive/ROADMAP-2026-10-24-before-realign.md#L464) |
| R101 | — | 未完成 | 马良 | "多开发不同模板"：PM 不想招人代画，已验证 Creatomate 模板编辑页的 Code 视图（`{}` 图标）能直接读出完整模板 JSON 源码，理论上也能反向粘贴编辑保存，但只验证了"读"，没验证"改并保存"这一步 | [归档 L465](./archive/ROADMAP-2026-10-24-before-realign.md#L465) |
| R102 | — | 未完成 | 马良 | 上面这次发现：CTS 现在有两套"这个客户在卖哪些团"的真实事实存储——视频工厂这边（`factory_config.render.creatomate.offers`）和私信回复 Agent 那边（`config/clients/cts/offerings.yaml`，#1577）各存一份，语义高… | [归档 L472](./archive/ROADMAP-2026-10-24-before-realign.md#L472) |
| R103 | — | 未完成 | 马良 | 真实照片排序（`rankAssetsByPrompt`）疑似没有匹配度门槛，会把明显文不对题的照片当"匹配成功"返回（如故宫文案配上长城照片、兵马俑文案配上梯田照片，`reason` 字段自己写的解释都文不对题）——2026-09-13 诊断发现，已建独立任务调查范围和优先级，不在这批改动里处理 | [归档 L473](./archive/ROADMAP-2026-10-24-before-realign.md#L473) |
| R105 | — | 未完成 | 马良 | CTS 三个优先团（11月 Golden China / 12月圣诞团奥克兰版/基督城版）实拍两轮真实渲染，均未过分镜自检，未发布（2026-09-16）。用刚上线的"资料包管理界面"核对时发现并直接在生产环境修正了 3 处真实错误（golden-china/xmas-nye-akl/xmas-ny… | [归档 L475](./archive/ROADMAP-2026-10-24-before-realign.md#L475) |
| R321 | — | 未完成 | 苏东坡 | M2.7c 三段式重排 —— 现在是 3 层 + 6 组 + 底栏 + 终端/同行开关 ≈ 10 个概念， | [归档 L1433](./archive/ROADMAP-2026-10-24-before-realign.md#L1433) |
| R322 | — | 未完成 | 苏东坡 | M2.7 收尾：等 PM 拍的一件事 —— 「说好周五给报价，这几天他还该不该出现在 | [归档 L1441](./archive/ROADMAP-2026-10-24-before-realign.md#L1441) |
| R323 | — | 未完成 | 苏东坡 | M2.7 已知后续项：重试时那句确认会降级 —— 第一次请求写入成功、但响应在 | [归档 L1445](./archive/ROADMAP-2026-10-24-before-realign.md#L1445) |
| R324 | — | 未完成 | 苏东坡 | M2.7h 「暂时 / 最终」的判断交给解析器，正则只留兜底 —— 上面那条做完之后， | [归档 L1460](./archive/ROADMAP-2026-10-24-before-realign.md#L1460) |
| R325 | — | 未完成 | 苏东坡 | M2.7j 给「正向意向」一个专门的信号 —— 现在「他现在想订了」只能落成兜底的 | [归档 L1481](./archive/ROADMAP-2026-10-24-before-realign.md#L1481) |
| R326 | — | 未完成 | 苏东坡 | M2.7k 抽屉里刚标完坏号要即时刷新 —— 现在那个 `tel:` 链接要等抽屉关掉才消失。 | [归档 L1485](./archive/ROADMAP-2026-10-24-before-realign.md#L1485) |
| R327 | — | 未完成 | 苏东坡 | M2.3 用 `crm_segment_feedback` 改判据 —— 表建好了，还没有人去看它。 | [归档 L1495](./archive/ROADMAP-2026-10-24-before-realign.md#L1495) |
| R328 | — | 未完成 | 苏东坡 | M2.5 新人邮件（PM 规则 1，本次明确没做） —— 客人第一次进来当天自动发一封。 | [归档 L1500](./archive/ROADMAP-2026-10-24-before-realign.md#L1500) |
| R329 | — | 未完成 | 苏东坡 | M2.6 确认 Meta 自动化消息的真实 tag —— `lib/messenger/automation` 里 | [归档 L1504](./archive/ROADMAP-2026-10-24-before-realign.md#L1504) |
| R330 | — | 未完成 | 苏东坡 | M5 WhatsApp Business API（新号） —— 申请清单已给 PM（`docs/sops/whatsapp-business-api-申请清单.md`）。⚠️ AU/NZ 单价未核实（这台开发机连不上 Meta 站点），拿到后台截图后补 | [归档 L1510](./archive/ROADMAP-2026-10-24-before-realign.md#L1510) |
| R331 | — | 未完成 | 苏东坡 | M6 客户员工账号 + 角色 + 归属 + 转派 + 推手机 —— PM：「ME 的登陆系统需要给到 client 的员工层级」。`conversations` 已有 `owner_email` / `snooze_until` 两列待用，不需要 migration | [归档 L1511](./archive/ROADMAP-2026-10-24-before-realign.md#L1511) |
| R332 | — | 未完成 | 苏东坡 | M7 「谁来回」开关 + Meta AI 客服配置（AI 先答 / 人工先答 / 分时段） | [归档 L1512](./archive/ROADMAP-2026-10-24-before-realign.md#L1512) |
| R333 | — | 未完成 | 苏东坡 | M8 IP 电话外呼 + 通话记录回流（与 Phase 36 Voice Agent 合流）🔄 判断层已上线 | [归档 L1513](./archive/ROADMAP-2026-10-24-before-realign.md#L1513) |
| R334 | — | 未完成 | 苏东坡 | M8.2 落地库 —— 单独开一个 Postgres，绝不能是主库。方向反了： | [归档 L1520](./archive/ROADMAP-2026-10-24-before-realign.md#L1520) |
| R335 | — | 未完成 | 苏东坡 | M8.3 取数层 `lib/threecx/landing.ts` —— 按水位线读新行 → 翻译成 | [归档 L1526](./archive/ROADMAP-2026-10-24-before-realign.md#L1526) |
| R336 | — | 未完成 | 苏东坡 | M8.4 落库层 —— 复用 `resolveContact`（电话身份）+ `contact_touchpoints` | [归档 L1529](./archive/ROADMAP-2026-10-24-before-realign.md#L1529) |
| R337 | — | 未完成 | 苏东坡 | M8.5 `/api/cron/call-sync` 每 15 分钟 + 同一个 PR 内加 `render.yaml` 调度条目 | [归档 L1531](./archive/ROADMAP-2026-10-24-before-realign.md#L1531) |
| R338 | — | 待 PM 决定 | 苏东坡 | M8.6 ⏳ 录音要不要留档 —— PM 拍板，有到期日 推过来的是下载链接， | [归档 L1532](./archive/ROADMAP-2026-10-24-before-realign.md#L1532) |
| R339 | — | 未完成 | 苏东坡 | M9 短信 · M10 从 ME 发 newsletter（优先级靠后，PM 明确） | [归档 L1538](./archive/ROADMAP-2026-10-24-before-realign.md#L1538) |
| R340 | — | 未完成 | 苏东坡 | 设置页那个 ✅「私信正在同步」是写死的，没连也显示绿勾 —— 会骗人，要改成真状态 | [归档 L1541](./archive/ROADMAP-2026-10-24-before-realign.md#L1541) |
| R341 | — | 未完成 | 苏东坡 | `mailchimp-activity-sync` 没有 run-logging，断了看不出来 | [归档 L1542](./archive/ROADMAP-2026-10-24-before-realign.md#L1542) |
| R342 | — | 未完成 | 苏东坡 | segments / display-name 里有 3 处写死的旅游业措辞，接第二个行业前要抽出来 | [归档 L1543](./archive/ROADMAP-2026-10-24-before-realign.md#L1543) |
| R343 | — | 未完成 | 苏东坡 | #1019 换掉「他是不是要求别再联系」的判据 —— 怎么判 | [归档 L1548](./archive/ROADMAP-2026-10-24-before-realign.md#L1548) [#1019](https://github.com/bigbigraydeng-maker/magic-engine/issues/1019) |
| R344 | — | 未完成 | 苏东坡 | #1025 🔴 Facebook 私信正文根本进不了这个判据 —— 喂什么进去。 | [归档 L1549](./archive/ROADMAP-2026-10-24-before-realign.md#L1549) [#1025](https://github.com/bigbigraydeng-maker/magic-engine/issues/1025) |
| R345 | — | 未完成 | 苏东坡 | #1026 中文「别再联系我」这类写法漏判 | [归档 L1557](./archive/ROADMAP-2026-10-24-before-realign.md#L1557) [#1026](https://github.com/bigbigraydeng-maker/magic-engine/issues/1026) |
| R346 | — | 未完成 | 苏东坡 | #1027 「别打电话，只发邮件」记不住 —— 需要按渠道的信号。 | [归档 L1558](./archive/ROADMAP-2026-10-24-before-realign.md#L1558) [#1027](https://github.com/bigbigraydeng-maker/magic-engine/issues/1027) |
| R347 | — | 未完成 | 苏东坡 | 存量回填是逐个联系人串行查询，量级上去要改批量 | [归档 L1565](./archive/ROADMAP-2026-10-24-before-realign.md#L1565) |
| R348 | — | 未完成 | 苏东坡 | 给「试过、补不上」的人打标 —— 现在每轮都重扫这批人，看着在跑其实原地踏步 | [归档 L1566](./archive/ROADMAP-2026-10-24-before-realign.md#L1566) |
| R349 | — | 未完成 | 苏东坡 | 解绑了 Facebook 主页的客户跑不到本地回填（凭证闸之前那一步只覆盖已绑的） | [归档 L1567](./archive/ROADMAP-2026-10-24-before-realign.md#L1567) |
| R350 | — | 未完成 | 苏东坡 | 只留电话没留邮箱时按电话认人 —— 现在会多出一条重复联系人。 | [归档 L1568](./archive/ROADMAP-2026-10-24-before-realign.md#L1568) |
| R363 | — | 待 PM 决定 | 苏东坡 | P21.J.M1 地基(≈1 周):migration 7 表 + `clients.brand_redline_phrases` + claim RPC + `content-factory` bucket(一次 PM 拍板 apply,worker 严禁自行 apply);`POST /api/… | [归档 L1613](./archive/ROADMAP-2026-10-24-before-realign.md#L1613) |
| R364 | — | 未完成 | 苏东坡 | P21.J.M2 生产线(≈1.5-2 周):本地 worker(claim/heartbeat/complete/fail)+ Video Studio + Edit Engine 接入;独立审核 base `ME Factory Ops`(Factory Review + Winner Inta… | [归档 L1614](./archive/ROADMAP-2026-10-24-before-realign.md#L1614) |
| R365 | — | 未完成 | 苏东坡 | P21.J.M3 闭环(≈1-2 周):发布($50 绝对硬顶 + publish_intent 幂等 + publish_failed 收敛)+ UTM 沿用 + 表现回流单链路 + winner 判定拆片入库 + 工厂内部自发疲劳信号。验收:真实成片上 CTS Meta 账户(PM 显式 go … | [归档 L1615](./archive/ROADMAP-2026-10-24-before-realign.md#L1615) |
| R366 | — | 未完成 | 苏东坡 | 开放项:信号契约与 34.A 对齐冻结(M1 前置)· asset_gap 信号归属 · MTC 计费触点(v1 占位不扣)· Airtable 观测层↔ME 真值同步(M2 起) | [归档 L1616](./archive/ROADMAP-2026-10-24-before-realign.md#L1616) |
| R367 | — | 未完成 | 苏东坡 | P21.J.SEC 接口安全完整审计:狄仁杰三审报"26 个 `/api/clients/[id]/*` 无鉴权",逐个核实后发现多数(ads 执行/cms 发布)其实已有锁、是误报,真裸奔仅 5 个已补。需一次系统性复核:grep 全部 access 守卫关键词 + 逐个确认,把"真裸奔"与"已有… | [归档 L1617](./archive/ROADMAP-2026-10-24-before-realign.md#L1617) |
| R368 | — | 未完成 | 苏东坡 | P21.J.UP 上传链接两取舍:①无单条吊销(作废靠换 `UPLOAD_LINK_SECRET`,所有链接一起失效)②无速率限制(有真链接者可刷存储/烧 Vision 额度)。规模化前需补 per-client 限流 + 单链接吊销 | [归档 L1620](./archive/ROADMAP-2026-10-24-before-realign.md#L1620) |
| R369 | — | 未完成 | 苏东坡 | 本地 worker 没在认领:今天 00:18 有 CTS 新工单卡在 `queued` 没人做 = 那台 Mac 的 worker 没跑/没连。工厂要真转,先确认 worker 进程在跑(仓库无 launchd/pm2 配置,`ps`/`pm2 list` 上机看)且已在 07-24 后重启(否则… | [归档 L1621](./archive/ROADMAP-2026-10-24-before-realign.md#L1621) |
| R370 | — | 未完成 | 苏东坡 | `FACTORY_PUBLISH_LIVE` 未设 = 静默发草稿:未配时片子 `status=published`+三落库全绿,FB 主页却只是没人看见的 DRAFT。验完草稿格式后 PM 显式在 Render 设 `=true` 才真发 | [归档 L1622](./archive/ROADMAP-2026-10-24-before-realign.md#L1622) |
| R371 | — | 未完成 | 苏东坡 | `auto_order_enabled` 无客户开启:调度器每天照跑但一单不下(安全默认)。要工厂自己下单,逐客户开;首个跑通客户 = CTS | [归档 L1623](./archive/ROADMAP-2026-10-24-before-realign.md#L1623) |
| R372 | — | 未完成 | 苏东坡 | `creative_profile` 无客户填:出片风格仍全靠本地 JSON。CTS 现有风格(龙旗破云/golden_hour/短句大字/xfade 0.35)可抄进 ME 配置页接管 | [归档 L1624](./archive/ROADMAP-2026-10-24-before-realign.md#L1624) |
| R373 | — | 未完成 | 苏东坡 | 1 条 `rendered` 旧单(CTS 07-12,有 caption)永久卡住:交付直连修复只对新单生效,这条旧单需手动迁 `in_review` 或归档(PM 判断) | [归档 L1625](./archive/ROADMAP-2026-10-24-before-realign.md#L1625) |
| R374 | — | 待 PM 决定 | 苏东坡 | P21.K.7 ad 级数据脊柱(登记 2026-07-25,PM 拍板):日度 cron 补拉 ad 级(每条广告每天一行,复用 `ad_daily_insights` 的 `level='ad'`),让「某天新增了哪条广告 / 哪条在拖后腿」可被系统自查,不依赖 Meta MCP(Oztop 账… | [归档 L1626](./archive/ROADMAP-2026-10-24-before-realign.md#L1626) |
| R375 | — | 待 PM 决定 | 苏东坡 | P21.K.8 objective 感知 + 视频疲劳正向检测(登记 2026-07-26,PM 拍板 `排`):把 P21.K 止血从「不误判视频广告」升级到「真正体检视频广告好不好」。需 ① `ad_daily_insights` 加 `objective` 列 + 采集时拉 campaign … | [归档 L1627](./archive/ROADMAP-2026-10-24-before-realign.md#L1627) |
| R376 | — | 未完成 | 苏东坡 | P21.K.9 每日分析 cron 的候选客户名单仍只看主账户(2026-09-13 子牙+魏征复审 | [归档 L1628](./archive/ROADMAP-2026-10-24-before-realign.md#L1628) |
| R377 | — | 未完成 | 苏东坡 | 多视角对抗复盘工作流(1-2 天,可后置):battle-plan §8 方法论固化成可复用 Workflow/agent(N 视角互相证伪前提 → 作战计划 → 喂鲁班),异常触发非每日跑 | [归档 L1640](./archive/ROADMAP-2026-10-24-before-realign.md#L1640) |
| R378 | — | 未完成 | 苏东坡 | 开放项:三张新表 migration 逐次 PM `go apply`(`ad_daily_insights` / `ad_strategy_configs`+`_triggers` / `ad_health_narratives`)· P5 泛化首批客户(Oztop?)· 姊妹 spec Crea… | [归档 L1641](./archive/ROADMAP-2026-10-24-before-realign.md#L1641) |
| R392 | — | 未完成 | 苏东坡 | 做片任务表防双击唯一索引 —— 动数据库，🔴 PM `go apply` | [归档 L1691](./archive/ROADMAP-2026-10-24-before-realign.md#L1691) |
| R393 | — | 未完成 | 苏东坡 | 数字人首跑实测 —— 生成要花钱，需 PM 说一声再试 | [归档 L1692](./archive/ROADMAP-2026-10-24-before-realign.md#L1692) |
| R394 | — | 未完成 | 苏东坡 | 发布端按平台带不同 CTA 接线 | [归档 L1693](./archive/ROADMAP-2026-10-24-before-realign.md#L1693) |

### 竞品 · 张骞（10）

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R137 | — | 未完成 | 张骞 | Latest-result follow-up: show newest signal per page/direction including ignore; collapse earlier records without implying they are resolved. Read-onl… | [归档 L879](./archive/ROADMAP-2026-10-24-before-realign.md#L879) |
| R138 | — | 未完成 | 张骞 | Readable UI follow-up: result-first views, collapsed configuration/evidence, Chinese future interpretations; locally verified, pending review/producti… | [归档 L881](./archive/ROADMAP-2026-10-24-before-realign.md#L881) |
| R139 | — | 未完成 | 张骞 | Verify an actual later website change through LLM classification/recommendation; do not manufacture live evidence. One UI draft-refresh follow-up rema… | [归档 L884](./archive/ROADMAP-2026-10-24-before-realign.md#L884) |
| R140 | — | 未完成 | 张骞 | ME-WI.0.2-A：统一 source / observation / evidence / event 契约、来源等级、新鲜度、去重、运行状态与结果呈现。 | [归档 L890](./archive/ROADMAP-2026-10-24-before-realign.md#L890) |
| R141 | — | 未完成 | 张骞 | ME-WI.0.2-B：主流新闻、行业新闻、行业杂志/行业网站采集与事件抽取；旅游行业首批纳入 Travel Today 等垂直来源。 | [归档 L891](./archive/ROADMAP-2026-10-24-before-realign.md#L891) |
| R142 | — | 未完成 | 张骞 | ME-WI.0.2-C：首期接入新西兰 SEEK、Indeed 公开招聘信息，识别组织与战略领先信号，并明确不等同于已发生业务事实。 | [归档 L893](./archive/ROADMAP-2026-10-24-before-realign.md#L893) |
| R143 | — | 未完成 | 张骞 | ME-WI.0.2-D：SERP、公开广告库、AI 可见度、口碑接入统一事件模型，复用既有 provider，不恢复已退役 `ai-tracker`。 | [归档 L894](./archive/ROADMAP-2026-10-24-before-realign.md#L894) |
| R144 | — | 未完成 | 张骞 | ME-WI.0.2-D1：通过 Apify `themineworks/similarweb-scraper` 接入竞品网站流量方向信号；仅保存域名级公开估算、变化率、来源结构和主要国家，标记低置信度，不将其解释为真实访问量、销售影响或 NZ 精确市场流量。已完成小样本验证、统一 observati… | [归档 L895](./archive/ROADMAP-2026-10-24-before-realign.md#L895) |
| R145 | — | 未完成 | 张骞 | ME-WI.0.2-E：跨来源事件聚合、高级客户预警与周度情报摘要。 | [归档 L896](./archive/ROADMAP-2026-10-24-before-realign.md#L896) |
| R146 | — | 未完成 | 张骞 | 每条管道必须完成“采集 → 证据 → 时效 → 变化分析 → 结果呈现”，保持只读、建议型、人工复核；不自动执行外部经营动作。 | [归档 L898](./archive/ROADMAP-2026-10-24-before-realign.md#L898) |

### 线索与受治理客服 · Connector（25）

邮件、表单抑制、老线索中心清单里还没勾掉的。NAL 不在这里。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R008 | P2 | 待认领 | 客服构建控制 | 去重闸 settled 判据绑定当前 audience/tag（改 crm/meta-lead.ts 回执形状，A 级需另走设计+实施复审） | [归档 L54](./archive/ROADMAP-2026-10-24-before-realign.md#L54) |
| R009 | P2 | 待认领 | 客服构建控制 | settledLookupFailures 没有消费者：在 pm-todo/manual-monitoring-items.ts 加独立判据下发待办 | [归档 L57](./archive/ROADMAP-2026-10-24-before-realign.md#L57) |
| R012 | P2 | 修法未拍板 | 客服构建控制 | 26 个带抑制标签的人只靠 Mailchimp 后台手工排除：发信前用接口核对收件人，命中则拦下+下发待办（或移出名单） | [归档 L90](./archive/ROADMAP-2026-10-24-before-realign.md#L90) |
| R011 | P3 | 待做 | 客服构建控制 | 修 loadContactsForClient()：把 metadata.do_not_contact===true 映射进 flagged，复用每日抑制管道 | [归档 L76](./archive/ROADMAP-2026-10-24-before-realign.md#L76) |
| R068 | P3 | 未完成 | 客服构建控制 | 页面顶栏「最后同步时间」硬编码「每小时一次」+ TODO，改从 `mailbox-sync` 心跳读。 | [归档 L361](./archive/ROADMAP-2026-10-24-before-realign.md#L361) |
| R069 | P3 | 未完成 | 客服构建控制 | 大团客户（pax > 30 常态）会被 `needs_review` 淹掉看板；判据升级成「同 Agent 30 天内见过一次即默认信任」。CTS 短期不撞。 | [归档 L362](./archive/ROADMAP-2026-10-24-before-realign.md#L362) |
| R021 | — | 待 PM 决定 | 客服构建控制 | PM 决定：旧表上那条外部管道（疑似 Zapier/Make）要不要停 | [归档 L166](./archive/ROADMAP-2026-10-24-before-realign.md#L166) |
| R022 | — | 待 PM 决定 | 客服构建控制 | PM 决定：补档窗口要不要往前调（2026-07-24 之前调不得） | [归档 L167](./archive/ROADMAP-2026-10-24-before-realign.md#L167) |
| R023 | — | 待认领 | 客服构建控制 | 欠账：lead-sheets 只吃 meta_lead_form（改名或加 source_channel 列） | [归档 L177](./archive/ROADMAP-2026-10-24-before-realign.md#L177) |
| R024 | — | 待认领，不急 | 客服构建控制 | 欠账：CLIENT_FOLLOWUP_SHEETS 收编进 client_lead_sheet_routes | [归档 L178](./archive/ROADMAP-2026-10-24-before-realign.md#L178) |
| R025 | — | 待认领 | 客服构建控制 | 欠账：347 条历史线索 source_ref 不是真线索编号 | [归档 L179](./archive/ROADMAP-2026-10-24-before-realign.md#L179) |
| R026 | — | 待认领 | 客服构建控制 | 小项：registry.ts 这条 schedule 加「与函数定义一致」断言；leads.ts 回查广告组名不再全量分页拉快照 | [归档 L181](./archive/ROADMAP-2026-10-24-before-realign.md#L181) |
| R106 | — | 未完成 | 客服构建控制 | 依然真实存在：`阶段Stage` 列 1599 行只填了 1 行，`阶段更新日` 列 100% 空白——"已 | [归档 L498](./archive/ROADMAP-2026-10-24-before-realign.md#L498) |
| R107 | — | 未完成 | 客服构建控制 | 若未来这条同步的记录量明显起量（不再是当前的量级），"查不到价格/缺日期"的搁置项要不要 | [归档 L501](./archive/ROADMAP-2026-10-24-before-realign.md#L501) |
| R122 | — | 未完成 | 客服构建控制 | 数据库那两个新开关默认是关的——代码合并上线不代表已经对 CTS/NAL 生效， | [归档 L681](./archive/ROADMAP-2026-10-24-before-realign.md#L681) |
| R123 | — | 未完成 | 客服构建控制 | 这一版只有手动触发入口，没有接 Inngest 定时——先观察几天判断质量和熔断阈值， | [归档 L683](./archive/ROADMAP-2026-10-24-before-realign.md#L683) |
| R124 | — | 未完成 | 客服构建控制 | 熔断触发后目前只进 PM 每日待办（拉模式），不会主动推送邮件——如果这类"钱可能 | [归档 L685](./archive/ROADMAP-2026-10-24-before-realign.md#L685) |
| R126 | — | 未完成 | 客服构建控制 | Delivery day 灰度切换：真正对 CTS 客户开放前的开关计划还没定 | [归档 L781](./archive/ROADMAP-2026-10-24-before-realign.md#L781) |
| R127 | — | 未完成 | 客服构建控制 | F4 系统健康巡检故意留的缺口——issue 原文要求的"4小时批准超时算事故"这一项仍未 | [归档 L782](./archive/ROADMAP-2026-10-24-before-realign.md#L782) |
| R128 | — | 未完成 | 客服构建控制 | 后续跟进（子牙复审记录，不阻塞已合并代码）：F4 健康心跳对"某渠道消息已入库但 | [归档 L798](./archive/ROADMAP-2026-10-24-before-realign.md#L798) |
| R129 | — | 未完成 | 客服构建控制 | 邮件渠道的 kill switch（`messenger_agent_enabled_email`）仍然只有 API、没有 | [归档 L801](./archive/ROADMAP-2026-10-24-before-realign.md#L801) |
| R131 | — | 未完成 | 客服构建控制 | Meta 企业验证仍未通过（issue #1299，需要 PM 本人上传公司文件）——不卡继续开发，但卡 Messenger/WhatsApp webhook 真正上线那天 | [归档 L821](./archive/ROADMAP-2026-10-24-before-realign.md#L821) [#1299](https://github.com/bigbigraydeng-maker/magic-engine/issues/1299) |
| R351 | — | 未完成 | 客服构建控制 | 阶段 1 验收：合并后需实际对 CTS 跑一次 `/api/clients/[id]/marketing-plan/generate`， | [归档 L1589](./archive/ROADMAP-2026-10-24-before-realign.md#L1589) |
| R352 | — | 未完成 | 客服构建控制 | 阶段 2（明确排除在阶段 1 之外，需要独立立项）：Mailchimp"建 campaign + 真发送"的 | [归档 L1591](./archive/ROADMAP-2026-10-24-before-realign.md#L1591) |
| R353 | — | 未完成 | 客服构建控制 | 自动欢迎序列碰撞检测目前是粗粒度的（只统计过去 7 天触达人数，不是精确逐联系人 | [归档 L1595](./archive/ROADMAP-2026-10-24-before-realign.md#L1595) |

### 共享底盘 · Kernel / 调度 / 待办（92）

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R015 | P2 | 待做（转给客户销售之前必须完成） | 鲁班 / 子牙 | 「填了表没人回」汇总信：接 remind-cadence.ts 提醒节奏 + 生成时按当前状态再过滤 | [归档 L128](./archive/ROADMAP-2026-10-24-before-realign.md#L128) |
| R016 | P2 | 待做 | 鲁班 / 子牙 | 同批：interest 以外自由文本脱敏复核；「直接回复这封邮件」换成真能点的入口 | [归档 L129](./archive/ROADMAP-2026-10-24-before-realign.md#L129) |
| R164 | P2 | 未完成 | 鲁班 / 子牙 | [P2] `kernel_needs_human` 三处分支生成空 href（`src/lib/kernel/handoff.ts` 91/103/112 行）：这几类交接待办的 `href: ''`，PM 点开邮件根本没有入口可点，只能靠 how 里的文字描述摸索。是「管道不许断头」这条铁律的安全… | [归档 L997](./archive/ROADMAP-2026-10-24-before-realign.md#L997) |
| R165 | P2 | 未完成 | 鲁班 / 子牙 | [P2] `leads_metric_untrusted` 落地页没有修复入口（`src/lib/pm-todo/manual-items.ts` `pushLeadsSanityItems` + `/goal/{goalId}`）：待办要求 PM 去客户网站统计后台收窄「产生线索」触发条件，但目标… | [归档 L998](./archive/ROADMAP-2026-10-24-before-realign.md#L998) |
| R166 | P2 | 未完成 | 鲁班 / 子牙 | [P2] `meta_stuck` 落地页跟需要做的事不对应（`src/lib/pm-todo/manual-items.ts` 515-520 行 + `/dashboard/clients/{id}/settings`）：待办要求登录客户自己的 WordPress 后台启用 Magic Engi… | [归档 L999](./archive/ROADMAP-2026-10-24-before-realign.md#L999) |
| R167 | P2 | 未完成 | 鲁班 / 子牙 | [P2] `goal_baseline_mismatch` 目标起点数字改不了（`/goal/{goalId}` 页 + `src/app/api/goals/[goalId]/route.ts` 只有 GET/DELETE）：待办要求把错误的起点改成重算值，但目标详情页只读展示 `baseline… | [归档 L1000](./archive/ROADMAP-2026-10-24-before-realign.md#L1000) |
| R443 | P2 | 未完成 | 鲁班 / 子牙 | P.G.5 平台候选复查治理界面 —— Codex 复审 P2 遗留意见。当前 `platform_candidate_review_due` 待办的 href 指向 GitHub `blob` 只读页面，PM/FDE 收到待办后要同时改 `docs/registry/platform-candid… | [归档 L1780](./archive/ROADMAP-2026-10-24-before-realign.md#L1780) |
| R448 | P2 | 未完成 | 鲁班 / 子牙 | [P2] 验证 Cloudflare AI Gateway 到底代不代理 `/v1/responses`。 | [归档 L1813](./archive/ROADMAP-2026-10-24-before-realign.md#L1813) |
| R453 | P2 | 未完成 | 鲁班 / 子牙 | [P2] 「卡死」的 60 分钟阈值对 Inngest 那几条长流程可能是误报。 | [归档 L1839](./archive/ROADMAP-2026-10-24-before-realign.md#L1839) |
| R010 | P3 | 待认领（已核实 load.ts 仍不递归） | 子牙 | docs/ledger/evidence/** 单独加格式/敏感信息检查（长数字、邮箱/电话、令牌前缀） | [归档 L67](./archive/ROADMAP-2026-10-24-before-realign.md#L67) |
| R449 | P3 | 未完成 | 鲁班 / 子牙 | [P3] 失败邮件只看最近 24 小时，卡死超过 24 小时的轮次进不了它。 | [归档 L1821](./archive/ROADMAP-2026-10-24-before-realign.md#L1821) |
| R450 | P3 | 未完成 | 鲁班 / 子牙 | [P3] `checkCronHealth()` 整体仍然没有单测。 | [归档 L1825](./archive/ROADMAP-2026-10-24-before-realign.md#L1825) |
| R454 | P3 | 未完成 | 鲁班 / 子牙 | [P3] `makeSupabaseStuckProber` 查询报错时返回 `[]`，等于「没有卡死」。 | [归档 L1848](./archive/ROADMAP-2026-10-24-before-realign.md#L1848) |
| R455 | P3 | 未完成 | 鲁班 / 子牙 | [P3] 看板 `workflows-health/page.tsx:214` 的文案过期了。 | [归档 L1852](./archive/ROADMAP-2026-10-24-before-realign.md#L1852) |
| R158 | — | 未完成 | 鲁班 / 子牙 | 🔴 需 PM 在 Cloudflare 后台（独立账号，本仓无法访问）给 magicengine.com.au 的 Pages 项目补 `SUPABASE_URL`=`https://glbdnayojixmexgofbsd.supabase.co`、`SUPABASE_SERVICE_KEY`=（… | [归档 L982](./archive/ROADMAP-2026-10-24-before-realign.md#L982) |
| R159 | — | 未完成 | 鲁班 / 子牙 | 补上后必须端到端验证：重新跑一次 `/discover` 全流程，确认 `leadId` 是真实 UUID、Supabase `discovery_leads` 真的新增一行、且真的收到报告邮件（不能只看页面显示"发送成功"——`report.js` 的 `sendEmail()` 在 `RESEN… | [归档 L983](./archive/ROADMAP-2026-10-24-before-realign.md#L983) |
| R160 | — | 未完成 | 鲁班 / 子牙 | 次要（魏征复审发现，非阻塞）：`discovery_leads` 表建表起没有任何 migration 显式 `enable row level security`/加 policy，虽然 service-role 调用不受 RLS 影响、暂无实际泄露，但应补一条独立 RLS migration 让… | [归档 L984](./archive/ROADMAP-2026-10-24-before-realign.md#L984) |
| R161 | — | 未完成 | 鲁班 / 子牙 | 次要：`website/_headers` 对 `/api/*` 声明 `Access-Control-Allow-Origin: https://magicengine.com.au`，而各 Function 自己又各设 `Access-Control-Allow-Origin: *`——未验证 … | [归档 L985](./archive/ROADMAP-2026-10-24-before-realign.md#L985) |
| R197 | — | 未完成 | 鲁班 / 子牙 | [Onboarding / 第三方对接页面简化（2026-08] PR6 板桥发现5（低优先级，随手可修） Google 连接失败 vs 客户自己点取消，回向导后画面一模一样看不出区别——不卡人，PR6 已上线，这条留到下次顺手改 | [归档 L1214](./archive/ROADMAP-2026-10-24-before-realign.md#L1214) [specs/2026-08-11-onboardin…](./specs/2026-08-11-onboarding-integrations-unify-v1.md) |
| R198 | — | 未完成 | 鲁班 / 子牙 | [Onboarding / 第三方对接页面简化（2026-08] PR3b（contract 阶段，PM 已表态"优先级较低可以往后放"） 老 `google_oauth_tokens` 表目前仍是读写兜底路径（PR3a 只做了双写+双读的 expand），等回填脚本在生产真正跑过、观察一段时间没问题后，再停止读… | [归档 L1215](./archive/ROADMAP-2026-10-24-before-realign.md#L1215) [specs/2026-08-11-onboardin…](./specs/2026-08-11-onboarding-integrations-unify-v1.md) |
| R204 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P21.J.UP9 两个新路由（房源素材列表、归档）+ 面板仍零测试。跨客户拿数、`uploadUrl` 的 fail-closed、20 文件截断回报、全失败分支，一条都没覆盖 | [归档 L1236](./archive/ROADMAP-2026-10-24-before-realign.md#L1236) |
| R205 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P21.J.UP10 上传文件零内容校验（信客户端 `file.type`，无魔数）；`visual-assets` 桶 `allowed_mime_types` 为 null（对比 `brief-uploads` 是有白名单的） | [归档 L1237](./archive/ROADMAP-2026-10-24-before-realign.md#L1237) |
| R206 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P21.J.UP11 `visual-assets` 桶仍是 `public=true`。路径已 hash 化不再泄 client_id，但「知道 URL 即可读」这条没变 —— 要根治得改私有桶 + 签名 URL | [归档 L1238](./archive/ROADMAP-2026-10-24-before-realign.md#L1238) |
| R207 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P21.J.UP12 上传令牌非确定性（GCM nonce 随机），每打开一次页面就多铸一条永不过期、无法单独吊销的链接。至少要让签发落账可吊销 | [归档 L1239](./archive/ROADMAP-2026-10-24-before-realign.md#L1239) |
| R208 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P21.J.M11 卖家向 Reel 需要 Ray White 侧的新证明点 —— 官网四条战绩全带前东家分行名 `Royal Heights Branch`，逐字引用不行、改写更不行。要跟 Roman 要 Mission Bay 的挂牌数/成交案… | [归档 L1241](./archive/ROADMAP-2026-10-24-before-realign.md#L1241) |
| R209 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P21.J.M12 `romanhu.com` 仍是旧行资料（含 `r.hu@barfoot.co.nz`）—— 广告线已被禁用词闸拦住，但网站本身该改（属 website-rescue 那条线） | [归档 L1242](./archive/ROADMAP-2026-10-24-before-realign.md#L1242) |
| R213 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] TM.1 团队工作记忆 · 套路层出第一条：机器已建好，但要先吃几天真实会话数据才提炼得出可复用套路。观察 `team_skills` 是否开始有行；一周后没有就回头看 distill prompt 的套路判据是不是太严 | [归档 L1251](./archive/ROADMAP-2026-10-24-before-realign.md#L1251) |
| R214 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] TM.2 团队工作记忆 · 后台页 `/dashboard/team-memory` 补视觉验证：功能上线时页面在登录墙后未做视觉检查，数据层与接口层已验 | [归档 L1252](./archive/ROADMAP-2026-10-24-before-realign.md#L1252) |
| R215 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] TM.3 团队工作记忆 · 补第二个 agent 复审：按铁律 4 属大任务（加表 + 新 endpoint + 新 UI），交付时只做了自审 + 变异测试，缺魏征挑刺那一刀 | [归档 L1253](./archive/ROADMAP-2026-10-24-before-realign.md#L1253) |
| R216 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P29.SEO.14 AU/NZ SME service page QA pass - verify titles, canonicals, internal links, sitemap exposure, and only make tiny … | [归档 L1255](./archive/ROADMAP-2026-10-24-before-realign.md#L1255) |
| R217 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S2.4 real_estate_auckland 8 个域名采集 + 写 industry_benchmarks | [归档 L1256](./archive/ROADMAP-2026-10-24-before-realign.md#L1256) |
| R218 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S2.5 flooring_tiles_brisbane 12 个域名采集 + 写 industry_benchmarks | [归档 L1257](./archive/ROADMAP-2026-10-24-before-realign.md#L1257) |
| R219 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S2.6 logistics_3pl_nz 9 个域名采集 + 写 industry_benchmarks | [归档 L1258](./archive/ROADMAP-2026-10-24-before-realign.md#L1258) |
| R220 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S4.4 real_estate_sydney — 悉尼房产（等客户） | [归档 L1259](./archive/ROADMAP-2026-10-24-before-realign.md#L1259) |
| R221 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S4.5 real_estate_melbourne — 墨尔本房产（等客户） | [归档 L1260](./archive/ROADMAP-2026-10-24-before-realign.md#L1260) |
| R222 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S4.6 real_estate_christchurch — 基督城房产（等客户） | [归档 L1261](./archive/ROADMAP-2026-10-24-before-realign.md#L1261) |
| R223 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S5.5 前端加趋势列（domain 历史折线 / 14d 30d 涨跌） | [归档 L1262](./archive/ROADMAP-2026-10-24-before-realign.md#L1262) |
| R224 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S5.6 异常预警（domain 单次掉分 >10% 报警 FDE） | [归档 L1263](./archive/ROADMAP-2026-10-24-before-realign.md#L1263) |
| R225 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P30.S5.7 客户对照视图（客户 vs 行业 P50 折线图） | [归档 L1264](./archive/ROADMAP-2026-10-24-before-realign.md#L1264) |
| R226 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P31.X.1 月营收"季度签字对账"流程（避免客户自报数据失真） | [归档 L1265](./archive/ROADMAP-2026-10-24-before-realign.md#L1265) |
| R227 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P31.X.2 主指标 measurement='auto' 时自动拉取 current_value（GA4 / SerpAPI / Apify） | [归档 L1266](./archive/ROADMAP-2026-10-24-before-realign.md#L1266) |
| R228 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P31.X.3 AI 参谋升级：基于历史 outcome 推荐 Initiative 组合（依赖数据沉淀） | [归档 L1267](./archive/ROADMAP-2026-10-24-before-realign.md#L1267) |
| R229 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P31.X.4 评分公式重做（reputation / SEO / ai_visibility 维度独立大工程） | [归档 L1268](./archive/ROADMAP-2026-10-24-before-realign.md#L1268) |
| R230 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P31.X.4a CTS 的 AI 可见度判断从 ai-tracker（系统 B）迁到 M1（系统 A = `geo-module`+`geo-baseline`）——2026-09-20 投资调查结论：PO 2026-08-19 已拍板「M1 唯… | [归档 L1269](./archive/ROADMAP-2026-10-24-before-realign.md#L1269) [DECISIONS.md](./DECISIONS.md) [拆除清单](./specs/2026-08-19-ai-tracker-decommission-v1.md) |
| R231 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P31.X.5 Retention / Reactivation intent（需先接通 CRM/EDM） | [归档 L1274](./archive/ROADMAP-2026-10-24-before-realign.md#L1274) |
| R232 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P31.X.6 Initiative 类型扩展：Operations / Market Intelligence / Product / Partnerships | [归档 L1275](./archive/ROADMAP-2026-10-24-before-realign.md#L1275) |
| R233 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P33.11 Goal 详情页 Initiative 卡片展开显示：关联 Campaign 数量 + action 完成率 | [归档 L1276](./archive/ROADMAP-2026-10-24-before-realign.md#L1276) |
| R234 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P33.12 Goal 详情页底部「执行进度摘要」区块（各 Initiative 进度条 + 总数统计） | [归档 L1277](./archive/ROADMAP-2026-10-24-before-realign.md#L1277) |
| R235 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P34-P3.9（降级 backlog）`createMcpAuthAdapter(kind)` 抽取防 verifyToken 漂移（两 endpoint 已工作+测试覆盖，纯重构） | [归档 L1278](./archive/ROADMAP-2026-10-24-before-realign.md#L1278) |
| R236 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] 二期补强（狄仁杰/魏征 backlog）：真 colleague-confirm code 流程 · IP 白名单升 DB 强约束 · 过期邮件（依赖 P2 SendGrid）· 老 mcp_access_log.key_id 列下线 | [归档 L1279](./archive/ROADMAP-2026-10-24-before-realign.md#L1279) |
| R237 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P35.7 转化闭环接线：replied → 发 `/discover` magic link；converted → `converted_client_id` 关联 clients | [归档 L1280](./archive/ROADMAP-2026-10-24-before-realign.md#L1280) |
| R238 | — | 待 PM 决定 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P35.8 定价页 / 官网 Digital Foundation 套餐文案（板桥必审：C 端文案）。退款保证措辞红线（PM 拍板 2026-07-06）：保证挂「交付」不挂「效果」——「7 天内四项升级全部交付并附验证截图，做不到全额退款」；绝不… | [归档 L1281](./archive/ROADMAP-2026-10-24-before-realign.md#L1281) |
| R240 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P35.10 外呼专用域名（PM 已拍板不用主域）：候选近似域名查询 → PM 选定注册 → SPF/DKIM/DMARC 配置 → 2-3 周预热计划。主域只收回复，保 magic link 通道信誉 | [归档 L1283](./archive/ROADMAP-2026-10-24-before-realign.md#L1283) |
| R241 | — | 待 PM 决定 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P35.11 邮箱深挖（治本，PM 拍板 2026-07-13）⭐：「假邮箱」≠「没邮箱」 —— 诊断 9 个被判无邮箱的商家（Maddren Homes / Clinic 1 / ETF Electrical / Roofing Excellen… | [归档 L1284](./archive/ROADMAP-2026-10-24-before-realign.md#L1284) |
| R242 | — | 待 PM 决定 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P35.12 $19.90 Tripwire Onboarding（获客漏斗第一钩，PM 拍板 2026-07-13）⭐⭐：一次性 $19.90「onboarding 数字优化」当 tripwire → 建联建信任 → 上钩 $990 套餐（GEO… | [归档 L1285](./archive/ROADMAP-2026-10-24-before-realign.md#L1285) |
| R243 | — | 未完成 | 鲁班 / 子牙 | [三位 agent 复审剩下的（2026-08-05，已修的不] P35.13 社媒内容引擎升级（IG 原生 + 品牌套件，为 $990 代运营铺路）：现输出主打 FB 文字帖、太粗不符 IG。三支柱：① IG 原生格式模板库（轮播/Reel/精修图/Story）② 每客户品牌套件（从 logo/官网抽主色+2 … | [归档 L1286](./archive/ROADMAP-2026-10-24-before-realign.md#L1286) |
| R275 | — | 未完成 | 鲁班 / 子牙 | TD.1 Content Workbench 编辑失败无错误提示（当前静默失败） | [归档 L1327](./archive/ROADMAP-2026-10-24-before-realign.md#L1327) |
| R276 | — | 未完成 | 鲁班 / 子牙 | TD.2 图片生成失败后无法手动重试（需刷新页面） | [归档 L1328](./archive/ROADMAP-2026-10-24-before-realign.md#L1328) |
| R278 | — | 未完成 | 鲁班 / 子牙 | TD.4 缺少 Supabase Row Level Security 规则 | [归档 L1330](./archive/ROADMAP-2026-10-24-before-realign.md#L1330) |
| R279 | — | 未完成 | 鲁班 / 子牙 | TD.5 视觉生成队列在客户端 localStorage（需迁移到服务端） | [归档 L1331](./archive/ROADMAP-2026-10-24-before-realign.md#L1331) |
| R280 | — | 未完成 | 鲁班 / 子牙 | TD.6 第三方真实名在部分 UI 文案中暴露（需扫描 + 替换为封装名） | [归档 L1332](./archive/ROADMAP-2026-10-24-before-realign.md#L1332) |
| R281 | — | 未完成 | 鲁班 / 子牙 | TD.12 `SeoContentAdapter.pullMetrics` 入库失败只 `console.error` 不抛 —— 回执会报「写了 4 行」而库里 0 行。2026-09-07 每周 SEO 快照上线时发现，属适配器旧账，未在那条链路的 PR 范围内修（#1440 复审记录） | [归档 L1333](./archive/ROADMAP-2026-10-24-before-realign.md#L1333) [#1440](https://github.com/bigbigraydeng-maker/magic-engine/pull/1440) |
| R282 | — | 未完成 | 鲁班 / 子牙 | TD.13 `getDomainMetrics` 两层 `Promise.allSettled` 把 provider 故障写成 0 值 —— DataForSEO 故障那一周，全体客户的 SEO 指标会被记成 0 并写进 `flywheel_metrics`，Check / Tune 读到的是假数… | [归档 L1334](./archive/ROADMAP-2026-10-24-before-realign.md#L1334) [#1440](https://github.com/bigbigraydeng-maker/magic-engine/pull/1440) |
| R283 | — | 未完成 | 鲁班 / 子牙 | TD.14 「谁买了 SEO」这个商业事实被编码成「填没填网址」这个技术字段 —— `flywheel-seo-weekly` / `keyword-snapshots-weekly` 等 5 条链路共用 `client_status='active' AND domain IS NOT NULL`… | [归档 L1335](./archive/ROADMAP-2026-10-24-before-realign.md#L1335) |
| R285 | — | 未完成 | 鲁班 / 子牙 | TD.10 Git 本地分支堆积（20+ 个 `claude/*` 和 `feat/*` 废弃分支） | [归档 L1337](./archive/ROADMAP-2026-10-24-before-realign.md#L1337) |
| R286 | — | 未完成 | 鲁班 / 子牙 | TD.11 `agitated-mahavira-be6d17` 等 worktree 物理目录占用磁盘空间 | [归档 L1338](./archive/ROADMAP-2026-10-24-before-realign.md#L1338) |
| R287 | — | 未完成 | 鲁班 / 子牙 | TD.7 收集器模块（6 个）缺少错误重试机制 | [归档 L1339](./archive/ROADMAP-2026-10-24-before-realign.md#L1339) |
| R288 | — | 未完成 | 鲁班 / 子牙 | TD.8 月报聚合库缺少事务型一致性保证 | [归档 L1340](./archive/ROADMAP-2026-10-24-before-realign.md#L1340) |
| R289 | — | 未完成 | 鲁班 / 子牙 | TD.9 聚合器性能未优化（N+1 查询） | [归档 L1341](./archive/ROADMAP-2026-10-24-before-realign.md#L1341) |
| R290 | — | 未完成 | 鲁班 / 子牙 | TD.10 月报查询端点缺少分页 / 排序参数 | [归档 L1342](./archive/ROADMAP-2026-10-24-before-realign.md#L1342) |
| R291 | — | 未完成 | 鲁班 / 子牙 | TD.11 API 缺少速率限制（Rate Limit） | [归档 L1343](./archive/ROADMAP-2026-10-24-before-realign.md#L1343) |
| R292 | — | 未完成 | 鲁班 / 子牙 | TD.12 月报页面缺少加载骨架屏（loading skeleton） | [归档 L1344](./archive/ROADMAP-2026-10-24-before-realign.md#L1344) |
| R293 | — | 未完成 | 鲁班 / 子牙 | TD.13 分节组件之间缺少交互（drill-down / tooltip） | [归档 L1345](./archive/ROADMAP-2026-10-24-before-realign.md#L1345) |
| R294 | — | 未完成 | 鲁班 / 子牙 | TD.14 月报导出功能（PDF / 邮件）未实现（P8.2 任务） | [归档 L1346](./archive/ROADMAP-2026-10-24-before-realign.md#L1346) |
| R295 | — | 未完成 | 鲁班 / 子牙 | TD.15 聚合器单元测试覆盖率 < 70% | [归档 L1347](./archive/ROADMAP-2026-10-24-before-realign.md#L1347) |
| R296 | — | 未完成 | 鲁班 / 子牙 | TD.16 未做月报端到端测试（CTS Tours 实际客户） | [归档 L1348](./archive/ROADMAP-2026-10-24-before-realign.md#L1348) |
| R297 | — | 未完成 | 鲁班 / 子牙 | TD.17 聚合器架构文档缺失 | [归档 L1349](./archive/ROADMAP-2026-10-24-before-realign.md#L1349) |
| R298 | — | 未完成 | 鲁班 / 子牙 | TD.18 缺少聚合器性能 / 错误监控仪表板 | [归档 L1350](./archive/ROADMAP-2026-10-24-before-realign.md#L1350) |
| R299 | — | 未完成 | 鲁班 / 子牙 | TD.19 私信 AI 摘要的 `trip`（旅游行程专属字段）在 schema 层被建成"通用必填对象"——`src/lib/messenger/brief-schema.ts` 的 `TripDetailsSchema` 永远存在、永远带默认值，`MessengerBriefSchema.tri… | [归档 L1351](./archive/ROADMAP-2026-10-24-before-realign.md#L1351) [#1629](https://github.com/bigbigraydeng-maker/magic-engine/pull/1629) [docs/DECISIONS.md「2026-09-…](./DECISIONS.md) |
| R300 | — | 未完成 | 鲁班 / 子牙 | TD.20 私信 AI 客服门户「批准」按钮点击时不检查该客户/渠道的 AI 开关是否已被关闭——PM/FDE 可以在渠道已经被紧急停用之后，照常点批准一条草稿，系统照常接受，真正挡住发送的检查点在批准界面上完全看不到、也不提示。2026-09-15 issue #1590 回滚演练发现：`conv… | [归档 L1352](./archive/ROADMAP-2026-10-24-before-realign.md#L1352) [docs/sops/messenger-ai-rol…](./sops/messenger-ai-rollback.md) |
| R301 | — | 未完成 | 鲁班 / 子牙 | TD.21 私信 AI 客服没有"一键批量拒绝该客户所有待审批草稿"的入口——紧急停用 AI 后，已经生成、还没被人批准/拒绝的草稿只能逐条手动处理，客户草稿多时人工回滚会很慢，且容易漏掉。同一次 2026-09-15 演练发现，与 TD.20 同源。 | [归档 L1353](./archive/ROADMAP-2026-10-24-before-realign.md#L1353) |
| R302 | — | 未完成 | 鲁班 / 子牙 | TD.22 私信 AI 客服没有"中止正在跑的 Inngest 任务"机制——一个已经开始但还没生成草稿的处理流程，目前没有任何办法主动打断，只能等它自己跑到检查点（生成草稿进入待审批）或等 4 小时等待上限超时。2026-09-15 演练确认：关掉客户的 AI 开关后，这类"还在路上"的任务不会被… | [归档 L1354](./archive/ROADMAP-2026-10-24-before-realign.md#L1354) |
| R306 | — | 未完成 | 鲁班 / 子牙 | P8.S.8 — `batchKeywordOverview`（`phrase_these`）→ `keywords_data/google_ads/search_volume/live` + `bulk_keyword_difficulty`（两次 task 合并） | [归档 L1364](./archive/ROADMAP-2026-10-24-before-realign.md#L1364) |
| R415 | — | 未完成 | 鲁班 / 子牙 | P29.C.3 — 接入内容生成页（博客 / 社媒 / Reels Studio） | [归档 L1729](./archive/ROADMAP-2026-10-24-before-realign.md#L1729) |
| R416 | — | 未完成 | 鲁班 / 子牙 | P29.C.4 — 接入执行看板顶部 | [归档 L1730](./archive/ROADMAP-2026-10-24-before-realign.md#L1730) |
| R417 | — | 未完成 | 鲁班 / 子牙 | P29.C.5 — 接入 Launch Hub | [归档 L1731](./archive/ROADMAP-2026-10-24-before-realign.md#L1731) |
| R418 | — | 未完成 | 鲁班 / 子牙 | P29.D.1 — AI Agent 辅助补 Brief：给出公司名 / 网址后 AI 自动提议 5 字段（可编辑确认） | [归档 L1732](./archive/ROADMAP-2026-10-24-before-realign.md#L1732) |
| R419 | — | 未完成 | 鲁班 / 子牙 | P29.D.2 — Brief 完成后可随时在 Settings 页完善为 Full Brief | [归档 L1733](./archive/ROADMAP-2026-10-24-before-realign.md#L1733) |
| R439 | — | 未完成 | 鲁班 / 子牙 | P.G.1 补 harness 层挂载 hook —— 子牙终审问题 3。当前挂载靠 agent 自觉读 CLAUDE.md，跟事故根因（agent 没自认为在做平台决策）同构。方案：`.claude/settings.local.json` 加 Stop hook，扫本轮产出文本命中 `能力线\/智… | [归档 L1776](./archive/ROADMAP-2026-10-24-before-realign.md#L1776) |
| R440 | — | 未完成 | 鲁班 / 子牙 | P.G.2 改名 skill 避免与 `src/lib/kernel-approval/tier-gate.test.ts` 语义碰撞 —— 子牙终审问题 4。同仓库 "tier-gate" 缩写会永久混淆平台层级与 kernel 权限档位两套概念。建议改成 `me-capability-layer… | [归档 L1777](./archive/ROADMAP-2026-10-24-before-realign.md#L1777) |
| R441 | — | 未完成 | 鲁班 / 子牙 | P.G.3 澄清 skill 在五道 Build Gate 中的位置为 Gate 0 / Pre-Gate —— 子牙终审问题 5。SKILL.md 现在"红线 6"与"与既有治理机制的关系"表两处对 skill 从属关系的表述矛盾（一说是 Gate 4 前置子步骤，一说强化 Gate 2）。改成"… | [归档 L1778](./archive/ROADMAP-2026-10-24-before-realign.md#L1778) |
| R442 | — | 待 PM 决定 | 鲁班 / 子牙 | P.G.4 抽 `docs/registry/pillars.md` 作为 6 支柱唯一名单来源 —— 子牙终审问题 6。当前 SKILL.md、CLAUDE.md 两处硬编码"SEO / 社媒 / 广告 / 口碑 / AI 可见度 / 竞品"，跟 skill 自己声明的"支柱数量是 PM 拍板项"… | [归档 L1779](./archive/ROADMAP-2026-10-24-before-realign.md#L1779) |

### 行业层 · ME 旅游版（5）

PM 已立版，未授权实施。按「平台 → 行业 → 企业」，排在平台缺口之后。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R132 | P1 | 未完成 | 行业层（未授权） | P1 · 统一/连接现有团事实源 + 最小营销快照（A 级）：连接 `config/clients/cts/offerings.yaml` / `src/lib/web-intelligence/first-party-tours.ts`(`FirstPartyTour`) / 客户官网，不新建第三… | [归档 L870](./archive/ROADMAP-2026-10-24-before-realign.md#L870) |
| R133 | P2 | 未完成 | 行业层（未授权） | P2 · 路线图生成器产品化（B 级）：把原型 `docs/specs/prototypes/tour-route-map/` 搬成 ME 正式能力，输入 = P1 快照，输出 PC + 手机 SVG 落公开桶。前置：品牌/logo、底图、地理标注规则参数化（当前 CTS/中国硬编码）。晋升门槛 =… | [归档 L871](./archive/ROADMAP-2026-10-24-before-realign.md#L871) |
| R134 | P3 | 未完成 | 行业层（未授权） | P3 · Tour 管理后台 UI（B 级）：ME 后台录入营销快照 + 一键生成地图；价格/出发日期只读展示。 | [归档 L872](./archive/ROADMAP-2026-10-24-before-realign.md#L872) |
| R135 | — | 未完成 | 行业层（未授权） | P4 · 内容 + 定价产出（B 级）：接现有 AI 文案 / SEO writer / grounding，从快照产出各渠道文案；价格读统一事实源。 | [归档 L873](./archive/ROADMAP-2026-10-24-before-realign.md#L873) |
| R136 | — | 未完成 | 行业层（未授权） | P5 · 一键交付（C 级）：地图 + 文案 + PDF brochure + 落地页片段打包。 | [归档 L874](./archive/ROADMAP-2026-10-24-before-realign.md#L874) |

### 客户专属（21）

Roman 参考闭环、Park Homes、NZCPE。NZCPE 的方向和预算同时列在拍板区。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R053 | P3 | 未开工 | PM | Park Homes：补齐 Greenview / Castor Bay / Forrest Hill 配套内容（文章、效果图） | [归档 L328](./archive/ROADMAP-2026-10-24-before-realign.md#L328) |
| R054 | P3 | 未开工（已核实 Base.astro 仍无 og: 标签） | PM | Park Homes 全站加 Open Graph / Twitter Card 元数据（Base.astro） | [归档 L331](./archive/ROADMAP-2026-10-24-before-realign.md#L331) |
| R147 | — | 未完成 | PM | #1023 WP05 follow-up | [归档 L944](./archive/ROADMAP-2026-10-24-before-realign.md#L944) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) |
| R148 | — | 未完成 | PM | #1030 WP05 follow-up | [归档 L945](./archive/ROADMAP-2026-10-24-before-realign.md#L945) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) |
| R149 | — | 未完成 | PM | #1040 聚合分组键需按 `engine_family / model_version / query_set_version` 隔离（未知 fail-closed）—— Codex #1032 第 4 轮 P1-c，Roman 单引擎/单模型未触发但结构上带洞；已在 comment 531568… | [归档 L946](./archive/ROADMAP-2026-10-24-before-realign.md#L946) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) [#1040](https://github.com/bigbigraydeng-maker/magic-engine/issues/1040) |
| R150 | — | 未完成 | PM | WP07 #880 Kernel 授权的 apply / verify / rollback | [归档 L947](./archive/ROADMAP-2026-10-24-before-realign.md#L947) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) [#880](https://github.com/bigbigraydeng-maker/magic-engine/issues/880) |
| R151 | — | 未完成 | PM | K-WP01 #881 认证审批 / 拒绝界面 + 政策 Settings UI | [归档 L948](./archive/ROADMAP-2026-10-24-before-realign.md#L948) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) [#881](https://github.com/bigbigraydeng-maker/magic-engine/issues/881) |
| R152 | — | 未完成 | PM | WP08 余项 #932 Roman 页面台账 + 权威来源 · 测量频率（cadence，须与 #885 对齐）· WP09 前置就位登记 —— WP09 的前置，与已冻结的 Baseline v1 无关 | [归档 L957](./archive/ROADMAP-2026-10-24-before-realign.md#L957) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) [#932](https://github.com/bigbigraydeng-maker/magic-engine/issues/932) |
| R153 | — | 未完成 | PM | WP09 / WP10 #884 / #885 首次 1–3 页优化 → T+7/14/28 复测与学习（严格串行，两项均未开工） | [归档 L958](./archive/ROADMAP-2026-10-24-before-realign.md#L958) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) [#884](https://github.com/bigbigraydeng-maker/magic-engine/issues/884) |
| R154 | — | 未完成 | PM | WP00 §15 其余未决项（U1–U10、U12）仍单独以未决形态挂着，任何 WP 不许把它们当既定假设 | [归档 L960](./archive/ROADMAP-2026-10-24-before-realign.md#L960) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) |
| R155 | — | 未完成 | PM | Product Map PR3（WP「ME2 Product Map v1」的最后一段）—— PR1（组件登记册＋成熟度引擎,PR #976）与 PR2（GitHub 只读动态同步,PR #979）均已于 2026-08-15 合并并完成生产 provisioning（migration 已 app… | [归档 L961](./archive/ROADMAP-2026-10-24-before-realign.md#L961) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) [#976](https://github.com/bigbigraydeng-maker/magic-engine/pull/976) |
| R156 | — | 未完成 | PM | #911 / PR #912 OPS03 事件驱动 Issue 中继试点 —— ⚠️ 它写死的唯一标的 #910 已关闭，试点要么改标的要么归档 | [归档 L968](./archive/ROADMAP-2026-10-24-before-realign.md#L968) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) [#911](https://github.com/bigbigraydeng-maker/magic-engine/issues/911) |
| R157 | — | 规则已定案；#931 不另开工 | PM | 【已定案 2026-10-24 19:55 NZDT】Ray 原话：「普通改动机器自动合并。」与此矛盾的「PR 一律不自动合并」作废，依据即该原话。#931 仍是未合并且冲突的旧 PR，不另开工。原文：PR #931 OPS02「Codex 复审干净就自动合并」—— ⚠️ 前置已就绪，卡点在 PR 自己身上：原引用的 #939 已于 2026-08-16 关闭修复，不再是阻塞点。曾经存在的另一个真实缺口——`tools/ops-review-loop/src/fix-scope.mjs` 的 `G… | [归档 L969](./archive/ROADMAP-2026-10-24-before-realign.md#L969) [#872](https://github.com/bigbigraydeng-maker/magic-engine/issues/872) [#931](https://github.com/bigbigraydeng-maker/magic-engine/pull/931) |
| R199 | — | 待 PM 决定 | PM | [NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-1 推广方向口径待 PM 一句话定死 —— 网站 SEO 已按 PM 2026-08-05 拍板改回 B2B（中国企业出海 / NZ 企业对华采购），而广告与社媒计划仍冲 To C 的 15,000 公众访客目标。两条线现在方向不同：是… | [归档 L1222](./archive/ROADMAP-2026-10-24-before-realign.md#L1222) [docs/clients/nzcpe/](./clients/nzcpe/) |
| R200 | — | 未完成 | PM | [NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-2 GBP 建档 地址挂 NZICC（101 Hobson Street, Auckland CBD）—— To C 推广也吃自然搜索流量 | [归档 L1223](./archive/ROADMAP-2026-10-24-before-realign.md#L1223) [docs/clients/nzcpe/](./clients/nzcpe/) |
| R201 | — | 未完成 | PM | [NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-3 确认 `plan_tier` 现设 `starter`，无预算信号，PM 确认后再调 | [归档 L1224](./archive/ROADMAP-2026-10-24-before-realign.md#L1224) [docs/clients/nzcpe/](./clients/nzcpe/) |
| R202 | — | 未完成 | PM | [NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-4 广告账户挂谁 NZCPE 自建 vs Magic Engine `（长编号见归档）` 代投 —— PM 待拍板 | [归档 L1225](./archive/ROADMAP-2026-10-24-before-realign.md#L1225) [docs/clients/nzcpe/](./clients/nzcpe/) |
| R203 | — | 未完成 | PM | [NZCPE 2026（新西兰中国贸易博览会 · 2026-0] NZCPE-5（可选，PM 决定要不要做） 关键词调研发现 `things to do with kids auckland`（1900/月·低难度）比品牌词好抓，可做网站博客 / `news.html` 扩展 —— 但这跟 NZCPE-1 的方向… | [归档 L1226](./archive/ROADMAP-2026-10-24-before-realign.md#L1226) [docs/clients/nzcpe/](./clients/nzcpe/) |
| R210 | — | 未完成 | PM | [三位 agent 复审剩下的（2026-08-05，已修的不] NZCPE.1 NZCPE 2026（新西兰-中国商品博览会，client_id （客户编号见归档），FDE 接管网站+FB，目标=11月展会 To C 推广，因粉丝基数≈0 已定调优先做广告非自然发帖）2026-08-05 已把 Page(… | [归档 L1245](./archive/ROADMAP-2026-10-24-before-realign.md#L1245) [docs/clients/nzcpe/client-…](./clients/nzcpe/client-brief.md) |
| R211 | — | 待 PM 决定 | PM | [三位 agent 复审剩下的（2026-08-05，已修的不] NZCPE.2 NZCPE 2026 GBP——2026-08-05 查到 Google 上已有未认领的旧档案"NZCN Expo Auckland office"(同一主办方旧年份用的)，PM 拍板改名/更新成2026版，但认领必须客户自己账号走… | [归档 L1247](./archive/ROADMAP-2026-10-24-before-realign.md#L1247) |
| R212 | — | 待 PM 决定 | PM | [三位 agent 复审剩下的（2026-08-05，已修的不] NZCPE.5 NZCPE 2026 网站+FB 内容规划+广告计划已出草案，见 docs/clients/nzcpe/content-and-ads-plan.md。待 PM 拍板：广告预算量级、广告账户挂谁、要不要做"things to do … | [归档 L1250](./archive/ROADMAP-2026-10-24-before-realign.md#L1250) [docs/clients/nzcpe/content…](./clients/nzcpe/content-and-ads-plan.md) |

---

## 冻结 / 待 PM 决定是否保留（89）

不删除。全文在归档。恢复或作废都等你一句话。

### 老阶段，对不上现行六支柱和 IMPACT（70）

Phase 7 的日期已经过了。下半年 Phase 8–10、创意引擎 Phase 11、视觉参考库 Phase 27、收件箱 Phase 28、会员五档、语音、平台伙伴拓展，都先冻着。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R431 | P1 | 未完成 | 客服构建控制 | WhatsApp 文字 + 语音消息（P1） | [归档 L1748](./archive/ROADMAP-2026-10-24-before-realign.md#L1748) |
| R244 | — | 未完成 | 待认领 | P7.4.14 第 2/4 周复跑 AI Tracker，对比排名变化（2026-05-12 执行） | [归档 L1290](./archive/ROADMAP-2026-10-24-before-realign.md#L1290) |
| R245 | — | 未完成 | 待认领 | P7.4.15 第 4 周生成首份月报（2026-05-26 执行） | [归档 L1291](./archive/ROADMAP-2026-10-24-before-realign.md#L1291) |
| R246 | — | 未完成 | 待认领 | P8.2.4 社媒联动：博客 approved 后，自动在策略面板生成 3 条对应社媒话题建议（Facebook / Instagram / LinkedIn） | [归档 L1295](./archive/ROADMAP-2026-10-24-before-realign.md#L1295) |
| R247 | — | 未完成 | 待认领 | P8.P.1 新建 `paid_ad_sets` 表（client_id / brief_id / set_name / format_matrix / status / created_at） | [归档 L1296](./archive/ROADMAP-2026-10-24-before-realign.md#L1296) |
| R248 | — | 未完成 | 待认领 | P8.P.2 新建 `paid_ad_copies` 表（set_id / format_type / headline / body / cta / visual_prompt / visual_asset_id / status） | [归档 L1297](./archive/ROADMAP-2026-10-24-before-realign.md#L1297) |
| R249 | — | 未完成 | 待认领 | P8.P.3 `src/lib/paid-social/brand-dna-extractor.ts` — 从 Master Brief 提炼 Brand DNA（价值主张 / 受众痛点 / 差异化 / 证据点），Strategy Engine（Claude）输出结构化 JSON | [归档 L1298](./archive/ROADMAP-2026-10-24-before-realign.md#L1298) |
| R250 | — | 未完成 | 卫青 | P8.P.4 `src/lib/paid-social/ad-copy-generator.ts` — 按格式矩阵批量生成广告文案，Content Engine（GPT-4o-mini）输出，AU/NZ 本地英语拼写强制约束 | [归档 L1299](./archive/ROADMAP-2026-10-24-before-realign.md#L1299) |
| R251 | — | 未完成 | 卫青 | P8.P.5 `src/lib/paid-social/visual-prompt-builder.ts` — 为每条广告生成配图提示词（结合产品图描述 + 品牌色调 + 格式规格） | [归档 L1300](./archive/ROADMAP-2026-10-24-before-realign.md#L1300) |
| R252 | — | 未完成 | 待认领 | P8.P.6 `POST /api/clients/[id]/paid-social/generate` — 触发一次完整生成（brief_id + 可选 format_filter + 可选 reference_image_desc） | [归档 L1301](./archive/ROADMAP-2026-10-24-before-realign.md#L1301) |
| R253 | — | 未完成 | 卫青 | P8.P.7 `GET /api/clients/[id]/paid-social/sets` — 广告集列表 | [归档 L1302](./archive/ROADMAP-2026-10-24-before-realign.md#L1302) |
| R254 | — | 未完成 | 待认领 | P8.P.8 `GET /api/clients/[id]/paid-social/sets/[setId]/copies` — 单集文案列表 | [归档 L1303](./archive/ROADMAP-2026-10-24-before-realign.md#L1303) |
| R255 | — | 未完成 | 待认领 | P8.P.9 `PATCH /api/clients/[id]/paid-social/copies/[copyId]` — 编辑单条文案 / 更新状态 | [归档 L1304](./archive/ROADMAP-2026-10-24-before-realign.md#L1304) |
| R256 | — | 未完成 | 待认领 | P8.P.10 `POST /api/clients/[id]/paid-social/copies/[copyId]/generate-image` — 单条文案触发 Visual Studio 配图生成 | [归档 L1305](./archive/ROADMAP-2026-10-24-before-realign.md#L1305) |
| R257 | — | 未完成 | 待认领 | P8.P.11 路由 `/dashboard/paid-social/[clientId]` 创建（含客户选择 landing） | [归档 L1306](./archive/ROADMAP-2026-10-24-before-realign.md#L1306) |
| R258 | — | 未完成 | 待认领 | P8.P.12 生成面板：选择 Brief + 勾选格式类型 + 可选填产品图描述 → [Generate Ad Set] 按钮（预估 10 分钟） | [归档 L1307](./archive/ROADMAP-2026-10-24-before-realign.md#L1307) |
| R259 | — | 未完成 | 卫青 | P8.P.13 广告集列表视图（按格式分组 Tab，每条展示 headline / body / CTA / 状态） | [归档 L1308](./archive/ROADMAP-2026-10-24-before-realign.md#L1308) |
| R260 | — | 未完成 | 卫青 | P8.P.14 单条广告卡片：文案内联编辑 + 右侧配图提示词展示 + [Generate Image] 按钮 | [归档 L1309](./archive/ROADMAP-2026-10-24-before-realign.md#L1309) |
| R261 | — | 未完成 | 待认领 | P8.P.15 批量操作：[Generate All Images] 一键触发全集配图生成（复用视觉生成队列） | [归档 L1310](./archive/ROADMAP-2026-10-24-before-realign.md#L1310) |
| R262 | — | 未完成 | 待认领 | P8.P.16 侧边栏导航加 "Paid Social 📣" 菜单项 | [归档 L1311](./archive/ROADMAP-2026-10-24-before-realign.md#L1311) |
| R263 | — | 未完成 | 卫青 | P8.12.S1.6 张骞 Apify 商业情报扩展 — 社媒真实指标 + FB 广告 + 小红书 + Google Search（张骞按需调用，非每次全跑） | [归档 L1312](./archive/ROADMAP-2026-10-24-before-realign.md#L1312) |
| R264 | — | 未完成 | 待认领 | S1.6b 小红书 RedNote scraper（新封装 `apify/xiaohongshu-scraper.ts`，actor `zhorex/rednote-xiaohongshu-scraper`）+ `SocialPlatform` 枚举加 `xiaohongshu` + 接入（⚠️ 该… | [归档 L1313](./archive/ROADMAP-2026-10-24-before-realign.md#L1313) |
| R265 | — | 未完成 | 待认领 | P9.1 月报 PDF 导出 + 邮件自动发送（Strategy Engine 生成分析文字，Puppeteer 截图） | [归档 L1314](./archive/ROADMAP-2026-10-24-before-realign.md#L1314) |
| R266 | — | 未完成 | 待认领 | P9.2 客户 Portal（client-facing view，只看自己内容 + 当月月报） | [归档 L1315](./archive/ROADMAP-2026-10-24-before-realign.md#L1315) |
| R267 | — | 未完成 | 待认领 | P9.3 站点权威度追踪（DA / 外链 / 内链趋势） | [归档 L1316](./archive/ROADMAP-2026-10-24-before-realign.md#L1316) |
| R268 | — | 未完成 | 待认领 | P9.4 Cron：每日 sync Content Workspace → 主库；每周一跑 AI Tracker + 更新策略建议 | [归档 L1317](./archive/ROADMAP-2026-10-24-before-realign.md#L1317) |
| R269 | — | 未完成 | 待认领 | P9.5 批量执行：一键为所有 approved 策略条目生成对应内容 | [归档 L1318](./archive/ROADMAP-2026-10-24-before-realign.md#L1318) |
| R270 | — | 未完成 | 待认领 | P10.1 小红书 / LinkedIn / TikTok 视频自动剪辑支持 | [归档 L1319](./archive/ROADMAP-2026-10-24-before-realign.md#L1319) |
| R271 | — | 未完成 | 待认领 | P10.2 多语言内容支持（中文市场优先） | [归档 L1320](./archive/ROADMAP-2026-10-24-before-realign.md#L1320) |
| R272 | — | 未完成 | 待认领 | P10.3 Magic Lab Academy 课程化（基于 CTS Tours 实战 SOP） | [归档 L1321](./archive/ROADMAP-2026-10-24-before-realign.md#L1321) |
| R273 | — | 未完成 | 待认领 | P10.4 Plugin 形态：WordPress / Webflow GEO 自动注入插件 | [归档 L1322](./archive/ROADMAP-2026-10-24-before-realign.md#L1322) |
| R274 | — | 未完成 | 待认领 | P10.5 Google AI Overview 追踪（SerpAPI，AU/NZ 市场必做） | [归档 L1323](./archive/ROADMAP-2026-10-24-before-realign.md#L1323) |
| R303 | — | 未完成 | 待认领 | Markifact API 能否回传 `creative_parent_id`（绑定我们的 seed creative） | [归档 L1358](./archive/ROADMAP-2026-10-24-before-realign.md#L1358) |
| R304 | — | 未完成 | 待认领 | Markifact 能否提供"创意 × 受众 × 转化"三维数据切片 | [归档 L1359](./archive/ROADMAP-2026-10-24-before-realign.md#L1359) |
| R305 | — | 未完成 | 待认领 | Supabase `visual_assets` 表加 `embedding vector(512)` + `style_scores jsonb` 列 | [归档 L1360](./archive/ROADMAP-2026-10-24-before-realign.md#L1360) |
| R400 | — | 未完成 | 马良 | P27.1 — DB migration：`visual_reference_library` 表 | [归档 L1708](./archive/ROADMAP-2026-10-24-before-realign.md#L1708) |
| R401 | — | 未完成 | 马良 | P27.2 — FDE 上传 UI：Assets 页面「参考库」标签，支持批量上传 + 标注来源（FDE/客户/竞品） | [归档 L1709](./archive/ROADMAP-2026-10-24-before-realign.md#L1709) |
| R402 | — | 未完成 | 马良 | P27.3 — GPT-4o Vision 分析管道：提取配色 + 构图 + 元素类型 + 风格标签 | [归档 L1710](./archive/ROADMAP-2026-10-24-before-realign.md#L1710) |
| R403 | — | 未完成 | 马良 | P27.4 — 行业标签过滤 + 相似图搜索（pgvector embedding） | [归档 L1711](./archive/ROADMAP-2026-10-24-before-realign.md#L1711) |
| R404 | — | 未完成 | 马良 | P27.5 — 视觉得分：参考 viral_score 逻辑，给每张图打 1-10 分 | [归档 L1712](./archive/ROADMAP-2026-10-24-before-realign.md#L1712) |
| R405 | — | 未完成 | 马良 | P27.6 — 竞品爬取接入：URL 输入 → Jina.ai 抓取 OG 图 → 自动入库分析 | [归档 L1713](./archive/ROADMAP-2026-10-24-before-realign.md#L1713) |
| R406 | — | 未完成 | 马良 | P27.7 — AI Factory 注入：图片/封面生成时，从参考库取 top-3 相似风格约束注入 prompt | [归档 L1714](./archive/ROADMAP-2026-10-24-before-realign.md#L1714) |
| R407 | — | 未完成 | 马良 | P27.8 — 参考库浏览 UI：瀑布流展示 + 筛选 + 得分排序 + 删除 | [归档 L1715](./archive/ROADMAP-2026-10-24-before-realign.md#L1715) |
| R408 | — | 未完成 | 待认领 | P28.1 — DB migration：4 张产物表各加 `reviewed_at TIMESTAMPTZ` | [归档 L1719](./archive/ROADMAP-2026-10-24-before-realign.md#L1719) |
| R409 | — | 未完成 | 待认领 | P28.2 — 执行看板顶部「📥 待处理」收件箱区域 UI（聚合查询 + 时间倒序） | [归档 L1720](./archive/ROADMAP-2026-10-24-before-realign.md#L1720) |
| R410 | — | 未完成 | 待认领 | P28.3 — 收件箱条目点击展开 + 「标记已读」动作（PATCH reviewed_at） | [归档 L1721](./archive/ROADMAP-2026-10-24-before-realign.md#L1721) |
| R411 | — | 未完成 | 待认领 | P28.4 — 「发送到看板」后写入 reviewed_at=NULL（已是默认，确认 reels_drafts 行为） | [归档 L1722](./archive/ROADMAP-2026-10-24-before-realign.md#L1722) |
| R412 | — | 未完成 | 待认领 | P28.5 — 收件箱 badge 计数：侧边栏「执行看板」入口显示未读数 | [归档 L1723](./archive/ROADMAP-2026-10-24-before-realign.md#L1723) |
| R420 | — | 未完成 | 客服构建控制 | 首呼后校准 `mapRealtimeEvent`（需真呼一次才知实际事件名） | [归档 L1737](./archive/ROADMAP-2026-10-24-before-realign.md#L1737) |
| R421 | — | 未完成 | 客服构建控制 | 0. 真机 spike（验 verbatim 哑巴模式，最先做 · 1d）— 决定后 3 周走法 | [归档 L1738](./archive/ROADMAP-2026-10-24-before-realign.md#L1738) |
| R422 | — | 未完成 | 客服构建控制 | 1. 真实外呼发起（现为 mock stub，provider 真拨号 API · 2–3d） | [归档 L1739](./archive/ROADMAP-2026-10-24-before-realign.md#L1739) |
| R423 | — | 未完成 | 客服构建控制 | 2. 浏览器↔通话实时通道（SSE 下行 + POST 上行 · 3–4d） | [归档 L1740](./archive/ROADMAP-2026-10-24-before-realign.md#L1740) |
| R424 | — | 未完成 | 客服构建控制 | 3. operator 编排层（STT→翻译/KB→注入 · 3–4d） | [归档 L1741](./archive/ROADMAP-2026-10-24-before-realign.md#L1741) |
| R425 | — | 未完成 | 客服构建控制 | 4. bridge 改造（逐字朗读 + 哑巴模式 + 垫场 · 4–6d） | [归档 L1742](./archive/ROADMAP-2026-10-24-before-realign.md#L1742) |
| R426 | — | 未完成 | 客服构建控制 | 5. 操作台 UI（纯语音，双语字幕+模式开关+价格确认+kill switch · 4–5d） | [归档 L1743](./archive/ROADMAP-2026-10-24-before-realign.md#L1743) |
| R427 | — | 未完成 | 客服构建控制 | 6. 操作员语音转文字 STT 接入（1–2d） | [归档 L1744](./archive/ROADMAP-2026-10-24-before-realign.md#L1744) |
| R428 | — | 未完成 | 客服构建控制 | 7. 安全（通道租户鉴权 + kill switch + 掉线兜底 · 2–3d）+ 狄仁杰攻击验证 | [归档 L1745](./archive/ROADMAP-2026-10-24-before-realign.md#L1745) |
| R429 | — | 未完成 | 客服构建控制 | 8. 填充语/轮次管理/快捷话术打磨（2–3d） | [归档 L1746](./archive/ROADMAP-2026-10-24-before-realign.md#L1746) |
| R430 | — | 未完成 | 客服构建控制 | 9. 合规（披露脚本 + DNC + 录音，过法务 · 1–2d + 法务） | [归档 L1747](./archive/ROADMAP-2026-10-24-before-realign.md#L1747) |
| R432 | — | 未完成 | 客服构建控制 | CRM adapter（接外部 CRM，现只内置权威） | [归档 L1749](./archive/ROADMAP-2026-10-24-before-realign.md#L1749) |
| R433 | — | 未完成 | 客服构建控制 | 全自动外呼 campaign（批量）+ suppression 逻辑 | [归档 L1750](./archive/ROADMAP-2026-10-24-before-realign.md#L1750) |
| R434 | — | 未完成 | 客服构建控制 | 生产级知识库（OpenAI 向量库语义检索，替代关键词版） | [归档 L1751](./archive/ROADMAP-2026-10-24-before-realign.md#L1751) |
| R435 | — | 未完成 | 待认领 | 待办 1：实际发送 —— 严格等 PM 逐家或批量明确说"发"，不自动发送 | [归档 L1765](./archive/ROADMAP-2026-10-24-before-realign.md#L1765) |
| R436 | — | 未完成 | 待认领 | 待办 2：`generatePersonalizationLines()`（AI 调用路径）尚未在生产环境验证可用，目前 wave-1 草稿的两句个性化文案是人工按同一套规则手写的，不是 AI 生成的——下一批候选建议先确认 API key 可用再接上自动生成 | [归档 L1766](./archive/ROADMAP-2026-10-24-before-realign.md#L1766) |
| R437 | — | 未完成 | 待认领 | 待办 3：回复分类 + follow-up 调度 + admin 审批 UI（spec §16-17）尚未实现，这一轮范围只到"草稿就绪待审" | [归档 L1767](./archive/ROADMAP-2026-10-24-before-realign.md#L1767) |
| R438 | — | 未完成 | 待认领 | 待办 4：Meta 官方 Partner Directory 需要登录态才能核验，公开调研工具查不到——8 家 Meta 候选全部卡在 unverified；如果 PM 有 Meta Business 账号登录态,可以人工核一遍这批公司 | [归档 L1768](./archive/ROADMAP-2026-10-24-before-realign.md#L1768) |
| R444 | — | 未完成 | 待认领 | #1273 [风险 B] AI 单页站生成器 —— 免费档与 $39 档的第一块砖。 | [归档 L1792](./archive/ROADMAP-2026-10-24-before-realign.md#L1792) [#1273](https://github.com/bigbigraydeng-maker/magic-engine/issues/1273) |
| R445 | — | 未完成 | 待认领 | #1274 [风险 A] 免费档 —— 认领、隔离与永不删除的生命周期。免费站边界：永久能用能发链接，但 noindex 不收录 + 带 ME 角标 + 无邮箱 + 无自有域名 —— 这四条正是 $39 档的卖点。 | [归档 L1797](./archive/ROADMAP-2026-10-24-before-realign.md#L1797) [#1274](https://github.com/bigbigraydeng-maker/magic-engine/issues/1274) |
| R446 | — | 未完成 | 待认领 | #1275 [风险 A] $39 订阅与四项解锁 —— 用 Stripe Billing，禁止自建订阅状态机（承接 #1122 的 Build Control 决议）。$39 含自有域名 + 公司邮箱 1 个，第 2 个起 $9/月/箱。`src/types/magic-engine.ts:7` 的… | [归档 L1798](./archive/ROADMAP-2026-10-24-before-realign.md#L1798) [#1275](https://github.com/bigbigraydeng-maker/magic-engine/issues/1275) [#1122](https://github.com/bigbigraydeng-maker/magic-engine/issues/1122) |
| R447 | — | 未完成 | 待认领 | #1276 [风险 A] 扫街预建站管道 —— 先把网站做好再去谈。口径：不公开 · 一商家一链接 · 只用公开事实 · 不用商家照片和 logo。 | [归档 L1799](./archive/ROADMAP-2026-10-24-before-realign.md#L1799) [#1276](https://github.com/bigbigraydeng-maker/magic-engine/issues/1276) |

### NAL 暂停（15）

2026-10-24：企业验证只做 CTS，NAL 暂停。下面是 NAL 专属的投放、私信回传、WhatsApp 和素材决定。平台规则里顺便提到 NAL 的（币种列、结果阶梯配置、两家客户共用的开关）留在未完成清单，并注明不要为 NAL 单独开工。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R104 | — | 待 PM 决定 | 马良 | NAL（New Asian Logistics，物流客户）首次接入视频工厂——PM 拍板"先用现有真实素材做1图1视频"，2026-09-13 已完成（真实素材取自 NAL 自己的 Facebook 主页，走 ffmpeg 本地合成，未走 Creatomate，NAL 没有专属模板）。素材偏薄（只有… | [归档 L474](./archive/ROADMAP-2026-10-24-before-realign.md#L474) |
| R108 | — | 未完成 | 客服构建控制 | PM/FDE 决定要不要开始审核这 20 条 `pending_review` 记录、要不要切到真发送 | [归档 L532](./archive/ROADMAP-2026-10-24-before-realign.md#L532) |
| R109 | — | 未完成 | 客服构建控制 | 编排层目前每次全量重扫该客户全部历史消息（无增量游标），今天 186 段对话（最长 102 | [归档 L533](./archive/ROADMAP-2026-10-24-before-realign.md#L533) |
| R110 | — | 未完成 | 客服构建控制 | 对话没有关联联系人的情况目前生产库实测 0 个，代码已加 `skippedNoContact` 计数防呆， | [归档 L536](./archive/ROADMAP-2026-10-24-before-realign.md#L536) |
| R111 | — | 未完成 | 卫青 | 观察本周"打开对话"数量能不能回到并超过健康期 9.6次/天水平，单次对话成本有没有明显上涨 | [归档 L577](./archive/ROADMAP-2026-10-24-before-realign.md#L577) |
| R112 | — | 未完成 | 卫青 | PM 待决定：Audience Network 这个零效果的投放位置要不要关掉（不花新钱，纯粹省掉浪费） | [归档 L579](./archive/ROADMAP-2026-10-24-before-realign.md#L579) |
| R113 | — | 未完成 | 卫青 | PM 待决定：一直停着的"3PL"留资表单系列（纽澳都投，不只新西兰）要不要小额重新测试， | [归档 L580](./archive/ROADMAP-2026-10-24-before-realign.md#L580) |
| R114 | — | 未完成 | 卫青 | 第二步加码（私信线/WhatsApp线继续加预算）视本周数据决定，不会自动往下涨 | [归档 L582](./archive/ROADMAP-2026-10-24-before-realign.md#L582) |
| R116 | — | 已下发 PM 待办 | 卫青 | （已下发今日待办）PM/FDE 去 Meta Business 后台给系统用户加 `whatsapp_business_management` | [归档 L623](./archive/ROADMAP-2026-10-24-before-realign.md#L623) |
| R117 | — | 已下发 PM 待办 | 卫青 | （已下发今日待办，同一条里已把 `META_VERIFY_TOKEN` / `META_APP_SECRET` 配置一起带上） | [归档 L625](./archive/ROADMAP-2026-10-24-before-realign.md#L625) |
| R118 | — | 未完成 | 卫青 | PM/FDE 在 Render 后台把 `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` | [归档 L629](./archive/ROADMAP-2026-10-24-before-realign.md#L629) |
| R119 | — | 未完成 | 卫青 | #1299 企业验证走完，再确认线上真的开始收到 WhatsApp 消息 | [归档 L631](./archive/ROADMAP-2026-10-24-before-realign.md#L631) |
| R120 | — | 未完成 | 客服构建控制 | PM/FDE 决定要不要开始审核这批新记录、要不要切到真发送 | [归档 L657](./archive/ROADMAP-2026-10-24-before-realign.md#L657) |
| R121 | — | 未完成 | 客服构建控制 | 技术债（不影响当前正确性）：`WON_STAGE_KEY` 目前写死对应 NAL 今天的阶段配置，跟 | [归档 L658](./archive/ROADMAP-2026-10-24-before-realign.md#L658) |
| R130 | — | 未完成 | 客服构建控制 | NAL（New Asian Logistics，client_id （客户编号见归档）） | [归档 L803](./archive/ROADMAP-2026-10-24-before-realign.md#L803) |

### 未排期，或原文写明先别做（4）

R036 是未排期的内部连接评估。R239、R452 跟语音外呼是同一条线，和 Phase 36 一起冻。R478 是谷歌搜索广告的工作节奏，PM 2026-10-09 已说归广告支柱，并且 SEO 第一阶段跑起来之前不开工。

| ID | 优先级 | 状态 | 负责人 | 事项 | 依据 |
|---|---|---|---|---|---|
| R452 | P3 | 未完成 | 语音（冻结） | [P3] `voice/finalize.ts:131-137` 账户没钱时仍然安静回落 mock。 | [归档 L1835](./archive/ROADMAP-2026-10-24-before-realign.md#L1835) |
| R036 | —（未打分） | 仅登记，不排期 | 子牙 | Meta Social Technologies MCP 内部工程助手：评估资格/Read 覆盖/与现有 Connector 的边界 | [归档 L289](./archive/ROADMAP-2026-10-24-before-realign.md#L289) |
| R239 | — | 未完成 | 语音（冻结） | [三位 agent 复审剩下的（2026-08-05，已修的不] P35.9 AI 语音外呼（PM 指定方向 2026-07-06）：ElevenLabs Conversational AI / Bland.ai / Vapi 选型 PoC。用途分级：warm 跟进优先（邮件已回复/未接来电回拨），cold ca… | [归档 L1282](./archive/ROADMAP-2026-10-24-before-realign.md#L1282) |
| R478 | — | 未完成 | 卫青 | [待排] 谷歌搜索广告（SEM）专家工作节奏设计（PM 2026-10-09 拍板与 SEO 分开管理，归广告支柱；SEO 第一阶段跑起来后再排，不开工）。SEO 设计稿 §12 已定义两边「对表」接口；台账卡 `2026-10-09-sem-expert-rhythm-design-todo` | [归档 L1916](./archive/ROADMAP-2026-10-24-before-realign.md#L1916) [docs/specs/2026-10-08-seo-…](./specs/2026-10-08-seo-lead-operating-rhythm-v0.1.md) |

---

## 已完成 / 已作废（本次清理）

共 47 条。已完成 42（其中盘点标为「代码已在或模块已删」的 31 条，另加 2026-10-24 核查判定做完的 11 条）。已作废 4 条。定案更正 1 条（R003）。

### 已完成

| ID | 处置 | 原优先级 | 证据 |
|---|---|---|---|
| R002 | 已完成，移出未完成清单 | P2 | 已完成。main 上有 `src/lib/maliang/render-check.ts`、`libai-copy-provenance.ts`、`libai-prompt-library-monthly.ts`、`simaqian-reputation-weekly.ts`。 |
| R006 | 已完成，移出未完成清单 | P0 | 已完成。2026-10-24 核查：PR #2733 已按客户区分成功 / 挡住 / 失败，生产近两天该任务不再轮轮失败。本次未重查生产库。 |
| R017 | 已完成，移出未完成清单 | P1 | 已完成。2026-10-24 生产只读核查：写客户表的定时任务在跑，表头校验会拦住列不对的写入。本次未重查生产库。 |
| R018 | 已完成，移出未完成清单 | P1 | 已完成。同上，写表成功，说明表格修改权限已经授过。本次未重查生产库。 |
| R019 | 已完成，移出未完成清单 | P1 | 已完成。2026-10-24 生产只读核查：`client_lead_sheet_routes` 与种子数据已在库。同日较早的盘点曾写未应用，以较晚这次为准。本次未重查生产库。 |
| R020 | 已完成，移出未完成清单 | P1 | 已完成。写表任务已在 Inngest 上跑过，同步这一步已经发生。本次未重查生产库。 |
| R031 | 已完成，移出未完成清单 | P0 | 已完成。2026-10-24 核查：生产已有 `fix_kernel_claim_reclaim_count_ambiguity` 与 `fix_kernel_claim_run_step_attempt_ambiguity`，函数里用的是步骤上的 attempt。本次未重查生产库。 |
| R032 | 已完成，移出未完成清单 | P0 | 已完成。2026-10-24 核查：生产 `action_runs` 有成功记录，认领执行这条链路跑通过。本次未重查生产库。 |
| R055 | 已完成，移出未完成清单 | P0 | 已完成。main 有 `src/lib/inngest/functions/ads-autonomy-sync.ts`，并调用 `ads_sync_autonomy_policy`。 |
| R115 | 已完成，移出未完成清单 | — | 已完成。仓库有 `supabase/migrations/20260902000002_whatsapp_phone_number_id.sql`。2026-10-24 核查称生产已于 2026-09-27 应用。本次未重查生产库。 |
| R125 | 已完成，移出未完成清单 | — | 已完成。草稿批准在 `src/app/dashboard/clients/[id]/messenger/_components/DraftApprovalPanel.tsx`，含「改后发送」。不再是只能改数据库。 |
| R168 | 已完成，移出未完成清单 | P1 | 已完成。`src/lib/linkedin-progress/` 不在仓库。 |
| R169 | 已完成，移出未完成清单 | P2 | 已完成。随 LinkedIn 进展模块一起不在仓库。 |
| R277 | 已完成，移出未完成清单 | — | 已完成。2026-10-24 盘点称 Supabase 连接已能访问本项目。本次未重测连接。 |
| R284 | 已完成，移出未完成清单 | — | 已完成。`src/lib/messenger/brief-client-facts.ts` 不在仓库。 |
| R314 | 已完成，移出未完成清单 | — | 已完成。`supabase/migrations/20260606000001_execution_items_zhuge_source.sql` 在仓库。 |
| R315 | 已完成，移出未完成清单 | — | 已完成。`src/lib/zhuge/action-persister.ts` 有 `writeExecutionItems`。 |
| R316 | 已完成，移出未完成清单 | — | 已完成。`src/lib/zhuge/__tests__/action-persister.test.ts` 与 `execution-items-writer.test.ts` 在仓库。 |
| R317 | 已完成，移出未完成清单 | — | 已完成。`src/app/api/cron/zhuge-recalculate/route.ts` 在仓库。 |
| R318 | 已完成，移出未完成清单 | — | 已完成。日程在 `catalog.ts` 的 `zhuge-weekly-recalculate`，由 3 个调度入口触发（PR #3071），不再单独占一条旧定时服务。 |
| R319 | 已完成，移出未完成清单 | — | 已完成。`src/app/dashboard/geo-composer/[clientId]/_components/DeploymentForm.tsx` 在仓库。 |
| R320 | 已完成，移出未完成清单 | — | 已完成。路由在 `src/app/api/clients/[id]/cms/publish-geo-snippet/route.ts`。 |
| R354 | 已完成，移出未完成清单 | — | 已完成。自助入口 `src/app/api/onboard/self/route.ts` 在仓库。本段 Phase 25 页面一并核对。 |
| R355 | 已完成，移出未完成清单 | — | 已完成。同上，`POST /api/onboard/self` 路由在仓库。 |
| R356 | 已完成，移出未完成清单 | — | 已完成。Phase 25 清单对应的门户页面已在仓库（发现 / 诊断 / 处方 / 计划）。 |
| R357 | 已完成，移出未完成清单 | — | 已完成。`src/app/portal/[clientId]/discovery/page.tsx` 在仓库。 |
| R358 | 已完成，移出未完成清单 | — | 已完成。门户发现页已在，原「加摘要卡」属于已落地页面的后续打磨，清单本身按已落地移出。若摘要卡仍缺，从归档加回。 |
| R359 | 已完成，移出未完成清单 | — | 已完成。发现页已进门户路由。导航文案若仍缺，从归档加回，不单独立项。 |
| R360 | 已完成，移出未完成清单 | — | 已完成。`src/app/portal/[clientId]/diagnosis/page.tsx` 在仓库。 |
| R361 | 已完成，移出未完成清单 | — | 已完成。`src/app/portal/[clientId]/prescription/page.tsx` 在仓库。 |
| R362 | 已完成，移出未完成清单 | — | 已完成。`src/app/portal/[clientId]/plan/page.tsx` 在仓库。 |
| R379 | 已完成，移出未完成清单 | — | 已完成。`src/lib/creatomate/` 客户端、渲染与 `src/app/api/webhooks/creatomate/route.ts` 已在仓库。原「立项待开发」清单过期。 |
| R380 | 已完成，移出未完成清单 | — | 已完成。Connector 代码已落地，原「先审再动」的门槛已过。 |
| R381 | 已完成，移出未完成清单 | — | 已完成。`src/lib/creatomate/client.ts` 在仓库。 |
| R382 | 已完成，移出未完成清单 | — | 已完成。模板参数在 `src/lib/creatomate/modifications.ts` 一带。若某个具体客户模板仍缺，从归档按客户加回，不保留整段立项清单。 |
| R383 | 已完成，移出未完成清单 | — | 已完成。渲染编排在 `src/lib/creatomate/render.ts` 与 webhook。 |
| R384 | 已完成，移出未完成清单 | — | 已完成。端到端代码路径已在。某一次客户场景联调若没留回执，不把整段立项重新打开。 |
| R386 | 已完成，移出未完成清单 | — | 已完成。`supabase/migrations/20260728144156_client_audience_assets.sql` 在仓库。策略写成了 `FOR ALL USING (true)`，没有 `TO service_role`。条目按「表已建」移出；这个策略形状记在「需要 PM 拍板」，本次不改库。 |
| R413 | 已完成，移出未完成清单 | — | 已完成。`src/app/dashboard/clients/[id]/brief` 在仓库。 |
| R414 | 已完成，移出未完成清单 | — | 已完成。`BriefGateBanner` 已被客户工作台、计划、执行等页面引用。 |
| R451 | 已完成，移出未完成清单 | P3 | 已完成。`src/lib/messenger/brief.ts` 已改用 `getOpenAIClient`，不再自己 `new OpenAI()`。 |
| R488 | 已完成，移出未完成清单 | P3 | 已完成。`registry.ts` 里两条日程已改；排班现以 `src/lib/cron/dispatch/catalog.ts` 为准（PR #3071）。`render.yaml` 只剩 3 个调度入口。 |

### 已作废

| ID | 处置 | 原优先级 | 证据 |
|---|---|---|---|
| R013 | 已作废，移出未完成清单 | —（记账） | 已作废。原文写明不单独开工。那 12 条是 9 月传出的转化，归因窗口已过，撤回没有意义。 |
| R030 | 已作废，移出未完成清单 | P2 | 已作废。这是查 9 月 23 日当天没写上数据的一次性调查。该任务现为每周一 16:30 UTC（`catalog.ts` 的 `industry-ai-visibility-daily`），前提「每天跑不完」已不成立。 |
| R034 | 已作废，移出未完成清单 | P3 | 已作废。原文写了现网没有 UTC+7/+8 账户就别做。2026-10-24 核查近 14 天账户时区里没有这两个时区。 |
| R066 | 已作废，移出未完成清单 | P0 | 已作废（待你认）。PR #2830 已把熔断探针只读接进日任务。PR #2860（未合并，纯文档）写明账本和韩信函数不做。正式作废以 #2860 合并或你一句确认为准。 |

### 定案更正

R003 仍不在未完成清单里，也不加回近期。更正的是作废理由。

| ID | 处置 | 原优先级 | 证据 |
|---|---|---|---|
| R003 | 定案更正，仍移出未完成清单，不另开工 | P2 | 2026-10-24 19:55 NZDT，Ray 原话：「普通改动机器自动合并。」先前把本条标作废，依据是「现行 PR 不自动合并」。这句依据作废。普通改动自动合并与仓库现有合并规则一致，不取消。本次不改合并规则文件。三人签字后的自动写入仍按原文等广告跑稳两周（同 R004、R005），不因此把本条加回近期。GitHub Actions 自 2026-10-18 起因账单锁定，审查流当时没在跑。定级接线 PR #2157 仍开着，本次不处理。 |

