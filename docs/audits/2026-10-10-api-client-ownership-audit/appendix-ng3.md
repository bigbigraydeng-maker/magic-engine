# 附录 · 无守卫名-第3组（逐接口明细，原始清查输出）

> 来源：66号窗口只读清查，2026-10-10。路径省略 `src/app/api` 前缀。分类 A=归属守卫已覆盖 B=仅登录 C=无守卫 D=自定义校验 E=仅管理员。

# result_ng3 · 客户越权清查（名单 list_ng3，共 51 个 handler，全部真读代码）

谁能打到：①任何登录账号 ②客户员工/门户成员 ③仅全局内部管理员 ④匿名；③'=受限管理员(DEMO_ADMINS，role=admin 但只绑单个客户)。
说明：middleware 只拦页面，/api/* 全部不被覆盖（已核对 matcher）。

## 汇总
- A=0, B=0, C=23, D=15, E=13（合计 51）。名单里没有一个用到 requireDashboardClientAccess 等归属守卫；"无守卫"的 C 类里有 8 个是公开设计（获客/落地页），真正有问题的见下表。

## 明细表

| 路径 | 方法 | 类别 | 读写删 | 表 | 客户号来源 | 问题/风险(人话) | 严重度 | 谁能打到 | 修法 |
|---|---|---|---|---|---|---|---|---|---|
| visual/upload | POST | C | 写(存储+表) | visual_assets + visual-assets 公开桶 | 表单 client_id/post_id（自报，未校验） | 任何人不登录就能往公开桶传最多 500MB 文件，并给**任意客户**建一条"已就绪"素材记录；还会每次调用把桶改成公开、取消大小上限 | 高 | ④ | 加 requireSession + requireDashboardClientAccess(client_id)；校验 post_id 属于该 client；去掉 ensureBucket 里的 updateBucket |
| visual/avatar | POST | C | 写+花钱(HeyGen) | content_posts(读), visual_assets(写) | body.client_id/post_id（自报，post 与 client 不比对） | 匿名就能触发 HeyGen 数字人视频生成（烧钱），且能给任意客户号挂素材记录；post_id 取的是别人的脚本 | 高 | ④ | 同上：登录+归属守卫；取 post 时 .eq('client_id', 守卫通过的id) |
| visual/video | POST | C | 写+花钱(Seedance)+写 production_items | content_posts, visual_assets, production_items | body.client_id/post_id/production_package_id（自报） | 同 avatar：匿名烧视频生成钱；可把素材挂到任意客户和任意制作包 | 高 | ④ | 登录+归属守卫；post、package 都校验 client_id |
| visual-assets/[assetId]/upload-version | POST | C | 写(存储+2表) | visual_assets, visual_asset_versions, 存储 | 仅 assetId（间接 IDOR，无任何客户校验） | 匿名拿到一个素材 id 就能用任意文件**覆盖该素材**并标 is_final=true、状态 ready（客户广告/帖子用的图被换掉）；upsert 路径可覆盖旧版本文件 | 高 | ④ | 登录；读出 asset.client_id 后 requireDashboardClientAccess(asset.client_id) |
| visual-assets/[assetId]/edit-status | PATCH | C | 写 | visual_assets | 仅 assetId | 匿名可改任意素材的"外部编辑状态"，置 final 会同时 is_final=true（绕过审核流程） | 中高 | ④ | 同上 |
| visual-assets/[assetId]/versions | GET | C | 读 | visual_asset_versions | 仅 assetId | 匿名可读任意素材全部历史版本地址与备注 | 中 | ④ | 同上 |
| visual/status/[assetId] | GET | C | 读+写+调第三方 | visual_assets(select *), 存储 | 仅 assetId | 匿名读素材整行（含提示词 prompt_used、成本）；GET 还会触发轮询第三方、下载转存、把状态改 failed/ready（读接口有副作用） | 中 | ④ | 登录+按 asset.client_id 归属守卫；副作用拆出去 |
| visual/queue | GET | C | 读 | 无 | 无 | 只返回生成队列配置常量 | 低 | ④ | 可不管 |
| reports/[clientId]/monthly | GET | C | 读 | clients, ai_visibility_*, geo_directives, blog_posts, backlink_velocity, serp_rankings, local_serp_rankings | URL clientId | 匿名凭客户号读完整月报：客户名、AI 排名、竞品名单、反链、关键词排名。客户号被很多旧接口当凭据，等于外泄即可读 | 中 | ④ | requireSession + requireDashboardClientAccess(clientId)（页面在 /dashboard 下，门户用户也走它） |
| reports/[clientId]/monthly/recommendations | POST | C | 读+花钱(OpenAI gpt-4o) | 同上（经 buildMonthlyReport） | URL clientId | 匿名可无限触发 GPT-4o（烧钱）并拿到该客户数据驱动的建议文 | 中 | ④ | 同上，另加频率限制 |
| publer-published | POST | C | 写 | content_posts, flywheel action | body.publer_post_id | 没有任何签名/密钥：知道 publer_post_id 的人可把帖子伪标记为"已发布"并写入飞轮成果（污染归因/验证）；不外发 | 中 | ④ | 校验 Publer 回调密钥或 HMAC 令牌，缺密钥时拒绝（fail-closed） |
| tools/github-commits | GET | C | 读(调 GitHub) | 无 | 无 | 用服务器的 GITHUB_TOKEN 匿名代拉 **私有仓库** 最近 25 条提交信息+作者名，公开给任何人（提交说明里可能含客户/内部信息） | 中 | ④ | 改为 guardGlobalAdmin，或只展示脱敏摘要 |
| transcript | POST | C | 调第三方(Supadata，花钱) | 无 | 无 | 匿名可无限拿视频转写，烧 Supadata 额度 | 低中 | ④ | requireSession + 限流 |
| scan/run | POST | C | 调 Jina+Claude(花钱) | 无 | 无 | 公开设计（品牌体检获客页）；限流是进程内存、按可伪造的 X-Forwarded-For，实际拦不住有意刷的人；url 交给 Jina 外部抓取（SSRF 风险小） | 低中 | ④ | 换成库里持久限流（可复用 public/site-check 的 consumeSteps） |
| public-scan/start | POST | C | 写+花钱(Claude agent+DataForSEO≈$0.57/次) | public_scan_jobs, discovery_leads, 限流表 | body.url（域名，不是客户） | 公开获客设计，有 IP/邮箱/域名三维持久限流；IP 取自可伪造的 XFF，换邮箱即可绕过每人 3 次，成本放大点 | 低中 | ④ | IP 用平台可信头；加全站日总量上限（site-check 那种） |
| public-scan/status/[jobId] | GET | C | 读 | public_scan_jobs | jobId（UUID 作凭据） | 凭 jobId 取公开扫描结果，数据本就是对公开域名的扫描；cached 命中会把别人的 jobId 返回给任何扫同域名的人 | 低 | ④ | 可不管 |
| public/site-check | POST | C | 写+花钱(模型) | tools-lab 限流表、leads | 无客户号 | 公开设计；有来源域名检查+访客限流+全站日/月上限+24h 复用，较完善（Origin 头非浏览器可伪造，但有成本上限兜底） | 低 | ④ | OK |
| public/site-check/report | POST | C | 写+外发邮件 | leads | body.leadId(UUID 凭据)+email | 凭 leadId 可让系统把报告邮件发到**任意邮箱**（一线索一封、有每访客/每收件人/全站日上限，已做防滥用）；邮箱需同意勾选 | 低 | ④ | OK（可选：leadId 绑定访客 key） |
| report/[id]/interest | POST | C | 写+外发提醒邮件 | outbound_prospects | URL id(UUID 凭据) | 公开表单设计；任何拿到链接的人可提交，且**覆盖**上一次 lead_response（不是追加）、无限流，可刷内部提醒邮件 | 低中 | ④ | 加限流；lead_response 改追加 |
| unsubscribe/[id] | POST | C | 写 | outbound_prospects | URL id(UUID 凭据) | 退订链接设计如此；只能把 prospect 置 opted_out，不降级 converted/archived，安全 | 低 | ④ | OK |
| training/leads | POST | C | 写 | website_lead_events | 无 | 公开埋点：匿名可灌垃圾行；字段 href 自由文本（污染统计） | 低 | ④ | 限流/来源检查 |
| voice/health | GET | C | 读 | 无 | 无 | ?check=ready 匿名可见 store 类型、各 provider 是真还是 mock、外呼开关；无密钥 | 低 | ④ | 把 ready 分支放到 admin 后面 |
| webhooks/creatomate | POST | C | 读+发事件 | content_factory_render_jobs | body.id | 渲染完成回调，**不验来源**（官方无签名，已在注释说明）；只发"唤醒"事件，真实状态另查接口，匿名最多让工作流多查一次，响应体统一不泄露存在性 | 低 | ④ | OK（可加 URL 内随机段） |
| reel-batch/approve | POST | D | 发事件 | 无 | body.batch_id | 请求头 x-internal-secret 与 SUPABASE_SERVICE_ROLE_KEY 全等（缺失则 401，fail-closed）；用最高权限钥匙当内部口令，口令一泄露=数据库全开，且是 === 比较非恒定时间 | 低中 | 仅持钥匙者 | 改用独立的 INTERNAL_API_SECRET + timingSafeEqual |
| reel-batch/start | POST | D | 发事件(触发渲染，花钱) | 无 | body.batch_id(schema) | 同上；注释写"INTERNAL_API_SECRET"，实际用 service role key | 低中 | 同上 | 同上 |
| stripe/webhook | POST | D | 写 | stripe_events_log, mtc_purchases, clients | 事件 metadata.client_id | 验 Stripe 签名，缺密钥时 constructEvent 抛错=拒绝，幂等表防重放；client_id 取自我们自己创建结算会话时写的 metadata，可信 | OK | 无 | OK |
| team-memory/context | POST | D | 读 | work_sessions, work_events | project_key | CRON_SECRET Bearer（未配置→500，fail-closed）；内部开发记忆，无客户数据；非恒定时间比较（!==） | 低 | 持 CRON_SECRET 者 | 可换 timingSafeEqual |
| team-memory/distill | POST | D | 写+调 Claude | work_sessions 等 | body.session_key | 同上 | 低 | 同上 | 同上 |
| team-memory/ingest | POST | D | 写 | work_sessions/events | body | 同上 | 低 | 同上 | 同上 |
| team-memory/lessons | POST | D | 写(upsert,≤500) | team_lessons | body | 同上；可批量覆盖 lesson_key | 低 | 同上 | 同上 |
| team-memory/lessons | GET | D | 读 | team_lessons | ?project 拼进 .or() 过滤串 | 同上；project 参数未转义直接拼进 PostgREST or 表达式（持密钥者才能到，影响仅过滤注入） | 低 | 同上 | 白名单校验 project |
| upload/[token] | POST | D | 写(存储+client_assets) | clients, listings, client_assets, 存储 | 令牌解密出的 clientId/listingId（AES-GCM，缺密钥 fail-closed） | 设计为"链接即凭据"：客户号来自密文令牌，非 URL 自报；listing 校验属于该客户；有大小/数量/10分钟300个限流；链接不过期无单条吊销（已知取舍）；限流计数失败时放行 | 低 | 持链接者（只能往该客户素材库写） | OK |
| voice/webhooks/openai | POST | D | 写+开通话会话 | voice 表 | 路由到 tenant 由号码路由决定 | OpenAI 签名验证(含重放窗口)，缺密钥=拒绝；mock provider 在缺 key 时对无签名放行，但生产环境配置层强制不允许 mock(fail fast) | 低 | 仅 OpenAI | OK |
| webhooks/meta/messenger | GET | D | 读 | 无 | 无 | META_VERIFY_TOKEN 恒定时间比较，缺则 500 | 低 | 仅 Meta | OK |
| webhooks/meta/messenger | POST | D | 写+发事件 | conversations, messages, optout 表 | 页面ID→clients.facebook_page_id，且过 assessPageBinding 验证绑定 | HMAC(META_APP_SECRET)恒定时间验签，缺密钥 500；绑定已验证才入库；失败 503 让 Meta 重投 | OK | 仅 Meta(带签名) | OK |
| webhooks/whatsapp | GET | D | 读 | 无 | 无 | 同上验证令牌 | 低 | 仅 Meta | OK |
| webhooks/whatsapp | POST | D | 写+发事件 | conversations, messages 等 | phone_number_id→clients.whatsapp_phone_number_id | HMAC 验签 fail-closed；但**没有** messenger 那种 assessPageBinding（号码绑定已验证）这一道，号码映射若客户员工可改则存在串户可能（见可疑清单） | 低(待确认) | 仅 Meta(带签名) | 看下面可疑项 |
| zhangqian-revalidate | GET | D | 读+可写(persist=1) | client_discovery_jobs, client_discovery | ?job_id | requireBearerToken(INTERNAL_API_KEY，缺则 500，恒定时间)；文件头写"TEMPORARY — DELETE before commit"但已提交；persist=1 会覆盖对应客户的 client_discovery（客户号取自 job，非自报） | 低 | 持内部 key 者 | 该临时接口应删除 |
| voice/integration-status | GET | E | 读 | 无(配置) | 无 | requireVoiceAdmin=任何 admin（含 DEMO_ADMINS 受限管理员）；只显示"已配置/缺失"不泄露密钥 | 低 | ③ + ③' | 改全局 admin |
| voice/tenants | GET | E | 读 | voice tenants/agents/routes/kb | 无（列全部租户） | 受限管理员能列出**所有客户**的语音租户及计数 | 中 | ③+③' | requireGlobalAdmin，或按 tenant.client_id 过滤 |
| voice/tenants | POST | E | 写 | voice_tenants | body.client_id | 受限管理员可新建租户并绑任意客户号 | 中 | ③+③' | requireGlobalAdmin |
| voice/tenants/[tenantId] | PATCH | E | 写 | voice_tenants | URL tenantId | 受限管理员可改任意租户名称/绑定客户/状态(暂停)/向量库 id | 中高 | ③+③' | requireGlobalAdmin 或校验 tenant.client_id=allowedClientId |
| voice/tenants/[tenantId]/agents | GET | E | 读 | voice_agents | URL tenantId | 读任意租户的 AI 话务员提示词/转接号码 | 中 | ③+③' | 同上 |
| voice/tenants/[tenantId]/agents | POST | E | 写 | voice_agents | URL tenantId（agent 属于该租户有校验） | 受限管理员可改任意租户话务员话术、转接号码、启用工具（影响真实来电与转人工） | 中高 | ③+③' | 同上 |
| voice/tenants/[tenantId]/calls | GET | E | 读 | voice_calls | URL tenantId | 读任意租户的最近 100 通来电记录（含来电方号码等客人信息） | 高 | ③+③' | 同上 |
| voice/tenants/[tenantId]/leads | GET | E | 读 | voice_leads | URL tenantId | 读任意租户电话线索（客人姓名/电话） | 高 | ③+③' | 同上 |
| voice/tenants/[tenantId]/knowledge | GET | E | 读 | voice_knowledge | URL tenantId | 列任意租户知识库文档标题 | 中 | ③+③' | 同上 |
| voice/tenants/[tenantId]/knowledge | POST | E | 写 | voice_knowledge | URL tenantId | 往任意租户知识库塞文档（话务员会据此回答客人，可改说法/价格） | 中高 | ③+③' | 同上 |
| voice/tenants/[tenantId]/knowledge/[docId] | DELETE | E | 删(软删) | voice_knowledge | URL tenantId+docId，已校验 doc.tenant_id=URL tenantId | 子记录归属校验有，但租户本身不校验归属：受限管理员可停用任意租户的知识文档 | 中 | ③+③' | 同上 |
| voice/tenants/[tenantId]/phone-routes | GET | E | 读 | voice_phone_routes | URL tenantId | 读任意租户号码路由 | 中 | ③+③' | 同上 |
| voice/tenants/[tenantId]/phone-routes | POST | E | 写 | voice_phone_routes | URL tenantId（agent 属于租户已校验） | 受限管理员可改任意租户的电话号码路由（改接到哪个话务员）；existing 按号码在本租户内找，不会跨租户，但号码本身是否已被其它租户占用未校验 | 中高 | ③+③' | 同上 + 校验号码全局唯一归属 |

## 可疑但不确定
1. **voice 整组 E 类的真实风险取决于 DEMO_ADMINS 里有没有人**：requireVoiceAdmin 用 getUserPermissions().role==='admin'，而受限管理员(DEMO_ADMINS)返回的也是 role:'admin'+allowedClientId。我没读环境变量（不允许），不知道线上有几个。若线上没有受限管理员，这 13 个实际只有内部人能打到，风险降为"防未来"。voice 租户 client_id 还可为 null（不归任何客户）。
2. **webhooks/whatsapp** 用 clients.whatsapp_phone_number_id 把号码映射到客户，没有像 messenger 那样的 assessPageBinding 校验；若客户员工能在设置页自己改这一列（messenger 注释说 facebook_page_id 以前"client staff could edit until 2026-09-14"），可能让别的号码消息串进自己名下。需查 clients 更新接口是否限制该字段。
3. **visual 系列的调用方**：app/dashboard/visuals、content、SocialPlanSection 等页面在 /dashboard 下受 middleware 保护，但 API 本身无守卫——页面保护不等于接口保护。assetId/post_id 是 UUID，但素材公开 URL 路径里带 client_id/post_id（visual/upload、upload-version 的存储路径用明文 client_id/post_id），所以公开桶里任何一张素材图链接外泄就同时外泄 client_id+post_id，可被用来打这些接口。upload/[token] 已改用哈希前缀，这几个旧接口没改。
4. **visual-assets/[assetId]/select**（同目录）不在我的名单，未读，建议同批核查。
5. **reel-batch/* 用 SUPABASE_SERVICE_ROLE_KEY 做请求头口令**：调用方（本地脚本）把全库最高钥匙放在请求头里发出去，日志/代理若记录请求头即泄露；非恒定时间比较。我没验证是否有日志记录请求头。
6. **tools/github-commits** 是否真的私有仓库未验证（只看到代码用 token 访问）；若仓库是公开的则风险降为低。
7. **public/site-check/report** 的 Origin 检查对非浏览器调用可伪造，靠后面的限流兜底，已判低。
8. **stripe/webhook** 价格表键在缺 STRIPE_PRICE_ID_* 环境变量时退化成固定字符串 'price_starter' 等；因为已验签，攻击者无法构造事件，仅是配置缺失时的静默错配风险。

## 没读懂/没验证
- 没读 getUserPermissions 之外的受限管理员实际名单；没读 lib/team-memory/ingest|context|distill 内部、lib/voice/store 实现（Supabase 还是内存）、lib/tools-lab/site-check/leads 内部。
