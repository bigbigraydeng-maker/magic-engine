# 附录 · 无守卫名-第1组（逐接口明细，原始清查输出）

> 来源：66号窗口只读清查，2026-10-10。路径省略 `src/app/api` 前缀。分类 A=归属守卫已覆盖 B=仅登录 C=无守卫 D=自定义校验 E=仅管理员。

# result_ng1 · 客户越权清查（名单 ng1，共 50 个 handler，只读）

类别：A=归属守卫 B=仅登录 C=无守卫/靠密钥或公开 D=自定义校验 E=仅admin。谁能打到：①任何登录账号 ②客户员工 ③仅内部全局管理员 ④匿名。
说明：src/middleware.ts 的 matcher 只有 /dashboard /portal /prospect，不含 /api，所以下面标 C 的接口真的是“谁都能直接打”。
说明2：共用的辅助守卫 —— 内容三兄弟用 guardContentGeneration（内部调 requirePaidClientAccess + 校验子记录归属）；Meta 广告写入用 requirePaidClientAccess + assertCampaignOwnedByClient（只到“广告账户”级）。

| 路径 | 方法 | 类别 | 读写删 | 表 | 客户号来源 | 问题/风险(人话) | 严重度 | 谁能打到 | 修法 |
|---|---|---|---|---|---|---|---|---|---|
| admin/apply-migration | POST | C(Bearer CRON_SECRET，没配就拒，fail-closed) | 写(固定一条加列) | ai_visibility_runs | 无 | OK：密钥缺失时拒绝；内容写死，无注入 | 低 | 持密钥者 | 无 |
| admin/clear-runs | POST | C(密钥放在URL ?secret=，fail-closed) | 删(清空整张表，所有客户) | ai_visibility_runs | 无 | 密钥放网址里会进访问日志/浏览器历史；一旦泄露可一键清空全部客户的AI可见度诊断记录 | 中 | 持密钥者 | 改成 Authorization 头；或改 guardGlobalAdmin |
| admin/viral-references | GET | C 完全无守卫 | 读 | viral_reference_library(select *) | 无 | 任何人可读整个爆款参考库（含 client_id、备注、我们自己的视频） | 中 | ④匿名 | 加 guardGlobalAdmin |
| admin/viral-references | POST | C 完全无守卫 | 写+外部调用+**执行系统命令** | viral_reference_library；yt-dlp、Gemini | body.videos[].url / client_id | **高危**：url 原样拼进 shell 命令 `yt-dlp ... "${url}"`（src/lib/reels/viral-analyzer.ts:198，execAsync）。匿名者提交一个不含 youtube/facebook/tiktok/instagram 字样的 url 并带 `"`/`$()` 即可在服务器上执行任意命令，进而拿到服务器环境变量(含 service role 密钥)。另外还能任意写入 client_id、烧 Gemini 费用 | 高(可能是整个系统最严重) | ④匿名 | 立即加 guardGlobalAdmin；url 只允许 https 白名单域名；改用 execFile/spawn 传参数数组，别拼 shell |
| admin/viral-references/[id]/retry | POST | C 无守卫 | 写+外部调用+执行命令 | viral_reference_library | 路径 id | 同上：对库里已有记录重跑，库里 url 若是被投毒的就再次触发命令执行；匿名可无限触发重跑烧费用 | 高 | ④匿名 | 同上 |
| admin/viral-references/analyze-pending | POST | C 无守卫 | 读(只计数) | viral_reference_library | 无 | 只返回待处理条数，信息很少 | 低 | ④匿名 | 加 guardGlobalAdmin(顺手) |
| admin/viral-references/discover | POST | C 无守卫 | 写+花钱 | viral_reference_library；YouTube API、Gemini | body 关键词/行业 | 匿名可反复触发 YouTube 搜索(吃每日配额)和 Gemini 分析(花钱)，并往库里灌数据。url 来自 YouTube 视频ID，无注入 | 中 | ④匿名 | guardGlobalAdmin |
| admin/viral-references/upload | POST | C 无守卫 | 写+落盘+外部调用 | viral_reference_library；服务器 /tmp；Gemini Files | 无(表单) | 匿名可上传最大约百兆视频到服务器临时目录并送 Gemini 分析：磁盘/费用/拒绝服务风险；文件类型只信客户端声明的 MIME | 中 | ④匿名 | guardGlobalAdmin；限大小 |
| ai-tools/meta/invoke | POST | D(客户级 API key，client 类，要求 Meta 范围 + 试点生效) | 读(Meta 广告数据) | client_api_keys 等 | 来自 key 绑定的 clientId，不接受参数覆盖 | OK：客户号取自密钥主体，不取自请求体；有请求体大小/schema 限制 | 低 | 持有本客户密钥者 | 无 |
| ai-tools/meta/manifest | GET | D(同上) | 读 | meta_ads_read_grants 等 | key 主体 | OK | 低 | 持密钥者 | 无 |
| ai-tracker/run | POST | C(Bearer CRON_SECRET，没配返回500，fail-closed) | 写+花钱(OpenAI/Anthropic) | ai tracker 相关表 | body.client_id(仅格式校验) | OK：只有持密钥者能传任意 client_id，属内部调用；密钥为非常量时间比较(次要) | 低 | 持密钥者 | 无 |
| ai/zhugeliang/proactive | POST | C(Bearer ${process.env.CRON_SECRET}) | 写+花钱(Claude)，处理全部客户信号 | anomaly_signals、flywheel_actions、execution_items | 无(全客户) | **密钥没配时会放行**：比较的是字符串 `Bearer undefined`，匿名者发这个头就能触发全客户的 AI 判断并写待办/飞轮动作。是否真有洞取决于线上 CRON_SECRET 是否一定有值 | 中(条件性) | ④匿名(仅当环境变量缺失) | 改成先判断 env 存在，缺失即拒绝(同 ai-tracker/run 的写法) |
| auth/facebook/ads/connect | POST | A(activeDashboardAccess=onboarding 归属守卫)+checkOrigin | 写(发起授权，记审计) | 审计表 | URL ?client_id，与守卫同一个 | OK | 低 | ②本客户成员 | 无 |
| auth/facebook/callback | GET | D(HMAC 签名 state+10分钟过期；clientId 来自签名 state) | 写(存 Facebook 页面令牌) | platform_oauth_connections；clients | 签名 state 内 clientId | 基本OK：state 只有“发起接口”(已有归属守卫)能签出。弱点：state 没绑登录会话/一次性，同一链接 10 分钟内谁点完授权都会把“点击者的 FB 页面令牌”绑到该客户上(被诱导型)；签名比较不是常量时间 | 低 | 持有效 state 者 | state 加一次性 nonce+绑会话；timingSafeEqual |
| auth/forgot-password | POST | C 静态 410 | 无 | 无 | 无 | OK：已停用，不做任何事 | 低 | ④ | 无 |
| auth/google-login | GET | C 公开(OAuth 发起) | 无 | 无 | 无 | OK。次要：next 校验只拦 `//`，`/\evil.com` 可能被浏览器当成外站(开放跳转) | 低 | ④ | next 额外拒绝反斜杠 |
| auth/magic-link | POST | C 静态 410 | 无 | 无 | 无 | OK：已停用 | 低 | ④ | 无 |
| auth/self-register | POST | C 公开(设计如此) | 写+外发邮件 | clients、client_portal_users、public_scan_jobs、client_discovery | body.email/businessName | 设计即公开，但：①能探测邮箱是否已注册/是否未验证(返回不同提示)；②可替别人邮箱抢先注册，占住公司名；③新注册那条分支没有频率限制，可给任意邮箱灌验证码邮件；④限流用可伪造的 X-Forwarded-For；⑤无验证码就能批量往 clients 表灌假客户 | 中 | ④匿名 | 统一响应文案；对新注册加按邮箱+IP限流/人机校验；未验证账号不占公司名 |
| auth/session-route | GET | D(读当前会话) | 读+(可能)发放500 MTC欢迎奖励 | 会话 | 无 | OK：只对当前登录人生效；次要同 google-login 的跳转校验 | 低 | ① | 同上 |
| auth/tiktok/callback | GET | D(HMAC state+10分钟，clientId 来自签名 state) | 写(存 TikTok 令牌) | platform_oauth_connections | 签名 state | 同 facebook callback：弱点相同(无nonce/不绑会话) | 低 | 持有效 state 者 | 同上 |
| auth/verify-otp | POST | C 公开(设计如此) | 写(建立登录会话) | Supabase Auth | body.email+code | OK：靠 Supabase 校验验证码；本接口自身没有尝试次数限制，依赖 Supabase 侧限流 | 低 | ④ | 视 Supabase 限流配置，必要时加本地限流 |
| baselines/cron-runs | GET | C 无守卫 | 读 | baseline_cron_runs | 无 | 内部定时任务运行记录对外公开(含错误信息) | 低 | ④匿名 | guardGlobalAdmin |
| baselines/domains | GET | C 无守卫 | 读 | baseline_domains(select *) | 查询参数 sub_industry | 任何人可读全部基准域名清单，含 is_client(哪些是我们客户的域名)和备注 | 中 | ④匿名 | guardGlobalAdmin |
| baselines/domains | POST | C 无守卫 | 写 | baseline_domains | body | 匿名可往基准库塞域名，污染行业基准分 | 中 | ④匿名 | guardGlobalAdmin |
| baselines/domains/[id] | DELETE | C 无守卫 | 删 | baseline_domains | 路径 id | 匿名可删任意基准域名 | 中 | ④匿名 | guardGlobalAdmin |
| baselines/domains/[id] | PATCH | C 无守卫 | 写 | baseline_domains | 路径 id，body 整个直接 update | 匿名可改记录，且 body 不做字段白名单(可改任何列，如分数、行业、域名) | 中 | ④匿名 | guardGlobalAdmin+字段白名单 |
| baselines/domains/[id]/collect | POST | C 无守卫 | 写+花钱(Semrush/DataForSEO) | baseline_domains、baseline_domain_score_history | 路径 id | 匿名可反复触发付费 SEO 数据采集并写历史分数 | 中 | ④匿名 | guardGlobalAdmin |
| baselines/score-history | GET | C 无守卫 | 读 | baseline_domain_score_history | 查询参数 | 行业分数趋势，无客户私有数据 | 低 | ④匿名 | 可顺手加守卫 |
| clients | GET | D(登录+邮箱→client_portal_users 过滤；全局admin全量；受限admin仅自己) | 读 | clients、client_portal_users、goals | 来自会话邮箱，不取自请求参数 | OK：只返回本人有权的客户 | 低 | ①(只看到自己的) | 无 |
| clients/[id]/ad-health/o1-scale | GET | A(requirePaidClientAccess)+再要求全局admin | 读 | action_runs | URL id，同一个 | OK(仅内部全局管理员能读) | 低 | ③ | 无 |
| clients/[id]/ad-health/o1-scale | POST | A+E(全局admin) | 写(建待审批请求，不直接花钱) | ads_growth_states、ad_entity_snapshots、goals、client_automation_policies | URL id；adset_id 必须出现在该客户已落库的检查结果里 | OK：子记录(adset)归属已校验，且需人工批准 | 低 | ③ | 无 |
| clients/[id]/ad-health/stop-loss | POST | A(requirePaidClientAccess)+campaign归属(广告账户级) | 写+外发(直接暂停/砍预算，改 Meta 真实广告) | goals、Kernel、Meta | URL id；body.campaign_id 要核对属于该客户登记的广告账户 | 基本OK。**残留洞(代码里已自承)**：CTS 和 Oztop 共用同一个 Meta 广告账户，账户级归属校验分不出，其中一家的付费员工可暂停/砍另一家的广告 | 中高(涉钱，限共用账户的客户) | ②付费客户成员 | 拆广告账户，或加“广告→客户”归属表 |
| clients/[id]/knowledge/candidates | GET | A(requireDashboardClientAccess)+tier==='admin' | 读 | client_knowledge_facts | URL id | OK。注：tier admin 也包含“受限管理员”(只绑本客户)，他们能批本客户自己的知识——设计意图是“ME内部人员”，见可疑清单 | 低 | ②(admin层，限本客户)/③ | 视需要改 requireGlobalAdmin |
| clients/[id]/knowledge/candidates | POST | 同上 | 写 | client_knowledge_facts | URL id；fact_id 在库函数内按 client_id 过滤 | OK：fact 归属已校验 | 低 | 同上 | 同上 |
| clients/[id]/knowledge/confirmation-requests | GET | 同上 | 读 | 知识确认请求表 | URL id | OK | 低 | 同上 | 同上 |
| clients/[id]/knowledge/confirmation-requests | POST | 同上 | 写+外发邮件(发确认链接) | 同上 | URL id；fact_ids 在库函数内按 client_id 过滤；确认人必须是已登记的 | OK：不返回原始令牌；子记录归属已校验 | 低 | 同上 | 同上 |
| clients/[id]/knowledge/rollout-advance-requests | GET | 同上 | 读 | rollout 请求表 | URL id | OK | 低 | 同上 | 同上 |
| clients/[id]/knowledge/rollout-advance-requests | POST | 同上 | 写+外发邮件 | 同上 | URL id | OK | 低 | 同上 | 同上 |
| clients/[id]/leads | POST | C 公开(设计如此：客户官网表单提交) | 写+外发邮件 | leads、CRM、Resend | URL id(公开 UUID) | 设计即公开，仅靠 CORS(只限浏览器，curl 不受限)、蜜罐、按 IP 限流。限流取 X-Forwarded-For 第一段，可伪造，且限流查询出错时放行：匿名者可对任意客户灌假线索、向客户的通知邮箱灌邮件、污染 CRM。不泄露数据 | 中 | ④匿名 | IP 取代理追加的最后一段/平台头；按客户总量封顶；加人机校验 |
| clients/[id]/meta-ads-ai | GET | A(pilotDashboardAccess→onboarding归属) | 读 | 连接/授权/密钥表(仅本人的) | URL id | OK：按 client_id+授权主体过滤 | 低 | ②本客户成员 | 无 |
| clients/[id]/meta-ads-ai | POST | A(同上；绑定/发密钥另加 activeDashboardAccess) | 写(激活/绑定广告账户/发只读密钥/撤销/生成分析) | meta_ads_read_grants、client_api_keys 等 | URL id；connection_id/grant_id/id 全部同时按 client_id+本人 principal 过滤 | OK：子记录 IDOR 已防(manage.ts 里每处都带 client_id 与 principal) | 低 | ②本客户成员 | 无 |
| clients/[id]/meta-ads/execute | POST | A(requirePaidClientAccess)+campaign归属(广告账户级)；重开广告另要全局admin(PM) | 写+外发(暂停立即生效；降预算走审批队列) | flywheel_actions、Kernel、Meta | URL id；body.campaign_id | 基本OK；残留洞同 stop-loss(共用广告账户时能碰别家系列)；另 params.execution_item_id 只校验是 UUID，没核对属于本客户(可把回执挂到别家待办，影响小) | 中高(涉钱，限共用账户) | ②付费客户成员 | 同上；execution_item_id 加 client_id 校验 |
| clients/[id]/meta-ads/execute | GET | A(requireAdsCampaignBudgetAccess=付费归属) | 读 | action_runs、flywheel_actions | URL id；runId 按 client_id 过滤 | OK | 低 | ② | 无 |
| clients/[id]/projects | GET | A(requireDashboardClientAccess)+行业=地产 | 读 | 楼盘表(store 内恒带 client_id) | URL id | OK | 低 | ② | 无 |
| clients/[id]/projects | POST | A+行业=地产 | 写 | 楼盘表 | URL id | OK | 低 | ② | 无 |
| cms/github/webhook | POST | D(GitHub HMAC-SHA256，timingSafeEqual；没配密钥就拒，fail-closed) | 写(博客置为已发布、产品地图同步) | blog_posts、geo 部署表、product-map | 按 PR 号+PR 链接匹配 | OK；用的是全部仓库共用的同一密钥 | 低 | 持 webhook 密钥者 | 无 |
| contact | POST | C 公开(设计如此：官网联系表单) | 写+外发邮件 | website_lead_events；Resend | body | 无限流/人机校验：可灌内部收件箱；`formType=meta_ads_ai_pilot` 时还会用 ME 品牌给**任意邮箱**发确认邮件(可被用来骚扰第三方邮箱)。内容已转义，无数据泄露 | 中低 | ④匿名 | 加限流/人机校验；确认邮件限频 |
| content/route-a | POST | A(guardContentGeneration→requirePaidClientAccess) | 写+花钱(OpenAI) | content_posts、production_items | body.client_id 与守卫同一个；campaign 按 client_id 取；execution_item_id/production_package_id 均核对属于该客户 | OK：子记录 IDOR 已防 | 低 | ②付费客户成员 | 无 |
| content/route-b | POST | A(同上) | 写+花钱 | content_posts | body.client_id；execution_item_id 已核对 | OK | 低 | ② | 无 |
| content/route-c | POST | A(同上) | 写+花钱 | content_posts、production_items | body.client_id；两个子 id 已核对 | OK | 低 | ② | 无 |

## 可疑但不确定
1. zhugeliang/proactive 是否真有洞，取决于线上 CRON_SECRET 是否一定已配置(我没查线上，按规定不请求线上)。
2. knowledge 六个接口用“tier==='admin'”当“ME内部人员”，但 admin 层也包括只绑单个客户的受限管理员(DB scoped_admin / DEMO_ADMINS)。他们只能碰自己那个客户，没有跨客户问题；但“客户这一方的受限管理员能自批知识并发确认”是否符合“双签”设计意图，需要 PM/架构确认。
3. stop-loss / meta-ads/execute 的共用广告账户残留洞：代码注释已写明，我没验证线上 CTS/Oztop 现在是否仍共用同一账户。
4. google-login、session-route、verify-otp 的 next 校验(`startsWith('/') && !startsWith('//')`)对 `/\host` 是否被目标浏览器当外站，未实测。
5. facebook/tiktok callback 的 state：没有一次性 nonce/会话绑定，我没确认前端发起处是否另有补偿。
6. admin/viral-references 的命令注入是读代码判断(url 拼进 shell)，未实际尝试(按规定不执行)。线上服务器是否真有 yt-dlp、命令执行权限未验证。
7. baselines/domains 的 is_client/notes 内容我没读库，不确定实际是否含客户域名。
