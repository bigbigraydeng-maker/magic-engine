# 12 月初两篇月信 v0.4（实时版·润色第二遍）——按 2026-11-04 当天真实核查重写

> 状态：**草稿 v0.4（润色版），只在本机，未发送。** PM 11-04 看完第一遍后回「方向是对的，内容还需要润色」，本文件 §3 的信是润色后的第二遍；第一遍的文字留在 git 历史里（提交 5d8c4fdcc）。取代 v0.3 的两篇正文（v0.3 文件保留作历史，不删）。
> 日期：2026-11-04 ｜ 来源：126 号窗口；PM 2026-11-04 指令：「内容不够好，内容我需要结合实时 realtime 的撰写」「方向是对的，内容还需要润色」 ｜ 风险：C（仅文档）
> 设计依据：[实时写信线设计稿 v0.1](../../../specs/2026-11-04-newsletter-realtime-context-line-design-v0.1.md)。本文件就是那份设计「手工跑一遍」的产物：§2 是情境包，§3 是据此写的信，§6 是被丢掉的热点。
> **保鲜规定**：§2 里标「发前重核」的条目，发送日前 2 天（11/30 周一）必须重查一遍；变了就改信，信里每个「as at」的日期同步改。
> **独立复核**：第一位审查员（针对润色前的文字）的结果与处理见 §8.1；润色和按其意见改过的句子，第二遍复核见 §8.2（待回）。

## 0. 这版和 v0.3 的区别

1. v0.3 是通用清单（护照、保险、软件），任何季节、任何路线收到的都一样。v0.4 每封信多了两块**只对这位客人成立**的内容：①他这条路线、这几天，每座城市的真实气候；②「截至发送日」的官方最新说法，带日期、带来源。
2. 一个团一个变体（共 4 个），不再 3 月团 10 人、5 月团 6 人各发同一封。
3. 清单部分压短：5 个月那封只留护照 / 保险 / 登记三件；3 个月那封只留软件与支付。
4. **润色（本遍）**：①开头改成 Baker 本人的口气，不再是报告腔；②天气并成「城市 + 日期 + 早晚冷暖 + 下雨天数」一行，客人一眼对上自己哪天在哪；③去掉生硬说法（`wet days`、`highs/lows`）；④标题改加粗、不再全大写；⑤新增一句时差（中国比新西兰晚几小时），这是确定性算出来的；⑥压短并拆短句（3 月团那封 425→405 词；5 月团那封 409→415 词，但最长句 33 / 35→29 / 30 词；审查意见要求补的几处让篇幅回升了一些，已再压一轮），春节那条删了；⑦所有原有气温、下雨天数、网址、引用的话**一个没动**，日期由单个日改成区间（推算自团目录），§9 有对账；⑧按第一位独立审查员的意见又改了 7 处（署名职位、rain 口径、北京数字、VPN 提醒、护照半句、SafeTravel 句、起飞日），见 §8.1。

## 1. 收件分组与变体（2026-11-04 查团目录与 CRM 汇总，只看人数）

| 变体 | 团（团目录名称） | 出发—回程 | 人数 | 发送日 | 离出发月数（代码口径） |
|---|---|---|---|---|---|
| A | China Discovery — Best of China（15 天） | 2027-03-11 — 03-25 | 9 | 2026-12-02 | 99 天 ÷ 30.4 = 3.26 → 3 |
| B | China Discovery — A Tale of Two Cities（10 天） | 2027-03-18 — 03-27 | 1 | 2026-12-02 | 106 天 → 3.49 → 3 |
| C | China Signature — China Panorama（27 天） | 2027-05-08 — 06-03 | 4 | 2026-12-02 | 157 天 → 5.16 → 5 |
| D | China Discovery — Best of China（15 天） | 2027-05-13 — 05-27 | 2 | 2026-12-02 | 162 天 → 5.33 → 5 |

人数来自上一轮的 CRM 只读汇总（3 月团 9+1、5 月团 4+2，共 16 位）；本轮没有再碰客人名单。发信前要重算一次（有人退订、取消或新交定金都会变）。

## 2. 情境包（2026-11-04 快照）

来源类型：**官方**＝政府 / 官方机构原文；**官网**＝CTS 自己的页面；**二手**＝第三方整理，只能当线索或交叉核对；**推算**＝由前几项确定性算出。状态一律是「候选」，直到独立复核过才算已验证（见 §8）。

| ID | 事实 | 出处 | 类型 | 查到时间 | 保鲜 / 发前重核 |
|---|---|---|---|---|---|
| F01 | 今天 2026-11-04；发送日 2026-12-02（每月第一个周三）；离出发月数见 §1 | 系统日期（新西兰时区）；规则见设计稿 §6 | 推算 | 11-04 | 发送日变了就重算 |
| F02 | 路线×日期（按「第 N 天 = 出发日 + N − 1」推算）：<br>**A**：北京 3/12–3/16 → 西安 3/16–3/19 → 蒲园 3/19–3/20 → 杭州 3/20–3/21 → 上海 3/21–3/24 → 3/25 回奥克兰<br>**B**：北京 3/19–3/23 → 西安 3/23–3/26 → 3/27 回奥克兰<br>**C**：北京 5/9–5/12 → 西安 5/12–5/15 → 宜昌 / 长江三峡游轮 5/15–5/19 → 重庆 → 成都 5/19–5/20 → 大理 5/20–5/22 → 昆明 5/22–5/24 → 桂林 / 阳朔 5/24–5/28 → 上海 5/28–5/30 → 苏州 5/30–5/31 → 杭州 5/31–6/2 → 6/3 回奥克兰<br>**D**：北京 5/14–5/18 → 西安 5/18–5/21 → 蒲园 → 杭州 5/22–5/23 → 上海 5/23–5/26 → 5/27 回奥克兰 | ME 团目录（`tour_catalog_tours` 行程、`tour_catalog_departures` 出发日），只读查询，11-04 | 官网 / 目录（客户自己的系统） | 11-04 | 团目录有改动就重核；**发前重核**（同时有别的窗口在改 Signature 团的酒店和火车，行程可能变） |
| F03 | 各城市 3 月、5 月平均气候（中国气象局 1991–2020 平均值）：<br>北京 3 月 13.1–13.2 / 0.2–1.9 °C（各来源不一致，信里清晨取约 1 °C），降水日 3.0；5 月 27.2 / 15.1 °C，降水日 6.0<br>西安 3 月 15.5 / 3.9 °C，降水日 7.2；5 月 26.9 / 13.9 °C，降水日 9.8<br>杭州 3 月 15.9 / 7.6 °C，降水日 14.9；5 月 26.9 / 18.0 °C，降水日 13.3<br>上海（徐家汇）3 月 14.9 / 7.6 °C，降水日 12.7；5 月 25.8 / 17.9 °C，降水日 11.2<br>成都（双流）5 月 27.0 / 17.6 °C，降水日 13.8<br>昆明 5 月 25.2 / 14.9 °C，降水日 11.1<br>桂林 5 月 27.9 / 20.7 °C，降水日 18.2，降水量 321 mm<br>（格式：平均日最高 / 平均日最低；降水日＝降水 ≥ 0.1 mm 的天数） | 英文维基百科各城市页「Climate data」表，表注来源为中国气象局（China Meteorological Administration）：[北京](https://en.wikipedia.org/wiki/Beijing) · [西安](https://en.wikipedia.org/wiki/Xi'an) · [杭州](https://en.wikipedia.org/wiki/Hangzhou) · [上海](https://en.wikipedia.org/wiki/Shanghai) · [成都](https://en.wikipedia.org/wiki/Chengdu) · [昆明](https://en.wikipedia.org/wiki/Kunming) · [桂林](https://en.wikipedia.org/wiki/Guilin) | 二手（转录中国气象局数据；**没有直接打开气象局原表**） | 11-04 | 气候平均值一年一变，不需发前重核；西安表有两个站点，取长安区 1991–2020；上海日照一栏用的是 1981–2010（本信不用日照）；**北京一行有分歧**：我 11-04 读到的表是 13.2 / 1.9，独立复核在引用页上找不到这张表（维基百科 2026-08-04 换过北京主站表），其他来源 3 月清晨为 0.2（Climates to Travel）、0.4（Weather Atlas）、1.2（维基百科朝阳站），故信里取约 1 °C；Weather Atlas 与上述转录另有差异（西安 3 月高 13.9 vs 15.5；桂林 5 月低 18.8 vs 20.7、降水日 23.6 vs 18.2，该站没写统计期），所以信里一律写 around / about，并标 based on |
| F04 | 新西兰外交贸易部 SafeTravel 对中国的建议级别：「Exercise increased caution」；页面更新日 2026-08-27；提到「小偷小摸，尤其在公共交通和旅游区」「针对游客的骗局」；另建议购买含空中医疗转运的综合旅游保险 | [safetravel.govt.nz/destinations/china](https://www.safetravel.govt.nz/destinations/china)（抓了两次，措辞逐字对上） | **官方** | 11-04 | 7 天；**发前重核**（级别一变，信要暂停、回报 PM） |
| F05 | 2027 年春节：2 月 6 日（周六）。官方 2027 年放假安排**尚未公布**：英文、中文各搜一次都只有第三方推算；上一年的通知是 2025-11-04 发布（国办发明电〔2025〕7 号），今年同一天还没看到 | 日期：多个二手来源一致（[choiceshanghai](https://choiceshanghai.com/blog/china-public-holidays-2027-shanghai)、[studycli](https://studycli.org/chinese-holidays/2027/)）；「未公布」是搜索结果的缺席，不是官方声明 | 日期：推算＋二手；「未公布」：**查无** | 11-04 | 公告出来前每次发信都重查；**发前重核**。**本期信里没用**（春节日期价值低，且要让「Good to know」段保持不超过 2 条），留作备选 |
| F06 | 中国对新西兰普通护照免签：入境不超过 30 天，政策延至 2026-12-31 24:00（领事馆 2026-05-19 通知）；搜索未见延期到 2027 的公告；通知未写护照有效期要求 | [奥克兰总领馆通知](https://auckland.china-consulate.gov.cn/eng/lsqz/gg/202605/t20260519_11912956.htm)；[使馆 2025-11 通知](https://nz.china-embassy.gov.cn/eng/zxgxs/202511/t20251104_11746508.htm) | **官方** | 11-04 | 7 天。**PM 11-04 回「先不说」＝本期不写**（话题开关＝关）；12/14 复核卡另行跟进 |
| F07 | 官网打包页（发表于 2026-04-08）：分层穿衣、可折叠防水外套、防滑步行鞋、阳朔 / 桂林穿速干裤而不是牛仔裤；写「北京三月仍会觉得凉」 | [CTS 打包页](https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season) | 官网 | 11-04 | 页面改版时重核 |
| F08 | **官网内部矛盾**：「最佳旅行时间」页把「3–4 月」写成 15–25 °C 温和偏暖，另一页写北京 3 月 5–15 °C；中国气象局平均值显示 3 月城市日最高只有 13–16 °C、北京和西安清晨 2–4 °C。**信里不引用任何官网的气温数字** | [最佳时间页](https://www.ctstours.co.nz/best-time-to-visit-china)；另一页见 11-04 搜索结果 | 官网（互相矛盾） | 11-04 | 官网改了再看 |
| F09 | 支付：官方文章（gov.cn 英文版 2026-09-24）只说 2026–2030 年要让「签证、支付、退税等更方便」，没有细则；第三方指南称可绑国际卡但限额说法不一，没找到官方出处 → **信里只用官网应用页已有的软话**，不写任何限额数字 | [gov.cn 2026-09-24](https://english.www.gov.cn/news/202609/24/content_WS6ab54149c6d00ca5f9a0d717.html) | 官方（无细则）＋二手（冲突） | 11-04 | 30 天 |
| F10 | **时差**：中国全年用北京时间（UTC+8），不实行夏令时；新西兰夏令时到 2027-04-04（周日，四月第一个周日）结束。→ 3 月团（3/11–3/27）在中国期间，中国比新西兰晚 **5 小时**（新西兰 UTC+13）；5 月团（5/8–6/3）晚 **4 小时**（新西兰 UTC+12） | 新西兰规则：[DIA 夏令时页](https://www.dia.govt.nz/Daylight-Saving)（「九月最后一个周日到四月第一个周日」）；2027 年具体日期：[timeanddate 新西兰](https://www.timeanddate.com/time/change/new-zealand)（两个小站写 4 月 3 日，按规则与 timeanddate 取 4 月 4 日）；中国：[timeanddate 中国](https://www.timeanddate.com/time/zone/china) | 规则：官方；日期与中国时区：二手；差值：推算 | 11-04 | 365 天；若新西兰夏令时规则变动再核 |

## 3. 信的原文（英文，客人看到的；`**…**` 表示在 Mailchimp 里加粗）

通用规则：称呼在 Mailchimp 里用 `*|IF:FNAME|*Kia ora *|FNAME|*,*|ELSE:|*Kia ora,*|END:IF|*`（下文用 `{first_name}` 代指）；回复地址必须设成 info@ 并测过；每个变体建一个一次性标签再发。每封信约 400 词以内（不含网址），每句尽量不超过 30 词，给中老年读者慢慢读。网址在 Mailchimp 里做成「Our packing guide」这样的链接文字，不显示原始长网址（下文为了让审查看得见出处才写出网址）。**署名职位见 §5 第 7 条，PM 未定前用官网「关于我们」页的写法。**

### 3.1 变体 A（3 月团·Best of China·9 位）——「离出发 3 个月」

**主题**：`Your China tour: what March will feel like`
**预览行**：`The weather on your route, a few things to know right now, and one thing to do at home.`

```
Kia ora {first_name},

Your Best of China tour is about three months away. Here's a note on the weather, what's current right now, and one thing to do at home.

**What March will feel like**
You fly out on 11 March and reach Beijing the next day. Here are the long-term March averages for the main cities on your route (based on China Meteorological Administration averages, 1991 to 2020):
- **Beijing, 12–16 March:** around 1°C in the morning and 13°C in the afternoon. Measurable rain on about 3 days of the month.
- **Xi'an, 16–19 March:** around 4°C and 16°C. Measurable rain on about 7 days.
- **Hangzhou, 20–21 March:** around 8°C and 16°C. Measurable rain on about 15 days.
- **Shanghai, 21–24 March:** around 8°C and 15°C. Measurable rain on about 13 days.
Take a warm jacket, scarf and gloves for the cold mornings in the north, and a packable waterproof jacket and comfortable shoes with good grip for the wetter south. Our packing guide has more: https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612

**Good to know right now**
- As at 2 December, New Zealand's SafeTravel service (page updated 27 August 2026) advises travellers to "exercise increased caution" in China, the second of its four advice levels. Among other things, it points to theft, especially on public transport and in tourist areas, and to scams aimed at tourists. The full page is worth a read. If in doubt on tour, ask your guide. https://www.safetravel.govt.nz/destinations/china
- China doesn't change its clocks. While you are there it will be 5 hours behind New Zealand, because our daylight saving runs until 4 April 2027.

**One thing to do at home**
Set up your phone for China before you leave. Google Maps doesn't work well there, so we suggest Amap (Gaode) or Baidu Maps. Alipay and WeChat Pay are widely used in the cities and can increasingly be set up with a foreign card, although the rules change. So carry some Chinese yuan in cash too, and tell your New Zealand bank your travel dates. Google, Facebook and Instagram are blocked in China. VPN rules and reliability change, so check the current position and arrange anything you need before you travel. Our guide to the essential apps has more: https://www.ctstours.co.nz/blog/essential-travel-apps-china-navigation-communication-payment?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612

If you have any questions at all, just reply to this email or call us on 0800 287 888. We're glad to help.

Warm regards,
Baker Gu
China Travel Specialist, CTS Tours
```

### 3.2 变体 B（3 月团·A Tale of Two Cities·1 位）——替换「开头一句」「天气」两段，其余与变体 A 相同

```
Your A Tale of Two Cities tour is about three months away. Here's a note on the weather, what's current right now, and one thing to do at home.

**What March will feel like**
You fly out on 18 March and reach Beijing the next day. Here are the long-term March averages for both cities on your route (based on China Meteorological Administration averages, 1991 to 2020):
- **Beijing, 19–23 March:** around 1°C in the morning and 13°C in the afternoon. Measurable rain on about 3 days of the month.
- **Xi'an, 23–26 March:** around 4°C and 16°C. Measurable rain on about 7 days.
Take a warm jacket, scarf and gloves for the cold mornings, and comfortable shoes with good grip. Our packing guide has more: https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612
```

（「Good to know right now」「One thing to do at home」两段与变体 A 完全相同。）

### 3.3 变体 C（5 月团·China Panorama·4 位）——「离出发 5 个月」

**主题**：`Your China tour: what May will feel like`
**预览行**：`The weather along your route, and three things worth doing early.`

```
Kia ora {first_name},

Thank you again for booking your China tour with CTS Tours. Your China Panorama tour is about five months away, so this first note covers the weather and three things worth doing early. Over the coming months I'll send a few short notes with practical tips.

**What May will feel like**
You fly out on 8 May and reach Beijing the next day, and the weather changes a good deal along your route. Here are the long-term May averages for six of your stops (based on China Meteorological Administration averages, 1991 to 2020):
- **Beijing, 9–12 May:** around 15°C in the morning and 27°C in the afternoon. Measurable rain on about 6 days of the month.
- **Xi'an, 12–15 May:** around 14°C and 27°C. Measurable rain on about 10 days.
- **Chengdu, 19–20 May:** around 18°C and 27°C. Measurable rain on about 14 days.
- **Kunming, 22–24 May:** around 15°C and 25°C. Measurable rain on about 11 days.
- **Guilin, 24–28 May:** around 21°C and 28°C. The wettest of the six, with measurable rain on about 18 days.
- **Shanghai, 28–30 May:** around 18°C and 26°C. Measurable rain on about 11 days.
So pack light layers for the cooler mornings, a packable waterproof jacket and comfortable shoes with good grip, plus quick-dry trousers rather than denim for Guilin and Yangshuo. Our packing guide has more: https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m5_202612
Good to know: China doesn't change its clocks. While you are there it will be 4 hours behind New Zealand.

**Three things worth doing now**
1. Check your passport. Make sure it is valid and has blank pages. We recommend at least six months of validity from the day you arrive in China.
2. Arrange travel insurance. New Zealand's SafeTravel service advises comprehensive cover that includes medical evacuation by air, and we strongly recommend it too.
3. Register your trip on SafeTravel, the New Zealand government's travel advice website, so the Ministry of Foreign Affairs and Trade can send you updates about the places you are visiting. As at 2 December, its advice for China (page updated 27 August 2026) is to "exercise increased caution", the second of its four advice levels. Among other things, it points to theft, especially on public transport and in tourist areas, and to scams aimed at tourists. https://www.safetravel.govt.nz/destinations/china

If you have any questions at all, just reply to this email or call us on 0800 287 888. We're glad to help.

Warm regards,
Baker Gu
China Travel Specialist, CTS Tours
```

### 3.4 变体 D（5 月团·Best of China·2 位）——替换「开头一句」「天气」两段，其余与变体 C 相同

```
Thank you again for booking your China tour with CTS Tours. Your Best of China tour is about five months away, so this first note covers the weather and three things worth doing early. Over the coming months I'll send a few short notes with practical tips.

**What May will feel like**
You fly out on 13 May and reach Beijing the next day. Here are the long-term May averages for the main cities on your route (based on China Meteorological Administration averages, 1991 to 2020):
- **Beijing, 14–18 May:** around 15°C in the morning and 27°C in the afternoon. Measurable rain on about 6 days of the month.
- **Xi'an, 18–21 May:** around 14°C and 27°C. Measurable rain on about 10 days.
- **Hangzhou, 22–23 May:** around 18°C and 27°C. Measurable rain on about 13 days.
- **Shanghai, 23–26 May:** around 18°C and 26°C. Measurable rain on about 11 days.
So pack light layers for the cooler mornings, a packable waterproof jacket and comfortable shoes with good grip. Our packing guide has more: https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m5_202612
```

（变体 D 的「Good to know」时差一句与变体 C 相同，4 小时；「Three things worth doing now」与变体 C 相同。）

## 4. 逐句出处（变体 A 与 C；B、D 同理）

| 信里的句子 | 依据 |
|---|---|
| 「about three months away」「about five months away」 | F01：天数 ÷ 30.4 四舍五入（§1 表） |
| 团名（Best of China / A Tale of Two Cities / China Panorama） | CRM 里这些客人订的团名（团目录名称去掉系列前缀） |
| 「You fly out on 11 March and reach Beijing the next day」及各城市日期区间 | F02：团目录行程 + 出发日推算；官网 Best of China 团页「Day 1: Evening international flight from Auckland to Beijing」（审查员核）；China Panorama 官网团页 [grand-tour](https://www.ctstours.co.nz/tours/china/signature/grand-tour) 同样写 2027-05-08 出发、2027-06-03 回程；区间含到达日和离开日 |
| 各城市「around N°C in the morning and N°C in the afternoon」 | F03：平均日最低 → morning，平均日最高 → afternoon；取整＝四舍五入（15.5 → 16）。**北京 3 月清晨取约 1 °C**（各来源 0.2–1.9 °C 不等，约 1 °C 落在全部来源 ±1 °C 内） |
| 「Measurable rain on about N days of the month」 | F03：降水 ≥ 0.1 mm 的天数，四舍五入。新西兰读者习惯的「rain day」常指 ≥ 1 mm，所以信里写「measurable rain」而不是「wet days」 |
| 「cold mornings」（北京、西安 3 月） | F03：清晨平均约 1–4 °C，是形容词，不是新事实 |
| 「Guilin … the wettest of the six」 | F03：桂林 5 月降水日 18.2、降水量 321 mm，是信里列出的六处里最多（只对列出的六处下结论） |
| 「based on China Meteorological Administration averages, 1991 to 2020」 | 数字转录自维基百科的气候表（表注来源为中国气象局数据网）；用「based on」表示二手转录；北京以外 27 个数字审查员逐个复算一致 |
| 「So think layers … warm jacket, scarf and gloves for the cold mornings」 | 建议，由 F03 的清晨低温推出（官网打包页的春季清单是 base layers、waterproof jacket、fleece，没有围巾手套）；「packable waterproof jacket、comfortable shoes with good grip、quick-dry trousers rather than denim for Guilin and Yangshuo」＝F07（官网打包页原话） |
| 「SafeTravel … 'exercise increased caution' … the second of its four advice levels … Among other things … theft … scams」 | F04；四档：[SafeTravel 说明页](https://www.safetravel.govt.nz/destinations/about-our-travel-advice) 的 1「Exercise normal safety and security precautions」、2「Exercise increased caution」、3「Avoid non-essential travel」、4「Do not travel」（审查员与我各读一次）；「As at 2 December」＝发送日，发前 48 小时内重核才保留；「Among other things」是因为该页还有别的内容（审查员指出页面首句另提到比新西兰更大的安全隐患） |
| 「The full page is worth a read … ask your guide」 | 建议；团目录行程里每天都有当地导游 |
| 「China doesn't change its clocks … 5 hours behind New Zealand, because our daylight saving runs until 4 April 2027」「4 hours behind」 | F10：UTC+8 无夏令时；新西兰 UTC+13（夏令时）→ 差 5 小时；4 月 4 日后 UTC+12 → 差 4 小时。3/11–3/27 全在夏令时内，5/8–6/3 全在夏令时外 |
| 「One thing to do at home」整段：Google Maps 在中国不好用→Amap（Gaode）或 Baidu Maps；Alipay / WeChat Pay 城市里普遍使用、可越来越多地绑外国卡但规则会变→带些人民币现金、告诉银行出行日期；Google、Facebook、Instagram 被屏蔽；VPN 规则和可靠性会变→先查现状再备 | 官网 [应用与支付指南](https://www.ctstours.co.nz/blog/essential-travel-apps-china-navigation-communication-payment)（v0.3 已由独立审查员逐句核过；本遍把四条合成一段，并略去「Save your hotel's address in the app」「which helps avoid your card being blocked」两处细节；按第二位审查员意见**补回该指南原有的 VPN 提醒**「VPN legality and reliability change — verify current policies」）；F09：没有新证据推翻，所以不加任何数字。「Set up your phone for China before you leave」是建议，不是事实 |
| 护照 / 保险 / 登记三条（变体 C、D） | 官网签证与新手指南（v0.3 已核）；F04 的保险建议；「we strongly recommend it too」：Best of China 团页与 China Panorama 团页都写「Travel insurance (strongly recommended)」（后者由审查员找到）。「at least six months」＝CTS 自己的建议，官网两页对是否「必须」说法不一，信里只写 recommend |
| 署名「Baker Gu / China Travel Specialist, CTS Tours」 | 官网「关于我们」页：Baker Gu 的职位写「China Travel Specialist」；**官网首页另写「Founder & Lead China Specialist」，两页冲突，见 §5 第 7 条** |

## 5. 当天核查中发现的问题（逐条处理，别烂在这里）

1. **官网自相矛盾（F08）**：「最佳旅行时间」页写 3–4 月 15–25 °C，与气象局平均值和另一页都对不上。已写进设计稿的「冲突检测」例子；已开台账卡（`2026-11-04-cts-trial-found-site-temp-conflict-and-empty-tour-cities`）。不是 126 的活。
2. **团目录里两个团的「城市」字段是空的**（Best of China、China Panorama 的 `tour_cities` 为 []，只有行程文字里有城市）。设计稿要求：字段为空时必须改读行程并报警，不能当成「没有城市」。同一张台账卡。
3. **（已更正）China Panorama 官网有团页**：[ctstours.co.nz/tours/china/signature/grand-tour](https://www.ctstours.co.nz/tours/china/signature/grand-tour)，2027-05-08 出发、2027-06-03 回程，页面写「Travel insurance (strongly recommended)」。我上一遍写的「官网没有对应页面」是错的——是我在站点地图里按 `panorama` 搜，没想到官网路径叫 `grand-tour`，属于「搜索没命中 ≠ 不存在」。
4. **（已解决）保险「we strongly recommend」**：Best of China 与 China Panorama 两页都有，不用再请 Baker 确认。
5. **SafeTravel 级别是「Exercise increased caution」（黄区）**：官方原话，客人点进链接也看得到；信里按原话转述，并补上「四档里的第二档」「Among other things」「The full page is worth a read」，避免读起来像只有这两条。留不留由 PM 定；如果不想写，删 3.1 / 3.3 里带 "exercise increased caution" 的那一句即可，其余不受影响。
6. **VPN**：官网应用指南自己写了「VPN legality and reliability change — verify current policies」，上一遍的信丢掉了这个提醒。本遍补回（「VPN rules and reliability change, so … check the current position」）。PM 觉得这个话题太敏感，可整句删。
7. **（高）署名职位冲突——需要 PM 定**：官网**首页**「Meet your specialist」写 Baker Gu＝「Founder & Lead China Specialist」；官网**「关于我们」页**写 **Lisa Li, MNZM＝Managing Director、Founder of CTS Tours New Zealand**，而 Baker Gu＝「China Travel Specialist」，没有创始人头衔。上一遍的信和欢迎信 v1 都署「Baker Gu, Founder, CTS Tours」。本遍先把这四封信改署「**China Travel Specialist, CTS Tours**」（跟「关于我们」页一致，说少不说多）；如果 Baker 确实是创始人之一，回 `Founder` 我改回去。欢迎信 v1 草稿也有同一处，等欢迎信那件事一起定。
8. **所有 ctstours.co.nz 链接页顶部都挂着免签横幅**（「visit China visa-free for 30 days (until 31 Dec 2026)」）：客人点信里的打包指南、应用指南、团页，会看到写着“到 2026 年底”的免签横幅，而他们都是 2027 年出发，可能来电话问。信里一个字没提免签（照 PM 的「先不说」），但链接页绕过了这个决定。这是 PM 的决定：①留着、告诉接电话的同事怎么答；②请官网把横幅改成中性说法。我可以写一段给同事用的统一回答。
9. **护照六个月**：官网签证指南写「建议但非必须」，另一页（FAQ）写「minimum 6 months validity remaining」，两页对是否必须说法不一。信里只写 “We recommend”，并去掉了 “for entry stamps” 这半句（它描述的是入境条件，靠近 PM 关掉的话题）。
10. **有别的窗口正在改 Signature 团的酒店和火车**（会话列表里的「Signature 4 tours: hotel and train updates」）：China Panorama 的行程可能变，F02 在 11/30 必须重核。
11. **运营提示（不进信，属于「红区」走报警通道的真例子）**：SafeTravel 对中国页的“相关新闻”里有一条 2026-07-20 的《中东冲突对旅行与燃油供应的影响》，原文提到「flight delays or cancellations due to fuel shortages」「changes to flight schedules or aircraft types」，建议“不要在得到专业意见前取消航班”“检查每个目的地和转机点的建议”。这条**没提中国**，我也没有 CTS 团队航班怎么订的资料；建议运营在 12/2 前确认一下团队的航班安排。是否需要处理由 PM / 运营定。

## 6. 被丢掉的热点（Phase 0 试跑的结果：查了 10 条，用了 0 条）

三道关：①跟这位客人的路线和日期有关吗 ②官方或主流来源能核实吗 ③对品牌安全吗。

| # | 候选 | 来源 | 为什么没用 |
|---|---|---|---|
| H1 | 中国入境游热：2025 年 1.54 亿人次，同比 +17.1% | gov.cn 英文版 2026-09-24（官方） | 过①：客人拿它做不了任何事 |
| H2 | 「China Haul」（外国游客空箱来、满箱回）国庆期间走红 | 聚合新闻摘要 | 过②：没有原始出处；过①：团队游的中老年客人不相关 |
| H3 | 第三季度免签入境同比 +24.1% | 聚合新闻摘要 | 过②；且**免签话题 PM 已关** |
| H4 | 240 小时过境免签覆盖 57 国 | gov.cn（官方） | 过①：CTS 团不是过境；新西兰是否在列来源没写 |
| H5 | 3 月「服务包」（文章没写年份，应为 2026，未核）：优化离境退税、多语种生活应用 | gov.cn（官方） | **保留待查**：官方只提到名字，没写生效日期和做法，不能写进信；发信前看有没有细则 |
| H6 | 外国游客支付便利 | gov.cn（官方，无细则）＋第三方（限额冲突） | 只沿用官网应用页的软话 |
| H7 | 「新西兰人涌向中国」 | 单一旅游博客 | 过②：没有官方统计，不引用 |
| H8 | 中国南航奥克兰—广州每周 10 班 | 航线资讯站（二手） | 过①：与团队客人的行程无关 |
| H9 | 故宫 / 兵马俑预约与限流 | 旅游博客 | 过②：没找到官方出处；这类事该由运营核官方售票页，不进营销信 |
| H10 | SafeTravel 页首：8 月 26 日西藏—尼泊尔边境山洪 | 官方 | 过①：这四条路线都不去西藏（官网另有拉萨指南，但不在这批客人的行程里），被「路线相关」这道关挡掉（过滤器有效的证据） |

结论：**当下没有值得写进信的社会热点**，所以信里没有。写这条结论本身就是 agent 的正确输出（设计稿 §7：「没有」是合法答案，不硬凑）。

## 7. 发信前要做的事（别的角色 / PM）

1. 11/30（周一）发送前最后一次重核：F04（SafeTravel）、F02（行程）两项进信，变了就改信，并把信里「as at 2 December」的日期同步；F05（国务院放假通知）、F06（免签）只是看一眼，有消息先告诉 PM。已加日历提醒。
2. Mailchimp 里建 4 个一次性标签：`predep_m3_boc_202612`（A）、`predep_m3_t2c_202612`（B）、`predep_m5_pano_202612`（C）、`predep_m5_boc_202612`（D）；每个变体单独建一个活动。
3. 发之前：核这 16 位在 Mailchimp 的订阅状态（11/5 例行查漏时顺带，要 PM 登录）；核每人 7 天内收信不超过 2 封；回复地址设 info@ 并测试；标题在 Mailchimp 里设成加粗。
4. 发送只有 PM 本人说「发」才发（NL-14）。

## 8. 独立复核结果

### 8.1 第一遍（针对润色前的文字；后台另一个角色，自己重新打开出处，约 22 分钟、88 次工具调用）

结论：**暂不通过——1 条高、6 条中、4 条低**；日期、SafeTravel 事实、大部分气候数字没问题。逐条处理：

| # | 严重度 | 问题 | 处理 |
|---|---|---|---|
| 1 | 高 | 署名「Founder」与官网「关于我们」页冲突（Lisa Li＝创始人，Baker＝China Travel Specialist） | 我自己重新打开首页和关于我们页**核实属实，两页互相矛盾**；四封信先改署「China Travel Specialist」，PM 定（§5 第 7 条） |
| 2 | 中 | “wet days” 按 ≥ 0.1 mm 算，新西兰读者习惯 ≥ 1 mm，看起来比实际湿 | 改成 “Measurable rain on about N days” |
| 3 | 中 | 北京一行（13.2 / 1.9 / 3.0；27.2 / 15.1 / 6.0）在引用页上对不上任何北京表；3 月清晨 2 °C 偏暖 | 3 月清晨改成约 1 °C（各来源 0.2–1.9）；F03 加了分歧说明；5 月数字在所有来源 ±1 °C 内，不动 |
| 4 | 中 | VPN 一句丢掉了官网指南的提醒，还是个敏感话题 | 补回提醒：“VPN rules and reliability change, so … check the current position”（§5 第 6 条） |
| 5 | 中 | 所有链接页顶部有免签横幅（到 2026-12-31），绕过 PM 的“先不说” | 记入 §5 第 8 条，PM 定 |
| 6 | 中 | 护照：“blank pages for entry stamps” 和六个月靠近入境条件；官网两页对六个月说法不一 | 去掉 “for entry stamps”；六个月只写 recommend；§5 第 9 条 |
| 7 | 中 | SafeTravel 句子准确但有选择性 | 补上 “the second of its four advice levels”（我已核实是二级）、“Among other things”、“The full page is worth a read” |
| 8 | 低 | “starts in Beijing on 12 March” 与 11 日晚出发对不上 | 改成 “You fly out on 11 March and reach Beijing the next day” |
| 9 | 低 | “best”、“always glad to help” | VPN 句去掉 “it's best”（团名 Best of China 保留）；“always” 去掉 |
| 10 | 低 | 长句、长网址 | 句子已拆到 ≤ 30 词；网址在 Mailchimp 里做成链接文字 |
| 11 | 低 | 春节“约一个月”对 B 团是 40 天；围巾手套不在官网春季清单；预览行“latest official advice”可能吓到人 | 春节条已删；围巾手套保留为建议（由清晨低温推出）；预览行改成 “a few things to know right now” |

审查员对草稿说明的更正：§5.3、§5.4 写错了（China Panorama 有官网团页，保险被强烈建议）——已更正；H5 的年份“2026”只是推断、H10 说“任何 CTS 路线都不去西藏”不对（官网有拉萨指南）——§6 已改；10 条被丢热点没有一条该进信。

审查员**核对无误**的：SafeTravel 级别、更新日、偷窃 / 骗局 / 保险 / 登记原文；33 个气候数字里 27 个（除北京外）逐个复算一致；所有行程日期、月数、第一个周三、春节日期（香港天文台表）；官网应用 / 打包 / 电话 / 现金 / 银行通知等说法；脚本扫描四封信没有 visa / 价格 / 催促 / 稀缺词，新西兰拼写一致。**没能核实**：中国气象局原始门户；内部数据；Baker 的真实职位（只看公开网站）；聚合新闻类热点。
审查员还报告：搜索摘要里说有 CTS 页面含写给 AI 的文字，它查了 21 个 CTS 页面原始 HTML 没找到，也没据此做任何动作。

### 8.2 润色后新增 / 改写的句子（第二遍）

润色和按审查意见改过的句子，有些是新的事实（时差、四档中的第二档、早晚冷暖说法、“fly out … next day”、日期区间）。我自己已经核了两条（SafeTravel 四档；SafeTravel 中东冲突通知原文）和署名职位；**其余交回审查员复核，结果待回**，不由写信的人自己核。

## 9. 润色记录（第二遍 vs 第一遍）

| 项 | 第一遍 | 润色后 | 事实有没有变 |
|---|---|---|---|
| 开头 | 「This note covers…」报告腔 | 点出团名，拆成两个短句：「Your Best of China tour is about three months away. Here is a short note on…」 | 没变 |
| 天气 | 先写一句路线，再列「highs / lows / wet days」四行 | 每行＝城市 + 日期区间 + 早晚冷暖 + 下雨天数，客人一眼对上哪天在哪；先写“You fly out on 11 March and reach Beijing the next day” | 数字没变（北京 3 月清晨 2→1 °C 例外，见 §8.1 第 3 条）；新增日期区间（推算自 F02） |
| 生硬说法 | `wet days`、`highs around … lows around …` | `Measurable rain on about N days`、`around N°C in the morning and N°C in the afternoon`、北京「cold mornings」 | 口径说明更准 |
| 标题 | 全大写 | 加粗、首字母大写 | — |
| 「Current」一块 | 「Current as at 2 December」，两条（SafeTravel + 春节日期） | 「Good to know right now」，两条（SafeTravel + 时差）；SafeTravel 句补了“第二档 / Among other things / 读全页” | 春节条换成时差条 |
| 时差 | 无 | 新增一句（F10） | **新增**（确定性算出） |
| 软件 / 支付 | 四条清单 | 合成一段「One thing to do at home」，略去两处细节，补回官网指南的 VPN 提醒 | 只略去 / 补回 |
| 署名 | Baker Gu, Founder, CTS Tours | Baker Gu, China Travel Specialist, CTS Tours | **变**（PM 定，§5 第 7 条） |
| 长度 | A 425 词、C 409 词，最长句 33 / 35 词 | A 405 词、C 415 词，最长句 29 / 30 词（脚本实测） | — |

**对账（脚本，2026-11-04 已跑）**：把第一遍（提交 5d8c4fdcc）和润色后每个变体里的网址、引号里的短语各抽成集合比较，两类**完全相同**（审查意见后新增的 “exercise increased caution” 句式没有改变引号内容）；气温与下雨天数的差异只有北京 3 月清晨 2→1 °C；日期的变化只有「单个日 → 日期区间」，以及变体 A 里春节那条被删；新增只有时差一句（4 April 2027，5 / 4 hours）。脚本只比较这几类，不比较措辞。字数与最长句用另一个小脚本数。
