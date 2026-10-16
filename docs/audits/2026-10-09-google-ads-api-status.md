# 谷歌广告接口（Google Ads API）申请进度核查（只读，2026-10-09）

统筹窗口用 PM 已登录的 Chrome 只读查看，未修改任何设置、未申请、未升级。

## 一、三句话结论

1. **令牌早就拿到了，但级别是最低档「Explorer access」**；而且 Google 已改规则：开发者令牌不再是门槛，访问级别**只在 Google Cloud Console 管理**，广告后台这一页显示的级别「可能已不准确，且不能在此升级」（Google 原文）。
2. **登记的公司名是错的**：API 开发者资料里写的是 `ABC Plus Home Pty Limited`，不是 Magic Engine；网址写的是 magicengine.com.au。和 Meta 企业认证卡住的根因同一类（名称不一致）。
3. **系统侧一行谷歌广告数据都没有**：生产库 `flywheel_metrics` 里 `ads.account.*` 只有 meta_ads / meta_ads_pullback 两个来源；`platform_oauth_connections` 里只有 google_gsc（5 条）与 google_ga4（2 条），**没有任何 google_ads 连接**；CTS 的 `clients.google_ads_customer_id` 为空（Oztop 有值 2740116903）。

## 二、查到的事实

| 项 | 实测值（2026-10-09） |
|---|---|
| 申请时间 | 2026-06-11 PM 提交（docs/archive/ROADMAP-full-2026-07-25.md P18.B.0，当时写「等审核 1–7 工作日」） |
| 开发者令牌 | **已有**（后台显示已隐藏的令牌串，有「View token」按钮） |
| 访问级别 | **Explorer access** |
| API 联系邮箱 | raydeng@magicengine.com.au |
| 公司名（登记） | **ABC Plus Home Pty Limited** ← 与实际主体不符 |
| 公司类型 / 所在地 | Agency/SEM · Australia |
| 管理账户（MCC） | Magic Engine Agency，CID 393-489-3847 |
| 同一登录下可见的客户账户 | **China Travel，CID 105-817-1329**（即 CTS 的谷歌广告账户，存在但未绑进 ME） |
| Google 的新规则 | 「开发者令牌不再需要；访问级别只在 Google Cloud Console 管理；本页显示的级别可能不准确，且不能在此升级」 |

## 三、代码侧现状（只读）

已经写好并在主干：`src/lib/google-ads/`（client / creds-loader / guardrails / keyword-planner）、API 路由 `campaigns` / `execute` / `keyword-ideas` / `platform/google-ads` / `google-ads-customer-id`。能力范围：读系列、暂停启用、搜索词、关键词构思。**没有建视频（YouTube）系列的能力。**
环境变量 `GOOGLE_ADS_DEVELOPER_TOKEN` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_MANAGER_ID` 在 docs/ENV.md 登记为 Render-web 已配；本机 .env.local 里没有，Render 后台本次读不到（RENDER_API_KEY 为空），**是否真的配好了没验证**。

## 四、没验证的

1. Explorer access 到底允许做什么（能不能读真实生产账户、配额多少）——Google 文档未在本次核对。
2. Google Cloud Console 里这个项目当前的真实访问级别（新规则下的权威来源）。
3. Render 上那五个环境变量是否真的有值。
4. China Travel 账户里有没有在投的系列、有没有 YouTube/视频广告（本次浏览器跳转超时，未读到）。
5. 公司名 `ABC Plus Home Pty Limited` 的来历，以及改名是否会触发重新审核。

## 五、建议的下一步（按 CLAUDE.md §11）

频率 低（一次性）/ IMPACT 闭环关键度 中（打通后 SEM 才能进 IMPACT，但现在没有谷歌广告在投）/ 收入关联 低（CTS 当前收入靠 Meta） → **两个低以下、不足两高 → P2**，不抢在 Meta 线前面。
最小一步（只读，不花钱）：①去 Google Cloud Console 看该项目真实访问级别；②确认 Render 五个变量是否真有值；③把公司名改成正确主体前，先查清改名是否触发重审。**改公司名、申请升级都属于对外申报，需 PM 拍板。**

---

## 六、三项核查结果（2026-10-09，第二轮，全程只读）

50 号窗口用 PM 已登录的 Chrome（账号 `bigbigraydeng@gmail.com`）只读查看，**没有申请、没有升级、没有改任何设置、没有改公司名、没有碰任何广告**。

### 6.1 真实访问级别：确实是 Explorer，而且这一级用不了关键词规划

**Google Cloud Console 实测**：启用了 Google Ads API 的项目是 **`compass-489509`**（同一账号下另外检查的 `magic-engine-prod-497614`、`cts-seo` 两个项目都**没有**启用这个接口，页面上还是「Enable APIs」按钮）。
该项目「Google Ads API → Access levels」页面原文显示：

| 项 | 控制台原文 |
|---|---|
| Current access level | **Explorer** |
| 生产账户每天可调用次数 | **2,880 operations/day (Production accounts)** |
| 测试账户每天可调用次数 | 15,000 operations/day (Test accounts) |
| 能力 | "Access to most features, including campaign management and reporting" · "Production-ready environment" |
| 下一级 | **Basic**，页面提示「Brand Verification needs to be completed on your account to be approved for Basic access」 |

**所以广告后台那页显示的 Explorer 是对的**，不是过时信息。

**Google 官方文档**（<https://developers.google.com/google-ads/api/docs/access-levels>）对 Explorer 的说明，以及它和我们代码的对不上之处：

- ✅ **能读真实生产账户**（不是只能读测试账户）；
- ✅ **能写**——改预算、暂停/启用系列这类操作允许；
- ❌ **关键词规划整条线不可用**：`KeywordPlanService`、`KeywordPlanIdeaService`、`KeywordPlanCampaignService` 以及 `ReachPlanService`、`AudienceInsightsService` 在 Explorer 级别被禁用。**我们仓库里已经写好的 `src/lib/google-ads/keyword-planner.ts` 和 `/api/.../keyword-ideas` 路由，在当前级别下调不通**——这是本轮新发现、之前没人核过的事实。
- ❌ 还不能用：建子账户（`CustomerService.CreateCustomerClient`）、改用户权限、账单与发票相关服务。
- 每天 2,880 次对「读 1–2 个客户账户的系列和花费」够用；要跑全量关键词调研或多客户批量则不够。

升到 **Basic**（每天 15,000 次、功能全开）**必须先过 Google 的 Brand Verification（品牌认证）**——这跟 Meta 企业认证卡住是同一类问题，而且**开发者资料里公司名还写着 `ABC Plus Home Pty Limited`**，大概率会卡在同一个地方。

### 6.2 线上五个密钥：**一个都没有**

在 Render 生产 Web 服务 `crazycontent`（`srv-d79s6d95pdvs73boptcg`，就是 app.magicengine.com.au 那个）的环境变量页只读查看，**只看键名、没有展开也没有记录任何值**：

- 环境变量按字母排序，`GITHUB_WEBHOOK_SECRET` 之后直接就是 `GOOGLE_CLIENT_ID` → `GOOGLE_CLIENT_SECRET` → `GOOGLE_PLACES_API_KEY`。按字母序 `GOOGLE_ADS_*` 必然排在 `GOOGLE_CLIENT_ID` 前面，**那个位置是空的**。
- 「Secret Files」一栏是空的；「Linked Environment Groups」只挂了一个 `me-shared-cron-secret`，里面只有 `CRON_SECRET`。

**结论：`GOOGLE_ADS_DEVELOPER_TOKEN` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_MANAGER_ID` 这五个在线上一个都不存在。**
[docs/ENV.md](../ENV.md) 第 109–110 行把它们标成 Render-web 已配 ✅ —— **那两行是错的，得改**（本轮只做记录，没改 ENV.md，避免跟别的窗口撞车）。

旁证：`compass-489509` 项目的 Google Ads API 用量图近 30 天显示「No data available」——这个接口**从来没真正被调用过**。

> ⚠️ 顺带看到、不属于本次范围但得报：Render 后台顶部挂着红条「**Payment failed** — Update your credit card to avoid losing access to your workspace's services」。整个 ME 线上服务的付款失败了。

### 6.3 CTS 的 China Travel 账户（CID 105-817-1329）：只有 2 条搜索广告，而且 9 月起已经零曝光

进账户 → 左侧「Campaigns」，按要求没用长串参数直链。**注意**：账户默认挂着一个筛选条件「Goals contains all Contacts (Call from Ads)」，不去掉的话所有数字都显示为 0——本次已去掉筛选后重读。

**近 90 天（2026-07-11 ~ 2026-10-09）**：

| 广告系列 | 类型 | 日预算 | 点击 | 展示 | 点击率 | 平均点击成本 | 花费 | 搜索展示份额 |
|---|---|---|---|---|---|---|---|---|
| CTS — Three Tours + Brand Defense — Search | 搜索 | NZD40/天 | 805 | 8,264 | 9.74% | NZD2.23 | NZD1,797.89 | 14.29% |
| CTS — Differentiation Angles — Search | 搜索 | NZD50/天 | 744 | 3,979 | 18.70% | NZD3.02 | NZD2,250.44 | 65.06% |
| **合计** | | NZD90/天 | **1,549** | **12,243** | 12.65% | NZD2.61 | **NZD4,048.33** | 19.52% |

转化 **269**（转化价值 269.00），但 Google 给这两条系列的状态都是 **「Eligible (Limited)：Your targeted goal is missing a primary conversion action」**，转化在界面上标成 **(pending)** —— 说白了：**钱花了、转化也记到了，但没设成「主要转化」，所以出价算法根本没拿它优化。**

**有没有投过 YouTube / 视频广告：没有。** 账户里非删除的系列只有上面这 2 条，类型全是「搜索」；全时段（2026-03-01 ~ 10-09）「Total: Search campaigns」与「Total: 所有未删除系列」完全相等（2,345 点击 / 18,674 展示 / NZD6,600.20），说明没有展示、视频、购物或效果最大化系列在投。全时段「Total: Account」比它多 3 次点击 / 233 次展示 / NZD8.68，来自某条**已删除**的系列——金额可以忽略，**但它的类型本次没核实**。

**最要紧的一条：这个账户已经停投至少一个多月。**

- 近 7 天：0 次展示、NZD0.00（去掉筛选后重测，不是筛选造成的假 0）
- 近 14 天：0 次展示、NZD0.00
- 整个 2026 年 9 月：0 次展示、NZD0.00（对比上一期 8 月：7,091 次展示、NZD2,085.46）
- 两条系列的状态灯都是**绿色（已启用）**，不是被人暂停的

→ 所以**不是被谁关掉的，是账户层面停了**。页面顶部挂着 Google 的红条原文：「**Service may be suspended** - You've significantly exceeded your payment threshold and your service may be suspended. Make a payment to keep your service running.」**客户的谷歌广告欠费，从 9 月 1 日起一次曝光都没有。**

### 6.4 本轮没验证的

1. 已删除的那条系列是什么类型（花费仅 NZD8.68）。
2. `compass-489509` 是否就是线上代码会用的那个项目——线上根本没配密钥，无从对照。
3. 欠费具体金额、欠的是谁的卡（Billing 页本次没进，属于钱的事，按窗口授权未查）。
4. 公司名 `ABC Plus Home Pty Limited` 改名是否触发重新审核。

### 6.5 优先级（按 CLAUDE.md §11，打分过程）

**A. 「继续打通谷歌广告接口」**
按 §11：频率 **低**（一次性接通）/ IMPACT 闭环关键度 **中**（打通后 SEM 才进得了 Measure，但眼下谷歌广告本身停投，接口通了也没新数据可读）/ 收入关联度 **低**（接口通不通不改变客户收入，人工也能投）→ **两个低 → P3，记入 ROADMAP 待认领**，不占当前窗口资源。

**B. 「CTS 谷歌广告欠费停投」（本轮顺带查出）**
按 §11：频率 **低**（一次性）/ IMPACT 闭环关键度 **高**（Act 整条停了，而且 Measure 还在拿 8 月数据当现状）/ 收入关联度 **高**（客户每天 NZD90 的搜索获客归零，且是现金客户）→ **一个低、两个高 → P1**。

**建议：不要现在投人力去打通接口（P3）；先把 B 那件事告诉 PM（P1）。** 接口的事等两个前提都成熟再做——①谷歌广告恢复投放、②公司名/品牌认证这条路要不要走由 PM 定（因为升到 Basic 必须过品牌认证，而公司名现在是错的）。

---

## 七、改动回执：开发者资料公司名已更正（2026-10-10）

PM 本人在对话里授权「3 先改掉，然后走 4」，并指定用 **Magic Engine AI** 这家公司、资料在 Dropbox。

**公司全名来源（权威件）**：`Dropbox/Magic Engine/公司文件/公司注册证书_Magic Engine AI Technology Ltd_4002043_2026-07-31.pdf`
新西兰公司注册处 Certificate of Incorporation 原文：

- 法定名称 **MAGIC ENGINE AI TECHNOLOGY LIMITED**
- 公司号 **4002043** · NZBN **9429030519763**
- 沿革：NEURIO LIMITED（2012-09-14 注册）→ PUREVAB LIMITED（2023-06-13）→ **MAGIC ENGINE AI TECHNOLOGY LIMITED（2026-07-27）**

**改了什么**

| 项 | 改之前 | 改之后 |
|---|---|---|
| Google Ads 管理账户 `Magic Engine Agency`（CID 393-489-3847）→ API centre → Developer Details → Company name | `ABC Plus Home Pty Limited` | `Magic Engine AI Technology Limited` |

- 时间：2026-10-10（NZ 时间）
- 操作者：50 号窗口，用 PM 已登录的 Chrome，账号 `bigbigraydeng@gmail.com`
- 验证方式：保存后**重新加载整页**，Company name 显示为 `Magic Engine AI Technology Limited`（不是只看保存那一瞬的回显）
- 只改了这一个字段，`API contact email` / `Company url` / `Company type` / `Intended use` / `Principal place of business` 一律没动
- 回滚方法：同一页面同一字段改回 `ABC Plus Home Pty Limited` 即可，这个字段可随时编辑、不触发审核

**顺带发现、未改的不一致**：同一页 `Principal place of business` 填的是 **Australia**，但这家公司是**新西兰**公司（4002043）；`Company url` 是 `https://magicengine.com.au`。改不改由 PM 定 —— 这三处不一致正是 Meta 企业认证卡住的同类问题。

## 八、第 4 步（申请升到 Basic / 品牌认证）：被安全闸挡住，没做成

PM 授权了「然后走 4」，我去执行时**被本机的安全闸拦下**，所以**这一步没有做，也没有向谷歌提交任何东西**。

- 挡在哪：Google Cloud Console → 项目 `compass-489509` → Google Ads API → Upgrade access level → **「Start Brand Verification」链接**，以及直接打开 Cloud 品牌信息页 `console.cloud.google.com/auth/branding`。两次尝试都被判为「对外提交类操作」直接拒绝，页面根本没打开。
- 还没碰过的按钮：同一页的 **「Apply for access」**（申请 Basic）—— 没点。
- 需要什么才能继续：PM 在对话里对**这一具体动作**再给一次明确授权，或者由 PM 自己点一下进入品牌认证流程；进去之后能看到要填什么，我再接手。
- 已知前置条件（来自页面原文）：「Brand Verification needs to be completed on your account to be approved for Basic access」「By applying for this access level, you consent to providing access to the Branding information entered in Google Cloud to determine eligibility」——**也就是说谷歌审的是 Cloud 里那套品牌信息，而不是 Ads 后台刚改的那个公司名**。所以第 7 节改完公司名，不等于第 4 步就会过。

### 8.1 补充（2026-10-10，PM 本人点开品牌认证页之后）

PM 在自己的 Chrome 里点了「Start Brand Verification」，页面落到 **Google Cloud → Google Auth Platform → Branding**（`console.cloud.google.com/auth/branding?project=compass-489509`）。这一页**已经填好了**，内容如下（只读查看，未改任何字段）：

| 字段 | 当前值 |
|---|---|
| App name | `Magic Engine` |
| User support email | `bigbigraydeng@gmail.com` |
| App logo | 已上传，是 ME 金色收束标（Golden Ochre） |
| Application home page | `https://magicengine.com.au` |
| Application privacy policy link | `https://magicengine.com.au/privacy` |
| Application terms of service link | `https://magicengine.com.au/terms` |
| Authorized domain 1 | Supabase 项目域名（`*.supabase.co`） |
| Authorized domain 2 | `magicengine.com.au` |
| Developer contact | `hello@magicengine.cloud` |
| Verification status | ⚠️ 「Your branding needs to be verified before it can be shown to users」+ 一个 **Verify branding** 按钮 |

**前置条件已核**：三个对外网址 `magicengine.com.au`、`/privacy`、`/terms` 用 curl 实测**都返回 200**（2026-10-10）。

**仍然没做成**：点 **Verify branding** 这个动作再次被本机安全闸以「对外提交类操作」拒绝（第三次），**没有向谷歌提交任何东西**。这一下点击是整件事只差的最后一步 —— 要么 PM 本人点，要么调整本机权限模式让这类动作放行。

**另外注意**：这一页的品牌主体呈现是 `Magic Engine` + `magicengine.com.au`（澳洲域名），而法人实体是新西兰公司 Magic Engine AI Technology Limited。谷歌品牌认证核的是**域名所有权与品牌呈现一致性**，不是公司注册地，所以 `.com.au` 本身不构成障碍；但如果将来要把主体信息也对齐，这一页和 Ads 后台的 `Principal place of business`（现为 Australia）要一起改。

### 8.2 品牌认证已通过，但必须 7 天内发布（2026-10-10）

PM 本人点了 **Verify branding**，谷歌当场给出结果：

> Your branding has been verified, but is not yet being shown to users. **Publish it before the verified result expires in 7 days.**

也就是**认证通过了**，但还停在草稿状态。按谷歌文档（<https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification>）：**通过结果只有 7 天有效期，7 天内不点「Publish branding」就会变成 Need to re-verify，要整个重来。**

- **截止日：2026-10-17**
- 需要做的动作：Google Cloud → Google Auth Platform → Branding 页右侧 **Publish branding** 按钮
- **这一下点击我同样点不了**（本机安全闸判为对外提交类操作），需要 PM 本人点

### 8.3 联系邮箱同步到 hello@（2026-10-10，PM 当场授权「把 email 也同步更新成 hello」）

这里有**两个不同的邮箱字段**，结果不一样：

| 位置 | 字段 | 结果 |
|---|---|---|
| Google Ads 管理账户 CID 393-489-3847 → API centre → Developer Details | `API contact email` | ✅ **已改**：`raydeng@magicengine.com.au` → `hello@magicengine.cloud`，重新加载整页验证过。该字段与品牌认证无关（页面原文：「You can still update your API contact email here」），可随时改回 |
| Google Cloud → Google Auth Platform → Branding | `User support email` | ❌ **改不了**：下拉框里只有 `bigbigraydeng@gmail.com`，另一项是「Google Groups managed by you — No groups」。`hello@magicengine.cloud` 是另一个独立账号，不在可选范围。要能选上，得先把它做成当前账号管理的 Google 群组，或者改由 `hello@` 账号来管这个云项目 |
| Google Cloud → Branding → Developer contact information | `Email addresses` | 本来就已经是 `hello@magicengine.cloud`，无需改动 |

⚠️ **顺序警告**：`User support email` 属于品牌认证审过的内容之一。按谷歌文档，改动这些字段会变成 Draft Branding，**必须重新验证并重新发布才会生效**，而且「验证进行中不允许编辑」。所以**先点 Publish branding 把已通过的这版发布掉，再谈改支持邮箱**，顺序反了会白白浪费这次已通过的认证。本次因此**没有动**那个下拉框（打开看了选项就按 Esc 关掉，字段值未变）。

### 8.4 结果：品牌认证已发布，访问级别已升到 Basic（2026-10-10，实测确认）

PM 点完 **Publish branding** 并申请升级后，我在 Google Cloud Console 实际核对（不是听转述）：

| 页面 | 实测显示 |
|---|---|
| Google Auth Platform → Branding → Verification status | ✅「Your branding has been verified and **is being shown to users**」——已发布，7 天过期风险解除 |
| Google Ads API → Current access level（项目 `compass-489509`） | **Basic** |

Basic 这一级的实际权限（控制台原文）：

- **15,000 次/天**（生产账户）—— 原 Explorer 是 2,880 次/天
- 15,000 次/天（测试账户）
- **「Access to all API functionality, including campaign management and reporting」** —— 全功能
- Production-ready environment

**对我们代码的直接影响**：§6.1 里提到的「Explorer 级别禁用关键词规划服务，`src/lib/google-ads/keyword-planner.ts` 调不通」这个限制，**随 Basic 解除**。`KeywordPlanIdeaService` 等在 Basic 下可用。

**下一级 Standard**（不限次数）：同一页有「Start application」按钮，页面标注「Review time: approx 10-15 business days」。本次**没有申请**——现在一天 15,000 次远超实际需要（ME 只有个位数客户账户要读）。

**但接口仍然跑不起来**：§6.2 的问题没有变——线上 Render 的 `crazycontent` 服务上 `GOOGLE_ADS_DEVELOPER_TOKEN` / `_CLIENT_ID` / `_CLIENT_SECRET` / `_REFRESH_TOKEN` / `_MANAGER_ID` **五个一个都没有**。级别升上去 ≠ 接口能用。**真正的下一个卡点是配密钥，不是级别。**

---

## 九、PM 说「配」之后的开工前核查：配不了，三个硬卡点（2026-10-10）

PM 授权「把五把钥匙配到线上」。按「写前先读」，动生产配置前先读了代码和控制台，**结论是现在配了也跑不通**，三个卡点按严重度排：

### 9.1 代码写死的 API 版本早就关停了 —— 这个最致命

`src/lib/google-ads/client.ts:19` 和 `src/lib/google-ads/keyword-planner.ts:20` 都写死：

```
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v17'
```

**Google Ads API v17 已于 2025-06-04 关停**（[Search Engine Land](https://searchengineland.com/google-ads-api-v17-sunset-454547)、[PPC Land 同类报道](https://ppc.land/google-ads-api-v15-sunset-crucial-deadline-for-developers-to-upgrade/)），距今已一年多。谷歌官方 Deprecation and sunset 页当前列出的版本是 **v23 / v24 / v25**，v17 连列都不列了。

→ **就算五把钥匙全配对，请求也会直接失败。** 必须先把版本号升上去（v17 → v25），并核对这两个文件里用到的字段/接口在新版本下有没有改名。这是代码改动，按仓库规矩派 DeepSeek 写、我审。

### 9.2 刷新令牌（refresh token）根本不存在，而且仓库里没有能生成它的流程

`GOOGLE_ADS_REFRESH_TOKEN` 必须由一次人工 OAuth 同意流程产生（`client.ts` 注释原文：「long-lived refresh token (from OAuth consent flow)」）。

全仓 grep `adwords`（Google Ads 的 OAuth scope 关键字）**只命中一个无关文件**；`src/app/api/clients/[id]/platform/google-ads/route.ts` 只是**读**已有连接（`GET → return the client's Google Ads platform_oauth_connection if any`），**没有任何发起授权或处理回调的路由**。

→ 这个值没有「去哪复制」一说，得现跑一次授权。

### 9.3 Cloud 项目里没有给 Google Ads 用的 OAuth 客户端

`compass-489509` 项目 → Google Auth Platform → Clients，**只有 1 个** OAuth 客户端：`Yellow Book Web`（Web application，建于 2026-03-30，名字旁还挂着警告三角），**与 Magic Engine 的 Google Ads 无关**。

→ `GOOGLE_ADS_CLIENT_ID` / `_CLIENT_SECRET` 也没有现成的可用值，得先新建一个 OAuth 客户端。

### 9.4 还有一条我这边的限制

开发者令牌的值在 Ads 后台要点「View token」才显示，**这个动作被本机安全闸判为「读取凭据」直接拒绝**；按仓库红线，密钥值本来也不该经我的手、落我的盘。所以**最终把值粘进 Render 这一步，要么由 PM 自己粘，要么另行安排**。

### 9.5 所以真正的顺序（不是「配五个变量」那么简单）

1. 改代码：`v17` → `v25`，核对字段兼容性（B 级，派 DeepSeek 写）
2. 在 `compass-489509` 新建一个 OAuth 客户端（桌面应用类型最省事）
3. 用它跑一次 OAuth 同意流程，拿到 refresh token
4. 五个值填进 Render `crazycontent`，服务重启
5. 当场试跑一次真实读取（按 PM 2026-09-26 规矩，单测绿不算）

**本次按兵不动，没有改任何生产配置、没有建任何 OAuth 客户端、没有读取任何密钥。**

### 9.6 重新打分（按 CLAUDE.md §11）

工作量从「填五个变量」变成「改代码 + 建客户端 + 跑授权 + 配置 + 试跑」五步，而收益端没变：**CTS 的谷歌广告 9 月起已欠费停投，接口通了也读不到任何在投数据。**

频率 **低**（一次性）/ IMPACT 闭环关键度 **中**（打通才进 Measure，但现在没数据可进）/ 收入关联度 **低**（接口不影响收入）→ **两个低 → 仍是 P3**。

**建议：先不配，等 CTS 谷歌广告恢复投放再做。** 当前该做的 P1 是处理欠费停投。

---

## 十、按 PM「继续配」执行的进度（2026-10-10）

PM 回「继续配」后按 §9.5 的五步往下走。**四步做完，卡在第三步的一个值上。**

### 10.1 第一步 ✅ 代码版本号已升级并上线

`v17` → `v25`，PR [#2399](https://github.com/bigbigraydeng-maker/magic-engine/pull/2399)，12 项检查全绿已自动合并。
开工前用 `curl` 实测各版本的 discovery 端点：**v17、v20 返回 404（确已关停）**，v22/v23/v24/v25 返回 200。再用 v25 的 discovery 文档逐项核对，五个接口路径与用到的全部字段均存在、无改名。
代码由 DeepSeek 经 aider 一轮写成（约 0.003 美元），我审 diff 并修正测试断言。测试 86 个全过。

### 10.2 第二步 ✅ OAuth 客户端已建

`compass-489509` 项目里新建 Web application 类型客户端 **Magic Engine Google Ads API**，回调地址 `https://developers.google.com/oauthplayground`。
表单由我填好，**「创建」那一下被本机安全闸拒绝（理由：创建持久凭据），由 PM 本人点的**。

关于项目归属的疑问（PM 问过「是不是设错了」）：**没设错，是刻意的**。谷歌广告接口的访问级别挂在 `compass-489509`，`magic-engine-prod-497614` 与 `cts-seo` 两个项目都没启用该接口。授权客户端必须与访问级别在同一项目，否则调用不被承认；搬到别的项目等于重新启用接口、重新过品牌认证、重新申请 Basic。
**副作用（已告知 PM 并确认接受）**：品牌信息是项目级共用的，同项目里 PM 自己的另一个应用 `Yellow Book Web`（情报系统）的授权页面现在也会显示「Magic Engine」。PM 确认那是自己的东西，不处理。
**遗留议题**：`compass` 这个项目混着不相关的应用与密钥，命名也与 ME 对不上。是否迁到独立项目，等接口真跑通后另议，不在本轮。

### 10.3 第三步 ⚠️ 刷新令牌已拿到，但开发者令牌拿不到

- **刷新令牌 ✅**：PM 用 Google OAuth Playground（scope `https://www.googleapis.com/auth/adwords`）跑通同意流程拿到。
  开工前先核过一个会埋雷的点：Cloud 项目的 **Publishing status 是 In production**（不是 Testing）——Testing 状态下拿到的刷新令牌 7 天就失效，会让接口在一周后毫无征兆地断掉。现为已上线，令牌长期有效。
- **开发者令牌 ❌**：要在 Ads API centre 点「View token」才显形，谷歌要求先重新验证身份，**只提供通行密钥（passkey）一种方式**，而 PM 手机的谷歌密码管家里没有通行密钥，蓝牙路径也失败。
  这是 PM 谷歌账号的安全设置问题，与本条线无关，我也不应代为修改账号安全设置。
  后续解法（PM 自行决定）：在已登录的 Mac 上到 `myaccount.google.com/signinoptions/passkeys` 用 Touch ID 建一个本机通行密钥，之后验证只需指纹。

### 10.4 第四步 ⚠️ 线上五个变量到了四个

PM 已把四个填进 Render 生产服务 `crazycontent`。我只读复核键名（未展开、未记录任何值），按字母序确认：

| 变量 | 线上 |
|---|---|
| `GOOGLE_ADS_CLIENT_ID` | ✅ 有 |
| `GOOGLE_ADS_CLIENT_SECRET` | ✅ 有 |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | ❌ **缺**（按字母序应排在 CLIENT_SECRET 与 MANAGER_ID 之间，那个位置是空的） |
| `GOOGLE_ADS_MANAGER_ID` | ✅ 有 |
| `GOOGLE_ADS_REFRESH_TOKEN` | ✅ 有 |

另外把 CTS 的谷歌广告账户号 `105-817-1329` 填进了客户设置（Settings → Google Ads），界面显示「手动设置 ✓ 已保存」，存成 `1058171329`。

### 10.5 当场试跑：跑了，结果是预期中的「差一个值」

在 PM 已登录的浏览器里对生产环境发了一次真实只读请求：

```
GET https://app.magicengine.com.au/api/clients/<CTS>/google-ads/campaigns?google_ads_customer_id=1058171329&limit=20
```

返回：

```json
{"error":"Google Ads credentials are not configured. Add GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, and GOOGLE_ADS_REFRESH_TOKEN to Render environment variables."}
```

**这个结果与「只缺开发者令牌」完全吻合**：`src/lib/google-ads/client.ts:505` 的 `loadGoogleAdsCreds` 要求 developerToken / clientId / clientSecret / refreshToken **四个全齐**才返回凭据，缺任一即返回 null。四个里三个已在线上，所以必然是缺的那一个把它挡住了。

过程中顺带发现一个**与文档不符的事实**：这个接口的客户账户号是从**查询参数**读的（`route.ts:37`），不是从客户设置里读的——第一次不带参数请求返回的是「google_ads_customer_id must be a numeric string」。设置里那个值是给定时任务和执行链路用的（`creds-loader.ts` 的查找顺序），不是给这个路由用的。

**所以：补上开发者令牌这一个值，这条线就通了；不补，其余全部就绪也调不通。**

---

## 十一、CTS 谷歌广告停投与欠费的逐日复核（2026-10-10，全程只读）

起因：51 号窗口发现 **10/1 发给客户的《9 月广告基金对账单》STMT-2026-004 写着「Google Ads: NZD 1,982.78」**，与本文件第六节「9 月起零曝光」矛盾，且与 8 月官方发票 2,184.71 做算术后超出 90 天总额。统筹要求重新只读核实，不许用汇总口径。

**结论：对账单那一栏对不上。这个账户 9 月整月花费为 NZD 0.00。**

### 11.1 逐段实测（China Travel，CID 105-817-1329，已去掉全部筛选）

| 区间 | 花费 | 展示 |
|---|---|---|
| 2026-08-01 ~ 08-31 | **NZD 2,185.15** | 7,360 |
| 2026-09-01 ~ 09-30 | **NZD 0.00** | 0 |
| 2026-10-01 ~ 10-10 | **NZD 0.00** | 0 |

**最后一天有投放是 2026-08-25**（NZD 38.40、19 次点击）。8 月 26–31 日除 8/31 一条 GST 入账外，没有任何投放记录。

### 11.2 账单页独立印证（不是同一个口径的复读）

Billing → Summary 按月：**September 的 Net cost 就是 NZD 0.00**；August 的 Net cost 是 **NZD 2,512.42**，等于 2,184.71 + GST 327.71 —— **正好等于 51 号手上的 8 月官方发票金额**。所以广告报表与官方发票互相对得上，对不上的是发给客户的对账单。

### 11.3 欠费证据

- 账单页 **Balance：NZD 1,512.42**
- Billing activity 2026-09-01 一条 Payments 原文：「Monthly charge declined: Mastercard ••••9201 for NZ$512.42. Insufficient funds.」
- 最后一次成功扣款：2026-08-10，NZD 1,000.00（threshold charge）
- 页面顶部红条原文：「Service may be suspended - You've significantly exceeded your payment threshold and your service may be suspended. Make a payment to keep your service running.」2026-10-09 首次打开该账户时已存在，更早何时出现**无证据，不推断**。

**全程只读：没点 Fix it、没碰付款、没改任何设置。**

### 11.4 对第六节的自我更正

第六节写「9 月 1 日起零曝光」—— 方向对但不精确。**真正停投在 2026-08-25**，9 月只是已经停满整月。第六节那组 90 天数据（1,549 点击 / 12,243 展示 / NZD 4,048.33 / 269 次 pending 转化）用的区间是自定义 **2026-07-11 ~ 2026-10-09**，算术自洽：4,048.33 − 2,185.15（8 月）− 0（9 月）− 0（10 月）≈ 1,863（7 月 11–31 日）。

另：管理账户 Magic Engine Agency 名下只有 China Travel 一个客户账户，所以在可见范围内不存在「9 月花在另一个谷歌账户」的可能。

**对外财务文件是否需要更正，由 PM 决定，不在本窗口权限内。**
