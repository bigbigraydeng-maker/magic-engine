# CTS 静默唤回 · 第二轮邮件草稿 v8(改版:主推 Best of China,另两团做"报满"效果)

- **状态：已发送。** 2026-08-06,campaign 15910023(`reeng_r2_first_time_traveller_3tours`)真实发给 **338 人**(CTS Tours 订阅名单排除 `suppressed_do_not_email` + `hold_active_jul2026` 两个标签)。PM 确认"过"。
- **已知风险(PM 已知情并接受)**:"Two Cities / Shanghai & Surroundings 已报满"是 PM 直接给的业务事实,系统里**没有**按团追踪报名名单/剩余名额的数据表(`contact_deals` 之类的表还没建),所以**没有额外排除这两个团的既有报名者**——PM 2026-08-06 明确选择"没有名单,接受风险直接发"。如果这批人里有人已经报了这两个团又收到"已报满"的信,属于已知且被接受的小概率情况。
- 下一步：等开信/点击数据出来,评估效果 + 准备第三轮
- v7→v8 大改版(按 PM 新要求重新设计):
  - Two Cities 和 Shanghai & Surroundings 做成"小团已报满"效果——图片压暗、深色"SOLD OUT"标签、去掉价格和预订按钮,只留"看看 2027 团期"引导
  - 主推 Best of China 11月团("还有少量位置"),放大成信里的主角:红框+"Few spots left"标签+预订按钮
  - 新加一段"提一下明年多个团,欢迎咨询"(丝绸之路/Legacy of China/China Panorama/Natural China,均为官网真实存在的 2027 团期,信里未写具体日期,只做邀约咨询)
- **邮件预览(带真图/真色/真链接,已更新为 v8 内容)**：https://claude.ai/code/artifact/cddbd2ca-c40b-4dcc-9070-194c3b8941ec
- v6→v7:三个团卡片(图片+团名+"View full itinerary →")全部加了官网真实链接,点进去直接到对应团的详情页:
  - Shanghai & Surroundings → https://www.ctstours.co.nz/tours/china/discovery/shanghai-surroundings
  - A Tale of Two Cities → https://www.ctstours.co.nz/tours/china/discovery/beijing-xian
  - Best of China → https://www.ctstours.co.nz/tours/china/discovery/essentials
- **⭐ 规矩记下了(以后每封 CTS 邮件都要照做)**：凡是邮件里提到具体某个团,团名/图片必须链接到官网那个团的真实详情页,不能只是纯文字介绍。见 memory `feedback-cts-email-tour-links`
- v5→v6:①视觉改用官网真实素材——logo(`public/logo.png`)、三张团照片(各团 `heroImage` 原图)、免签横幅用官网 `VisaFreeBanner.tsx` 同款红→金渐变+同款文案、字体换成官网同款 Playfair Display + Inter(此前 v5 版本用的是我自己配的枣红+Georgia,不是官网真实用色/用字)②落款改成 "Baker, China Specialist"(不再是 "Baker Gu ... based in Auckland")
- **邮件预览(带真图/真色/真链接)**：https://claude.ai/code/artifact/cddbd2ca-c40b-4dcc-9070-194c3b8941ec
- v4→v5:加了一条"圣诞节前就回来了"——三个团全在10-11月出发,算了返程日期,离圣诞节还有一个多月,不影响过节
- v3→v4 修正:倒计时不是数免签截止日,是**每个团自己出发日的倒计时**(PM 澄清)。免签政策照样强调,只是不挂那个 147 天的数字了
- **三个天数按"今天"(2026-08-06)算,发送当天必须重新算一遍再填**:
  - Shanghai & Surroundings(10月14日出发)= 今天算起 69 天
  - A Tale of Two Cities(10月15日出发)= 今天算起 70 天
  - Best of China(11月3日出发)= 今天算起 89 天
- 收件对象：342 沉淀客户名单(定义见下),发送前重新拉取最新名单
- 数据来源：团名/天数/价格/团期/亮点全部取自官网源码 `chinatravel` 仓库 `src/lib/data/tours.ts`,未编造
- 品牌红线检查：未使用 "Auckland/NZ/New Zealand since 1928"

---

## 三个团的真实数据(核对用,不进邮件正文)

| 团名 | 天数 | 价格(起) | 今年团期 | 倒计时(按今天算) | 备注 |
|---|---|---|---|---|---|
| Shanghai & Surroundings(苏州/无锡/杭州/上海) | 10天 | NZD $3,399 起 | **2026年10月14日** | 69天 | 价格最亲民 |
| A Tale of Two Cities(北京+西安) | 10天 | NZD $3,480 起 | **2026年10月15日** | 70天 | 评分4.8(312条评价);官网原文直接写"免签政策发布至2026年12月31日" |
| Best of China(北京+西安+杭州+上海) | 15天 | NZD $3,880 起 | **2026年11月3日** | 89天 | 覆盖面最广的一条 |

---

## Subject

First time to China? The closest of 3 trips departs in 69 days

## Preview text

Visa-free entry for NZ passport holders, running to 31 Dec 2026. Three first-timer-friendly trips from NZD $3,399 — departing in 69, 70 and 89 days.

## Body

Hi [First Name],

If China has been on your list but you've never been — here's a reason to stop putting it off. New Zealand passport holders can currently enter China visa-free for up to 30 days, and that policy is published through **31 December 2026** — it's real, and it's running right now.

I know a first trip somewhere new can feel like a lot to figure out — visas, flights, what to see, who to call if something goes wrong. So a couple of things worth knowing:

- **The visa-free entry is real and current** — no separate visa application needed for most NZ leisure trips within the 30-day window (worth double-checking against your own travel dates, but the policy itself is confirmed and running now).
- **Our team is based right here in Auckland** — not overseas. Before you go, and while you're travelling, you're talking to someone in your own timezone, not a call centre on the other side of the world.
- **You'll be home well before Christmas** — all three trips below run in October or November, so you're back and settled in weeks ahead of the 25th. The holidays stay completely free.

With that in mind, here are three trips we'd especially recommend for a first time to China — everything organised, escorted the whole way, nothing to figure out on your own:

**Shanghai & Surroundings** — Suzhou, Wuxi, Hangzhou & Shanghai
10 days, from NZD $3,399 — departing **14 October 2026** — **69 days away** [⚠️发送当天重算]
A gentler pace through the Yangtze Delta's classical gardens and water towns, finishing on the Bund.

**A Tale of Two Cities** — Beijing & Xi'an
10 days, from NZD $3,480 — departing **15 October 2026** — **70 days away** [⚠️发送当天重算]
Forbidden City, the Great Wall, a hutong pedi-cab tour, then high-speed rail to see the Terracotta Warriors. Our highest-rated Discovery tour: 4.8 out of 5 from 312 reviews.

**Best of China** — Beijing, Xi'an, Hangzhou & Shanghai
15 days, from NZD $3,880 — departing **3 November 2026** — **89 days away** [⚠️发送当天重算]
The fullest itinerary of the three: Beijing's imperial sights, the Terracotta Warriors, West Lake and Longjing tea in Hangzhou, and the Bund in Shanghai.

All three are fully inclusive — return flights from Auckland, hotels, an English-speaking guide, and entrance fees and meals as listed.

Not sure which one fits a first trip best? Just reply and let me know — I'm right here in Auckland and happy to talk it through.

Warm regards,
Baker
China Specialist, CTS Tours NZ

*[Footer: 同第一轮 — *|UNSUB|* / *|HTML:LIST_ADDRESS_HTML|*]*

---

## "342 沉淀客户" 是怎么定义的

这批人是 CTS 邮件名单里符合下面这几条的人,大白话说就是**"以前感兴趣、现在没说不、也没成交、目前没人在跟"**：

1. **以前留过联系方式**(填过表、问过团、拿过报价)——人在名单里
2. **没有成交**——没有已付定金、没有付全款的人不算,这批人已经不需要再营销
3. **没有明确拒绝**——打过"不感兴趣"或要求"不要联系我"标签的人排除在外,这是硬红线
4. **现在没人正在跟他谈**——如果这个人最近还在跟销售来回发邮件谈细节,也排除,避免自动信跟人工沟通撞车、重复打扰

具体做法：在 Mailchimp 里,凡是打了"勿扰"或"已成交/已拒绝"标签的人,发送时自动跳过;剩下的就是这次要发的人。**发之前我会重新拉一次最新名单**——因为这段时间里,可能又有人成交了、或者拒绝了,得把最新状态排除掉,不能用上次的旧名单直接发。

---

## 发送前待确认(不需要 PM 现在回答,发送前我会自己核实一遍)

- 重新拉取排除名单(已成交/已付定金/已回信在谈/明确拒绝/勿扰)
- 小批测试(约 25 人)发一次看反应,正常再发全量,跟第一轮流程一致
