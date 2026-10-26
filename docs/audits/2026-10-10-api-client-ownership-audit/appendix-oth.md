# 附录 · 非clients目录（逐接口明细，原始清查输出）

> 来源：66号窗口只读清查，2026-10-10。路径省略 `src/app/api` 前缀。分类 A=归属守卫已覆盖 B=仅登录 C=无守卫 D=自定义校验 E=仅管理员。

# 客户越权清查 · 名单 oth（96 个 handler 全部真读）

图例
- 谁能打到：①任何登录账号（含 self-register 陌生人） ②某客户员工/门户成员（含 self_serve） ③仅 ME 内部全局管理员 ④匿名 ⑤受限管理员（DEMO_ADMINS，只绑单个客户，但 guardAdmin/requireAdmin 照样放行）
- 类别：A 归属守卫覆盖且客户号正确 / B 仅 requireSession / C 无守卫 / D 自定义校验 / E-ok 仅管理员且已是全局或已按客户收窄 / E-bad guardAdmin 或 requireAdmin 但该收紧为全局管理员或加客户范围
- 前提事实：requireAdmin/guardAdmin 只判 env 里的 role=admin；DEMO_ADMINS 在 whitelist.ts 返回 {role:admin, allowedClientId:X}，所以受限管理员能过所有 guardAdmin。只有 guardGlobalAdmin/requireGlobalAdmin 或 assertClientScope 才挡得住。

## 一、有问题的（按严重度排）

| 路径 | 方法 | 类别 | 读写删 | 表 | 客户号来源 | 问题/风险（人话） | 严重度 | 谁能打到 | 修法 |
|---|---|---|---|---|---|---|---|---|---|
| admin/users | POST | E-bad | 写+外发邮件 | client_portal_users, clients | body.client_id，完全不校验范围 | 受限管理员可给**任意客户**加人（任何邮箱，权限类型可选 client/fde/both/dashboard），被加的人立刻拿到该客户全部数据权限，系统还会真发邀请邮件。等于演示账号能「开后门」进任何真实客户 | 高 | ⑤ | guardGlobalAdmin；至少 assertClientScope(email, client_id) |
| admin/users/[id] | DELETE | E-bad | 删 | client_portal_users | 只按行 id，无客户校验 | 受限管理员可删任意客户的成员行（把真客户的人踢出后台）；无审计 | 高 | ⑤ | guardGlobalAdmin；或先读该行 client_id 再 assertClientScope |
| admin/users/upgrade | POST | E-bad | 写 | client_portal_users, clients | body.merge_into_client_id，不校验 | 把一个 self_serve 账号「合并升级」进**任意付费客户**（陌生人自助注册就有 self_serve 账号），拿到该客户付费权限 | 高 | ⑤（需手里有一个 self_serve 邮箱） | guardGlobalAdmin |
| admin/users | GET | E-bad | 读 | client_portal_users(+clients.name) | 无过滤，返回全部客户 | 受限管理员一次拿到**所有客户的全部成员邮箱、姓名、权限类型**（客户员工个人信息） | 高 | ⑤ | guardGlobalAdmin |
| admin/mcp-keys | POST | E-bad | 写（发钥匙，明文只返回一次） | admin_api_keys | 无 | 受限管理员可给自己发一把 `me_admin_` 钥匙；这种钥匙按设计就是「跨全部客户」的管理员钥匙（api-key-access.ts 写明 cross-client）。一步提权到全平台，owner_email 还可随便填 | 高 | ⑤ | requireGlobalAdmin |
| admin/mcp-keys/revoke-all | POST | E-bad | 写（一键作废所有管理员钥匙） | api_key_settings, admin_api_keys | 无 | 受限管理员可按下全平台紧急熔断，所有内部管理钥匙立刻失效，打断全部内部自动化 | 高（破坏性） | ⑤ | requireGlobalAdmin |
| visual/batch-image | POST | B | 写+花钱 | content_posts, visual_assets, storage | body.post_ids，**不校验属于谁，也不校验登录者属于哪个客户** | 任何登录的人（含陌生自助注册号）可对**任意客户的贴文**调 OpenAI 出图（约 0.04 美元/张，一次最多 20 张，不扣 MTC），并把这些贴文状态直接改成 approved（已批准），批准后的贴文可被发布流程拿去发 | 高 | ① | 先读各 post.client_id，对每个客户做 requirePaidClientAccess；接 chargeForGeneration |
| visual/image | POST | A(守卫对，子记录 IDOR) | 读+写+花钱 | content_posts, visual_assets, production_items | 守卫用 body.client_id，取数用 body.post_id，**没校验 post 属于该 client** | 自己客户的成员（含 self_serve）传别家的 post_id：①读到别家贴文的 visual_brief 并当提示词出图，prompt_used 回到自己名下；②新素材以 post_id=别家贴文 写入，而 publer/create-post 按 post_id 取「最新 ready 素材」且不带 client_id 过滤，**别家准备发布的贴文可能被换成攻击者生成的图**；③把别家贴文的 revision_notes 清空 | 高 | ② | 取 post 时加 `.eq('client_id', client_id)`；校验 production_package_id 归属；create-post 取素材加 `.eq('client_id', post.client_id)` |
| publer/schedule | POST | A(守卫对，account_id 未绑定) | 外发（真实发到社媒） | visual_assets, Publer | 素材自己的 client_id 过守卫；**account_id 来自 body，不校验该账号属于这个客户** | 任何客户成员（含 self_serve）可把自己的素材发到**另一个客户的 Facebook/IG 主页**（账号 id 从 publer/accounts 或 draft 接口就能拿到）。姊妹接口 create-post 已做「只发连接器绑定账号」，这条漏了 | 高 | ② | 照 create-post：取 client_connectors(publer) 绑定账号，要求 account_id 必须在其中；改 requirePaidClientAccess |
| baselines/trigger-cron | POST | B | 花钱（触发每月 DataForSEO 全量基线任务）+写 | baseline_cron_runs | 无 | 任何登录的人点一下就触发一轮付费基线任务（注释写着「会触发付费调用」，却只拦了未登录），可反复点 | 高 | ① | requireGlobalAdmin |
| factory/work-orders/[id]/review | POST | E-bad | 写（批准/打回/改预算） | content_work_orders | 只按工单 id；applyApprove 的 clientId 参数**没传**，也没范围校验 | 受限管理员可批准、打回、改预算**任何客户的内容工厂成片工单**，批准即进入后续发布。姊妹路由 chat 传了 clientId，这条漏了 | 高 | ⑤ | guardGlobalAdmin；或先读工单 client_id 再 assertClientScope |
| factory/chat | POST | E-bad | 读+写（工具可打回/改预算） | content_work_orders, clients | body.client_id，不校验是否属于受限管理员那个客户 | 受限管理员可对任意客户开对话并用工具打回/改预算该客户工单 | 高 | ⑤ | assertClientScope(email, client_id) |
| auth/google/connect | GET | C(flow=connect 刻意无登录) | 写入口（发起授权） | —(签名 state) | query.client_id；flow=connect 跳过鉴权 | 匿名者知道某客户 UUID 就能发起「连接 Google」，用**自己的 Google 账号**授权；回调对 connect flow 同样不验权，会把攻击者的令牌存成该客户的 GSC/GA4/GBP 连接，并覆盖该客户 GA4 的授权槽位（account_id=clientId）。代码注释承认是已知遗留（spec §2.1 B1）。后果：客户的搜索/流量数据来源被换，原连接被顶掉 | 高（凭证被替换/数据污染） | ④ | connect 改用「已登录 FDE 生成、带过期且单次使用」的签名链接，不能只靠 clientId |
| auth/google/callback | GET | A（flow=connect 分支绕过） | 写（令牌、连接器状态） | google_oauth_tokens, platform_oauth_connections, client_connectors | state 里的 clientId（HMAC 签名） | 同上，connect flow 不做 requireDashboardClientAccess；与 connect 入口配套 | 高 | ④ | 同上 |
| publer/accounts | GET | B | 读 | Publer（ME 全公司唯一工作区） | 无客户过滤 | 任何登录的人（含陌生人）拿到 ME 管的**所有客户社媒账号清单**（名称、平台、账号 id）。既泄露客户资产，又是 publer/schedule 打别家账号的前置情报 | 中（配合 schedule 为高） | ① | 按 client_id 只返回该客户绑定账号，或限管理员 |
| publer/draft/[assetId] | GET | A | 读 | visual_assets, content_posts, Publer | 素材自己的 client_id | 守卫对；但响应里的 accounts 是整个工作区所有客户的账号，客户成员能看到别家账号 | 中 | ② | 只返回该客户绑定账号 |
| visual/assets | GET | B | 读 | visual_assets | 无过滤 | 任何登录的人看到**所有客户最近 20 条素材**（图片地址、生成提示词、成本、post_id），陌生自助注册号也行 | 中（面最宽） | ① | 加 client_id 并 requireDashboardClientAccess；或限管理员 |
| admin/ai-gateway | GET | E-bad | 读 | Cloudflare AI Gateway 日志 | 无 | 受限管理员可读整个 AI 网关请求日志（含各客户的提示词/回答、花费） | 中 | ⑤ | guardGlobalAdmin |
| admin/billing/datasources | GET | E-bad + D | 读 | 用量账单 | 无；另有 `Bearer ${CRON_SECRET}` 旁路 | ①受限管理员看全部客户用量与花费（含 client_id）；②若环境变量 CRON_SECRET 没配，则发 `Authorization: Bearer undefined` 即可匿名通过（fail-open），与 baselines/trigger-cron 的显式判空不一致 | 中 | ⑤；④（仅 CRON_SECRET 缺失时） | guardGlobalAdmin；cron 分支先判 CRON_SECRET 非空 |
| admin/mtc/overview | GET | E-bad | 读 | mtc_purchases, mtc_ledger, clients | 无 | 受限管理员看到所有客户名称、余额、本月花费、公司总收入 | 中 | ⑤ | guardGlobalAdmin |
| factory/work-orders | GET | E-bad | 读 | content_work_orders, clients, factory_review_flag_acceptances | 无，返回最近 100 条全客户 | 受限管理员读到所有客户的内容工单（角度、brief、成本、产出） | 中 | ⑤ | 按 allowedClientId 过滤，或 guardGlobalAdmin |
| factory/work-orders/[id]/revive | POST | E-bad | 写（复活死信工单，重新花生产费） | content_work_orders | 只按工单 id | 受限管理员可复活任意客户的死信工单，触发再次付费生产 | 中 | ⑤ | 读工单 client_id + assertClientScope，或 guardGlobalAdmin |
| workbench/today | GET | E-bad | 读 | 今日待办（跨客户） | 无 | 受限管理员看到所有客户的待办（客户名、问题、链接） | 中 | ⑤ | guardGlobalAdmin |
| admin/mcp-keys/[keyId] | DELETE | E-bad | 写（吊销） | admin_api_keys | 只按 keyId | 受限管理员可吊销任意一把管理员钥匙 | 中 | ⑤ | requireGlobalAdmin |
| admin/mcp-keys | GET | E-bad | 读 | admin_api_keys | 无 | 列出全部管理员钥匙元数据（前缀、负责人邮箱、IP 白名单、最后使用 IP），无明文，但暴露内部员工邮箱和白名单配置 | 中 | ⑤ | requireGlobalAdmin |
| admin/prospecting/[id] | PATCH | E-bad | 写+外发（action=send 用 Resend 给外部商家发销售邮件；还能改草稿、标拒收、转成交） | outbound_prospects | 只按 id | 受限管理员可以 ME 的名义给外部商家发邮件、改状态（对象是 ME 自己的销售线索，不是客户数据） | 中 | ⑤ | guardGlobalAdmin |
| admin/prospects | GET | E-bad | 读 | public_scan_jobs | 无 | 公开扫描留下的访客**邮箱、姓名、网址**对受限管理员全开 | 中 | ⑤ | guardGlobalAdmin |
| admin/prospects/[id] | GET | E-bad | 读 | public_scan_jobs | 只按 id | 同上，含完整扫描结果 | 中 | ⑤ | guardGlobalAdmin |
| admin/viral-references/[id] | PATCH | E-bad | 写 | viral_reference_library | 只按 id | 受限管理员可改共享爆款配方库的行业标签，影响所有客户出片时查到的配方 | 中 | ⑤ | guardGlobalAdmin |
| baselines/ai-collect | POST | E-bad | 花钱+写 | industry_ai_visibility_runs 等 | 无 | 受限管理员可触发行业 AI 可见度全量采集（付费） | 中（花钱） | ⑤ | requireGlobalAdmin |
| admin/prospecting | GET | E-bad | 读 | outbound_prospects | 无 | 线索清单（含邮箱电话、可选完整 AI 报告和邮件草稿）对受限管理员全开 | 低-中 | ⑤ | guardGlobalAdmin |
| admin/prospecting/[id] | GET | E-bad | 读 | outbound_prospects | 只按 id | 同上，完整一行 | 低-中 | ⑤ | guardGlobalAdmin |
| admin/prospecting/analyze | POST | E-bad | 写+花钱(Anthropic) | outbound_prospects | 无 | 触发 AI 分析烧钱 | 低-中 | ⑤ | guardGlobalAdmin |
| admin/prospecting/audit | POST | E-bad | 写+外部抓取 | outbound_prospects | 无 | 触发对外部网站的批量审计 | 低 | ⑤ | guardGlobalAdmin |
| admin/prospecting/discover | POST | E-bad | 写+花钱(Places/DataForSEO) | outbound_prospects, cron_run_logs | 无 | 触发付费发现任务 | 低-中 | ⑤ | guardGlobalAdmin |
| admin/prospecting/ingest-jobs | POST | E-bad | 写+外部抓取 | outbound_prospects | 无 | 触发招聘站抓取入库 | 低 | ⑤ | guardGlobalAdmin |
| admin/prospecting/outreach | POST | E-bad | 写+花钱(AI 起草，不发送) | outbound_prospects | 无 | 触发 AI 批量起草销售邮件 | 低-中 | ⑤ | guardGlobalAdmin |
| admin/prospecting/rescan-emails | POST | E-bad | 写+外部抓取 | outbound_prospects | 无 | 触发批量邮箱重扫 | 低 | ⑤ | guardGlobalAdmin |
| admin/prospecting/summary | GET | E-bad | 读（计数） | outbound_prospects | 无 | 只有状态计数 | 低 | ⑤ | guardGlobalAdmin |
| admin/flywheel/aggregate | GET | E-bad | 读（汇总统计） | flywheel_outcomes | query.client_id 可任填；不填=全客户汇总 | 受限管理员可看任意客户或全体的飞轮成效统计（只有按动作类型的成功率，无明细） | 低-中 | ⑤ | assertClientScope；无 client_id 时 guardGlobalAdmin |
| mtc/ledger | GET | E-bad（admin 回退分支） | 读 | mtc_ledger | query.clientId | 不是门户成员时回退到 guardAdmin：受限管理员能读任意客户的 MTC 流水（服务项、金额、备注） | 低-中 | ⑤ | 回退分支换 requireDashboardClientAccess(clientId) |
| baselines/ai-questions | GET | E-bad | 读 | industry_ai_visibility_questions | 无（行业共享题库） | 行业级数据，无客户私有信息 | 低 | ⑤ | 可保持；理想 guardGlobalAdmin |
| baselines/ai-questions | POST | E-bad | 写 | 同上 | 无 | 受限管理员可往共享题库加题，影响所有客户后续采集 | 低-中 | ⑤ | guardGlobalAdmin |
| baselines/ai-questions/[id] | PATCH | E-bad | 写 | 同上 | 只按 id | 同上，可改题 | 低-中 | ⑤ | guardGlobalAdmin |
| baselines/ai-questions/[id] | DELETE | E-bad | 软删 | 同上 | 只按 id | 同上，可停用题 | 低-中 | ⑤ | guardGlobalAdmin |
| baselines/ai-snapshots | GET | E-bad | 读 | industry_ai_visibility_snapshots | 无（行业级） | 行业采集数据，无客户私有信息 | 低 | ⑤ | 可保持；理想 guardGlobalAdmin |
| admin/viral-references/detect-industry-batch | POST | E-bad | 写+花钱(OpenAI) | viral_reference_library | 无 | 受限管理员可触发批量标注，花 OpenAI 费用 | 低-中 | ⑤ | guardGlobalAdmin |
| admin/product-map/refresh | POST | E-bad | 外部读写(GitHub 全量同步)+写 | product map 表 | 无 | 只影响内部产品地图 | 低 | ⑤ | guardGlobalAdmin |
| admin/cron-health | GET | E-bad | 读 | cron_run_logs | 无 | 内部任务运行日志含错误原文，可能带客户名/报错内容 | 低-中 | ⑤ | guardGlobalAdmin |
| workbench/today/reconciliation-preview | GET | E-bad | 读 | 固定夹具（不连生产库） | 无 | 冻结夹具的待办核对结果，非实时数据 | 低 | ⑤ | guardGlobalAdmin |
| workflows-health | GET | E-bad | 读 | cron_run_logs 等 | 无 | 内部定时任务健康度，无客户数据 | 低 | ⑤ | guardGlobalAdmin |
| visual/image-preview | POST | A | 写+花钱 | storage(social-preview) | body.client_id，守卫与使用一致 | 守卫没问题，但生成不走 MTC 扣费，任何客户成员（含 self_serve 陌生人）可无限出图，由 ME 买单 | 低-中（花钱） | ② | 接 chargeForGeneration 或限付费档 |
| admin/conversions/writebacks/[id]/resolve-doubt | POST | E-ok（边角） | 写（可触发重发） | me_conversion_writebacks, me_sale_outcomes | 由回写行关联到 outcome.client_id | 守卫到位。边角：关联读不到 client_id（孤儿行）则传 null，guardConversionRoute 不做范围校验，受限管理员可处理 | 低 | ⑤（仅孤儿行） | ownerClientId 为 null 时直接 404 |

## 二、OK（逐个读过，一行理由）

| 路径 | 方法 | 类别 | 理由 |
|---|---|---|---|
| ad-approval/[actionId] | POST | A | 先按 actionId 反查 client_id 再 requirePaidClientAccess；「开」再要全局管理员 |
| ad-engine/lessons | POST | E-ok | guardGlobalAdmin，全局经验池 |
| ad-engine/lessons/[key] | PATCH | E-ok | guardGlobalAdmin |
| admin/ads/circuit/release | POST | E-ok | requireGlobalAdmin，actor 取自会话 |
| admin/conversions/ai-auto-review-run | POST | E-ok | 有 clientId→范围校验；没有→guardGlobalAdmin |
| admin/conversions/audience-export | GET | E-ok | guardAdmin + assertClientScope(query.client_id)，PII 导出留审计日志 |
| admin/conversions/cts-crm-sync | POST | E-ok | guardGlobalAdmin |
| admin/conversions/nal-mark-won | POST | E-ok | guardAdmin + guardConversionRoute(固定 NAL 客户号)；contact 查询带 client_id |
| admin/conversions/nal-messenger-sync | POST | E-ok | guardGlobalAdmin |
| admin/conversions/outcomes | POST | E-ok | assertClientScope(body.clientId)，createdBy 取会话 |
| admin/conversions/outcomes | GET | E-ok | assertClientScope(query.client_id)，查询全带 client_id |
| admin/conversions/outcomes/[id]/redact | POST | E-ok | 先读 outcome.client_id 再 assertClientScope |
| admin/conversions/outcomes/[id]/review | POST | E-ok | 同上，更新带 id+状态 CAS |
| admin/conversions/outcomes/[id]/send | POST | E-ok | 先读 client_id 再 guardConversionRoute |
| admin/dev-debt | GET | E-ok | guardGlobalAdmin |
| admin/users/password | POST | E-ok | requireGlobalAdmin + 同源校验 + 仅限已有门户权限的邮箱 |
| ai-tracker/queries | GET | A | 守卫与查询同一 client_id |
| ai-tracker/queries | POST | A | 守卫与插入同一 client_id |
| ai-tracker/queries/[id] | PATCH | A | 先读该 query 的 client_id 再守卫，更新带 client_id |
| ai-tracker/queries/generate | POST | A | 守卫用 body.client_id，生成与插入同一 id |
| ai-tracker/run-dashboard | POST | A | 守卫后 runTracker；loadQueries 按 client_id 过滤，query_ids 不能越客户 |
| ai-tracker/runs | GET | A | 守卫与查询同一 client_id |
| ai-tracker/snapshots | GET | A | 同上 |
| auth/facebook/ads/callback | GET | D | requireSession + state 绑定当前用户 id、浏览器 cookie、一次性删除；再对 state 里的 clientId 做 activeDashboardAccess |
| auth/facebook/connect | GET | A | requireDashboardClientAccess(client_id)；state 签名 |
| auth/google/gbp/start | GET | A | 同上 |
| auth/google/gbp/callback | GET | A | cookie 里 clientId 回调时重新验会话权限 |
| auth/microsoft/mail/start | GET | A | 同上 |
| auth/microsoft/mail/callback | GET | A | 回调复验权限；admin_consent 分支只跳转不写库 |
| auth/tiktok/connect | GET | A | requireDashboardClientAccess(client_id) |
| auth/verify-email | POST | D | requireSession + 邮箱必须是该 clientId 的成员行 + 必须是 self_serve 客户；发奖励幂等 |
| clients | POST | E-ok | guardGlobalAdmin |
| commerce/scan | POST | E-ok | guardGlobalAdmin（并有断连止损） |
| content/posts | GET | A | 带 client_id→requirePaidClientAccess；不带→guardGlobalAdmin；素材按 post 所属 client 对齐 |
| factory/work-orders/[id]/accept-flag | POST | E-ok | guardGlobalAdmin |
| mtc/balance | GET | D | 邮箱必须在 client_portal_users 对应该 clientId |
| mtc/checkout | POST | D | 同上；Stripe metadata 用已校验的 clientId |
| onboard/self | POST | B(合理) | 不接收客户号，全靠会话邮箱查自己的扫描记录、只建自己的客户 |
| posts/[id] | GET | A | 先读 post.client_id 再 requirePaidClientAccess |
| posts/[id] | PATCH | A | 同上，execution_item_id 还校验属于同一客户 |
| posts/batch | POST | A | 取全部 post 的 client_id，逐客户 requirePaidClientAccess，更新/删除再带 client_id |
| publer/create-post | POST | A | 付费档守卫 + 只发该客户连接器绑定且 live、provider 一致的账号（fail-closed）。注意素材按 post_id 取不带 client_id（见 visual/image） |
| publer/quick-post | POST | A | 守卫与插入同一 client_id，仅建草稿 |
| visual-assets/[assetId]/select | PATCH | A | 先读 asset.client_id 再守卫 |

## 三、可疑但不确定 / 需要别的名单配合

1. clients/[id]/connectors/[anchor]/connect（不在我名单）：requireOnboardingClientAccess 即放行，允许 anchor=publer 并**原样写入 body.config**；create-post 用的 `publer_account_ids` 就存在这里。若不过滤 config 内容，付费客户成员可把别家 Publer 账号 id 写进自己的绑定，再经 create-post 发到别家主页；self_serve 也能写（只是 create-post 要付费档）。请负责 clients/[id] 的窗口核实。
2. admin/users POST 里 `supabaseAdmin.auth.getUser()` 在服务端管理客户端上取不到当前登录人，`created_by_email` 实际恒为 null，审计缺失（低）。
3. publer/create-post 按 post_id 取素材没带 `.eq('client_id', ...)`，与 visual/image 的 post_id 注入叠加才成立；单独加一条过滤即可封住第二步。
4. google/connect flow=connect 是刻意无登录的公网页；我没查 /connect/[id] 页面是否还有别的保护，仅凭 API 代码，clientId 就是唯一凭据。
5. 受限管理员(DEMO_ADMINS)有几个账号、是否已发给外部人，我读不到环境变量，严重度按「演示/试用账号可能在外部人手里」估。若名单里全是内部人，第一节 ⑤ 的高/中可整体下调一档。
6. onboard/self：public_scan_jobs 的 email 是公开表单匿名填的，别人可用你的邮箱提交一次扫描，你注册后按那次扫描结果建工作区（内容被他人预设）。低。
7. visual/image 的 production_package_id 没校验属于同一客户，会在别家包里插一行 production_items（低）。
8. admin/conversions/nal-mark-won 把 NAL 客户号与 stage_key 写死在共享路由里，是平台化问题而非越权。
