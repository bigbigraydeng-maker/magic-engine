# 附录 · clients-成员已有守卫-第3组（逐接口明细，原始清查输出）

> 来源：66号窗口只读清查，2026-10-10。路径省略 `src/app/api` 前缀。分类 A=归属守卫已覆盖 B=仅登录 C=无守卫 D=自定义校验 E=仅管理员。

# 66号窗口 · cl3 名单查验结果（129 个 handler，101 个文件）

守卫检查结论：所有名单内 handler 的守卫都传的是 URL 里的 id、且都检查了 !access.ok 并 return（work-logs 三个除外，只有 requireSession）。没有任何 handler 使用 guardAdmin/requireAdmin；只有 web-intelligence 系列用 access.role==='admin'（会含受限管理员，但受限管理员本来被锁在自己那一个客户内）。

| 路径 | 方法 | 类别 | 读写删 | 表 | 客户号来源 | 问题/风险(人话) | 严重度 | 谁能打到 | 修法 |
|---|---|---|---|---|---|---|---|---|---|
| platform/gbp | DELETE | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| platform/google-ads | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| platform/gsc | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| platform/gsc | DELETE | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| platform/mailbox | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| platform/mailbox | DELETE | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| posts | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| posts | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| posts/[postId] | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| prescription/[pId] | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| prescription/[pId] | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| prescription/[pId]/outcomes | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| prescription/[pId]/outcomes | POST | A(引用未校验) | 写 | prescription_outcomes | URL id；pId、case_id 来自路径/请求体 | pId、case_id 没校验归属，成效记录可挂到别客户的处方/案例上(行里 client_id 是自己的) | 低 | ② paid_client | 先查 prescriptions.client_id===URL id |
| prescription/[pId]/refine | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| prescription/generate | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| prescriptions/latest-draft | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| primary-keywords | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| primary-keywords | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| production | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| production | POST | A(引用未校验) | 写 | production_packages | URL id；campaign_id/execution_item_id 来自请求体 | campaign_id、execution_item_id 没校验属于该客户；之后 GET production/[packageId] 会按这两个 id 无客户过滤地读 campaign_briefs / execution_items，可读到别客户的活动名/任务标题 | 中 | ② 含 self_serve(需知道UUID) | 插入前校验两个 id 的 client_id；GET 里读 campaign/execution_item 时也加 .eq(client_id) |
| production/[packageId] | GET | A(间接读未过滤) | 读 | campaign_briefs, execution_items, project_reviews, content_posts等 | URL id；pkg.campaign_id 等来自库里引用 | packageId 已校验归属，但随后按引用 id 读 campaign_briefs/execution_items/content_posts/blog_posts/reels/visual_assets 时都没加 client_id，配合上面能写入的跨客户引用可读到别客户内容 | 中 | ② 含 self_serve | 所有二次读取加 .eq(client_id) |
| production/[packageId] | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| production/[packageId]/schedule | POST | A | 写 | content_posts | URL id；post_id 在 update 里带 client_id | OK 归属；但 self_serve 可把稿件改为 approved+排期，是否触发外发取决于发布 cron(未能确认) | 低(可疑) | ② 含 self_serve | 如 approved 即会发，则限 paid |
| products | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| products | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| projects/[projectId] | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/[draftId] | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/[draftId] | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/[draftId]/frame-status | GET | A | 读+写 | reels_drafts | URL id；job_id 来自查询串 | job_id 不绑定该草稿，可轮询别人的出图任务并把结果图存进自己草稿(只拿到图片，写入仍带 client_id)；读 current 时没带 client_id 但不外泄 | 低 | ② 含 self_serve | 记录 job_id 到草稿，核对一致 |
| reels/[draftId]/generate-frame | POST | A(未计费) | 花钱 | Visual Studio(出图) | URL id | 出图 API 直接调用不扣 MTC(同目录 generate-storyboard 有扣)；self_serve 可无限烧出图费 | 中 | ② 含 self_serve | 接 precheckCharge/commitCharge |
| reels/[draftId]/generate-storyboard | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/[draftId]/generate-video | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/[draftId]/publish | POST | A(但目的地没校验) | 外发 | reels_drafts+Publer | URL id(取稿)；account_id来自请求体 | account_id 直接取自请求体、只在 ME 全局 Publer 账号列表里找，没验证这个账号属于该客户。任何客户成员(含免费 self_serve)可把自己的视频+任意文案排期发到别的客户的 FB/IG 主页；还绕过工厂/授权流程 | 高 | ② 任何有该客户dashboard权限的成员，含 self_serve | 改用 requirePaidClientAccess(或仅admin)；account_id 必须来自该客户自己的社媒连接表；并走发布授权事件，不直接 schedulePost |
| reels/[draftId]/refine | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/[draftId]/regenerate-prompt | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/[draftId]/upload-frame | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/[draftId]/video-status | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/create-from-plan | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reels/generate | POST | A(引用未校验+未计费) | 写/花钱 | production_items, reels_drafts | URL id；production_package_id 来自请求体 | production_package_id 没校验归属，可往别客户的生产包里塞条目；LLM 最多3次+质检没扣 MTC | 低 | ② 含 self_serve | 校验 package.client_id；接 precheckCharge |
| reports/monthly | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reports/summary | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reports/trends | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reputation-identity | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| reputation-identity | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| review | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| review | POST | A(引用未校验) | 写 | project_reviews | URL id；production_package_id 来自请求体 | production_package_id 没校验归属，评审记录可挂到别客户的包下，会出现在对方 production/[packageId] 的 reputation_reviews 里 | 低 | ② paid_client | 校验 package.client_id |
| seo-agent/plan | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-config | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-config | PATCH | A(但应付费/admin) | 写 | clients.seo_config | URL id | self_serve(免费)也能打开 weekly_blog(自动写博客=花钱/外发)、meta_cycle_enabled(自动改客户官网标题描述)、competitor_watch、ai_visibility(花钱)。违反“自动开关先 dry_run 给 PM 看”的规矩 | 高 | ② 含 self_serve | 改用 requirePaidClientAccess，且开关类字段限 admin(守卫结果 role==admin) |
| seo-fix | POST | A | 外发 | 客户官网仓库(GitHub PR) | URL id；file_path、new_value、execution_item_id、production_package_id 来自请求体 | 付费成员可用客户的仓库连接开 PR，路径/内容任意(只开PR不合并)；execution_item/package id 未校验归属 | 低 | ② paid_client | 限 admin 或 file_path 白名单；校验两个 id |
| seo-gap | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-gap | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-intelligence/competitors-gap | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-intelligence/metrics | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-intelligence/page-1-count | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-intelligence/page-health | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-intelligence/position-changes | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-intelligence/rankings | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| seo-meta-log | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| site-audit/crawl | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| site-audit/pages | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| site-audit/pages/[pageId] | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| site-audit/pages/[pageId]/rescan | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| site-audit/pages/stats | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| site-audit/status | GET | A+子资源未校验 | 读(+间接) | site_audit_jobs | URL id；jobId 来自查询串 | ?jobId= 直接 getJob(jobId)，没校验 job 属于该客户→读到别的客户的抓取任务(域名、页数、错误) | 中 | ② paid_client 成员(需知道任务UUID) | getJob 后比对 job.client_id === URL id，否则404 |
| social-handles | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| social-handles | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| social-plan | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| social-plan | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| social-plan/[planId]/save-to-board | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| strategy | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| strategy/[itemId] | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| strategy/generate | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/[quoteId] | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/[quoteId] | PUT | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/[quoteId] | DELETE | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/[quoteId]/brochure | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/[quoteId]/brochure | PUT | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/[quoteId]/brochure | DELETE | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/assist | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/attraction-library | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/brochure-assist | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/brochure-preview | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/expand-day | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/extract | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/flights | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/heroes | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/import | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/jobs/[jobId] | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tailor-made/preview | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| tiktok-ads/campaigns | GET | A(但广告户没校验) | 读 | TikTok API(全局令牌) | tiktok_advertiser_id 来自查询串 | 同上：可列出别的客户广告户的全部广告系列(名称/状态/预算) | 高 | ② paid_client 成员 | 同上，advertiser 只取服务端为该客户存的值 |
| tiktok-ads/execute | POST | A(但广告户没校验) | 改/花钱 | TikTok API(全局令牌)+flywheel_actions | campaign_id、tiktok_advertiser_id 来自请求体；令牌是服务器全局环境变量 | 没有校验 campaign/advertiser 属于该客户。付费客户成员可暂停/重启/改日预算 ME 令牌能碰到的任何客户的 TikTok 广告 | 高 | ② paid_client 成员(不含 self_serve) | 只允许 admin；或在 clients 上存该客户的 advertiser_id，请求里的 campaign 必须先查回确认属于该 advertiser，advertiser 不许从请求体取 |
| unassigned-actions | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| upload-link | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| users | GET | A | 读 | client_portal_users | URL id | self_serve 也能看到该客户所有成员邮箱(含内部 FDE 邮箱)；文件注释称是有意 | 低 | ② 含 self_serve | 可选：对 self_serve 只回自己 |
| users | POST | A(越权面) | 写+外发 | client_portal_users, 发邀请邮件 | URL id | 任何付费成员可：给任意邮箱授权并让系统发邀请邮件(可被滥用为钓鱼/骚扰，且以ME名义)；改写已有成员的 access_type(含降级同事)；DELETE 删除任何成员含 ME 内部 FDE 行，可把整个团队踢光 | 高 | ② paid_client 成员(含客户老板) | 限 admin；或限制只能管 portal/self_serve 类、不得动 fde/both 行、邀请限频，并对删除做二次确认/审计 |
| users | DELETE | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| visual-assets | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| visual-assets | POST | A(引用未校验+未计费) | 写/花钱 | visual_assets, Visual Studio | URL id；post_id 来自请求体 | post_id 没校验属于该客户，可往别客户的稿件挂图(visual_assets 多处按 post_id 读取不带 client_id)；出图不扣 MTC | 中 | ② 含 self_serve(需知道post UUID) | 先查 content_posts.client_id===URL id；接 MTC 扣费 |
| visual-assets/from-library | POST | A(引用未校验) | 写 | visual_assets | URL id；post_id 来自请求体 | 同上，post_id 未校验 | 中 | ② 含 self_serve | 同上 |
| web-intelligence | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| web-intelligence | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| web-intelligence | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| web-intelligence/external | POST | E(admin含受限管理员) | 花钱 | Apify | URL id；site_url 来自请求体 | role==admin 包含只绑一个客户的受限管理员(DEMO/DB scoped)，可指定任意 site_url 烧 Apify 额度 | 低 | ③受限管理员 | 改要求全局 admin(requireGlobalAdmin 语义) |
| web-intelligence/tour-comparison | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| web-intelligence/tour-landscape | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| web-intelligence/tour-landscape/chat | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| web-intelligence/traffic-direction | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| whatsapp-number | GET | A | 读 | clients | URL id | 回显服务器全局 WHATSAPP_PHONE_NUMBER_ID(给上一条抢号铺路) | 低 | ② 含 self_serve | 不返回 configured_number_id，只返回 matches_configured |
| whatsapp-number | PATCH | A(但应限admin) | 写 | clients.whatsapp_phone_number_id | URL id | 任何成员(含 self_serve)可给自己客户绑任意号码ID；GET 还会把服务器配置的号码ID回显。若某号码当前没绑给别的客户，就能把它绑过来→该号码的客人来信会进错误客户的收件箱(webhook 靠这列分流)；也能把自家绑定清空使来信被丢弃 | 中高 | ② 含 self_serve | 限 admin；GET 不回显 env 号码ID；绑定变更写审计 |
| whatsapp/conversations/[conversationId]/reply | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| work-logs | GET | B(已知，修复卡65) | 读 | fde_work_logs | URL id | 只 requireSession；任何登录者读任意客户工作日志 | 中 | ① 任何登录账号 | requireDashboardClientAccess(URL id) |
| work-logs | POST | B(已知，修复卡65) | 写 | fde_work_logs | URL id | 同上，可往任意客户写日志 | 中 | ① 任何登录账号 | 同上 |
| work-logs/[logId] | DELETE | B(已知，修复卡65) | 删 | fde_work_logs | URL id | 同上，可删任意客户日志 | 中 | ① 任何登录账号 | 同上 |
| workbench-feedback | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| workbench-summary | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| zhangqian/advanced-discover | POST | A(未计费) | 外发/花钱 | client_discovery_jobs+Agent | URL id；site_url 来自请求体 | 进阶发现 agent 没走 MTC 扣费也没限付费，self_serve 可无限触发(花 ME 的模型/抓取钱)；site_url 由请求体指定，agent 会去抓任意网址(类 SSRF) | 中 | ② 含 self_serve | 限 requirePaidClientAccess 或接 precheckCharge；site_url 必须限定为该客户 domain |
| zhangqian/confirm | PATCH | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| zhangqian/discover | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| zhangqian/docx | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| zhangqian/html | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| zhangqian/latest | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| zhangqian/status | GET | A+子资源未校验 | 读+写 | client_discovery_jobs | URL id；job_id 来自查询串 | ?job_id= 读取任意客户的发现任务整行；若该任务“卡超时”还会替别的客户把任务标记为失败(failJob) | 中 | ② 任何 dashboard 成员含 self_serve(需知道UUID) | getJob 后校验 job.client_id；不一致返回404 |
| zhuge/conduct | POST | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| zhuge/daily-recommendation | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |
| zhuge/latest-actions | GET | A | - | - | URL id | OK：归属守卫传URL id并检查返回；取数/写入均带 client_id | - | - | - |

## 可疑但不确定
- production/[packageId]/schedule：self_serve 能把稿件置为 approved 并排期。没查到发布 cron 是否按 approved+scheduled_at 自动外发（factory-publish-* 看起来是另一条路），若会自动发，应改成付费限定。
- visual-assets / from-library 的 post_id 不校验归属：配合 /api/publer/schedule、/api/content/posts 等是否按 post_id 无客户过滤读取 visual_assets，决定能否把图塞进别客户的发布稿（本名单外，没读）。
- tailor-made 全系（AI改写/解析/PDF航班/导入 共9个 AI 接口）：只是 requireDashboardClientAccess，没有 MTC 扣费也没有行业开关(项目接口有 clientHasIndustryFeature，这里没有)；self_serve 可无限用 LLM。库存取数全部带 client_id，没有跨客户读写。
- production PATCH 状态改 published 会写飞轮记录，self_serve 可手动置 published 污染数据（低）。
- upload-link：任何成员含 self_serve 可拿到该客户永久（确定性）免登录上传链接，换钥匙前不会失效。
- reels/[draftId]/upload-frame、video-status 的 update 只按 draftId(无 client_id)，但前面已有带 client_id 的取数校验，实际没洞。
