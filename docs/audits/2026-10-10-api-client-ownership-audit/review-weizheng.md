# 魏征复核 · 66号窗口越权清查（只读，独立重读源码）

范围：独立重读 52 个 handler（OK 类 21、高 类 17、cron 6、无守卫 8），另跑 4 套全量扫描脚本。
路径省略 `src/app/api/` 前缀；行号为本仓库当前文件行号。
全局事实核对：`src/middleware.ts:238` matcher 只有 /dashboard /portal /prospect，/api 无任何兜底；`require-admin.ts` 的 guardAdmin/requireAdmin 只看 `getUserPermissions`(=环境变量 ADMIN_EMAILS/ADMIN_EMAIL_DOMAIN/DEMO_ADMINS)，DB 里 scoped_admin 不会让人通过 guardAdmin。

## 一、抽查表

### A. 前人判 OK / 无问题（21 个）

| 路径·方法 | 前人判定 | 我的判定 | 一致? | 依据 |
|---|---|---|---|---|
| clients/[id]/geo/[directiveId]/activate POST | OK | OK | 是 | activate/route.ts:29 守卫；:37-40 走 RPC，SQL 内 `where id=p_directive_id and client_id=p_client_id`（migrations/20260623000001_geo_activate_rpc.sql:48-49,81-82） |
| clients/[id]/brief/[briefId]/activate POST | OK | OK | 是 | route.ts:21 守卫；:29-32、:45-48 全带 client_id；:54 的 .eq('id') 在已验证之后 |
| clients/[id]/reels/[draftId]/generate-video POST | OK | OK | 是 | route.ts:34 守卫；:54-57 取稿带 client_id；:119 更新发生在验证后 |
| clients/[id]/messenger/conversations/[conversationId]/messages GET | OK | OK | 是 | route.ts:37,46-51,59-61 会话按 id+client_id+channel 取，消息按已验证会话取 |
| clients/[id]/campaign/[campaignId]/generate-visual POST | OK | OK | 是 | route.ts:18,23-26 |
| clients/[id]/posts/[postId] PATCH | OK | OK | 是 | route.ts:15,34-37 |
| clients/[id]/strategy/[itemId] PATCH | OK | OK | 是 | route.ts:35,57-60 |
| clients/[id]/marketing-plan/[planId]/approve POST | OK | OK | 是 | route.ts:24,32-35（同目录 DELETE 才是洞，见下） |
| clients/[id]/projects/[projectId] PATCH | OK | OK | 是 | lib/clients/projects-store.ts:131-132 `.eq('client_id')` 恒带 |
| clients/[id]/tailor-made/jobs/[jobId] GET | OK | OK | 是 | lib/tailor-made/jobs.ts:143-144 getJob(clientId, jobId) |
| clients/[id]/crm/contacts/[cid]/stage PATCH | OK | OK | 是 | lib/crm/advance-contact-stage.ts:57-58 |
| clients/[id]/whatsapp/conversations/[conversationId]/reply POST | OK | OK | 是 | lib/whatsapp/send.ts:186 `convo.client_id !== input.clientId`；lib/crm/manual-send-dnc-gate.ts:36-37 |
| clients/[id]/blog/[postId]/social-suggestions POST | OK | OK | 是 | lib/blog/generate-social-suggestions.ts:100 校验 post.client_id |
| clients/[id]/production/[packageId] PATCH | OK | OK | 是 | route.ts:198-201 先按 id+client_id 取，再改（:210 在验证之后） |
| clients/[id]/memory/[type]/[memId] PATCH/DELETE | OK | OK | 是 | route.ts:96-99,136-139 |
| clients/[id]/messenger/unclaimed/claim POST | OK | OK | 是 | route.ts:55-58,71-74 会话与联系人都带 client_id |
| clients/[id]/agents/customers POST/PATCH | OK（POST 一处低） | OK，认同 POST 低 | 是 | route.ts:55-58 联系人按 client_id；`.eq('id', id)` 那几处的 id 是 clients 表自己的 URL id，是我的扫描误报 |
| initiatives/[id]/bulk-assign POST | OK | OK | 是 | route.ts:19,40-43 `.eq('client_id', initiative.client_id)`；lib/strategy/auth-helpers.ts:54-73 先读 initiative.client_id 再过守卫 |
| ai-tracker/queries/[id] PATCH | OK | OK | 是 | route.ts:53-55 先读行取 client_id，:66 守卫，:75-78 更新带 client_id |
| ai-tracker/run POST | OK(密钥) | OK | 是 | route.ts:21-37 密钥缺失 500、不符 401，fail-closed |
| kernel/approvals/[runId]/decision POST | OK | OK | 是 | requireApprovalActor→requirePaidClientAccess(run.client_id)（lib/kernel-approval/http.ts:103-112），是 throw 风格，不是漏检 |

### B. 前人判「高」（17 个，核实是否夸大）

| 路径·方法 | 前人判定 | 我的判定 | 一致? | 依据 |
|---|---|---|---|---|
| clients/[id]/brief/[briefId]/chat POST | 高(IDOR) | 属实 | 是 | route.ts:21 只验 URL id；:41 `refineBrief({briefId})`；lib/brief/refine.ts:38-42 只按 id 读，且整行回给调用者（读+改写）。注：需要别家 briefId，但见漏网#3，UUID 并非不可得 |
| clients/[id]/content-posts/[postId]/publish POST | 高 | 属实 | 是 | route.ts:31 Dashboard 档(含 self_serve)；lib/flywheel/social-post-publish.ts:167-168 `accounts[0]`、:181 `?? accounts[0]` 回退到 ME 共享工作区 |
| clients/[id]/content-factory/[postId] PATCH | 高 | 属实 | 是 | route.ts:27 Dashboard 档；:34-37 confirm→approved，:49/:143-151 LinkedIn 帖直接排发 |
| clients/[id]/google-ads-customer-id PATCH | 高 | 属实 | 是 | route.ts:66 Dashboard 档，:80 只校验 10 位数字；lib/google-ads/client.ts:498-516 共享凭据 |
| clients/[id]/google-ads/campaigns GET | 高 | 属实(有上限) | 是 | route.ts:30 付费档；:37-49 customerId 取自 query，共享凭据。可达范围=ME 的 MCC 能管到的账号，前人没写这个上限 |
| clients/[id]/google-ads/execute POST | 高 | 属实 | 是 | route.ts:70 付费档；:83,:99-120 body 账号号；:116 自带 `TODO P18.D … prevent IDOR`；对比 Meta 版 meta-ads/execute/route.ts:135 有 assertCampaignOwnedByClient |
| clients/[id]/marketing-plan/[planId] DELETE | 高 | 属实 | 是 | route.ts:115 付费档；:122 `revokePlanTasks(params.planId)` 先删；lib/marketing-plan/task-dispatcher.ts:246-251 只按 marketing_plan_id 删 pending 的 execution_items；:128-129 带 client_id 的归档在删之后 |
| clients/[id]/tiktok-ads/execute POST | 高 | 属实 | 是 | route.ts:59 付费档；:72,:96 advertiser 取 body；:92 `TODO P18.D` 同上 |
| clients/[id]/reels/[draftId]/publish POST | 高 | 属实 | 是 | route.ts:12 Dashboard 档；:18 account_id 取 body；:39 仅在全局账号列表里找，不绑定客户 |
| clients/[id]/seo-config PATCH | 高 | 属实 | 是 | route.ts:109 requireDashboardClientAccess(应为 Paid/admin)，可写 weekly_blog/meta_cycle_enabled（:59-63） |
| clients/[id]/users POST/DELETE | 高 | 偏高，我判「中偏高」 | 否(程度) | route.ts:31,102 付费档。「付费成员管理本客户团队」本身是设计意图；真问题只有 ①可删/改 ME 内部 fde 行 ②任意邮箱发邀请邮件无限流 ③任何一个付费档成员(不限老板)可踢掉老板 |
| visual/image POST | 高 | 属实 | 是 | route.ts:19 守卫用 body.client_id；:25-27 post 只按 id 取；:97-99 回写别家 content_posts |
| publer/schedule POST | 高 | 属实 | 是 | route.ts:28 守卫用 asset.client_id；:41 account 只在全局列表里找，无客户绑定 |
| visual/batch-image POST | 高 | 属实 | 是 | route.ts:19 仅 requireSession；:35-37 `.in('id', post_ids)` 无客户过滤；:85-87 把别家贴文改成 approved |
| baselines/trigger-cron POST | 高(花钱) | 属实 | 是 | route.ts:21-26 仅 requireSession；它用服务器 CRON_SECRET 去触发付费任务（相当于给任何登录者代发密钥） |
| auth/google/connect + callback (flow=connect) | 高 | 略高估，我判「中高」 | 否(程度) | connect/route.ts:46 `flow!=='connect'` 才鉴权；callback/route.ts:103 同。刻意设计的公开页(/connect/[id])；需要知道客户 UUID；后果是投毒/覆盖该客户 GSC/GA4 令牌(:136-157,:180-190)，不是读出数据 |
| voice/tenants/[tenantId]/calls、leads GET；admin/users*、admin/mcp-keys*、factory/work-orders/*、factory/chat 等「E-bad」组 | 高 | 属实但是「条件型」 | 否(程度) | lib/voice/api-auth.ts:15-16 与 require-admin.ts:24-27 都只认环境变量。只有「生产里配了 DEMO_ADMINS 的演示账号」能打到，DB 的 scoped_admin 打不到。前人没说明这个前提；若生产没配 DEMO_ADMINS，这一组实际只有内部全局管理员能碰 |

### C. cron（6 个独立核查 + 全量脚本）

| 路径·方法 | 前人判定 | 我的判定 | 一致? | 依据 |
|---|---|---|---|---|
| cron/factory-publish-worker GET | C⚠ 高 | 属实但应写成条件型 | 是(程度有保留) | route.ts:23 字面量 `Bearer ${process.env.CRON_SECRET}`(缺失时=`Bearer undefined`)；:29 `FACTORY_PUBLISH_LIVE` 不是 true 时只出草稿。要同时满足「密钥漏配」+「LIVE=true」才会真发。:37 注释说明 Render 新建 cron 服务确有「拿不到 CRON_SECRET」的前科，所以风险非纯理论 |
| cron/daily-cron-digest GET | C⚠ | 同意 | 是 | route.ts:15 |
| cron/zhuge-recalculate GET | C⚠ | 同意 | 是 | route.ts:41 |
| cron/poll-visual-jobs GET | C⚠ | 同意 | 是 | route.ts:34 |
| cron/ad-entity-snapshot GET/POST | D OK | OK | 是 | route.ts:87-88、:95-96 先判密钥存在 |
| cron/product-map-sync GET/POST | D OK | OK | 是 | route.ts:28-31 `!process.env.CRON_SECRET || !auth` 双判；POST=GET 同函数 |
| 全量：fail-open 清单 | 21 个文件 | 我独立扫出 21 个，与前人名单 diff 为空 | 是 | 扫描：`Bearer ${process.env.CRON_SECRET}` 字面量且无 `!process.env.CRON_SECRET/!cronSecret` 判断。另核对：cron 目录无任何路由用登录态；多方法文件里每个方法都有鉴权；无 `?secret=` |

### D. 无守卫(ng)（8 个）

| 路径·方法 | 前人判定 | 我的判定 | 一致? | 依据 |
|---|---|---|---|---|
| admin/viral-references POST | C 高(命令注入) | 属实，且比前人说的更宽（见第三节） | 是(并补充) | route.ts 全文件无鉴权；lib/reels/viral-analyzer.ts:198 |
| admin/viral-references/[id]/retry POST | C 高 | 属实，但与 POST 同根；单看它不能「注入」，只是「重放」 | 是 | retry/route.ts:12-31 无鉴权，直接 `analyzeViralReference(ref.id, ref.source_url)` |
| visual/upload POST | C 高 | 属实 | 是 | route.ts:31-36 无任何鉴权，client_id 取表单 |
| visual/avatar POST | C 高 | 属实 | 是 | route.ts:5-19 无鉴权，post 与 client 不比对 |
| visual-assets/[assetId]/upload-version POST | C 高 | 属实 | 是 | route.ts:15-41 仅按 assetId，:83 更新 |
| flywheel/execute POST | C 中 | 属实，中偏高可以接受 | 是 | route.ts:24-52 无任何鉴权，clientId 取 body，直接交 adapter 写 flywheel_actions |
| voice/tenants/[tenantId]/calls GET | E 高 | 条件型，见上 | 否(程度) | lib/voice/api-auth.ts:10-18 |
| auth/google-login 等「next=/\evil.com 开放跳转」 | 低(可能) | 对 /auth/callback 不成立；对 portal 登录页成立 | 否(精确度) | auth/callback/route.ts:132 `${origin}${destination}` 拼了 origin，不会跳外站；但 portal/login/portal-login-form.tsx:30-34 校验只拦 `//`，随后 `window.location.href = data.redirect`，`/\evil.com` 会被浏览器当成外站。低 |

## 二、漏网清单（result 文件里没写、或写得不准）

1. **【高·匿名】viral-analyzer 命令注入有第二、第三条入口，只修 POST 入口修不干净。**
   - 匿名 `admin/viral-references/upload`（upload/route.ts:56-57）把**用户上传的文件名**原样存成 `source_url = upload://<文件名>`。
   - `cron/viral-analyzer-worker`（route.ts:44-48）每轮捞 `pending` **和 `error`** 两种状态，不看 platform；上传解析失败(例如传一个假视频)→状态变 error→下一轮被 worker 拿去 `analyzeViralReference(id, 'upload://<文件名>')`→`detectPlatform` 判 unknown→`downloadAndAnalyzeVideo`→shell。文件名含 `"; … ; "` 即可。匿名者全程无需调 POST，也无需调 retry。
   - 修法必须落在 sink：viral-analyzer.ts:198 改 `execFile` 传参数数组，并只允许 `http(s)://` 开头；入口加鉴权只是第二层。
2. **【中】`/api/mcp/[transport]` 与 `/api/mcp-admin/[transport]` 两个文件没出现在任何 result 清单里**（list_*.txt 缺这两个）。我读过：都是 API key 鉴权、fail-closed（无/错钥匙 401），admin 工具全是只读。但 `sourceIp` 取 `x-forwarded-for` 第一段（mcp-admin/[transport]/route.ts:48，mcp/[transport]/route.ts:50）——这是调用者可自填的值，admin 钥匙的 IP 白名单（lib/auth/api-key-access.ts:236）形同虚设。前提是已有一把钥匙，所以中。
3. **【中·链】「别家 UUID 猜不到」这条缓解并不成立**：`visual/assets` GET（任何登录者见所有客户最近 20 条素材含 post_id/asset_id/client_id）+ `publer/accounts` + `publer/draft`，给 visual/image(post_id)、batch-image(post_ids)、reels publish/publer schedule(account_id)、brief chat(briefId) 这类 IDOR 供应了现成的别家编号。前人分别报了，但没串起来；**先修 visual/assets 与 publer/accounts 收益最大**。
4. **【中】publer/create-post 被判「A·fail-closed·OK」偏乐观**：它只发「客户连接器里绑定的 publer_account_ids」(create-post/route.ts:77-85,:144)，但 `clients/[id]/connectors/[anchor]/connect` POST（route.ts:76-79,:106-117）把 body.config **原样**写进 client_connectors（Onboarding 档，self_serve 可用），anchor=publer 时就是写 publer_account_ids（lib/flywheel/social-post-publish.ts:96-97 读取）。付费成员先写别家账号 id 再调 create-post，就绕过了「只发绑定账号」。前人在 cl1 第 4 条提到「允许成员自己写 Publer 绑定」，但没回头把 create-post / social-post-publish 的「严格解析」降级。
5. **(c) 守卫结果未检查**：全量扫描 src/app/api 所有 route.ts 的 `const x = await require*/guard*(`，后 700 字符内找不到 `.ok / !x / .status / if(x)` 的只有 `kernel/approvals/[runId]` 和 `…/decision` 两处，经核是 throw 风格，**无漏网**。无裸调用(`await requireXxx()` 不赋值)。
6. **(a) body/query 里的 client_id 与守卫参数错位**：49 个含 body/query client_id 的文件逐个对了守卫，没有新的错位；已知的只有「google-ads/tiktok 的外部账号号来自 body」(前人已报)。
7. **(b) 子资源 `.eq('id', …)` 无 client_id 的窗口扫描**：命中 ~140 行，逐个核对，除前人已报的(geo/[directiveId] PATCH、marketing-plan DELETE、fan-out、visual/image、work-logs)外，其余均为 ①验证后的二次更新 ②自己刚建的 id ③clients 表自己的 URL id。**无新增**。顺带确认前人已报的 `blog POST` 的 production_package_id（blog/route.ts:256-257,403）属实。

## 三、特别核实：admin/viral-references 命令注入

结论：**属实，且可匿名利用。**
- 无鉴权：`admin/viral-references/route.ts` 全文件没有任何 guard，`src/middleware.ts:238` 不覆盖 /api。
- 无校验：POST 只检查 `url`/`industry` 非空(route.ts:119-126)，原样入库 `source_url`，随后 `analyzeViralReference(ref.id, ref.source_url)`（route.ts:148-150，立即后台触发，不用等 cron）。
- 分流条件：`detectPlatform`(viral-analyzer.ts:101-107) 只是正则子串匹配；analyzeViralReference(:429-431) 里只有 platform==='youtube'(url 含 `youtube.com` 或 `youtu.be` 子串)走 Gemini 直连、不进 shell。facebook/tiktok/instagram/unknown 全部走 `downloadAndAnalyzeVideo`→shell。所以攻击者只要让 url 不含 youtube 子串即可。
- sink：viral-analyzer.ts:198-201 `execAsync(\`${cmd} -f "…" -o "${tmpFile}" "${url}"\`)`，`exec` 走 /bin/sh，`url` 无 scheme/字符校验。双引号内 `"`、`$()`、反引号都能逃逸；还可用以 `-` 开头的 url 做参数注入。
- 可利用条件：①能发 HTTP 请求到 web 服务(无需登录) ②服务器是普通 Node 进程，默认有 /bin/sh（yt-dlp 在不在都无所谓，注入的命令与 yt-dlp 同一行）③`GEMINI_API_KEY` 缺失时 analyzeViralReference 在 :414-418 提前 return，**不会走到 shell**——所以要生产上配了 GEMINI_API_KEY（大概率配了）。④进程权限=Render web 服务账号，能读到服务器全部环境变量(含 service role 钥匙)，实际后果是整库沦陷。
- 补充：除 POST 外还有 upload 文件名 + cron 重试路径(见漏网#1)。discover 路由的 url 来自 YouTube 视频 id，不可注入(前人判断正确)。
- 前人未验证「线上有没有 yt-dlp」，不影响结论。

## 四、夸大/误报清单

1. **「高」夸大(程度)**：admin/users·users/[id]·users/upgrade·mcp-keys·mcp-keys/revoke-all·factory/work-orders/*·factory/chat·voice 租户 calls/leads 这一整组「E-bad」。前提是「生产有 DEMO_ADMINS 账号」，前人没写。应标「条件型高」，并让 PM 先确认生产是否配了 DEMO_ADMINS。
2. **auth/google/connect(flow=connect)「高」偏高**：公开页是设计；需知道客户 UUID；只能投毒/覆盖，不能读数据。建议「中高」。
3. **clients/[id]/users「高」偏高**：团队管理是产品功能，真正要修的是 fde 行保护与邀请限流。建议「中偏高」。
4. **cron 21 个 fail-open 的严重度**：数量与名单准确；factory-publish-worker 的「高」需同时满足密钥漏配+LIVE 开关，写「条件型」更准。
5. **auth/google-login / session-route「开放跳转」**：对 auth/callback 是误报(拼了 origin)；真正成立的是 portal 登录页的 `window.location.href`，低。
6. **retry 路由「匿名可无限触发重跑烧费用」**：只能重跑已有行，烧钱程度有限；其危险性完全来自 POST/upload 能写入毒 url，不应与 POST 并列为独立「高」。
7. **前人判错/偏乐观(反向)**：publer/create-post 的「fail-closed OK」(见漏网#4)。除此之外，抽查的 21 个 OK 全部一致，未发现把有洞判成 OK 的。

## 五、方法与没做的

- 已做：52 个 handler 逐个读源码；4 个全量脚本（cron 密钥比对、守卫结果检查、body client_id 错位、`.eq('id')` 窗口扫描）；578 个 route 文件与 list_*.txt 对账，发现 mcp 两个文件缺失(另 ad-approval/diagnose/apply-migration 在 result 里有，只是 list 路径格式不同)。
- 没做：不请求线上、不确认生产环境变量(CRON_SECRET/DEMO_ADMINS/GEMINI_API_KEY 是否配置)、不验证 yt-dlp、没有实际打命令注入；SSRF(public-scan、transcript、listings brief 抓取 URL)只看了鉴权，没审 URL 过滤；没读 lib/mcp/scoped-queries 的每个查询。
