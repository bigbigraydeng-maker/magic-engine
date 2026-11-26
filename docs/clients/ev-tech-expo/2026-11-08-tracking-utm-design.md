# EV Expo · ME 广告来源追踪设计（2026-11-08 · v1 · 已作废）

> **作废（2026-11-08 PM）**：PM 确认所有人买票都是先到官网的购票页，不是直接去 Eventbrite。本稿「广告直接链 Eventbrite、不经官网」的前提不成立，重新设计由 GA4 窗口出 v2（新文件，以 `2026-11-08-tracking-utm-design-v2` 开头）。本稿的 `me_` 命名规则和「只新增不替换 Squid」原则可沿用，其余以 v2 为准。另：本稿写「现有 5 组都没有来源标记」也是错的，GA4 窗口核实全部已带（命名不统一，见 `2026-11-08-meta-ads-review.md`「没核实的」一节）。
> **路线已定（主窗口 11-08）**：继续落官网 `/register`，不改链 Eventbrite。

**状态**：设计稿，未实施。改在投广告的链接要走 ME，或由 PM 本人在广告后台改；AI 窗口不直接改 Meta（PM 11-04 / 11-05 红线）。
**范围**：ME 自己广告户（1018365291238494）的 Facebook / Instagram 广告 → Eventbrite 购票页 / 官网。Squid 的广告、像素、GA4 一律不动。

## 一句话

每个广告组配一条**自己的 Eventbrite 追踪链接**（直接看到这组卖了几张票、多少钱，用来代替没做的折扣码），链接后面再加一组 **`me_` 开头的来源标记**（GA4 里能分出我们的人）。我们只**新增**，不改、不替换任何 Squid 的设置；我们的访客在 Squid 的统计里会被清楚标成 `me_`，他们想排除，筛掉就行。

## 一、三处各看到什么

| 地方 | 用什么 | 能看到什么 | 要谁做 | 状态 |
|---|---|---|---|---|
| **Eventbrite** | 追踪链接（每组一条） | 每条链接的页面浏览、**售出票数、销售额**，还有按链接的参会人名单 | Eventbrite 管理员（Steven 或他指定的人）在后台建；或把管理员权限给 ME | 我们没有权限 |
| **Facebook / Instagram 广告** | 广告层的「网址参数」（来源标记） | 每次点击带上我们的组名、广告编号 | ME 流程或 PM 本人在广告后台改 | 现有 5 组都没有 |
| **官网 GA4 / Eventbrite 上的 GA4** | 读来源标记 | 我们带来的访问、开始下单（Eventbrite 上的 GA4 还能看到付款） | 官网：网站设计公司（GA4 窗口在跟）；Eventbrite：管理员 | 见 GA4 窗口 |

**真账本以 Eventbrite 追踪链接报表为准**（官方：每条链接显示售票数和销售额，销售实时、浏览数可能滞后几小时）。GA4 和 Meta 自己报的「购买」只当参考，因为 Squid 和我们两边都会把同一单算到自己头上。

## 二、命名规则（所有值都以 `me_` 开头，不会和 Squid 撞名）

链接格式（追踪链接是 Eventbrite 后台生成的那条网址，原样复制，后面接来源标记）：

```text
<Eventbrite 追踪链接原样>&utm_source=meta&utm_medium=paid_social&utm_campaign=me_evexpo26&utm_content=<组代号>&utm_term={{ad.id}}
```

如果追踪链接本身没有 `?`，第一个 `&` 改成 `?`。

| 组代号（utm_content，也用作 Eventbrite 追踪链接名） | 对应现在的广告组 |
|---|---|
| `me_g1_family` | G1 周末带娃 · 女 30-55 |
| `me_g2_ev` | G2 电动车 · 不限 30-65 |
| `me_g3_tech` | G3 科技 · 不限 25-55 |
| `me_g4_uni` | G4 大学生赛车 · 不限 18-24 |
| `me_video_testdrive` | 视频广告 · Test Drive EVs in Auckland |
| `me_g5_indian`（预留） | 方案里的印度裔组，还没建 |
| `me_whatsapp`（预留） | WhatsApp 回复里给的链接 |

为什么这样定：
- 组代号写死，不用 `{{adset.name}}`：现有组名有中文，而且名字类参数在发布时就固定了，改组名后对不上；`{{ad.id}}` 只用来区分同组里的不同广告。
- `utm_source` 固定写 `meta`，不区分 Facebook / Instagram：版位拆分直接在 Meta 后台看更准，GA4 里少一个维度不影响判断。
- 不用 `aff` 自己编值：官方没说没在后台建过的值会不会被记录，所以必须由管理员先建链接、我们照抄。

## 三、怎么做到「不影响 Squid」

| 可能影响 Squid 的地方 | 我们怎么做 | 残余影响（如实说） |
|---|---|---|
| Eventbrite 追踪链接 | 只新建我们的 `me_` 链接，不改不删 Squid 的 | 无 |
| Eventbrite 上的 GA4 / Meta 像素（如果要加） | 先只看「Tracking pixels」列表里现有的，**只点「新增」，范围选「This event」**，不改不删已有的 | 官方没写一个活动最多几个；第一次新增后要立刻确认 Squid 那条还在，不在就马上撤回我们的 |
| 官网 GA4（可能是 Squid 的） | 我们的广告**直接链到 Eventbrite，不经过官网**（原方案就这样定，官网手机端慢） | 无；若有广告落官网，我们的访问会出现在他们 GA4 的「付费社交」里，但活动名是 `me_evexpo26`，可筛掉 |
| Squid 的 Meta 广告报表 | 我们用自己的广告户、自己的像素 | 同一个人两边广告都看过时，两边都会算这一单；这改不了，所以结算只认追踪链接报表 |

**加来源标记反而帮 Squid 分清数据**：现在我们的点击只带 Meta 自动加的点击编号，没有 `utm`，到了任何 GA4 里都可能被归进「Facebook」一大类，和 Squid 的混在一起；加上 `me_` 标记后才分得开。

## 四、改现有广告的提醒

- 给在投广告加网址参数，网上多份第三方资料说会**重新进入审核**，是否重置学习期说法不一（没有官方答案）。新广告组本来就只投了约 1.5 天，影响有限。
- 体检回执里建议的三处调整（去掉插播视频和 Reels 叠加层、排除 35–64 岁男性、改按落地页浏览找人）要改的也是这几个组，**建议和加链接一次做完**，只触发一次审核。
- 走 ME 改：ME 门户现在能不能改广告网址参数，没核实；不能的话，由 PM 本人在 Ads Manager 改，改完我只读核对。

## 五、上线后当场验证

1. 每组拿一条广告的预览，点链接，看浏览器地址栏有没有 `aff=…` 和 `utm_campaign=me_evexpo26`、组代号对不对。
2. 用这条链接打开 Eventbrite 页面，几小时后在追踪链接列表看到这条的浏览数变成 ≥1。
3. 如果 Eventbrite 上加了我们的 GA4：GA4 实时报表里看到 `utm_campaign = me_evexpo26` 的访问。
4. 第二天早上导一次追踪链接报表，记下每组售票数、销售额，配上同期 Meta 花费，算每张票成本（这一步才是我们要的成绩）。

## 六、要客户（Steven）做的

给 Steven 的消息（英文，PM 发；我没发）：

```text
Hi Steven, a quick request so we can report how many tickets our Meta ads actually sell, without touching Squid's tracking.

1. Please create these Eventbrite tracking links for the NZ EV & Tech Expo event (Event Dashboard > Marketing > Tracking links > Create), using exactly these names:
   me_g1_family, me_g2_ev, me_g3_tech, me_g4_uni, me_video_testdrive, me_g5_indian, me_whatsapp
   Then send us the full links. (Or, if easier, add hello@magicengine.cloud as an Eventbrite admin and we will create them ourselves.)
2. Please don't change or remove any existing tracking links or pixels; ours are additional only.
3. Could you send us a screenshot of Marketing > Tracking pixels (the list only)? We'd like to check whether a second Meta Pixel / GA4 ID can be added for our ads without affecting Squid's.

Each morning we'll pull the tracking-link report so you can see tickets and revenue from our ads separately from Squid's.
Thanks!
```

## 七、没核实的

- `aff` 是否就是追踪链接用的参数、追踪链接后面接 `utm` 参数会不会让 Eventbrite 记不到（第三方资料推断，上线时第 1、2 步验证）。
- Eventbrite 一个活动能不能同时挂两个 GA4 / 两个 Meta 像素（官方页面用的是「Add new pixel」，暗示可以，但没写）。
- 新西兰的内嵌购票（如果官网嵌了 Eventbrite 购票框）里像素是否生效：官方只说在欧洲、英国等地内嵌时像素会被关掉，没提新西兰。
- 我们在投广告现在点进去落在哪里（GA4 窗口在核实）。

## 来源

- Eventbrite 追踪链接：<https://www.eventbrite.com/blog/eventbrite-unique-tracking-links/>
- Eventbrite 加 GA4：<https://www.eventbrite.com/help/en-us/articles/475328/>
- Eventbrite 加 Meta 像素：<https://www.eventbrite.com/help/en-us/articles/558547/>
- Eventbrite 像素与内嵌购票：<https://www.eventbrite.co.uk/help/en-gb/articles/598933/getting-started-with-tracking-pixels/>
- Meta 网址参数（西语官方页）：<https://es-la.facebook.com/business/help/1016122818401732>
