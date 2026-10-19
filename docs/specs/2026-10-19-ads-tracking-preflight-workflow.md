# 广告发布前「追踪与环境就绪」检查工作流（Inngest 监督）· 2026-10-19 · 统筹

PM 要求（10-19）：本次广告投放前，检查官网 Meta 数据集/像素、CAPI、GA4 等配套与工作环境，写成工作流，并由 Inngest 负责监督实施。本稿是该任务的唯一权威说明；依据 10-19 只读盘点（官网仓库 origin/main 047fb7b + 线上 6 页 + Meta 官方接口）。

**风险级别：B**（只读检查 + 新 Inngest 函数 + 扩展 promo/gates；不写 Meta、不发布、不改官网）。**A 级部分单列在第 6 节，不在本任务内。**

## 1. 目标 / 验收 / 不做
- 目标：任何一次广告开投前（及开投后 T+1h、T+24h），机器自动读出追踪与环境是否就绪，给出每项「绿/黄/红/灰」和证据，红灯变成人能照做的待办，全程有回执，不靠记忆。
- 验收：①函数在 Inngest 注册并按计划触发；②对 CTS 官方账户当场试跑一次，拿到真实回执（第 5 节）；③硬门红灯时今日待办出现「做什么/怎么做/直达链接」三件套；④36 小时没有新回执，这一项显示灰（不是绿）。
- 不做：不写 Meta/GA4/官网；不装 GTM；不做网站端 CAPI（第 6 节）；不改投放计划与预算；不自动开投。

## 2. 检查清单（门）
每项：怎么读（只读）｜怎么算绿｜硬/软。硬门红 = 不该开投。
| 门 | 怎么读 | 绿 | 类 |
|---|---|---|---|
| tracking.account_dataset_aligned 官方账户的数据集=官网像素=ME 回传目标 | Meta 数据集列表（官方账户）；官网 HTML 的 noscript 像素编号；ME 运行时 env 中 CAPI 目标像素编号（只比对，不输出值） | 三者含同一数据集编号 | 硬 |
| tracking.pixel_alive 像素在线 | 数据集 last_fired_time、近 24h PageView 条数 | 24h 内有触发且 PageView>0 | 硬 |
| tracking.lead_event_seen 留资事件 | 数据集近 7 天事件统计 Lead | ≥1（试跑提交算） | 硬 |
| tracking.lead_event_quality 留资质量 | 数据集匹配质量（若接口可读）；Lead 是否带占位 value | 匹配质量≥7；占位 value 记黄 | 软 |
| tracking.ga4_events GA4 收到事件 | GA4 Data API（复用 ga4/client）读近 7 天 generate_lead、enquiry_thank_you | 两者>0 | 软 |
| tracking.landing_ok 落地页可用 | 取计划里每条广告的最终落地地址：状态 200、跳转后 UTM 保留、含像素标记 | 全部通过 | 硬 |
| tracking.lead_reaches_crm 线索进 CRM | 官网表单提交→CRM 可见（依赖 CRM 网站表单入库；未上线前记红并说明） | 试跑线索 1 小时内进 CRM | 硬 |
| tracking.capi_ready 回传可用 | 复用 CAPI preflight（令牌有效、像素可见）+ 近 7 天成功/不明/失败数 | preflight 绿且失败率可解释 | 软 |
| env.token_and_crons 环境 | 令牌健康；meta-leads-hourly、mailbox-sync 最近回执 ≤3h；Inngest 函数已登记 | 全部在期 | 硬 |
| env.account_billing 广告账户 | 账户状态、付款方式、花费上限 vs 计划日预算 | ACTIVE、有付款方式、上限≥计划 | 硬 |
| post.t1h / post.t24h 开投后读回 | 点击数 vs 落地页浏览数（比例）、留资数、花费 | 比例≥合理下限、无零事件 | 开投后 |
灰灯（没读到/没证据）永不等于绿，也不等于 0。

## 3. Inngest 监督（硬约束，见 CLAUDE.md「Inngest 工作流硬约束」）
- 函数：`cloud-ads-tracking-preflight`（登记到 inngest/functions/index.ts，去 Inngest 后台 Sync）。范本：`promo-plan-daily-watch.ts`（cron + 事件双触发、回执写法、36 小时没更新喊"没在跑"）。
- 触发：①每天 NZ 07:10（直到计划开投日）；②事件 `ads.tracking_preflight.requested`（人手/开投前 T-24h、T-2h 的定时叫醒）；③开投后 T+1h、T+24h（`ads.tracking_postlaunch.requested`）。
- 步骤各自 `step.run`、retries 2，失败收尾不吞：读 Meta 数据集（Graph 接口，复用 META_SYSTEM_USER_TOKEN 家族 env，只读）→读 GA4（复用 ga4/client）→探落地页（fetch）→环境（CAPI preflight、cron_run_logs、env 存在性比对）→汇总。
- 回执（机器可读）：`{request_id, client_id, checked_at, overall, gates:[{key,status,reason,how,evidence,as_of,hard}], no_publish:true}`；用 `inngest.send({id:request_id, name:'ads.tracking_preflight.checked'})` 发出，并写 `cron_run_logs.summary`（沿用 WatchReceipt 形状，不另起一套）。
- 红灯去向：门状态写入 `promo/gates.ts`（新增 tracking.* 键，复用灯色与分硬/软门），推广计划看板与开投签字页可见；硬门红 → 今日待办「🙋 需要你动手」三件套（what 问题和影响 / how 具体怎么做 / href 直达）；属于开发活的（改官网代码、改 env）只发给开发窗口，不塞给 PM（今日待办只留 5 类）。
- fail-closed：没有回执或回执过期 → 灰；任何「发布/扣费/外发」动作的授权不得由本检查的绿灯代替，绿灯只是前置条件之一。

## 4. 复用声明（Reuse Statement）
- 复用：promo-plan-daily-watch（Inngest 范本与回执）、promo/gates.ts（门）、meta/capi preflight、ga4/client、manual-cron-trial.yml（当场试跑）、今日待办三件套。
- 新增（平台共享，L1 基础设施，归 Measurement Contract/Verification）：Meta 数据集只读读取器（last_fired、事件统计）、落地页探测、tracking.* 门、检查函数。检查本身不含客户或行业判断。
- 行业/客户差异只进配置：像素编号、GA 属性、落地地址、日预算上限、门是否适用（L4 客户配置），不写进共享代码。
- 换客户测试：换成 NAL/Roman/悉尼地产，函数不用改，只改该客户的配置；用到「官网表单→CRM」的门，没有官网表单的客户记灰（不适用）。

## 5. 当场试跑（交付前必做，不许只靠单测）
部署后对 CTS 官方账户触发一次 `ads.tracking_preflight.requested`（经管理入口或 manual-cron-trial，默认只读），贴真实回执：每个门的状态与证据、cron_run_logs 的一行、今日待办里红灯的三件套截图。回执里不得出现任何令牌值。

## 6. 本任务之外（A 级或需 PM 同意，各自单开）
- 官网服务端 CAPI（询盘提交时同时发服务器事件，带 fbp/fbc/event_id 去重）：新增令牌、向 Meta 外发客户数据，A 级。
- 把 ME 的 CAPI 回传目标对齐到官方账户的数据集（改生产环境变量）：写生产配置，需 PM 同意并手动重新部署。
- 官网事件修复（Lead 占位 value、/thank-you 一打开就记 Lead、Subscribe 没价格、转发 fbclid、补 ViewContent）：官网仓库 B 级小 PR，交 121 号窗口。
- 不装 GTM：容器编号在构建里，但组件没渲染，现有直发 gtag 的事件够用；Meta 里「连接跟踪代码管理器」不要点发布。

## 7. 现状快照（10-19 盘点，待工作流第一次回执替换）
绿：像素在线（今天仍在触发）、留资事件匹配质量 9.3、官方账户 ACTIVE 且有付款方式。
黄：Subscribe 无价格/货币；Lead 恒为 1 NZD 占位；官网没有服务端 CAPI；数据集错位风险（官网同时发两个数据集，ME 回传目标疑似另一个）。
灰（没证据）：GA4 近 7 天是否真收到事件、ME 回传目标的当前值。
红：官网表单线索进不了 CRM（76 号在修）。
