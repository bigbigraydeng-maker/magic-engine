# 附录 · 无守卫名-第2组（逐接口明细，原始清查输出）

> 来源：66号窗口只读清查，2026-10-10。路径省略 `src/app/api` 前缀。分类 A=归属守卫已覆盖 B=仅登录 C=无守卫 D=自定义校验 E=仅管理员。

# result_ng2 — 66号窗口 客户越权清查（名单 list_ng2，共 50 个 handler，全部真读）

路径均相对 `src/app/api/`。类别：A=归属守卫 / B=仅登录 / C=完全无守卫 / D=自定义校验。本名单没有 B 类、没有 E 类。
“谁能打到”：①任何登录账号 ②某客户员工 ③仅内部全局管理员 ④匿名。

## 一、有问题的（C 类：完全无守卫，匿名可打）

| 路径 | 方法 | 类别 | 读写删 | 表 | 客户号来源 | 问题/风险（人话） | 严重度 | 谁能打到 | 修法 |
|---|---|---|---|---|---|---|---|---|---|
| flywheel/execute | POST | C | 写 | flywheel_actions（supabaseAdmin，经4个adapter） | body.clientId（谁都能填） | 没登录的人也能给任意客户写“已执行动作”记录（含 payload、expectedMetric、executionItemId、productionPackageId）。这些记录是飞轮/归因“学习”的输入，会被污染；错误信息原样回给调用方。页面里只有 FlywheelDrawer 在用，说明本该是登录后的 FDE 操作。executionItemId/productionPackageId 也没校验属于该客户。 | 中（可跨客户伪造/污染学习数据；不外发、不花钱） | ④（也含①②） | 入口加 `requireDashboardClientAccess(body.clientId)`（或 requirePaidClientAccess）；再校验 executionItemId/productionPackageId 的 client_id 等于 clientId |
| diagnose | GET | C | 读+花钱 | clients、ai_visibility_queries；调 OpenAI+Claude | 写死“CTS Tours NZ” | 匿名每刷一次就真调一次 OpenAI 和 Claude（花钱），并回显 CTS 客户 id/域名/前3条问句，以及“哪个 API key 已配置”。 | 中（烧钱+泄露CTS业务数据+泄露配置状态） | ④ | 直接删除（诊断脚本），或改 guardGlobalAdmin |
| diagnostic/details | GET | C | 读 | ai_visibility_runs、ai_visibility_queries | 写死 CTS client_id | 匿名可读 CTS 的 AI 可见度原始回答（raw_response 前300字）、提取品牌、排名。 | 中（客户业务数据） | ④ | 删除或 guardGlobalAdmin |
| diagnostic/parser-errors | GET | C | 读 | 同上 | 写死 CTS | 匿名可读 CTS 全部 AI 运行记录的统计与失败样例（含回答开头）。 | 中 | ④ | 同上 |
| diagnostic/questions | GET | C | 读 | ai_visibility_queries | 写死 CTS | 匿名可读 CTS 全部启用的监控问句（客户策略）。 | 中 | ④ | 同上 |
| diagnostic/response | GET | C | 读 | ai_visibility_runs、ai_visibility_queries | 写死 CTS（`question` 参数其实没用上） | 匿名可读 CTS 最新一条 AI 完整原始回答 + 品牌提取。 | 中 | ④ | 同上 |
| diagnostic/results | GET | C | 读 | ai_visibility_runs | 写死 CTS | 匿名可读 CTS 全部运行的用量/成本/延迟/报错汇总与样例。 | 中（低偏中，含成本数据） | ④ | 同上 |
| diagnostic/verify-brands | GET | C | 读 | ai_visibility_runs、ai_visibility_queries | 写死 CTS（注意：问句表 select 没按客户过滤，取的是全客户问句做 id 映射，但只用于映射 CTS 的 run） | 匿名可读 CTS 全部成功运行的品牌提取与回答开头200字。 | 中 | ④ | 同上 |
| public-scan/keyword-gap | GET、POST | C（有意公开） | 读+花钱 | 无库表；调 DataForSEO（getSerpCompetitors + getKeywordsGap，最多2市场） | body/query 的 domain（任意域名） | 公开页面用的接口，但没有限流、没有缓存（GET 虽带 CDN 缓存头，换 domain/limit 参数即绕开）。匿名脚本循环调用 = 持续烧 DataForSEO 费用。不涉及客户数据。 | 低~中（只烧钱） | ④ | 加按 IP 限流（复用 consumeScanRateLimits 或同类）+ 服务端缓存 + 单次上限；或只允许默认域名 |
| discover/register | POST | C（有意公开，有限流） | 写+外发+花钱 | discovery_leads、public_scan_jobs、domain cache；DataForSEO + 诸葛/张骞 AI 扫描；Supabase 登录邮件 | body.url/email | 设计上的公开“注册”入口，有 3次/天 的 IP/邮箱/域名限额。风险：①IP 取自 x-forwarded-for 第一段（若上游不重写则可伪造），换邮箱+域名就能绕过 → 无上限烧钱；②往任意第三方邮箱发 magic link 并创建账号（邮件骚扰，每邮箱3次/天）；③24h 域名缓存命中时把别人的 job_id 回给你，而 public-scan/status/[jobId] 无需登录就能取完整结果（仅公开域名分析，低敏）。 | 低~中 | ④ | 确认部署层 x-forwarded-for 可信（取最右一段/用平台提供的 IP）；加全局日预算上限；邮件发送加验证码/人机校验。（此条是产品入口，不建议加登录） |
| discover/leads | POST | C（有意公开） | 写 | discovery_leads（insert，失败静默） | body | 匿名可无限写入线索表（无邮箱格式校验、无限流）= 可灌垃圾/污染线索库。不读任何数据。 | 低 | ④ | 加限流 + 邮箱格式校验；确认该表是否还在用（register 已经写同一张表，疑似冗余） |

## 二、D 类：自定义校验（读懂了）

| 路径 | 方法 | 类别 | 读写删 | 表 | 校验方式 | 结论 | 严重度 |
|---|---|---|---|---|---|---|---|
| factory/signals | POST | D | 写 | content_demand_signals，并同步触发 evaluateSignal | Bearer INTERNAL_API_KEY；env 缺失一律 401（fail-closed）；client_id 来自 body（内部密钥持有者可指定任意客户，属内部调用，可接受）；比较用 `!==`，非常量时间（低） | OK（密钥级） | 低 |
| factory/worker/claim | POST | D | 写(RPC领单)+签名URL | content_work_orders、video_clips、clients；storage签名上传/下载 | FACTORY_WORKER_TOKEN 常量时间比较，fail-closed；再加 FACTORY_WORKER_CLIENT_IDS 白名单（缺失 503），body.client_id 必须在白名单；返回的 client 再校验 | OK，设计最严 | — |
| factory/worker/[id]/complete | POST | D | 写 | content_work_orders、video_clips、factory_balance_ledger（经 completeWorkOrder） | 同上 token；校验 claimed_by==worker_id、路径必须在 renders/{该工单client_id}/{工单id}/ 下、clip 路径与 track 一致、成本上限 1.5×。**未**校验工单 client_id 是否在白名单内（claim 才查白名单） | OK（持 token 者可对任意客户“已被自己领取”的工单操作；token 泄露面=本地Mac，已独立轮换）。可疑：若 worker_id 被猜中且工单属非白名单客户 | 低 |
| factory/worker/[id]/fail | POST | D | 写 | content_work_orders | token + claimed_by 归属；同样未查白名单 | OK | 低 |
| factory/worker/[id]/heartbeat | POST | D | 写 | content_work_orders | token + claimed_by 归属 | OK | 低 |
| factory/worker/ping | POST | D | 写 | cron_run_logs | token + 白名单 | OK | — |
| inngest | GET/POST/PUT | D | 取决于注册函数 | — | Inngest 官方签名校验；生产缺 signing key 或 INNGEST_DEV 为真值直接 500 拒绝（fail-closed）。注意：守卫只在 NODE_ENV=production 生效，预览/非生产环境若公网可达且 INNGEST_DEV 开启则无签名 | OK（生产） | 低 |
| internal/ga4-form-funnel | GET | D | 读 | client_connectors（只读 GA4 property，调 Google） | Bearer CRON_SECRET，缺失 500（fail-closed）；client_id 由调用方指定（密钥持有者=内部） | OK | 低 |
| internal/gsc-query-overlap | GET | D | 读 | client_connectors（调 GSC，用客户已授权 token） | 同上 | OK | 低 |
| internal/keyword-opportunity | GET | D | 读（真跑时花钱） | clients、master_briefs、keyword_snapshots；DataForSEO | 同上；默认 dry_run，只有 `dry_run=0` 才花钱 | OK | 低 |
| meta/data-deletion | POST | D | 写（删除该 Meta 用户的广告连接/令牌） | RPC meta_process_data_deletion、meta_data_deletion_requests | Meta signed_request：HMAC-SHA256 常量时间校验、算法校验、24h 时效、拒绝登录型 payload、体积上限；密钥缺失 503 | OK，写得很严 | — |
| prospect/report | GET | D | 读 | public_scan_jobs（supabaseAdmin） | 登录会话邮箱 → 只查 email=本人 的最新扫描；不接收任何 id 参数 | OK（不存在 IDOR）。备注：magic-link 登录的陌生人只能看到自己邮箱的扫描 | — |
| prospect/report/docx | GET | D | 读 | 同上 | 同上 | OK | — |

## 三、A 类：归属守卫已覆盖，无问题（一行 OK）

| 路径 | 方法 | 结论 |
|---|---|---|
| goals/[goalId] | GET, DELETE | OK：requireGoalAccess 先读目标取 goal.client_id 再走 requireDashboardClientAccess，后续用的就是同一个 goalId（删除仅限草稿） |
| goals/[goalId]/activate | POST | OK，同上 |
| goals/[goalId]/archive | POST | OK，同上 |
| goals/[goalId]/execution-summary | GET | OK，同上 |
| goals/[goalId]/fetch-current-value | GET | OK：同上；注意它会调 DataForSEO 实时取数并回写 goals，self_serve 也能触发（守卫是 Dashboard 档不是 Paid 档），轻微花钱，见“可疑”# |
| goals/[goalId]/initiatives | GET, POST | OK：POST 的 client_id 取自 goal 而非 body，body 里即使带 client_id 也被忽略 |
| goals/[goalId]/judge | POST | OK，使用守卫返回的 goal 行 |
| goals/[goalId]/prescriptions | GET | OK，查询按 goalId，守卫已校验该 goal 的客户 |
| initiatives/[id] | GET, PATCH, DELETE | OK：requireInitiativeAccess；PATCH 只更新白名单字段，不能改 goal_id/client_id |
| initiatives/[id]/bulk-assign | POST | OK：UPDATE 带 `.eq('client_id', initiative.client_id)`，外客户的 execution_item 不会被改（防越界做对了） |
| initiatives/[id]/polish-hypothesis | POST | OK，只读 + 调 AI（花钱，需登录且有该客户权限） |
| kernel/approvals | GET | OK：先校验 uuid，再 requirePaidClientAccess(clientId)，查询按同一 clientId 钉死 |
| kernel/approvals/[runId] | GET | OK：先读 run 取 run.client_id 再 requirePaidClientAccess |
| kernel/approvals/[runId]/decision | POST | OK：同上，操作者取自会话，含 stale_decision 行锁；仅“授权”不执行 |
| listings/[listingId] | PATCH | OK：requireListingAccess（房源→client_id→requireDashboardClientAccess）；client_id 不在可改字段 |
| listings/[listingId]/brief | GET | OK |
| listings/[listingId]/brief/[briefId] | PATCH | OK：除房源守卫外，updateBrief 用 `.eq('listing_id')` 校验档案属于该房源（间接 id 防护到位） |
| listings/[listingId]/brief/[briefId]/activate | POST | OK：同上，fetchBriefOfListing 校验归属 |
| listings/[listingId]/brief/generate | POST | OK：守卫在最前；会花钱调 AI+抓房源页 URL（见可疑 #2） |

## 四、可疑但不确定

1. **initiatives/[id] PATCH `campaign_ids`**：可以写入任意 campaign UUID，没校验这些活动属于同一客户。execution-summary 会按这些 id 去 campaign_briefs 查 status，造成对“别的客户活动是否存在及其状态”的探测（需猜中 UUID，低风险，仅状态值）。修：写入前校验 campaign_briefs.client_id = initiative.client_id。
2. **listings/[listingId]/brief/generate**：`listing_url` 只校验 http/https，由服务端 fetchUrlAsMarkdown 抓取。未确认 fetchUrlAsMarkdown 是否挡内网/元数据地址（SSRF）。登录且有该客户 Dashboard 权限（含 self_serve）即可触发；未读该函数实现，建议复核。
3. **goals fetch-current-value / polish-hypothesis / brief/generate**：用 Dashboard 档守卫（self_serve 也过），都会花钱（DataForSEO / AI）。是否应改 requirePaidClientAccess 属产品决定。
4. **discover/register 的 x-forwarded-for**：是否可信取决于 Render/Cloudflare 前置如何重写，我没法从代码里确认。
5. **factory/worker/[id]/complete|fail|heartbeat 未查白名单**：只靠 token + claimed_by；claim 已按白名单限制，所以实际领不到非白名单客户工单，风险极低。complete 的 409 报错会回显当前 claimed_by（给持 token 者的信息，低）。
6. **diagnostic/verify-brands** 的 ai_visibility_queries 查询未按客户过滤（拉全库问句），只做内存映射，但仍属多余的全量读取，随该路由一并删除即可。
7. **inngest** 仅在 NODE_ENV=production 才强制签名；预览环境若公网可达需另确认。
8. 以上 diagnose / diagnostic/* 7 个路由看上去是一次性调试遗留（写死 CTS id、无页面引用）；我没有全仓 grep 前端引用，建议删除前确认。

## 五、统计

- handler 总数 50（49 个路由文件 + public-scan/keyword-gap 的 GET/POST、inngest 的 GET/POST/PUT 等多方法按方法数计，goals/initiatives/listings 同理）。
- A=23，B=0，C=12（含 2 个“有意公开”的 public-scan/keyword-gap 方法、discover/register、discover/leads），D=15，E=0。
