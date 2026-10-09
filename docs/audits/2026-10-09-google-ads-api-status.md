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
