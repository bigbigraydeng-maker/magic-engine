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
