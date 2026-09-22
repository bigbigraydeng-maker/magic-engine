# 服务器搬家 · 密钥交接手册

> 建立：2026-09-21 · 适用：把 Magic Engine 从现有 Render 服务逐步搬到新服务器
> 配套：[docs/ENV.md](../ENV.md)（全部变量名 + 用途）· [render.yaml](../../render.yaml)（57 个定时任务）
> **本文件只写变量名和做法，永远不写值。**

## 0. 三条规矩（先读）

1. **不传 `.env.local`，不传整份 Render 环境变量导出。** 只按本文件分阶段给，用到哪批给哪批。
2. **传递方式只有一种**：密码管理器（1Password / Bitwarden）的一次性、会过期的安全分享链接。不走微信、邮件、Slack、Git、截图。
3. **能单独新做一把的，就不共用正式环境那把。** 新服务器用自己的 key，出事只作废这一把，正式系统不受影响。

> ⚠️ **真实值以 Render 面板上 `crazycontent` 这个 web service 的 Environment 为准**，不是 `.env.local`，也不是 `docs/ENV.md`。
> 原因：有一类变量名是代码运行时拼出来的（见 §4），静态扫描扫不到，只有面板上有完整清单。

---

## 1. 最大的坑：两台服务器同时干活 = 双发、双扣钱

「逐步搬」意味着有一段时间新旧两台都开着。只要新服务器拿到了真钥匙 **并且** 会自己触发任务，下面这些事就会做两遍：

| 会重复的事 | 后果 |
|---|---|
| 57 个定时任务（`render.yaml`） | 同一份报告发两遍、外部 API 费用翻倍 |
| Inngest 工作流 | 同一个事件两边各跑一次（内容发布、AI 可见度追踪都在上面） |
| 社媒发布 / 评论自动回复 | 客户主页上出现重复帖子、重复回复 |
| Meta / Google 广告执行 | 同一个预算调整执行两次 |
| 事务邮件 | 客户收到两封 |

**所以切换日之前，新服务器必须保持「只能看、不能动」：**

- [ ] 新服务器**不配任何定时任务**（不部署 `render.yaml` 里的 cron 段，也不自建 crontab）
- [ ] **不要**在 Inngest 后台把新服务器地址同步（sync）上去——同步即开始接活
- [ ] `FACTORY_PUBLISH_LIVE` 不配（未配 = 只出草稿）
- [ ] `OUTBOUND_CALLING_ENABLED=false`
- [ ] `SOCIAL_COMMENT_AUTOREPLY_KILL=true`
- [ ] `PROSPECTING_SWEEP_ENABLED` / `JOB_SIGNAL_INGEST_ENABLED` / `EMAIL_REPLY_DIGEST_ENABLED` / `LINKEDIN_PROGRESS_POST_ENABLED` / `FACTORY_STOCK_REFILL_ENABLED` / `WEB_INTELLIGENCE_TRAFFIC_ENABLED` 全部不配（默认关）
- [ ] §3 第三阶段的钥匙（广告、发布、邮件、支付）**一把都不给**

---

## 2. 钥匙分三类：怎么给

### 甲类 · 新做一把（新服务器专用，可单独作废）

去对应平台后台新建一个 key，命名带上 `new-server`，方便以后辨认和作废。

| 变量 | 去哪新建 |
|---|---|
| `OPENAI_API_KEY` | OpenAI 后台 → API keys（建议同时设月度上限） |
| `ANTHROPIC_API_KEY` | Anthropic Console → API keys |
| `PERPLEXITY_API_KEY` · `GEMINI_API_KEY` | 各自后台 |
| `CF_AIG_TOKEN` | Cloudflare → AI Gateway |
| `TYPESAFE_API_KEY` · `JINA_API_KEY` · `SERPAPI_API_KEY` · `SUPADATA_API_KEY` | 各自后台 |
| `MUAPI_API_KEY` · `MODELSLAB_API_KEY` · `ATLAS_CLOUD_API_KEY` · `CREATOMATE_API_KEY` · `HEYGEN_API_KEY` · `UNSPLASH_ACCESS_KEY` | 各自后台（这一组按量计费，**视频类是唯一真烧钱的**，新 key 务必设上限） |
| `APIFY_TOKEN`（`APIFY_API_KEY` 同值，两个名字代码都在读） | Apify → Integrations |
| `RESEND_API_KEY` · `MAILCHIMP_API_KEY` · `PUBLER_API_KEY` | 各自后台 —— **第三阶段才给** |
| `GITHUB_TOKEN` · `CLOUDFLARE_MGMT_TOKEN` | 新建一个权限收窄的 token —— **第三阶段才给** |
| `CRON_SECRET` · `INTERNAL_API_KEY` · `INTERNAL_WORKER_TOKEN` · `FACTORY_WORKER_TOKEN` · `UPLOAD_LINK_SECRET` | 我们自己定的随机串。新服务器**自己生成新的**（`openssl rand -hex 32`），不需要从旧环境拿。注意 `CRON_SECRET` 在 GitHub Actions Secrets 里也有一份，切换日一起换 |

### 乙类 · 只能共用（跟身份或已存数据绑死，新做不了）

| 变量 | 为什么不能新做 | 怎么给 |
|---|---|---|
| `CMS_TOKEN_ENCRYPTION_KEY` | 数据库里存着的客户网站登录凭据是用它加密的。**新服务器的值必须一字不差**，否则所有客户网站连接全部解不开，且不报错只是连不上 | 安全链接单独传，第二阶段 |
| `SUPABASE_SERVICE_ROLE_KEY` | 数据库总钥匙，能读写全部客户数据。数据库不搬，它就只有这一把 | 安全链接单独传，第一阶段就需要。**这是全场最危险的一把** |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `NEXT_PUBLIC_PROJECT_ID` | 前端可见，本来就不是秘密 | 直接给 |
| `DATAFORSEO_LOGIN` / `_PASSWORD` | 账号密码制，一个账号一套 | 第二阶段 |
| `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` | 客户已把 GA4 / GSC 授权给这个服务账号邮箱，换账号 = 所有客户重新授权 | 可在同一服务账号下**新增一把密钥 JSON**（算半个甲类），第二阶段 |
| `GOOGLE_CLIENT_ID` / `_SECRET` · `MICROSOFT_CLIENT_ID` / `_SECRET` · `FACEBOOK_APP_ID` / `_APP_SECRET` · `META_APP_SECRET` · `TIKTOK_CLIENT_KEY` / `_SECRET` | 客户授权时认的是这个应用，换应用 = 客户重新授权 | 第三阶段。**还要去各平台后台把新域名加进回调地址白名单**（见 §5） |
| `META_SYSTEM_USER_TOKEN` 及 §4 的每客户版本 | 绑定广告账户授权，能花客户的钱 | 第三阶段，切换日当天 |
| `GOOGLE_ADS_*`（5 个）· `TIKTOK_ADS_*`（2 个） | 同上 | 第三阶段 |
| `WHATSAPP_ACCESS_TOKEN` / `_PHONE_NUMBER_ID` · `META_VERIFY_TOKEN` | 绑定号码 | 第三阶段 |
| `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` | 绑定 Inngest 上的应用。建议在 Inngest 里为新服务器**另建一个环境**拿新 key，切换日再指过去 | 第三阶段 |
| `STRIPE_SECRET_KEY` · `STRIPE_PRICE_ID_*` | 收钱的账户 | 第三阶段。可在 Stripe 建一把**受限密钥（restricted key）** |
| `STRIPE_WEBHOOK_SECRET` · `GITHUB_WEBHOOK_SECRET` · `OPENAI_WEBHOOK_SECRET` | 每个回调地址一把。新域名 = 在对方后台新建回调 = 自动得到新的一把 | 第三阶段，不从旧环境拿 |

### 丙类 · 不是秘密，照抄即可

域名、开关、模型名、收件人、白名单这类配置：
`APP_URL` `NEXT_PUBLIC_APP_URL` `NEXT_PUBLIC_SITE_URL` `NEXT_PUBLIC_REPORT_BASE_URL`（**新服务器要填新域名**）·
`OPENAI_BASE_URL` `ANTHROPIC_BASE_URL` · `ADMIN_EMAILS` `ADMIN_EMAIL_DOMAIN` `CLIENT_VIEWERS` `DEMO_ADMINS` ·
`SEMRUSH_DB` `DEFAULT_COUNTRY` `DEFAULT_TIMEZONE` · 全部 `OPENAI_*_MODEL` / `*_MODEL` ·
`ME_MAIL_*` `OUTREACH_*` `FACTORY_REVIEWER_EMAILS` `AD_HEALTH_DIGEST_TO` · `FACTORY_WORKER_CLIENT_IDS` `WEB_INTELLIGENCE_ALLOWED_CLIENT_IDS` ·
`NEXT_PUBLIC_GA_MEASUREMENT_ID` `NEXT_PUBLIC_META_PIXEL_ID` `META_CAPI_VERSION` · `ABR_GUID` `NZBN_API_KEY` `YOUTUBE_API_KEY` `GOOGLE_PLACES_API_KEY`（后四个是低风险查询 key，可照抄也可新做）

> `ADMIN_EMAILS` / `CLIENT_VIEWERS` / `DEMO_ADMINS` 决定谁能登录后台、谁能看哪个客户。照抄时逐项核对，别多加人。

**不要搬**（`docs/ENV.md` 已标注废弃或无代码引用）：`SEMRUSH_API_KEY` `ATLAS_API_KEY`（旧名）`FACTORY_CJK_FONT` `TWILIO_*` `TELEPHONY_PROVIDER` `WHATSAPP_BUSINESS_ACCOUNT_ID` `ENABLE_REAL_GENERATION` `AIRTABLE_API_KEY` 及三个 Airtable 表 ID（退役中，搬之前先确认是否还需要）。

---

## 3. 分三个阶段给

| 阶段 | 目标 | 给哪些 | 验收 |
|---|---|---|---|
| **一 · 能启动** | 新服务器上网页能打开、能登录、能看到客户数据 | 丙类全部 + Supabase 四项 + AI 模型 key（甲类新做） | `bash scripts/doctor.sh --env` 通过；后台能登录；§1 清单逐项打勾 |
| **二 · 能读数** | 各种只读数据源接通 | `CMS_TOKEN_ENCRYPTION_KEY` + DataForSEO + Google 服务账号 + 其余甲类查询 key | 随便开一个客户，关键词 / GSC / 网站连接状态能正常显示 |
| **三 · 切换日** | 新服务器接管，旧服务器停 | 乙类里所有「第三阶段」的 + 回调地址全部改到新域名 + 定时任务 + Inngest 同步 | 见 §5 切换日清单 |

第三阶段是**撤不回的动作**（对外发布、花钱、改生产），动手前必须产品负责人明确说 `go`。

---

## 4. 扫描扫不到的变量：每个客户一把的 Meta 令牌

代码里有一类名字是运行时拼出来的，`docs/ENV.md` 和任何静态扫描都列不全：

- `META_SYSTEM_USER_TOKEN_<域名>` —— 每个客户一把广告令牌。域名转大写、点换下划线，例如 `ctstours.co.nz` → `META_SYSTEM_USER_TOKEN_CTSTOURS_CO_NZ`（拼法见 `src/lib/meta/token-selection.ts` 的 `domainToEnvKey`）
- `META_SYSTEM_USER_TOKEN_PAGE_<主页 ID>` —— 旧做法，每个主页一把；新接入的客户已改走后台授权存库，但老客户的可能还在面板上
- `META_PIXEL_ID_<域名>` —— 每个客户的像素 ID（非秘密）

**做法**：切换日前，由产品负责人打开 Render 面板，按 `META_` 前缀过一遍，把实际存在的条目名字列出来补进交接登记表（§6）。漏一把 = 那个客户的广告数据回传和执行静默失败。

---

## 5. 切换日清单（第三阶段）

域名换了，下面这些「对方后台认的地址」全部要改，否则登录授权和消息回传会断：

- [ ] Google Cloud Console → OAuth 客户端 → 已授权的重定向 URI（客户授权 GSC / GA4 / GBP 用）
- [ ] Microsoft Entra → 应用注册 → 重定向 URI（客户邮箱授权）
- [ ] Meta 开发者后台 → Facebook 登录 → 有效 OAuth 重定向 URI；Webhooks（Messenger / WhatsApp / 留资表单）回调地址 + `META_VERIFY_TOKEN`
- [ ] TikTok 开发者后台 → 回调地址
- [ ] Stripe → Webhooks → 新建端点，拿新的 `STRIPE_WEBHOOK_SECRET`
- [ ] GitHub → 仓库 Webhooks → 新地址 + 新 `GITHUB_WEBHOOK_SECRET`
- [ ] OpenAI → Realtime webhook → 新地址 + 新 `OPENAI_WEBHOOK_SECRET`
- [ ] Inngest → 把应用地址指到新服务器并**手动重新同步**；确认旧地址已摘除
- [ ] GitHub Actions Secrets：`CRON_SECRET` 换成新值；4 个 workflow 里的目标地址（`BASELINE_CRON_URL` 等）指向新域名
- [ ] 定时任务在新服务器启用的**同一时刻**，Render 上 57 个 cron 全部暂停（先停旧、再开新，宁可空窗几分钟也不要重叠）
- [ ] 如果 `app.magicengine.com.au` 这个域名直接指到新服务器（域名不变），上面多数回调地址不用改——**优先走这条路**，能省掉大半清单

切换完成后：

- [ ] 旧 Render 环境里的甲类 key 全部作废
- [ ] 乙类里能轮换的（`SUPABASE_SERVICE_ROLE_KEY`、Stripe、Meta 应用密钥）评估是否轮换一次
- [ ] 回写 `docs/STATE.md`（部署在哪）和 `docs/ENV.md`（「配在哪」一列）

---

## 6. 交接登记表（每给一批填一行）

| 日期 | 给了哪些变量（只写名字） | 类别 | 给谁 | 传递方式 | 链接是否已过期 | 备注 |
|---|---|---|---|---|---|---|
| | | | | | | |

谁手里有哪把钥匙，必须随时答得上来。停止合作或怀疑泄露时，按这张表逐行作废。
