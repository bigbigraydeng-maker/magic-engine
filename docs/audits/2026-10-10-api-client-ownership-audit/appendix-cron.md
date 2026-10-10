# 附录 · 定时任务（逐接口明细，原始清查输出）

> 来源：66号窗口只读清查，2026-10-10。路径省略 `src/app/api` 前缀。分类 A=归属守卫已覆盖 B=仅登录 C=无守卫 D=自定义校验 E=仅管理员。

# 66号 · cron 清查结果（src/app/api/cron/** 共 70 个文件 / 80 个 handler）

## 一、共享校验函数
没有。**不存在共享的 cron 校验函数**，70 个文件各自内联写一遍：读 `Authorization: Bearer ${CRON_SECRET}`（部分 POST 用 `x-cron-secret` 头）。middleware 不覆盖 /api/*。没有任何一个 cron 路由使用登录态(requireSession/守卫)，没有任何一个读 URL 里的 `?secret=`。

## 二、核心发现：密钥环境变量没设时是放行还是拒绝
- **拒绝(fail-closed)**：49 个文件的全部 handler 先判断 `CRON_SECRET` 是否存在(不存在→500 或 401)，再比对。
- **放行(fail-open，类别 C)**：**21 个文件**(下表标 ⚠)写成 ``if (header !== `Bearer ${process.env.CRON_SECRET}`)``，**密钥未设时比较目标变成字面量 `Bearer undefined`，任何人带 `Authorization: Bearer undefined` 即可触发**。代码库里 diagnostic-weekly / prescription-weekly 已经因此改过并留注释，这 21 个没跟上。
- 现实可利用性：生产 web 服务现已配 CRON_SECRET(代码注释多处证实 cron 调用会 401)，所以**当前不可被匿名利用**；风险在于「新环境/预览环境/换密钥时漏配」就裸奔，并且无任何测试兜底。严重度按“漏配时的后果”标。
- 另：所有 cron 都用 `!==` 非定长比较(时序攻击理论风险，极低，不报修)。

## 三、请求里的 client_id 是否被信任
以下 cron 路由接受 `client_id` 参数，但**全部在 CRON_SECRET 校验之后**，只有持密钥者(Render 定时器/PM 手动)能用，不是越权口子：attribution、memory-extractor、flywheel-seo-weekly、seo-weekly-list、seo-meta-cycle-trigger(body.client_id)。登录用户、陌生人都碰不到。其余 cron 不读请求里的客户号(自己遍历库里客户)。

## 四、逐 handler 表
类别：D=cron 密钥校验(本目录通用类别；其中 fail-closed 记 D，fail-open 记 C)。读写删列只写主要动作。

| 路径 | 方法 | 类别 | 读写删 | 表/外发 | 客户号来源 | 问题/风险(人话) | 严重度 | 谁能打到 | 修法 |
|---|---|---|---|---|---|---|---|---|---|
| /api/cron/ad-entity-snapshot | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/ad-entity-snapshot | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/ad-readback-sweep | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/ad-readback-sweep | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/admin-key-expiry | GET | C ⚠ | 见右 | 读 admin_api_keys，发到期提醒 | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；读 admin_api_keys，发到期提醒 | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/agent-learning-rollup | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/agent-learning-rollup | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/ai-tracker-weekly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/ai-visibility-weekly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/ai-visibility-weekly | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/anomaly-detector | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/attribution | POST | D | — | — | 请求 client_id(密钥后) | OK：先判密钥存在再比对，fail-closed；请求带 client_id，但在密钥之后，OK | — | 仅持密钥者 | — |
| /api/cron/baseline-domains-monthly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/baseline-domains-monthly | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/benchmark-accumulator | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/blog-stuck-generating | GET | C ⚠ | 见右 | 改 blog_posts 状态为 failed | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；改 blog_posts 状态为 failed | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/blog-weekly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/cms-connection-retest | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/content-factory-intake | POST | C ⚠ | 见右 | 对所有客户往内容工厂排工单(会触发后续花钱的生成) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；对所有客户往内容工厂排工单(会触发后续花钱的生成) | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/cron-run-logs-cleanup | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/cts-seo-optimizer | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/daily-cron-digest | GET | C ⚠ | 见右 | 读 cron_run_logs 并发邮件 | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；读 cron_run_logs 并发邮件 | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/demo-refresh | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/diagnostic-weekly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/email-reply-digest | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/execution-auto-run | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/factory-order-scheduler | GET | C ⚠ | 见右 | 接受/排工厂订单(余额闸门内，会花钱出片) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；接受/排工厂订单(余额闸门内，会花钱出片) | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/factory-publish-sweeper | GET | C ⚠ | 见右 | 把卡住的发布工单重置回 approved | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；把卡住的发布工单重置回 approved | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/factory-publish-worker | GET | C ⚠ | 见右 | 发布到 Facebook/Instagram/讲课片(FACTORY_PUBLISH_LIVE 未设为 true 时只出草稿) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；发布到 Facebook/Instagram/讲课片(FACTORY_PUBLISH_LIVE 未设为 true 时只出草稿) | 高(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/factory-review-sweeper | GET | C ⚠ | 见右 | 读写 Airtable 审核表，拉赢家素材 | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；读写 Airtable 审核表，拉赢家素材 | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/factory-stock-refill | GET | C ⚠ | 见右 | 已被 FACTORY_STOCK_REFILL_ENABLED 关停；打开才抓图花 Apify 钱 | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；已被 FACTORY_STOCK_REFILL_ENABLED 关停；打开才抓图花 Apify 钱 | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/factory-worker-sweeper | GET | C ⚠ | 见右 | 收回僵死工单(update content_work_orders) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；收回僵死工单(update content_work_orders) | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/flywheel-seo-weekly | GET | D | — | — | 请求 client_id(密钥后) | OK：先判密钥存在再比对，fail-closed；请求带 client_id，但在密钥之后，OK | — | 仅持密钥者 | — |
| /api/cron/goal-current-value-refresh | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/goals-expiry-check | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/google-data-pullback-daily | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/job-boards-weekly | GET | C ⚠ | 见右 | 受 JOB_SIGNAL_INGEST_ENABLED 开关控制，抓招聘信号 | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；受 JOB_SIGNAL_INGEST_ENABLED 开关控制，抓招聘信号 | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/keyword-snapshots-weekly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/kpi-backfill | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/linkedin-progress-post-mon | GET | C ⚠ | 见右 | 自动生成并发 LinkedIn 进展帖(外发) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；自动生成并发 LinkedIn 进展帖(外发) | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/linkedin-progress-post-thu | GET | C ⚠ | 见右 | 同上(周四版) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；同上(周四版) | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/mailbox-sync | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/mailchimp-activity-sync | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/mailchimp-activity-sync | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/mailchimp-paid-tagging | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/mailchimp-paid-tagging | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/mailchimp-suppression-sync | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/mailchimp-suppression-sync | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/market-intel-daily | GET | C ⚠ | 见右 | 跑市场情报流水线并发邮件(调第三方) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；跑市场情报流水线并发邮件(调第三方) | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/memory-extractor | POST | D | — | — | 请求 client_id(密钥后) | OK：先判密钥存在再比对，fail-closed；请求带 client_id，但在密钥之后，OK | — | 仅持密钥者 | — |
| /api/cron/messenger-brief-hourly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/messenger-sync-hourly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/meta-leads-sync | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/meta-leads-sync | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/oztop-seo-optimizer | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/playbook-staleness-weekly | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/pm-daily-todo | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/poll-visual-jobs | GET | C ⚠ | 见右 | 轮询视频/图片生成任务并改 reels_drafts 等表 | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；轮询视频/图片生成任务并改 reels_drafts 等表 | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/prescription-weekly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/product-map-sync | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/product-map-sync | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed；POST=GET 同一函数 | — | 仅持密钥者 | — |
| /api/cron/proposal-view-digest | GET | C ⚠ | 见右 | 读 website_lead_events 并发邮件(含访客行为) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；读 website_lead_events 并发邮件(含访客行为) | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/prospecting-sweep | GET | C ⚠ | 见右 | 受 PROSPECTING_SWEEP_ENABLED 开关控制，分析潜在客户(调 AI，花钱) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；受 PROSPECTING_SWEEP_ENABLED 开关控制，分析潜在客户(调 AI，花钱) | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/reputation-snapshots-weekly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/seo-meta-cycle-trigger | POST | D | — | — | 请求 client_id(密钥后) | OK：先判密钥存在再比对，fail-closed；请求带 client_id，但在密钥之后，OK | — | 仅持密钥者 | — |
| /api/cron/seo-patrol-daily | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/seo-weekly-list | GET | D | — | — | 请求 client_id(密钥后) | OK：先判密钥存在再比对，fail-closed；请求带 client_id，但在密钥之后，OK | — | 仅持密钥者 | — |
| /api/cron/site-audit-jobs | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/site-audit-weekly | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/social-comment-autoreply | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/social-engagement-pullback | GET | C ⚠ | 见右 | 拉 Publer/TikTok 互动数据写库(调第三方) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；拉 Publer/TikTok 互动数据写库(调第三方) | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/tailor-made-jobs-sweeper | GET | C ⚠ | 见右 | 把卡住的定制行程任务改 failed | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；把卡住的定制行程任务改 failed | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/team-memory-sweeper | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/viral-analyzer-worker | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/viral-discovery-weekly | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/vision-analyzer | POST | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/weekly-seo-report | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/winner-reel-sync-daily | GET | D | — | — | 无 | OK：先判密钥存在再比对，fail-closed | — | 仅持密钥者 | — |
| /api/cron/zhangqian-sweeper | GET | C ⚠ | 见右 | 把卡住的客户发现任务改 failed | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；把卡住的客户发现任务改 failed | 低(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |
| /api/cron/zhuge-recalculate | GET | C ⚠ | 见右 | 对所有已确认客户重算诸葛方案(AI 花钱，写库) | 无(自己遍历库) | 密钥环境变量没配时，带 `Bearer undefined` 就能触发；对所有已确认客户重算诸葛方案(AI 花钱，写库) | 中(仅密钥漏配时生效) | ④匿名(仅密钥漏配时) | 改成先判 `!process.env.CRON_SECRET` 再比对(抄 ad-entity-snapshot 写法)，最好抽成共享函数 |

## 五、可疑但不确定
- 各 cron 的“持密钥者”= Render 调度器 + PM；密钥一旦泄露，意味着能触发 factory-publish-worker(发 FB/IG)、linkedin-progress-post(发 LinkedIn)、content-factory-intake 等外发/花钱动作。是否按动作分密钥我没评估。
- 21 个 fail-open 文件里的外发闸：factory-publish-worker 受 FACTORY_PUBLISH_LIVE 控制(未设=草稿)；linkedin-progress-post 我只读了入口，没通读 run.ts 里是否另有“发布开关”，可能有 dry/未配置账号即跳过。
- 我没通读各 cron 内部调用的 lib 函数(只读了鉴权段与取客户号方式)，所以“内部是否信任别处传入的 client_id”没覆盖。
- 49 个 fail-closed 文件我用 grep 判定存在“未设密钥拒绝”的分支，并抽读了 ~25 个确认顺序正确；其余按同模式推断，未逐个读全函数。
- site-audit-jobs / team-memory-sweeper 用 `x-cron-secret` 头(team-memory-sweeper 两种头都收)，均先判密钥存在，OK。
- 测试覆盖：`src/lib/cron/registry.test.ts` 未检查路由鉴权写法，没有一个测试拦这类 fail-open。
