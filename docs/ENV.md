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
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API（2026-06-11 提交的旧申请流程已作废；2026-09-15 走新流程拿到 Explorer 级权限——可管正式客户账户，2880 次操作/天，但不能建账户/管用户权限/关键词规划；Basic 级待品牌审核，见 ROADMAP AD-GADS-1） | Render-web | ✅ |
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
| `INTERNAL_API_KEY` | 内部服务间调用（`api/factory/signals`） | Render-web | ✅ |
| `INTERNAL_WORKER_TOKEN` | Voice worker 内部鉴权 | Render-web | ✅ |
| `FACTORY_WORKER_TOKEN` | Factory worker 认领工单鉴权 | Render-web + worker | ❌ |
| `FACTORY_WORKER_TARGET_CLIENT_ID` | 本地 Factory worker 可选单客户 claim 目标；提供时服务端必须再与 `FACTORY_WORKER_CLIENT_IDS` 求交集，不提供时沿用现有全白名单行为 | worker-local `.env` | ❌ |
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
| `OUTBOUND_CALLING_ENABLED` | 🔴 **外呼总闸**，当前 `false`（板桥硬闸 #3） | Render-web | ✅ |
| `DEFAULT_COUNTRY` / `DEFAULT_TIMEZONE` | `NZ` / `Pacific/Auckland` | Render-web | ✅ |
| `TELEPHONY_PROVIDER` `TWILIO_ACCOUNT_SID` `TWILIO_AUTH_TOKEN` `DEFAULT_HUMAN_TRANSFER_URI` `WEBHOOK_REPLAY_WINDOW_SECONDS` | `.env.example` 有，代码 0 引用（已切 OpenAI 原生 SIP） | — | ⚠️ 待清理 |
| `WHATSAPP_ACCESS_TOKEN` / `_PHONE_NUMBER_ID` | **WhatsApp 收发的关键路径依赖**（`lib/whatsapp/send.ts`）。`_PHONE_NUMBER_ID` 必须与该客户 `clients.whatsapp_phone_number_id` 一致，不一致时发送会被主动挡下（防止用别的客户号码发消息） | Render-web | ⬜ 待配 |
| `META_APP_SECRET` | WhatsApp webhook 验签用（`/api/webhooks/whatsapp`）。**缺了 POST 直接 500**，Meta 重试几轮后会停掉整个订阅 | Render-web | ⬜ 待配 |
| `META_VERIFY_TOKEN` | WhatsApp webhook 订阅握手用。缺了在 Meta 后台**订阅不上** | Render-web | ⬜ 待配 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | `.env.example` 有，代码 0 引用 | — | ⚠️ 待清理 |

## 11. 功能开关 / 灰度

| 变量 | 用途 | 配在哪 |
|---|---|---|
| `MOCK_EXTERNAL_SERVICES` | 测试时 mock 全部外部 API | 本地 / CI |
| `FACTORY_PUBLISH_LIVE` | 🔴 Factory 是否真发布。**未配 = 静默发 DRAFT**（片子落库全绿但 FB 上没人看得见） | Render-web |
| `FACTORY_WORKER_CLIENT_IDS` | Factory 认领工单的客户白名单。**不是 worker 自己读的** —— worker 调 `/api/factory/worker/claim`，白名单在那条路由里由 `src/lib/factory/worker-guard.ts` 读并 fail-closed（未配则拒绝全部 claim） | Render-web |
| `PROSPECTING_SWEEP_ENABLED` | 线索挖掘总闸（默认 **关**）。`/api/cron/prospecting-sweep` 路由里读 —— 那是 web 进程，prospecting-sweep 这个 cron 只负责 `curl` | Render-web |
| `JOB_SIGNAL_INGEST_ENABLED` / `JOB_SIGNAL_KEYWORDS` | 招聘信号采集开关（默认 **关**）+ 关键词。开关在 `/api/cron/job-boards-weekly` 路由里读，同样是 web 进程 | Render-web |
| `ATTRIBUTION_DUAL_WINDOW_ENABLED` | 归因双窗口总闸（默认 **关**）。开了之后被转交的动作会同时按 GSC 的 28 天节奏和 pass 1 的窗口各算一次。**在 `src/lib/memory/` 的消费方（extractor / learning-rollup）改成按动作计样本、并且分页读全之前不许开**（那 5 条查询也没分页，光去重不分页等于没修） —— 这是唯一还没改的一类；本 PR 已经把其余读取方（行业基准、三个信心读取、后台聚合页 `/api/admin/flywheel/aggregate`、执行看板 `/api/clients/[id]/execution`）**既改成按动作折叠、也改成分页读全**（只折叠不分页照样错：折叠是在读到的行里挑代表，带目标指标那行被截掉就会挑错代表，那不是少算是算错） —— 现在开会让同一个动作在学习和行业基准里被重复计数（Issue #859）。关着的时候两个写入方还会顺手清掉自己在非权威窗口上的旧行（老版本留下的），因为只拒绝新写入挡不住已经存在的第二个窗口；这一步只在权威窗口真的写进去之后才做，所以还算不出结果的动作会暂时保留那一行，等算得出来那一轮再清。⚠️ 配在 **web service** 上：`attribution-cron` 只是 `curl` 打这个接口，读 env 的是接请求的 web 进程；配到 cron 上开关不会生效，而且是静默不生效 | Render-web |
| `SOCIAL_COMMENT_AUTOREPLY_KILL` | 社媒评论自动回复紧急关停 | Render-web |
| `EMAIL_REPLY_DIGEST_ENABLED` | 🔴「客人来信没人回」汇总信总闸，默认 **关**（未配 = 不发，安全态）。开关在 `/api/cron/email-reply-digest` 路由里读 —— 是 web 进程，配到 cron job 自己身上不生效。2026-09-03 上线当天即由 PM 拍板暂停：现有排除只挡「自己人域名」和「同行域名」，挡不住陌生公司群发的推销，CTS 当天 32 条候选里噪音占七成，而排序按「等最久」，前 10 条有 8 条是营销邮件。**加好噪音过滤并用生产数据验证准确率之后才可开**；开的时候 `render.yaml` 里那段调度也要一起取消注释（两道闸） | Render-web |
| `LINKEDIN_PROGRESS_POST_ENABLED` | 🔴 ME 产品动态自动发 LinkedIn 总闸，默认关（未配 = 禁用，不用配才是安全态）。开关在 `/api/cron/linkedin-progress-post-{mon,thu}` 路由里读——那是 web 进程，两条 cron 只负责 `curl`；配到 cron job 自己的环境变量上不会生效。上线前提：PM 已在 Publer 连好个人 LinkedIn 账号，并在 Magic Lab Class 客户的 connectors 设置页把账号 ID 填进 Publer 绑定 | Render-web |
| `SWEEP_CITIES` / `SWEEP_INDUSTRIES` | 线索扫描城市 / 行业范围。`src/lib/prospecting/sweep.ts` 里读（走 `envList('SWEEP_CITIES', …)`，变量名是字符串传进去的），调用方是 web 路由 `/api/cron/prospecting-sweep` | Render-web |
| `ENABLE_REAL_GENERATION` | `.env.example` 有，代码 0 引用 | ⚠️ 待清理 |

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

---

## 自检

```bash
bash scripts/doctor.sh          # 全量：env + 外部 API + cron
bash scripts/doctor.sh --env    # 只查 env（掩码输出，不打印值）
```
