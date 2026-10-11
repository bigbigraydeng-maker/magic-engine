# 附录 · clients-成员已有守卫-第1组（逐接口明细，原始清查输出）

> 来源：66号窗口只读清查，2026-10-10。路径省略 `src/app/api` 前缀。分类 A=归属守卫已覆盖 B=仅登录 C=无守卫 D=自定义校验 E=仅管理员。

# 66号窗口 · 客户越权清查 · cl1 结果（只读，clients/[id]/** 已有守卫的 handler，共 130 个 handler / 94 个文件）

背景小抄：requireDashboardClientAccess=本客户任何成员(含 self_serve 免费档)；requirePaidClientAccess=本客户付费档/FDE/admin；requireOnboardingClientAccess=与 Dashboard 相同(只是标签)。
受限管理员：env DEMO_ADMINS 与 DB 里 scoped_admin=true 在各自客户内 tier=admin/role=admin(代码里没有任何接口会写 scoped_admin,只能库里人工配置);guardAdmin 类问题在本名单里只出现为"tier==='admin'"判断(provenance PATCH)。
守卫传参：本名单所有 handler 守卫传的都是 URL 里的 id,且取数用的也是同一个 id(没发现"守卫用A、取数用 body.client_id"的错位)。

## 汇总
- 查了 130 个 handler(类别: A 守卫覆盖且传真取数 id=125 其中 2 个带 IDOR(A+IDOR)；E 仅全局 admin=3；B/C/D=0)。
- 主要问题不是"没守卫",而是①守卫档次太低(self_serve 免费档能打到外发/花钱接口) ②个别子资源编号没校验归属 ③一个共享凭证回退。

## 最严重的几条
1. content-posts/[postId]/publish POST(高) — 任何成员(含免费 self_serve)能把自己客户一条 approved 内容真发到社媒；Publer 回退用 ME 共享工作区第一个账号 → 可能发到别家主页。
2. content-factory/[postId] PATCH confirm/schedule(高) — 成员自己把帖子置 approved、LinkedIn 帖直接真发、排 Creatomate 渲染花钱；上一条的"审批"可被它绕过。
3. brief/[briefId]/chat POST(高) — briefId 没校验归属，拿到别家 brief UUID 就能读+让AI改写(src/lib/brief/refine.ts 只按 id 读写)。
4. connectors/[anchor]/connect POST anchor=gsc(中高) — body.config.site_url 未校验，GSC 读取回退 ME 的 service account，可把别家站点热门搜索词拉进自己的报告；同路由还允许成员自己写 Publer 绑定。
5. content-factory/[postId]/lecture PATCH publish_facebook + assets/storyboard/.../generate-video + content-factory/run-intake + comment-autoreply-run/config (中/中高) — self_serve 免费档能触发外发或烧钱(Seedance 视频、Apify 抓取、Facebook 评论机器人)。

| 路径 | 方法 | 类别 | 读写删 | 表 | 客户号来源 | 问题/风险(人话) | 严重度 | 谁能打到 | 修法 |
|---|---|---|---|---|---|---|---|---|---|
| /api/clients/[id] | GET | A | 读 | clients | URL id | OK — GET 只读自己;DELETE/PATCH 仅全局admin(白名单字段) | 无 | ②本客户成员 | — |
| /api/clients/[id] | DELETE | E-global | 删 | clients | URL id | OK — GET 只读自己;DELETE/PATCH 仅全局admin(白名单字段) | 无 | ③仅全局admin | — |
| /api/clients/[id] | PATCH | E-global | 写 | clients | URL id | OK — GET 只读自己;DELETE/PATCH 仅全局admin(白名单字段) | 无 | ③仅全局admin | — |
| /api/clients/[id]/ad-accounts/[accountId]/daily-cap | PATCH | E-global | 写 | client_meta_ad_accounts,ad_strategy_configs,ad_entity_snapshots | URL id | OK — requireGlobalAdmin(仅全局管理员);accountId 校验属于该client | 无 | ③仅全局admin | — |
| /api/clients/[id]/ad-health | GET | A | 读 | ad_health_narratives,ads_growth_states | URL id | OK — requirePaid;全部 .eq client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-health/auto-pause | GET | A | 读 | ad_health_narratives,ads_growth_states | URL id | OK — requirePaid;全部 .eq client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-health/auto-pause/[runId]/decision | POST | A | 写 | flywheel_actions,action_runs | URL id | OK — requirePaid;run.client_id===URL id 才放行;批准另过 assertActorMayApproveAction(档次) | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-health/execute-prescription | POST | A | 写 | winner_reel_sync_config,Meta | URL id | OK — requirePaid;只允许 kind=refresh_creatives,新广告以 PAUSED 创建 | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-health/o1-scale/[runId]/decision | POST | A | 写 | action_runs | URL id | OK — requirePaid+仅全局admin;run.client_id校验 | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-health/stop-loss | GET | A | 读 | goals,action_runs,Meta | URL id | OK — requirePaid;campaign_id 经 assertCampaignOwnedByClient 校验属于该客户登记的广告账户,再走 Kernel 提交 | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-outcome-config | GET | A | 读 | ad_strategy_configs | URL id | OK — GET requirePaid;PATCH 另要全局admin | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-outcome-config | PATCH | A | 写 | ad_strategy_configs | URL id | OK — GET requirePaid;PATCH 另要全局admin | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-strategy-config | GET | A | 读 | ad_strategy_configs | URL id | OK — GET requirePaid;PATCH/approve 另要全局admin,creative_pool 审批只走专用接口 | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-strategy-config | PATCH | A | 写 | ad_strategy_configs | URL id | OK — GET requirePaid;PATCH/approve 另要全局admin,creative_pool 审批只走专用接口 | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ad-strategy-config/creative-pool/approve | POST | A | 写 | ad_strategy_configs | URL id | OK — GET requirePaid;PATCH/approve 另要全局admin,creative_pool 审批只走专用接口 | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/agents | GET | A | 读 | agent_customers,contacts,contact_identities | URL id | OK — requirePaid+行业开关;contact/行按client_id;reply 的 conversation 在 sendMailReply 内校验 client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/agents/customers | POST | A | 写 | agent_customers,contacts,contact_identities | URL id | body.conversationId 未校验属于该客户(仅存字段,不读) | 低 | ②付费档成员 | 校验 conversation.client_id |
| /api/clients/[id]/agents/customers | PATCH | A | 写 | agent_customers,contacts,contact_identities | URL id | OK — requirePaid+行业开关;contact/行按client_id;reply 的 conversation 在 sendMailReply 内校验 client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/agents/reply | POST | A | 写 | agent_customers,contacts,contact_identities | URL id | OK — requirePaid+行业开关;contact/行按client_id;reply 的 conversation 在 sendMailReply 内校验 client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/ai-factory/fan-out | POST | A+IDOR | 写(AI花费) | master_briefs,campaign_briefs,execution_items | URL id;body.campaignId/executionItemId未校验 | campaignId 直接按 id 取 campaign_briefs(无client_id),别家活动内容会进AI提示词/成品;executionItemId 直接按 id UPDATE execution_items,可改别家任务行 | 中 | ②任何成员(含self_serve) | 两处都加 .eq client_id=URL id |
| /api/clients/[id]/anomaly-signals | GET | A | 读 | anomaly_signals | URL id | OK — requirePaid;.in(ids).eq client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/anomaly-signals | PATCH | A | 写 | anomaly_signals | URL id | OK — requirePaid;.in(ids).eq client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/api-keys | GET | A | 读 | client_api_keys | URL id | OK — role==="admin"(含本客户受限管理员);keyId .eq client_id;跨站来源检查 | 无 | ②本客户成员 | — |
| /api/clients/[id]/api-keys | POST | A | 写 | client_api_keys | URL id | OK — role==="admin"(含本客户受限管理员);keyId .eq client_id;跨站来源检查 | 无 | ②本客户成员 | — |
| /api/clients/[id]/api-keys/[keyId] | DELETE | A | 删 | client_api_keys | URL id | OK — role==="admin"(含本客户受限管理员);keyId .eq client_id;跨站来源检查 | 无 | ②本客户成员 | — |
| /api/clients/[id]/asset-library/search | POST | A | 写 | client_assets | URL id | OK — A;.eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/assets | GET | A | 读 | client_assets,storage | URL id | OK — A;只读写本客户 | 无 | ②本客户成员 | — |
| /api/clients/[id]/assets | POST | A | 写 | client_assets,storage | URL id | OK — A;只读写本客户 | 无 | ②本客户成员 | — |
| /api/clients/[id]/assets/[assetId]/archive | POST | A | 写 | client_assets | URL id | OK — assetId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/assets/[assetId]/provenance | PATCH | A | 写 | client_assets | URL id | 注释说"必须 ME 团队来确认",实际判 tier==="admin",本客户的 DB 受限管理员/env演示管理员也过(只限本客户);确认后可背书"真实价格" | 低 | 本客户受限管理员 | 要求 allowedClientId===null(全局admin) |
| /api/clients/[id]/assets/storyboard | POST | A | 写(AI花费) | asset_storyboards | URL id | 调 AI 写分镜无 MTC 扣费(小额) | 低 | ②含self_serve | 加 MTC/预算闸 |
| /api/clients/[id]/assets/storyboard | GET | A | 读 | asset_storyboards | URL id | OK — selectAssetsForTheme 只在本客户素材里选 | 无 | ②本客户成员 | — |
| /api/clients/[id]/assets/storyboard/[storyboardId]/generate-video | POST | A | 写(花钱) | asset_storyboards,reels_drafts,Seedance | URL id,storyboardId .eq client_id | self_serve 可无限创建分镜并调 Seedance 视频生成,没有 MTC 扣费、没有预算闸、没有付费档限制 | 中高(钱) | ②含self_serve(含自助注册陌生人) | 改 requirePaidClientAccess,或加 checkBudget+deductMtc |
| /api/clients/[id]/assets/storyboard/[storyboardId]/send-to-kanban | POST | A | 写 | asset_storyboards,client_assets,reels_drafts | URL id | OK — storyboard/素材均 .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/blog | GET | A | 读 | blog_posts | URL id | OK — GET .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/blog | POST | A | 写(花钱,有MTC) | blog_posts,production_items | URL id | body.production_package_id 未校验归属,会往别家的 production package 里插一行(client_id写本客户);MTC 计费正常 | 低中 | ②任何成员 | 校验 package.client_id===URL id |
| /api/clients/[id]/blog/[postId] | GET | A | 读 | blog_posts | URL id | OK — postId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/blog/[postId] | PATCH | A | 写 | blog_posts | URL id | OK — postId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/blog/[postId] | DELETE | A | 删 | blog_posts | URL id | OK — postId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/blog/[postId]/image | POST | A | 写(AI花费) | blog_posts | URL id | 调生图(Visual Studio)无 MTC 扣费/预算闸 | 低中(钱,小额) | ②含self_serve | 加 MTC 扣费或限付费档 |
| /api/clients/[id]/blog/[postId]/refine | POST | A | 写(AI花费) | blog_posts | URL id | 调 Claude 改稿无 MTC 扣费 | 低 | ②含self_serve | 加 MTC 扣费 |
| /api/clients/[id]/blog/[postId]/social-suggestions | POST | A | 写 | blog_posts | URL id | OK — A + INTERNAL_API_KEY Bearer(浏览器打不通);lib内校验post.client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/blog/keyword-suggestions | GET | A | 读 | seo_analyses | URL id | OK — .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/blog/opportunities | GET | A | 读 | — | URL id | OK — 只读,按clientId | 无 | ②本客户成员 | — |
| /api/clients/[id]/brand-aliases | GET | A | 读 | clients | URL id | OK — 只动该客户自己的一行 | 无 | ②本客户成员 | — |
| /api/clients/[id]/brand-aliases | PATCH | A | 写 | clients | URL id | OK — 只动该客户自己的一行 | 无 | ②本客户成员 | — |
| /api/clients/[id]/brand-geo-anchors | GET | A | 读 | clients | URL id | OK — 只动该客户自己的一行 | 无 | ②本客户成员 | — |
| /api/clients/[id]/brand-geo-anchors | PATCH | A | 写 | clients | URL id | OK — 只动该客户自己的一行 | 无 | ②本客户成员 | — |
| /api/clients/[id]/brand-redlines | GET | A | 读 | clients | URL id | OK — 只动该客户自己的一行 | 无 | ②本客户成员 | — |
| /api/clients/[id]/brand-redlines | PATCH | A | 写 | clients | URL id | OK — 只动该客户自己的一行 | 无 | ②本客户成员 | — |
| /api/clients/[id]/brief | GET | A | 读 | master_briefs | URL id | OK — .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/brief | PUT | A | 写 | master_briefs | URL id | OK — .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/brief-status | GET | A | 读 | client_portal_users,master_briefs | URL id | OK — 只读自己 | 无 | ②本客户成员 | — |
| /api/clients/[id]/brief/[briefId] | GET | A | 读 | master_briefs | URL id | OK — briefId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/brief/[briefId] | PATCH | A | 写 | master_briefs | URL id | OK — briefId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/brief/[briefId] | DELETE | A | 删 | master_briefs | URL id | OK — briefId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/brief/[briefId]/activate | POST | A | 写 | master_briefs | URL id | OK — briefId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/brief/[briefId]/chat | POST | A+IDOR | 读写 | master_briefs | URL id(守卫);briefId未校验 | 守卫只验URL里的客户;refineBrief(briefId)按 id 读 master_briefs、再按 id UPDATE(src/lib/brief/refine.ts),不核对 brief 属于该客户。任何成员拿到别家 brief 的UUID就能读到并让AI改写它(跨客户篡改品牌/VI简报) | 高 | ②任何绑定了某客户的成员(含self_serve) | route 先查 master_briefs id=briefId & client_id=URL id;refineBrief 增加 clientId 参数并双 .eq |
| /api/clients/[id]/brief/generate | POST | A | 写(AI花费) | master_briefs,存储 | URL id | body.file_urls 被当存储路径直接下载喂AI(没校验以 clientId/ 开头);路径含客户号+毫秒时间戳+文件名,难猜。另 AI/DataForSEO/Jina 花费无 MTC | 低 | ②含self_serve | 校验路径前缀=URL id |
| /api/clients/[id]/brief/upload | POST | A | 写 | storage | URL id | OK — 路径前缀=clientId | 无 | ②本客户成员 | — |
| /api/clients/[id]/business-inbox/conversations | GET | A | 读 | conversations,conversation_messages | URL id | OK — requirePaid;conversationId .eq client_id+channel(客人邮件正文) | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/business-inbox/conversations/[conversationId]/messages | GET | A | 读 | conversations,conversation_messages | URL id | OK — requirePaid;conversationId .eq client_id+channel(客人邮件正文) | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/campaign | GET | A | 读 | campaign_briefs | URL id | OK — .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/campaign | POST | A | 写 | campaign_briefs | URL id | OK — .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/campaign-daily-plan | GET | A | 读 | social_plans,client_assets,campaign_briefs | URL id | OK — campaign/asset 归属校验齐全 | 无 | ②本客户成员 | — |
| /api/clients/[id]/campaign-daily-plan | POST | A | 写 | social_plans,client_assets,campaign_briefs | URL id | OK — campaign/asset 归属校验齐全 | 无 | ②本客户成员 | — |
| /api/clients/[id]/campaign-daily-plan/post-review | PATCH | A | 写 | social_plans,client_assets | URL id | OK — requirePaid;PASS要求role=admin;plan/asset按client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/campaign-daily-plan/publish | POST | A | 写+外发 | social_plans,Meta Graph | URL id,全部按 clientId | 真发 Facebook 主页帖(含定时)。只要求付费档成员+此前有 role=admin 的 PASS 评审+queue 回执;发布这一步本身不要求 ME 内部管理员/Ray 授权,receipt 里直接写 publishing_authorization=AUTHORIZED、approved_by=调用者。归属校验齐全 | 中(外发,仅限本客户主页) | ②本客户付费档成员(含客户自己用 users 接口发出的 fde 成员) | 发布改 requireGlobalAdmin 或校验内部授权事件 |
| /api/clients/[id]/campaign-daily-plan/publish-queue | POST | A | 写 | social_plans,Meta | URL id | 只登记"准备发布"回执(no_publish,不外发);要求 role=admin 评审 PASS | 低 | ②付费档成员 | — |
| /api/clients/[id]/campaign-daily-plan/recall | POST | A | 写 | social_plans,Meta | URL id | OK — requirePaid;post_id 取自本客户 publish_meta;删除FB帖(撤回功能) | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/campaign-daily-plan/tune-suggestions | GET | A | 读 | flywheel_actions | URL id | OK — .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/campaign/[campaignId] | GET | A | 读 | campaign_briefs | URL id | OK — campaignId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/campaign/[campaignId] | DELETE | A | 删 | campaign_briefs | URL id | OK — campaignId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/campaign/[campaignId] | PATCH | A | 写 | campaign_briefs | URL id | 展开 body 除 status/client_id/id 外所有列(批量赋值) | 低 | ②含self_serve | 白名单字段 |
| /api/clients/[id]/campaign/[campaignId]/archive | POST | A | 写 | campaign_briefs | URL id | OK — campaignId .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/campaign/[campaignId]/batch-generate | POST | A | 写(AI花费) | content_posts | URL id | 一次最多30帖×3次重试调 GPT+审核,无 MTC 扣费;读 campaign.source_file_urls(创建活动时可任意填)指向的存储文件喂AI | 低中 | ②含self_serve | 加预算闸;限制 source_file_urls 前缀 |
| /api/clients/[id]/campaign/[campaignId]/enrich | POST | A | 写(DataForSEO/Jina花费) | campaign_briefs | URL id | 调 DataForSEO/Jina 无 MTC 扣费(小额);末次 UPDATE 只按 id 但前面已校验归属 | 低 | ②含self_serve | 可选:加预算闸 |
| /api/clients/[id]/campaign/[campaignId]/generate-visual | POST | A | 写(AI花费) | campaign_briefs | URL id | body.vi_input_file_urls 当存储路径下载(无前缀校验,路径难猜);Claude 花费无 MTC | 低 | ②含self_serve | 校验路径前缀 |
| /api/clients/[id]/campaign/[campaignId]/preview-prompt | POST | A | 读(AI花费) | campaign_briefs | URL id | 调 GPT 无 MTC 扣费(小额) | 低 | ②含self_serve | 可选 |
| /api/clients/[id]/campaign/upload | POST | A | 写 | storage(campaign-uploads) | URL id | OK — 路径前缀=clientId | 无 | ②本客户成员 | — |
| /api/clients/[id]/client-status | GET | A | 读 | clients | URL id | OK — PATCH 要 tier==="admin" | 无 | ②本客户成员 | — |
| /api/clients/[id]/client-status | PATCH | A | 写 | clients | URL id | OK — PATCH 要 tier==="admin" | 无 | ②本客户成员 | — |
| /api/clients/[id]/cms/connect | POST | A | 写(凭证) | cms_connections | URL id | 存 GitHub 令牌;本客户付费成员可覆盖/删除(设计内) | — | ②付费档成员 | — |
| /api/clients/[id]/cms/connect | PATCH | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/connect | DELETE | A | 删 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/github/update-page | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/providers | GET | A | 读 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/publish-blog | POST | A | 写+外发 | cms_connections,website_publish_jobs,blog_posts | URL id | 向客户 GitHub 开 PR;blog_post 按 client_id 校验;body.execution_item_id 未校验归属(只写进本客户 flywheel_actions) | 低 | ②付费档成员 | 可选:校验 execution_item 属于本客户 |
| /api/clients/[id]/cms/publish-geo-snippet | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/publish-geo-to-github | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/publish-shopify | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/publish-wordpress | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/shopify | GET | A | 读 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/shopify | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/shopify | DELETE | A | 删 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/status | GET | A | 读 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/test | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress | GET | A | 读 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress | DELETE | A | 删 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress/category | PATCH | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress/lookup-post | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress/test | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress/theme-uppercase-check | GET | A | 读 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress/update-post | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/cms/wordpress/yoast-probe | POST | A | 写 | cms_connections,website_publish_jobs,blog_posts | URL id | OK — requirePaid;凭证/连接/blog/job 均按 clientId;URL有ssrf-guard | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/comment-autoreply-config | GET | A | 读 | social_comment_config | URL id | OK — GET 只读 | 无 | ②本客户成员 | — |
| /api/clients/[id]/comment-autoreply-config | PATCH | A | 写 | social_comment_config | URL id | self_serve 可自己打开"全自动评论回复"总开关并改配置(主页号受 AD-SEC-4 约束,指向别家主页会被拒) | 中 | ②含self_serve | 改 requirePaidClientAccess |
| /api/clients/[id]/comment-autoreply-posts | GET | A | 读 | Meta Graph | URL id | OK — 只读;主页经 authorizeConfiguredPage(AD-SEC-4) | 无 | ②本客户成员 | — |
| /api/clients/[id]/comment-autoreply-probe | GET | A | 读 | Meta Graph | URL id | OK — 只读;主页经 authorizeConfiguredPage | 无 | ②本客户成员 | — |
| /api/clients/[id]/comment-autoreply-run | POST | A | 外发(花钱) | social_comment_engagements,Meta Graph | URL id | 手动触发 processClientComments:在本客户已绑定 Facebook 主页公开回评论/隐藏评论/私信 + AI 回复费用。未付费(self_serve)也能打;跨客户主页已被 pageGate 堵住 | 中(外发+AI费用,仅限本客户主页) | ②含self_serve | 改 requirePaidClientAccess |
| /api/clients/[id]/comment-engagements | GET | A | 读 | social_comment_engagements | URL id | OK — 行 .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/comment-engagements | PATCH | A | 写+外发(删FB回复) | social_comment_engagements | URL id | revert 会在 Facebook 上删机器人回复(行按 client_id);body.reviewer 自报名字可伪造审计字段 | 低 | ②含self_serve | reviewer 取登录邮箱 |
| /api/clients/[id]/competitor-domains | GET | A | 读 | clients | URL id | OK — monitoring 需 role admin | 无 | ②本客户成员 | — |
| /api/clients/[id]/competitor-domains | PATCH | A | 写 | clients | URL id | OK — monitoring 需 role admin | 无 | ②本客户成员 | — |
| /api/clients/[id]/connectors/[anchor]/connect | POST | A | 写 | client_connectors,client_discovery_jobs | URL id;body.config.site_url未校验 | anchor=gsc 时 body.config.site_url 原样传给 fetchGscSearchPerformance,本客户没 Google 授权就回退到 ME 的 service account 令牌(对很多客户的GSC有权限)=>填别家站点网址就能把对方热门搜索词/点击/展示拉进自己的发现报告;另 publer/social 绑定(config.publer_account_ids)成员可自己改,可指向任意 Publer 账号(见 content-posts publish) | 中高(跨客户读客户业务数据) | ②任何成员含self_serve | site_url 只接受等于本客户域名;禁止 service account 回退;publer/social 绑定仅内部管理员可写 |
| /api/clients/[id]/connectors/status | GET | A | 读 | client_connectors | URL id | OK — 只读自己 | 无 | ②本客户成员 | — |
| /api/clients/[id]/contacts | GET | A | 读 | contacts,contact_touchpoints,listings,conversations,conversation_briefs | URL id | OK — requirePaid;全部 .eq client_id | 无 | ②本客户付费档成员 | — |
| /api/clients/[id]/content-factory/[postId] | PATCH | A | 写+外发+花钱 | content_posts,content_factory_render_jobs,Publer,Creatomate | URL id;post .eq client_id | action=confirm:任何成员可自己把帖子置 approved(审批形同虚设)、对 LinkedIn 来源帖直接 scheduleSocialPost 真发、并排 Creatomate 渲染任务(花钱);action=schedule 置排期 | 高(外发/花钱) | ②含self_serve | confirm/schedule 改 requirePaidClientAccess(或admin),LinkedIn 直发改内部授权 |
| /api/clients/[id]/content-factory/[postId]/lecture | GET | A | 读 | content_posts,storage | URL id | OK — post .eq client_id;上传路径正则含 clientId/postId | 无 | ②本客户成员 | — |
| /api/clients/[id]/content-factory/[postId]/lecture | PATCH | A | 写+外发请求 | content_posts,storage | URL id | action=publish_facebook:任何成员可登记"公开发 Facebook/TikTok"(live=true)请求,后台 cron 真发;recording_link 会对成员给的链接发 HEAD(只挡字符串形私网段,redirect=follow,盲 SSRF,低);regen/redo 调 Claude | 中高(外发) | ②含self_serve | publish_facebook 要付费档+内部授权;recording_link 改 safeProbeRemoteFile |
| /api/clients/[id]/content-factory/[postId]/lecture | POST | A | 写 | content_posts,storage | URL id | OK — post .eq client_id;上传路径正则含 clientId/postId | 无 | ②本客户成员 | — |
| /api/clients/[id]/content-factory/[postId]/video | POST | A | 写 | content_posts,storage | URL id | OK — post .eq client_id;上传路径正则含 clientId/postId;链接走 safeProbeRemoteFile | 无 | ②本客户成员 | — |
| /api/clients/[id]/content-factory/[postId]/video | PATCH | A | 写 | content_posts,storage | URL id | OK — post .eq client_id;上传路径正则含 clientId/postId;链接走 safeProbeRemoteFile | 无 | ②本客户成员 | — |
| /api/clients/[id]/content-factory/board | GET | A | 读 | content_posts,content_factory_render_jobs | URL id | OK — .eq client_id | 无 | ②本客户成员 | — |
| /api/clients/[id]/content-factory/config-chat | GET | A | 读 | clients.factory_config | URL id | OK — 只改本客户进料配置 | 无 | ②本客户成员 | — |
| /api/clients/[id]/content-factory/config-chat | POST | A | 写 | clients.factory_config | URL id | OK — 只改本客户进料配置 | 无 | ②本客户成员 | — |
| /api/clients/[id]/content-factory/generate | POST | A | 写(AI花费) | clients | URL id | 调 Claude 改写爆款并落库,无 MTC 扣费 | 低 | ②含self_serve | 可选 |
| /api/clients/[id]/content-factory/run-intake | POST | A | 写(Apify+Claude花钱) | clients | URL id | 一键跑进料:Apify 抓取+多次 Claude,无 MTC/预算闸/付费档限制,可反复点 | 中(钱) | ②含self_serve | 改 requirePaidClientAccess 或加预算闸/限频 |
| /api/clients/[id]/content-posts/[postId]/publish | POST | A | 外发 | content_posts,client_connectors,flywheel_actions,Publer | URL id;post .eq client_id | 任何成员(含self_serve)可把自己客户一条 approved 的内容真发/排期到社媒。scheduleSocialPost(src/lib/flywheel/social-post-publish.ts)在本客户没配 Publer 绑定时回退使用 ME 共享 Publer 工作区的 accounts[0]/第一个同平台账号 => 可能发到别的客户或 ME 自己的主页;而 approved 又可由成员自己经 content-factory PATCH confirm 置位,Publer 绑定也能由成员经 connectors/connect 自己写 | 高(外发+跨客户账号) | ②含self_serve(自助注册陌生人) | 改 requirePaidClientAccess+内部授权;scheduleSocialPost 无绑定即拒绝(删 accounts[0] 回退);绑定仅内部管理员可写 |

## 可疑但不确定
- 内容工厂 / 评论机器人 / 视频生成 这一族是否"本来就想对 self_serve 开放"(MTC 计费消费型)？代码里 requireDashboard 与 requirePaid 的分界注释写"consumption features MTC-billable"，但上述接口(generate-video、run-intake、blog image/refine、batch-generate、brief/generate、comment-autoreply-run)并没有扣 MTC 或预算闸。需要 PM 定"免费档能不能自己烧钱/外发"。
- scheduleSocialPost 的 accounts[0] 回退：我没查线上 Publer 工作区里到底有哪些账号，所以不能断言一定会发到别家；只能确认代码路径允许。
- 受限管理员(scoped_admin / DEMO_ADMINS)：role==='admin' 的判断在 api-keys、post-review(PASS)、competitor-domains(monitoring)、client-status、provenance 里放行了本客户的受限管理员(仅本客户)。若它们是客户侧人员而非 ME 内部人员,则"必须管理员评审/背书"这类闸会被客户自己满足。scoped_admin 无代码写入口,是否有真人被设成了它我没法查(不碰库)。
- campaign-daily-plan/publish 发布授权:代码只要求付费档成员+先前 admin 的 PASS 评审回执,没有额外的"Ray 授权事件"(CLAUDE.md §3 Inngest 约束里说发布要 Ray 授权事件)。是设计取舍还是漏洞,需 PM 判断。
- recording_link 探测(lecture PATCH)对成员给的 https 链接发 HEAD,redirect=follow,只挡字符串形私网段(localhost/10./192.168 等),DNS 指向内网或 302 到内网可绕过(盲 SSRF,不回显内容)。video/route.ts 已用 safeProbeRemoteFile,这里没用。
- brief/generate、campaign batch-generate/generate-visual 把 body/行里的存储路径直接 download:路径含 clientId+毫秒时间戳+文件名,难猜,所以只评低;但没有前缀校验。
- assets POST 无上传数量/总量限制(单文件50MB,公开桶),self_serve 可刷存储(低)。
- agents/customers POST 的 conversationId、blog POST 的 production_package_id、cms/publish-blog 的 execution_item_id、fan-out 的 executionItemId 都是"body 里带别的表的编号但不核对归属"的同一类模式,后两者写进的是本客户行,只有 fan-out 的 executionItemId 是直接 UPDATE 别家行。
- brief/[briefId] DELETE 的预查(读 status/is_active)没带 client_id,只会让别家 active brief 的 409 提示泄漏"它是否 active",可忽略。
