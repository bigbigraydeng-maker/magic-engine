# 现有能提交到内核 / 能动 Meta 广告的入口清单（只读 · 2026-10-20）

给 18 号转 PM。只读：读代码 + 生产库。范围＝**Meta 广告**（CTS / NAL 用的）；TikTok / Google 的执行路由只在最后列名，不展开。

## 一句话
**能动 Meta 广告的入口一共有 4 类：①人在 ME 页面点（经内核 / 不经内核两种）②D3 自动暂停（演练模式，不动手）③系统里的"每日任务 / 事件"（不动广告设置）④完全在 ME 之外的 Meta 官方工具。真正"不经内核、直接写 Meta"的有 3 处，其中一处正是 PM"开投"要走的按钮。**

## A. 经内核的入口（过授权 + 信封 + 回读验证 + 留 action_runs）

| # | 入口 | 谁能触发 | 提交的动作 | 信封 | 现状（实证） |
|---|---|---|---|---|---|
| A1 | `POST /api/clients/[id]/ad-health/stop-loss`（页面「先全停」「预算降 20%」） | 付费客户权限里的操作员（路由校验 `requireStopLossAccess`） | `ads.pause_campaign` / `ads.cut_campaign_budget` / `ads.cut_unit_budget` | **人工止损信封**（不查 72h、学习期、日上限，只收不放） | 2026-10-19 修了 act_ 账户号缺陷（PR 2889）；2 条空操作成功记录；**不写 flywheel_actions**（P3 卡） |
| A2 | `POST /api/clients/[id]/meta-ads/execute`，`action_type=ads.adjust_bid`（仅降预算） | 同上 | `ads.cut_campaign_budget`，由 Inngest 函数 `ads-campaign-budget` 执行 | **人工止损信封**（`triggered_by=human` 且动作在白名单，同 A1；读 `ads-campaign-budget.ts` 的 `run.triggered_by !== 'human'` 校验与 `selectEnvelopeVerdict`） | 同样补了 act_（PR 2889）；上调预算直接 422 拒绝 |
| A3 | `POST /api/clients/[id]/ad-health/o1-scale`（加预算建议）+ `…/[runId]/decision`（批准） | **仅内部全局管理员** | `ads.scale_unit_budget`（固定 +20%），**必须人批准**（`requireHumanApproval:true`），批准后发事件由 `ads-o1-budget-scale` 执行 | AI 信封（含 72h 冷却、日上限） | 需要一条真实 O1 命中；NAL 目前无；**从未执行过** |
| A4 | D3 自动暂停：`ads-d3-auto-pause`（每日诊断完成事件触发）+ `…/auto-pause/[runId]/decision`（批准） | 系统（唯一的"自动提交方"） | `ads.pause_unit` | 提交后**等人批准**；开关 `autopilot_dry_run=true` 时只记 `dry_run_logged`、**不提交** | 4 个客户全是演练模式；`ads.auto_pause_on_d3` 回执 0 行 |
| A5 | 后台"通用审批页"`/dashboard/kernel-approvals` | 内部 | 只**签字**，不执行 | — | 台账已记：通用审批只签不执行（内核 WP07 未建） |

策略表（`client_automation_policies`）：CTS、NAL 的 **9 个 `ads.*` 全是 `auto_approve`**——意思是：**只要有入口把动作提交进内核、过了信封，就直接执行，不再等人点批准**（A3/A4 例外，它们在提交时强制要求人批准）。

## B. ⚠️ 不经内核、直接写 Meta 的入口（没有授权闸、没有回读验证）

| # | 入口 | 做什么 | 保护 | 备注 |
|---|---|---|---|---|
| B1 | `POST /api/clients/[id]/meta-ads/execute`，`action_type=ads.pause_campaign` | **直接**调 `setCampaignStatus(…,'PAUSED')` | 登录 + 归属校验（AD-SEC-1）；写 `flywheel_actions` 留 before/after | 与 A1 的区别：**不过内核** |
| B2 | 同路由 `action_type=ads.reactivate_campaign` | **直接**调 `setCampaignStatus(…,'ACTIVE')`——**这就是"把停着的系列开起来"** | **仅全局管理员（PM）**（`requireSpendActivationAuthority`）；Meta 调用**之前**必须先写好回执，写不进就不调（503）；ME 自己建的 Messenger 草稿系列会被拒 | **PM 开投若走 ME 页面，走的就是这条**——不经内核、不过信封、不受 72h / 日上限约束，只受上面几条保护。这是**已知、有意的设计**（台账 `2026-10-06-ads-reactivate-pm-only-fail-closed`：仅 PM、回执写不进就不调 Meta），不是新发现的洞 |
| B3 | 胜出 Reel 同步 `winner-reel-sync`（页面「补新素材」一键处方 `execute-prescription`、以及按配置的任务） | 往**配置里写死的那一个广告组**加新广告，**默认 PAUSED** | 默认暂停 + 一组守卫 | 台账已有卡（`winner-reel-sync-bypasses-kernel`）；对这次测试，先查它挂的广告组是否在投 |

## C. 完全在 ME 之外
- **Meta 官方 MCP 工具 / 广告管理器**（`ads_create_campaign`、`ads_update_entity` 等）：任何接了这些工具的 Claude 窗口或真人都能直接建、改、开广告，**ME 的授权、信封、回执都看不到**。74 号建 A 方案草稿走的就是这条。**这既是好用的出路，也是治理上的最大缺口**：ME 只能在下一次每日抓取（快照）里"事后发现"改动，没有实时拦截。

## D. 其它平台（不展开）
`POST …/tiktok-ads/execute`、`…/google-ads/execute` 同样直接写各自平台，不过内核；与本次 CTS / NAL 的 Meta 测试无关，只列名。

## 对本次测试的含义（只陈述事实，不提新功能）
1. 开投期间 **"Agent 自己动手"的路径是关着的**（A4 演练模式；A3 需要真实 O1 命中且人批准）。能动广告的只有人
2. **PM 开投的按钮若走 ME（B2）**，这一步**不经内核**——它没有信封保护，也不会产生 `action_runs` 记录，观测要靠 `flywheel_actions` 回执与 Meta 实时读；若走广告管理器（C），ME 里什么记录都没有
3. 开投后"人点止损"（A1）是经内核的；所以 T3–T5 那套回执只覆盖 A 类，**覆盖不到 B、C**
4. 急停：B2/C 没有 ME 侧刹车，刹车是人在 Meta 里暂停；A 类参见《急停调查》
