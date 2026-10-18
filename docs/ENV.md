# Magic Engine — 环境变量总表

> 最后核对：2026-07-25（扫描 `process.env.*` 全仓 + `render.yaml` + `.env.example`）
> **本文件只写变量名、用途、配在哪个平台 — 永远不写值。**

## 怎么读这张表

| 「配在哪」 | 含义 |
|---|---|
| **Render-web** | Render 上 `crazycontent` web service（service id `srv-d79s6d95pdvs73boptcg`）的 Environment —— 它才是对外的生产 web 服务，持有 `app.magicengine.com.au`。⚠️ 旧的 web 服务 `magic-engine` 已于 2026-07-25 移除，**别因为名字像就去找它**（依据：`render.yaml` 顶部说明） |
| **Render-cron** | 该变量只有某个 cron job 用得到 |
| **GH** | GitHub repo → Settings → Secrets and variables → Actions |
| **本地** | 只在 `.env.local` 或跑脚本时临时传，不需要上平台 |
| **无需配** | 运行时自动注入，或纯测试夹具 |

| 「登记」 | 含义 |
|---|---|
| ✅ | `render.yaml` 或 `.env.example` 里有 |
| ❌ | **两个地方都没有** — 换台机器 / 换个人接手就会漏配 |
| 🔴 | 有已知问题，见备注 |

**统计**：代码在用 **113** 个 · `.env.example` 59 个 · `render.yaml` 44 个 · **62 个在用变量此前无任何登记**。

---

## 1. 核心基础设施（缺一个就起不来）

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 项目 URL（前端可见） | Render-web | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名 key | Render-web | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端全权 key — ME 全部数据访问走它（不用 end-user RLS） | Render-web | ✅ |
| `CRON_SECRET` | 所有 `/api/cron/*` 的 Bearer 鉴权 | Render-web + 全部 cron + **GH** | ✅ |
| `APP_URL` | 应用自身域名（邮件链接 / OAuth callback 拼接） | Render-web | ✅ |
| `NEXT_PUBLIC_APP_URL` | 同上，前端可见版本 | Render-web | ✅ |
| `NEXT_PUBLIC_SITE_URL` | 站点 URL（另一处用法） | Render-web | ❌ |
| `NEXT_PUBLIC_REPORT_BASE_URL` | 报告分享链接基址 | Render-web | ❌ |
| `NEXT_PUBLIC_PROJECT_ID` | Supabase project ref（前端） | Render-web | ❌ |
| `RENDER_EXTERNAL_URL` | Render 自动注入的服务 host | 无需配 | ✅ |
| `RENDER_INSTANCE_ID` | Render 自动注入的实例 ID | 无需配 | — |
| `NODE_ENV` `PORT` `HOME` | 运行时标准变量 | 无需配 | — |
| `INNGEST_SIGNING_KEY` | Inngest 云端回调本应用 `/api/inngest` 时的签名校验密钥。**生产必须配**，否则接收端拒签、云端函数不执行（#1346）。已在 crazycontent/Render-web 上（2026-09-04 核实存在） | Render-web | ✅ |
| `INNGEST_EVENT_KEY` | 发事件到 Inngest 的密钥（`sendInngestEvent` 用）。已在 Render-web 上 | Render-web | ✅ |
| `INNGEST_DEV` | ⚠️ **生产绝不可设成真值**：设了会让 SDK 进 dev 模式、静默关掉 `/api/inngest` 的签名校验（任何人可触发函数）。仅本地/预览用。`/api/inngest` 请求期有 fail-closed 守卫，生产设了它会 500 拒服务（#1346） | 仅本地 | ❌ |

## 2. AI 模型

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `OPENAI_API_KEY` | GPT-4o-mini 文案 / Vision / Realtime | Render-web | ✅ |
| `OPENAI_BASE_URL` | 走 Cloudflare AI Gateway 代理（值已内联 render.yaml） | Render-web | ✅ |
| `ANTHROPIC_API_KEY` | Claude Sonnet（Brief / 策略 / 诸葛亮） | Render-web | ✅ |
| `ANTHROPIC_BASE_URL` | 走 Cloudflare AI Gateway 代理（值已内联 render.yaml） | Render-web | ✅ |
| `CF_AIG_TOKEN` | Cloudflare AI Gateway 鉴权；跟 `ANTHROPIC_API_KEY` 同一条链 | Render-web | ✅ (仅 example) |
| `PERPLEXITY_API_KEY` | AI 可见度追踪引擎之一 | Render-web | ✅ |
| `GEMINI_API_KEY` | Google Gemini（AI 可见度追踪第 4 引擎） | Render-web | ❌ |
| `AI_TRACKER_ENABLE_CLAUDE` | 开关：AI Tracker 是否跑 Claude 引擎 | Render-web | ❌ |
| `TYPESAFE_API_KEY` | TypeSafe Jev 判断模型（`src/lib/jev/client.ts`，对外封装名「Compliance Engine」）。三个判断点在用：① SEO 事实核对（`fact-check.ts`，PR #1826）；② 内容工厂成片文案品控——判断竞品品牌/占位字幕/人称口吻（`content-quality-guard.ts` / `scanContentQualityFlags`，PR #1825/#1832）；③ CTS Messenger AI 客服 verifier 的品牌红线/数字核实语义补充判断（`verifier/policies/cts.ts` / `verifyCtsReplyWithSemanticChecks`，2026-09-20，PM 已确认可发客户对话内容给 Jev）。`callJev` 缺这个变量会直接抛错：①处 `checkFactPreservation` fail-closed 恒定返回「有矛盾」；②处 `scanContentQualityFlags` 把每个带文案的工单标成 `quality_check_unavailable`；③处 fail-open 退回七道正则闸原结果（不阻塞发送，见 `MESSENGER_VERIFIER_SEMANTIC_DISABLED`）。**2026-09-20 晚间已在 `crazycontent`（Render-web）配上真实值，并现场拿 CTS 真实候选页验证过——拿到真实 `consistent:true`（score 0.08–0.10）而不是报错兜底，①处已确认生效。②③两处尚未单独验证，合并/复用前建议再跑一次确认。** | Render-web | ✅ |
| `CONTENT_GUARD_CLICHE_THRESHOLD` | 发布前内容守卫：套话概率阈值（0–1，默认 0.8），≥ 即标记需人工复核 | 可选 | ✅ (仅 example) |
| `CONTENT_GUARD_MAX_EMBEDDED_LATIN_WORDS` | 中文句子里允许夹的连续英文词数（默认 3，品牌名用） | 可选 | ✅ (仅 example) |
| `CONTENT_GUARD_MAX_EMBEDDED_CJK_CHARS` | 英文句子里允许夹的汉字数（默认 0） | 可选 | ✅ (仅 example) |
| `CONTENT_GUARD_CLICHE_DISABLED` | 开关：设 true 只关停套话判断——这是「主动不查」，不会把内容标成需复核；中英混杂检测照常跑、照常拦 | 可选 | ✅ (仅 example) |

## 3. 视觉 / 视频 / 素材

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `ATLAS_CLOUD_API_KEY` | WaveSpeed 图片 + Seedance 视频（共用一把 key） | Render-web | 🔴 见下方 |
| `MUAPI_API_KEY` | Muapi 图生视频（Visual Studio） | Render-web | ✅ |
| `CREATOMATE_API_KEY` | Creatomate 模板渲染（Video Studio）——`src/lib/creatomate/client.ts`，PM 2026-09-09 已订阅 Essential $54/月 | Render-web | ❌ 落地 PR 需补 |
| `FACTORY_CJK_FONT` | 🔴 已废弃（2026-09-02）—— 只被已退役的 `content-factory-render-worker` 读，现在没有任何服务读它。CTS/Oztop 拼片改走本机 `scripts/factory-worker`，字体在 make_promo.py 那边另配 | — | ❌ |
| `HEYGEN_API_KEY` | 数字人头像视频 | Render-web | ✅ |
| `HEYGEN_DEFAULT_AVATAR_ID` / `HEYGEN_DEFAULT_VOICE_ID` | HeyGen 默认形象/音色 | Render-web | ✅ |
| `MODELSLAB_API_KEY` | Muapi 图/视频引擎（P21.J 后主用） | Render-web | ❌ |
| `UNSPLASH_ACCESS_KEY` | 免费商用图库（素材抓取政策首选源） | Render-web | ❌ |
| `APIFY_API_KEY` | Apify scraper | Render-web | ❌ 🔴 |
| `APIFY_TOKEN` | 同上 — **两个变量名并存，代码里都在读，需统一** | Render-web | ❌ 🔴 |
| `SUPADATA_API_KEY` | 视频字幕 / 转录 | Render-web | ❌ |
| `VISION_BASE_URL` | vision-analyzer 脚本目标基址 | 本地 | ❌ |

> 🔴 **`ATLAS_CLOUD_API_KEY` 名字陷阱**：`render.yaml:46` 声明的是 `ATLAS_API_KEY`，但代码只读
> `ATLAS_CLOUD_API_KEY`（`src/lib/visual/atlas.ts:5`、`seedance.ts:6`、`wavespeed.ts:5`）。
> 若 Render 面板只填了 `ATLAS_API_KEY`，图片/视频生成在生产上是坏的。
> 已在 `render.yaml` 补上正确名字的条目，**旧名暂留**（等确认面板现状后再删）。见 [PITFALLS.md](./PITFALLS.md)。

## 4. SEO / 数据源

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | 关键词量 / KD / SERP / 外链 —— **主数据源**。`src/lib/dataforseo/*` 里读（走 `validateEnvVar('DATAFORSEO_LOGIN')`），调用方全是 web 路由；另有几个 `scripts/archive/*` 本地脚本也读，那是本地跑，不用上平台 | Render-web | ✅ |
| `SEMRUSH_DB` | 市场库（默认 `au`，每客户可覆盖 `nz`） | Render-web | ✅ |
| `SEMRUSH_API_KEY` | 🔴 `render.yaml:54` 声明了，但**全仓无任何代码读取**（已被 DataForSEO 取代，见 DECISIONS.md） | — | ⚠️ 待清理 |
| `SERPAPI_API_KEY` | SERP 抓取 / Google AI Overviews | Render-web | ✅ (仅 example) |
| `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` | GA4 / GSC 服务账号 JSON | Render-web | ❌ |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth（客户授权 GSC / GA4 / GBP） | Render-web | ❌ |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | 客户公司邮箱授权（Microsoft Graph，把客人发来的邮件接回 CRM） | Render-web | ❌ |
| `GOOGLE_GBP_ACCESS_TOKEN` | Google Business Profile | Render-web | ❌ |
| `GOOGLE_PLACES_API_KEY` | 本地商户 / 口碑数据 | Render-web | ❌ |
| `YOUTUBE_API_KEY` | YouTube 数据 | Render-web | ✅ |
| `ABR_GUID` | 澳洲 ABN 企业注册库查询 | Render-web | ✅ |
| `NZBN_API_KEY` | 新西兰 NZBN 企业注册库查询 | Render-web | ✅ |

## 5. 广告平台

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `META_SYSTEM_USER_TOKEN` | Meta 长效 System User Token（广告执行必需） | Render-web | ✅ (仅 example) |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Meta OAuth 应用 | Render-web | ✅ |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API（等审核，见 ROADMAP P18.B.0） | Render-web | ✅ |
| `GOOGLE_ADS_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_MANAGER_ID` | Google Ads OAuth + MCC | Render-web | ✅ |
| `TIKTOK_ADS_ACCESS_TOKEN` / `TIKTOK_ADS_ADVERTISER_ID` | TikTok Ads | Render-web | ✅ |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok 自动发布（Content Posting API，跟 Ads 是两个应用）| Render-web | ⬜ 待建应用 |
| `AD_HEALTH_DIGEST_TO` | 广告健康日报收件人。`src/lib/ads-strategy/config.ts` 读，调用方是 web 路由 `/api/cron/google-data-pullback-daily`；那条 cron 只负责 `curl` | Render-web | ❌ |

## 6. 发布 / 内容协作

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `PUBLER_API_KEY` / `PUBLER_WORKSPACE_ID` | 多平台排期发布 | Render-web | ✅ |
| `CMS_TOKEN_ENCRYPTION_KEY` | 客户 WordPress / CMS token 加密 | Render-web | ✅ |
| `CLOUDFLARE_MGMT_TOKEN` | 客户站点 DNS / Pages 管理 | Render-web | ✅ |
| `GITHUB_TOKEN` / `GITHUB_WEBHOOK_SECRET` | GitHub CMS 执行闭环（P12.H） | Render-web | ✅ |
| `AIRTABLE_API_KEY` | Airtable —— **正在退役**，代码仅剩 3 处引用 | Render-web | ❌ |
| `FACTORY_OPS_BASE_ID` / `FACTORY_REVIEW_TABLE_ID` / `WINNER_INTAKE_TABLE_ID` | Airtable 表 ID（Factory 审核，同上退役中） | Render-web | ❌ |
| `OZTOP_WP_USERNAME` / `OZTOP_WP_APP_PASSWORD` | Oztop WordPress 直连 | Render-web | ⚠️ render 有，代码走 `cms_connections` 表 |

## 7. 计费 / 变现 — **整块都没登记过**

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Stripe 服务端 key（MTC 充值） | Render-web | ❌ |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook 签名校验 | Render-web | ❌ |
| `STRIPE_PRICE_ID_STARTER` / `_GROWTH` / `_SCALE` | 三档套餐 Price ID | Render-web | ❌ |

## 8. 鉴权 / 安全

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `ADMIN_EMAILS` | 管理员白名单 | Render-web | ✅ |
| `ADMIN_EMAIL_DOMAIN` | 管理员邮箱域白名单 | Render-web | ✅ |
| `CLIENT_VIEWERS` | 客户只读账号白名单 | Render-web | ✅ |
| `PROTECTED_PAGE_OVERRIDE_EMAILS` | 谁有权改「保护名单」里的页（逗号分隔、邮箱精确匹配，不认域名；必须是已验证邮箱）。**没设 = 谁都不能改保护页**（安全默认）。只管人点按钮的三条路（seo-fix / update-page / update-post）；自动流程永远不能改保护页 | Render-web | ✅ |
| `INTERNAL_API_KEY` | 内部服务间调用（`api/factory/signals`） | Render-web | ✅ |
| `INTERNAL_WORKER_TOKEN` | Voice worker 内部鉴权 | Render-web | ✅ |
| `FACTORY_WORKER_TOKEN` | Factory worker 认领工单鉴权 | Render-web + worker | ❌ |
| `FACTORY_WORKER_TARGET_CLIENT_ID` | 本地 Factory worker 可选单客户 claim 目标；提供时服务端必须再与 `FACTORY_WORKER_CLIENT_IDS` 求交集，不提供时沿用现有全白名单行为 | worker-local `.env` | ❌ |
| `FACTORY_REMOTION_CLIENT_IDS` | 本地 Factory worker 允许走 Remotion 引擎（`brief.engine='remotion'`）的 client_id，逗号分隔；默认空 = 全部拒绝 | worker-local `.env` | ❌ |
| `UPLOAD_LINK_SECRET` | 客户免登录上传链接签名（未配时 fallback 到 `CRON_SECRET`） | Render-web | ❌ |
| `ADMIN_KEY_KILL_SWITCH` | 紧急关停全部 admin API key（设 `true` 生效） | Render-web | ❌ |
| `OPENAI_WEBHOOK_SECRET` | OpenAI Realtime webhook 校验 | Render-web | ✅ |

## 9. 邮件 / 通知

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `RESEND_API_KEY` | 全部事务邮件 | Render-web | ✅ |
| `ME_MAIL_FROM` / `ME_MAIL_TO` | ME 内部通知收发件人 | Render-web | ❌ |
| `FACTORY_REVIEWER_EMAILS` | Factory 审核通知收件人 | Render-web | ❌ |
| `OUTREACH_FROM_EMAIL` / `_REPLY_EMAIL` | 线索外联邮件收发地址（P35） | Render-web | ❌ |
| `OUTREACH_SENDER_NAME` / `_SENDER_FIRST_NAME` / `_SENDER_COMPANY` / `_WEBSITE` | 外联邮件署名 | Render-web | ❌ |

## 10. Voice Agent（Phase 36）

| 变量 | 用途 | 配在哪 | 登记 |
|---|---|---|---|
| `OPENAI_PROJECT_ID` | OpenAI 项目 | Render-web | ✅ |
| `OPENAI_REALTIME_MODEL` / `OPENAI_SUMMARY_MODEL` / `OPENAI_KB_MODEL` / `OPENAI_DEFAULT_VOICE` | 模型选择 | Render-web | ✅ |
| `REALTIME_WORKER_URL` / `REALTIME_WORKER_PORT` | 独立 worker（当前 in-process 跑，未启用） | Render-web | ✅ |
| `VOICE_STORE` | 存储后端（`supabase`） | Render-web | ✅ |
| `VOICE_TEST_NUMBERS` | 测试号码白名单 | Render-web | ✅ |
| `VOICE_DEFAULT_AGENT_ID` | DID 丢失时的兜底坐席 | Render-web | ✅ |
> 🔴 **判「这个变量还有没有人用」，不能只 grep `process.env.X`。**
>
> `lib/voice/config.ts` 用 zod schema 声明变量名，代码读的是 `cfg.env.X` / `parsed.X`，**全程不出现 `process.env.X`**。
> 2026-08-01 就是按 `process.env` 搜出「0 引用」，误删了 9 个仍在用的语音变量（见 [PITFALLS A5](./PITFALLS.md)）。
> 2026-09-27 这一行又被记成「代码 0 引用，待清理」，实测 **5 个里 4 个在用** —— 同一个坑第二次。
> **正确做法**：`grep -rn "<变量名>" src/ scripts/`（搜名字本身，不搜 `process.env.`）。

| `OUTBOUND_CALLING_ENABLED` | 🔴 **外呼总闸**，当前 `false`（板桥硬闸 #3） | Render-web | ✅ |
| `DEFAULT_COUNTRY` / `DEFAULT_TIMEZONE` | `NZ` / `Pacific/Auckland` | Render-web | ✅ |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | 🔴 **在用，别清理**（2026-09-27 核实）。`lib/voice/config.ts:89` 用它俩判语音线路走 real 还是 mock，而 `:92-103` 在生产环境只要有 provider 落回 mock 就**抛错拒绝启动**；`api/voice/integration-status/route.ts:18` 还拿它对外报状态 | Render-web | ⬜ 待核 |
| `DEFAULT_HUMAN_TRANSFER_URI` | 🔴 **在用，别清理**。转人工的兜底地址（`lib/voice/tools/impl.ts:151`、`scripts/voice/provision-tenant.ts:51`） | Render-web | ⬜ 待核 |
| `WEBHOOK_REPLAY_WINDOW_SECONDS` | 🔴 **在用，别清理**。webhook 验签的防重放窗口（`lib/voice/providers/openai.ts:47`、`mock.ts:30`），有默认值 300 | Render-web | ✅ 有默认值 |
| `TELEPHONY_PROVIDER` | `.env.example` 有；只在 `lib/voice/config.ts:35` 声明了默认值 `'twilio'`，**没有任何消费方** —— 这一个是真的可以清理 | — | ⚠️ 待清理 |
| `WHATSAPP_ACCESS_TOKEN` / `_PHONE_NUMBER_ID` | **WhatsApp 收发的关键路径依赖**（`lib/whatsapp/send.ts`）。`_PHONE_NUMBER_ID` 必须与该客户 `clients.whatsapp_phone_number_id` 一致，不一致时发送会被主动挡下（防止用别的客户号码发消息） | Render-web | ⬜ 待配 |
| `META_APP_SECRET` | WhatsApp webhook 验签用（`/api/webhooks/whatsapp`）。**缺了 POST 直接 500**，Meta 重试几轮后会停掉整个订阅 | Render-web | ⬜ 待配 |
| `META_VERIFY_TOKEN` | WhatsApp webhook 订阅握手用。缺了在 Meta 后台**订阅不上** | Render-web | ⬜ 待配 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `.env.example` 有，代码 0 引用 | — | ⚠️ 待清理 |

## 11. 功能开关 / 灰度

| 变量 | 用途 | 配在哪 |
|---|---|---|
| `MOCK_EXTERNAL_SERVICES` | 测试时 mock 全部外部 API | 本地 / CI |
| `FACTORY_PUBLISH_LIVE` | 🔴 Factory 是否真发布。**未配 = 静默发 DRAFT**（片子落库全绿但 FB 上没人看得见） | Render-web |
| `FACTORY_INSTAGRAM_LIVE` | 🔴 Instagram 同步是否真发(**独立于** FACTORY_PUBLISH_LIVE,两个都明确为 `true` 才真排期)。**未配 = 只在 Publer 存草稿**,不会公开。Instagram 这条线第一次真连 Publer 必须先走草稿验证 | Render-web |
| `DAILY_PLAN_AUTO_PUBLISH_LIVE` | 🔴 每日计划图文 Post 自动发布是否**真发**。必须严格等于 `true`。**未配 = 只演练**（走完全部发布闸门、什么都不发也不写库，只在 cron_run_logs 留一行）。第一次真发必须 PM 明确说 go | Render-web |
| `STORY_AUTO_PUBLISH_LIVE` | 🔴 Story 自动发布是否**真发**。必须严格等于 `true`。**未配 = 只演练**（走完全部检查、什么都不发，只记检查结果）。真发还要客户在 `STORY_AUTO_PUBLISH_CLIENTS` 名单里；第一次真发必须 PM 明确说 go | Render-web |
| `STORY_AUTO_PUBLISH_CLIENTS` | Story 自动发布允许真发的客户 id，逗号分隔、小写。**未配或不在名单 = 只演练** | Render-web |
| `DAILY_PLAN_AUTO_PUBLISH_CLIENTS` | 🔴 允许自动真发的客户 id 白名单（逗号分隔，小写）。**不在名单里的客户永远只演练**，即使上面的总开关打开了 | Render-web |
| `FACTORY_INSTAGRAM_LIVE_CLIENTS` | 🔴 允许 Instagram 真发的客户 id 名单(逗号分隔)。**未配 = 空名单 = 所有客户只存草稿**。Publer 里绑了 Instagram 账号 ≠ 客户同意自动跟发,所以真发还要按客户点名 | Render-web |
| `FACTORY_INSTAGRAM_ENABLED_CLIENTS` | 🔴 允许 Instagram 同步的「客户id:Publer 账号id」名单(逗号分隔,如 `a:b,c:d`)。**未配 = 一条都不处理(连草稿也不建)**;客户自己能改连接器里的账号绑定,所以绑定只是候选,必须和这里点名的账号完全一致才处理 | Render-web |
| `FACTORY_WORKER_CLIENT_IDS` | Factory 认领工单的客户白名单。**不是 worker 自己读的** —— worker 调 `/api/factory/worker/claim`，白名单在那条路由里由 `src/lib/factory/worker-guard.ts` 读并 fail-closed（未配则拒绝全部 claim） | Render-web |
| `PROSPECTING_SWEEP_ENABLED` | 线索挖掘总闸（默认 **关**）。`/api/cron/prospecting-sweep` 路由里读 —— 那是 web 进程，prospecting-sweep 这个 cron 只负责 `curl` | Render-web |
| `JOB_SIGNAL_INGEST_ENABLED` / `JOB_SIGNAL_KEYWORDS` | 招聘信号采集开关（默认 **关**）+ 关键词。开关在 `/api/cron/job-boards-weekly` 路由里读，同样是 web 进程 | Render-web |
| `ATTRIBUTION_DUAL_WINDOW_ENABLED` | 归因双窗口总闸（默认 **关**）。开了之后被转交的动作会同时按 GSC 的 28 天节奏和 pass 1 的窗口各算一次。**在 `src/lib/memory/` 的消费方（extractor / learning-rollup）改成按动作计样本、并且分页读全之前不许开**（那 5 条查询也没分页，光去重不分页等于没修） —— 这是唯一还没改的一类；本 PR 已经把其余读取方（行业基准、三个信心读取、后台聚合页 `/api/admin/flywheel/aggregate`、执行看板 `/api/clients/[id]/execution`）**既改成按动作折叠、也改成分页读全**（只折叠不分页照样错：折叠是在读到的行里挑代表，带目标指标那行被截掉就会挑错代表，那不是少算是算错） —— 现在开会让同一个动作在学习和行业基准里被重复计数（Issue #859）。关着的时候两个写入方还会顺手清掉自己在非权威窗口上的旧行（老版本留下的），因为只拒绝新写入挡不住已经存在的第二个窗口；这一步只在权威窗口真的写进去之后才做，所以还算不出结果的动作会暂时保留那一行，等算得出来那一轮再清。⚠️ 配在 **web service** 上：`attribution-cron` 只是 `curl` 打这个接口，读 env 的是接请求的 web 进程；配到 cron 上开关不会生效，而且是静默不生效 | Render-web |
| `SOCIAL_COMMENT_AUTOREPLY_KILL` | 社媒评论自动回复紧急关停 | Render-web |
| `EMAIL_REPLY_DIGEST_ENABLED` | 🔴「客人来信没人回」汇总信总闸，默认 **关**（未配 = 不发，安全态）。开关在 `/api/cron/email-reply-digest` 路由里读 —— 是 web 进程，配到 cron job 自己身上不生效。2026-09-03 上线当天即由 PM 拍板暂停：现有排除只挡「自己人域名」和「同行域名」，挡不住陌生公司群发的推销，CTS 当天 32 条候选里噪音占七成，而排序按「等最久」，前 10 条有 8 条是营销邮件。**加好噪音过滤并用生产数据验证准确率之后才可开**；开的时候 `render.yaml` 里那段调度也要一起取消注释（两道闸） | Render-web |
| `LEAD_FOLLOWUP_DIGEST_ENABLED` | 🔴「客人填了表还没人回」每日汇总信总闸，默认 **关**（未配 = 只挑名单不发信，安全态）。开关在 Inngest 云端函数 `cloud-crm-lead-followup-digest` 里读 —— **不是** Render cron 路由，配在 Inngest 跑得到的那份环境里。关着的时候名单照挑、回执照记（`sent:false` + `reason:'未启用'`），可以先看名单准不准再打开。**收件人没有环境变量，也不许有**：写死成函数文件里的字面量 `DIGEST_RECIPIENT = 'hello@magicengine.cloud'`（PM 2026-09-24 拍板第一步只发给 ME 自己），要改成发给客户的销售必须走一次代码改动 + 复审。🔴 **刻意不用 `ME_MAIL_TO_ADDRESS`** —— 那个常量读 `ME_MAIL_TO` 这个**全站共用**的环境变量（联系表单、cron 摘要、今日待办都读它），用它就等于「改一行配置就能把每个客户的客人名单发到任意地址」 | Render-web |
| `LINKEDIN_PROGRESS_POST_ENABLED` | 🔴 ME 产品动态自动发 LinkedIn 总闸，默认关（未配 = 禁用，不用配才是安全态）。开关在 `/api/cron/linkedin-progress-post-{mon,thu}` 路由里读——那是 web 进程，两条 cron 只负责 `curl`；配到 cron job 自己的环境变量上不会生效。上线前提：PM 已在 Publer 连好个人 LinkedIn 账号，并在 Magic Lab Class 客户的 connectors 设置页把账号 ID 填进 Publer 绑定 | Render-web |
| `SWEEP_CITIES` / `SWEEP_INDUSTRIES` | 线索扫描城市 / 行业范围。`src/lib/prospecting/sweep.ts` 里读（走 `envList('SWEEP_CITIES', …)`，变量名是字符串传进去的），调用方是 web 路由 `/api/cron/prospecting-sweep` | Render-web |
| `ENABLE_REAL_GENERATION` | `.env.example` 有，代码 0 引用 | ⚠️ 待清理 |
| `FACTORY_QUALITY_GUARD_DISABLED` | 内容工厂成片文案品控（竞品品牌/占位字幕/人称口吻）总闸，设 `true` 临时全局关停 Jev 调用（确定性的字幕重复检测不受影响，照常跑）。默认开 | Render-web |
| `MESSENGER_VERIFIER_SEMANTIC_DISABLED` | CTS Messenger AI 客服 verifier 的 Jev 语义补充判断（brand_redline/number_claim 换措辞绕过）总闸，设 `true` 临时全局关停 Jev 调用（七道正则闸不受影响，照常跑）。默认开 | Render-web |

## 12. 只在脚本 / 测试里用 — **不需要配到任何平台**

| 变量 | 出处 |
|---|---|
| `SB_KEY` `SB_REF` | `scripts/factory-worker/ingest-clips.mjs:23-24`（fallback 到 `SUPABASE_SERVICE_ROLE_KEY`） |
| `DRY_RUN` | `scripts/archive/backfill-execution-target.ts` · `scripts/archive/p12-a13-cts-e2e.ts` |
| `WRITE` `SINCE` `CLIENT_ID` `PLAN_ID` | `scripts/archive/regenerate-social-plan-images.ts` |
| `CITY` `INDUSTRY` `SUB_INDUSTRY` | `scripts/archive/p30-s4-serp-probe.ts` |
| `TEST_VAR_MAGIC` | `src/lib/__tests__/validation-utils.test.ts` — 纯测试夹具 |

## 13. GitHub Actions Secrets

| 变量 | 用途 |
|---|---|
| `CRON_SECRET` | 4 个 workflow 全部依赖（**必需**，与 Render 同值） |
| `BASELINE_CRON_URL` | 可选覆盖，`.github/workflows/baseline-domains-monthly.yml` |
| `GOALS_EXPIRY_CRON_URL` | 可选覆盖，`.github/workflows/goals-expiry-check.yml` |
| `WINNER_REEL_SYNC_URL` | 可选覆盖，`.github/workflows/winner-reel-sync-daily.yml` |

## 14. 2026-09-21 补登记（对照 `src/` 全量扫描，main `41d47685`）

此前代码在读、但本表没有的变量。搬服务器的给法见 [sops/server-migration-secrets-handover.md](./sops/server-migration-secrets-handover.md)。

| 变量 | 用途 | 配在哪 |
|---|---|---|
| `JINA_API_KEY` | Site Analyzer 抓取客户官网（`src/lib/brief/jina.ts`） | Render-web |
| `MAILCHIMP_API_KEY` | 营销计划生成读 Mailchimp + `/api/cron/mailchimp-suppression-sync` 同步退订名单 | Render-web |
| `DEMO_ADMINS` | 演示管理员白名单，格式 `邮箱:客户ID`，限定只能看指定客户（`src/lib/auth/whitelist.ts`） | Render-web |
| `NEXT_PUBLIC_GA_MEASUREMENT_ID` / `NEXT_PUBLIC_META_PIXEL_ID` | ME 自家营销页的 GA4 / Meta 像素 | Render-web |
| `META_CAPI_VERSION` | Meta 转化回传用的 Graph 版本，默认 `v19.0` | Render-web（可不配） |
| `META_SYSTEM_USER_TOKEN_<域名>` | 🔴 **每客户一把的 Meta 广告令牌，名字运行时拼出来**（`domainToEnvKey`，`src/lib/meta/token-selection.ts`），静态扫描扫不到，完整清单只在 Render 面板上 | Render-web |
| `LAUNCH_SIGNOFF_SIGNERS` | 「上线签字」页能签字/撤销的人的邮箱（逗号分隔，大小写不敏感）。**未配 = 谁都不能签**（fail-closed）；只认真人登录会话，服务钥匙一律不行（`src/lib/launch-signoff/auth.ts`） | Render-web |
| `LAUNCH_SIGNOFF_EXECUTOR_KEY` / `LAUNCH_SIGNOFF_REVIEWER_KEY` | 上线签字接口给「执行窗口 / 复核窗口」各一把**不同**的钥匙（请求头 `x-launch-signoff-key`）；角色由钥匙决定，所以「复核人≠执行人」由服务端强制。未配 = 对应窗口不能写（fail-closed） | Render-web |
| `META_PIXEL_ID_<域名>` | 每客户像素 ID，同样是运行时拼名（`src/lib/meta/capi/config.ts`） | Render-web |
| `CRM_NOTE_MODEL` / `CRM_STAGE_INFER_MODEL` / `MESSENGER_BRIEF_MODEL` / `MARKET_INTEL_MODEL` | 各功能的模型名覆盖，默认都是 `gpt-4o-mini` | Render-web（可不配） |
| `CRM_FACTS_CLIENT_IDS` | 「AI 读对话存事实」要给哪些客户跑（逗号分隔的客户 UUID），**未配 = 全关**（fail-closed）。目前只该配 NAL；提示词里「具体货物」是物流语义，别的行业先别开 | Render-web |
| `CRM_FACTS_MODEL` / `CRM_FACTS_DAILY_LIMIT` / `CRM_FACTS_PER_RUN` | 存事实用的模型（默认 `gpt-4o`）、每客户每天最多读几段（默认 80）、每小时那一轮最多读几段（默认 5，上限 20）。可不配 | Render-web（可不配） |
| `WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS` | Web Intelligence 客户白名单，未配 = 谁都不跑 | Render-web |
| `WEB_INTELLIGENCE_TRAFFIC_ENABLED` | Web Intelligence 流量检查总闸，默认 **关** | Render-web |
| `WEB_INTELLIGENCE_FIRST_PARTY_TOUR_SOURCES` | 第一方行程数据源配置（JSON） | Render-web |
| `FACTORY_STOCK_REFILL_ENABLED` | 内容工厂素材库自动补货总闸，默认 **关** | Render-web |
| `BASELINE_CRON_ENABLED` | 设 `false` 可临时停掉每月域名基线任务，默认开 | Render-web |

---

## 自检

```bash
bash scripts/doctor.sh          # 全量：env + 外部 API + cron
bash scripts/doctor.sh --env    # 只查 env（掩码输出，不打印值）
```
