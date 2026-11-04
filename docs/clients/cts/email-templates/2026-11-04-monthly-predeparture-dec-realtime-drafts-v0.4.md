# 12 月初两篇月信 v0.4（实时版）——按 2026-11-04 当天真实核查重写

> 状态：**草稿 v0.4，只在本机，未发送。独立审查员复核结果见 §8。** 取代 v0.3 的两篇正文（v0.3 文件保留作历史，不删）。
> 日期：2026-11-04 ｜ 来源：126 号窗口；PM 2026-11-04 指令：「内容不够好，内容我需要结合实时 realtime 的撰写」 ｜ 风险：C（仅文档）
> 设计依据：[实时写信线设计稿 v0.1](../../../specs/2026-11-04-newsletter-realtime-context-line-design-v0.1.md)。本文件就是那份设计「手工跑一遍」的产物：§2 是情境包，§3 是据此写的信，§6 是被丢掉的热点。
> **保鲜规定**：§2 里标「发前重核」的条目，发送日前 2 天（11/30 周一）必须重查一遍；变了就改信，信里每个「截至 X 日」的日期同步改。

## 0. 这版和 v0.3 的区别

1. v0.3 是通用清单（护照、保险、软件），任何季节、任何路线收到的都一样。v0.4 每封信多了两块**只对这位客人成立**的内容：①他这条路线、这几天，每座城市的真实气候；②「截至发送日」的官方最新说法，带日期、带来源。
2. 一个团一个变体（共 4 个），不再 3 月团 10 人、5 月团 6 人各发同一封。
3. 清单部分压短：5 个月那封只留护照 / 保险 / 登记三件；3 个月那封只留软件与支付。

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
| F02 | 路线×日期（按「第 N 天 = 出发日 + N − 1」推算）：<br>**A**：北京 3/12–3/16 → 西安 3/16–3/19 → 蒲园 3/19–3/20 → 杭州 3/20–3/21 → 上海 3/21–3/24 → 3/25 回奥克兰<br>**B**：北京 3/19–3/23 → 西安 3/23–3/26 → 3/27 回奥克兰<br>**C**：北京 5/9–5/12 → 西安 5/12–5/15 → 宜昌 / 长江三峡游轮 5/15–5/19 → 重庆 → 成都 5/19–5/20 → 大理 5/20–5/22 → 昆明 5/22–5/24 → 桂林 / 阳朔 5/24–5/28 → 上海 5/28–5/30 → 苏州 5/30–5/31 → 杭州 5/31–6/2 → 6/3 回奥克兰<br>**D**：北京 5/14–5/18 → 西安 5/18–5/21 → 蒲园 → 杭州 5/22–5/23 → 上海 5/23–5/26 → 5/27 回奥克兰 | ME 团目录（`tour_catalog_tours` 行程、`tour_catalog_departures` 出发日），只读查询，11-04 | 官网 / 目录（客户自己的系统） | 11-04 | 团目录有改动就重核；**发前重核** |
| F03 | 各城市 3 月、5 月平均气候（中国气象局 1991–2020 平均值）：<br>北京 3 月 13.2 / 1.9 °C，降水日 3.0；5 月 27.2 / 15.1 °C，降水日 6.0<br>西安 3 月 15.5 / 3.9 °C，降水日 7.2；5 月 26.9 / 13.9 °C，降水日 9.8<br>杭州 3 月 15.9 / 7.6 °C，降水日 14.9；5 月 26.9 / 18.0 °C，降水日 13.3<br>上海（徐家汇）3 月 14.9 / 7.6 °C，降水日 12.7；5 月 25.8 / 17.9 °C，降水日 11.2<br>成都（双流）5 月 27.0 / 17.6 °C，降水日 13.8<br>昆明 5 月 25.2 / 14.9 °C，降水日 11.1<br>桂林 5 月 27.9 / 20.7 °C，降水日 18.2，降水量 321 mm<br>（格式：平均日最高 / 平均日最低；降水日＝降水 ≥ 0.1 mm 的天数） | 英文维基百科各城市页「Climate data」表，表注来源为中国气象局（China Meteorological Administration）：[北京](https://en.wikipedia.org/wiki/Beijing) · [西安](https://en.wikipedia.org/wiki/Xi'an) · [杭州](https://en.wikipedia.org/wiki/Hangzhou) · [上海](https://en.wikipedia.org/wiki/Shanghai) · [成都](https://en.wikipedia.org/wiki/Chengdu) · [昆明](https://en.wikipedia.org/wiki/Kunming) · [桂林](https://en.wikipedia.org/wiki/Guilin) | 二手（转录中国气象局数据；**没有直接打开气象局原表**） | 11-04 | 气候平均值一年一变，不需发前重核；西安表有两个站点，取长安区 1991–2020；上海日照一栏用的是 1981–2010（本信不用日照） |
| F04 | 新西兰外交贸易部 SafeTravel 对中国的建议级别：「Exercise increased caution」；页面更新日 2026-08-27；提到「小偷小摸，尤其在公共交通和旅游区」「针对游客的骗局」；另建议购买含空中医疗转运的综合旅游保险 | [safetravel.govt.nz/destinations/china](https://www.safetravel.govt.nz/destinations/china)（抓了两次，措辞逐字对上） | **官方** | 11-04 | 7 天；**发前重核**（级别一变，信要暂停、回报 PM） |
| F05 | 2027 年春节：2 月 6 日（周六）。官方 2027 年放假安排**尚未公布**：英文、中文各搜一次都只有第三方推算；上一年的通知是 2025-11-04 发布（国办发明电〔2025〕7 号），今年同一天还没看到 | 日期：多个二手来源一致（[choiceshanghai](https://choiceshanghai.com/blog/china-public-holidays-2027-shanghai)、[studycli](https://studycli.org/chinese-holidays/2027/)）；「未公布」是搜索结果的缺席，不是官方声明 | 日期：推算＋二手；「未公布」：**查无** | 11-04 | 公告出来前每次发信都重查；**发前重核** |
| F06 | 中国对新西兰普通护照免签：入境不超过 30 天，政策延至 2026-12-31 24:00（领事馆 2026-05-19 通知）；搜索未见延期到 2027 的公告；通知未写护照有效期要求 | [奥克兰总领馆通知](https://auckland.china-consulate.gov.cn/eng/lsqz/gg/202605/t20260519_11912956.htm)；[使馆 2025-11 通知](https://nz.china-embassy.gov.cn/eng/zxgxs/202511/t20251104_11746508.htm) | **官方** | 11-04 | 7 天。**PM 11-04 回「先不说」＝本期不写**（话题开关＝关）；12/14 复核卡另行跟进 |
| F07 | 官网打包页（发表于 2026-04-08）：分层穿衣、可折叠防水外套、防滑步行鞋、阳朔 / 桂林穿速干裤而不是牛仔裤；写「北京三月仍会觉得凉」 | [CTS 打包页](https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season) | 官网 | 11-04 | 页面改版时重核 |
| F08 | **官网内部矛盾**：「最佳旅行时间」页把「3–4 月」写成 15–25 °C 温和偏暖，另一页写北京 3 月 5–15 °C；中国气象局平均值显示 3 月城市日最高只有 13–16 °C、北京和西安清晨 2–4 °C。**信里不引用任何官网的气温数字** | [最佳时间页](https://www.ctstours.co.nz/best-time-to-visit-china)；另一页见 11-04 搜索结果 | 官网（互相矛盾） | 11-04 | 官网改了再看 |
| F09 | 支付：官方文章（gov.cn 英文版 2026-09-24）只说 2026–2030 年要让「签证、支付、退税等更方便」，没有细则；第三方指南称可绑国际卡但限额说法不一，没找到官方出处 → **信里只用官网应用页已有的软话**，不写任何限额数字 | [gov.cn 2026-09-24](https://english.www.gov.cn/news/202609/24/content_WS6ab54149c6d00ca5f9a0d717.html) | 官方（无细则）＋二手（冲突） | 11-04 | 30 天 |

## 3. 信的原文（英文，客人看到的）

通用规则：称呼在 Mailchimp 里用 `*|IF:FNAME|*Kia ora *|FNAME|*,*|ELSE:|*Kia ora,*|END:IF|*`（下文用 `{first_name}` 代指）；回复地址必须设成 info@ 并测过；每个变体建一个一次性标签再发。

### 3.1 变体 A（3 月团·Best of China·9 位）——「离出发 3 个月」

**主题**：`Your China tour: what March is like, and a few things to set up`
**预览行**：`Weather on your route, the latest official advice, and apps to set up before you go.`

```
Kia ora {first_name},

Your China tour is about three months away. This note covers the weather you can expect on your route, what is current as at 2 December, and a few things worth setting up before you leave.

WHAT MARCH IS LIKE ON YOUR ROUTE
Your tour starts in Beijing on 12 March, then moves on to Xi'an (from 16 March), Hangzhou (from 20 March) and Shanghai (from 21 March). Here are the average March conditions in each city (China Meteorological Administration, 1991 to 2020):
- Beijing: highs around 13°C, lows around 2°C, about 3 wet days
- Xi'an: highs around 16°C, lows around 4°C, about 7 wet days
- Hangzhou: highs around 16°C, lows around 8°C, about 15 wet days
- Shanghai: highs around 15°C, lows around 8°C, about 13 wet days
Mornings in Beijing and Xi'an are cold, and the south is milder but wetter. Layers work best: a warm jacket, scarf and gloves for the north, and a packable waterproof jacket and comfortable shoes with good grip for the south. Our packing guide has more: https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612

CURRENT AS AT 2 DECEMBER
- New Zealand's SafeTravel service (page updated 27 August 2026) advises travellers to "exercise increased caution" in China. It points to theft, especially on public transport and in tourist areas, and to scams aimed at tourists. If you are unsure about something, ask your guide. https://www.safetravel.govt.nz/destinations/china
- Chinese New Year falls on 6 February 2027, about a month before your tour starts.

WORTH SETTING UP BEFORE YOU GO
On our tours the main transfers are arranged for you, so these are mostly for your free time.
- Maps: Google Maps doesn't work well in China, so we suggest Amap (Gaode) or Baidu Maps. Save your hotel's address in the app before you leave.
- Payments: Alipay and WeChat Pay are widely used in the cities. They can increasingly be set up with a foreign card, although the rules change, so carry some Chinese yuan in cash as well.
- Your bank: tell your New Zealand bank your travel dates, which helps avoid your card being blocked.
- Google, Facebook and Instagram are blocked in China. If you need them, it's best to arrange a VPN before you travel, and to set up the apps you plan to use while you are still at home.
Our guide has more: https://www.ctstours.co.nz/blog/essential-travel-apps-china-navigation-communication-payment?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612

If you have any questions at all, just reply to this email or call us on 0800 287 888. We are always glad to help.

Warm regards,
Baker Gu
Founder, CTS Tours
```

### 3.2 变体 B（3 月团·A Tale of Two Cities·1 位）——只替换「天气」一段，其余与变体 A 相同

```
WHAT MARCH IS LIKE ON YOUR ROUTE
Your tour starts in Beijing on 19 March, then moves on to Xi'an (from 23 March). Here are the average March conditions in both cities (China Meteorological Administration, 1991 to 2020):
- Beijing: highs around 13°C, lows around 2°C, about 3 wet days
- Xi'an: highs around 16°C, lows around 4°C, about 7 wet days
Mornings are cold, so layers work best: a warm jacket, scarf and gloves, and comfortable shoes with good grip. Our packing guide has more: https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612
```

（变体 B 的「Current as at 2 December」「Worth setting up」两段与变体 A 完全相同。）

### 3.3 变体 C（5 月团·China Panorama·4 位）——「离出发 5 个月」

**主题**：`Your China tour: what May is like on your route`
**预览行**：`The weather along your route, and three things worth doing now.`

```
Kia ora {first_name},

Thank you again for booking your China tour with CTS Tours. Your tour is about five months away, so this first note is about the weather along your route and three things worth doing early. Over the coming months I'll send you a few short notes with practical tips, so you feel well prepared.

WHAT MAY IS LIKE ON YOUR ROUTE
Your tour starts in Beijing on 9 May and finishes in early June, after Xi'an, a Yangtze River cruise, Chongqing, Chengdu, Dali, Kunming, Guilin, Shanghai, Suzhou and Hangzhou. The weather changes a lot along the way. Here are the average May conditions for six of the places on your route (China Meteorological Administration, 1991 to 2020):
- Beijing: highs around 27°C, lows around 15°C, about 6 wet days
- Xi'an: highs around 27°C, lows around 14°C, about 10 wet days
- Chengdu: highs around 27°C, lows around 18°C, about 14 wet days
- Kunming: highs around 25°C, lows around 15°C, about 11 wet days
- Guilin: highs around 28°C, lows around 21°C, about 18 wet days
- Shanghai: highs around 26°C, lows around 18°C, about 11 wet days
Guilin is the wettest of these places, and you will be there, and in nearby Yangshuo, in the last week of May. Mornings in Beijing, Xi'an and Kunming are cool. Light layers work best, plus a packable waterproof jacket, comfortable shoes with good grip, and quick-dry trousers rather than denim for Guilin and Yangshuo. Our packing guide has more: https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m5_202612

THREE THINGS WORTH DOING NOW
1. Check your passport. Make sure it is valid and has blank pages for entry stamps. We recommend at least six months of validity from the day you arrive in China.
2. Arrange travel insurance. New Zealand's SafeTravel service advises comprehensive cover that includes medical evacuation by air, and we strongly recommend it too.
3. Register your trip on SafeTravel, the New Zealand government's travel advice website. It lets the Ministry of Foreign Affairs and Trade send you updates about the places you are visiting. As at 2 December, its advice for China (page updated 27 August 2026) is to "exercise increased caution", pointing to theft, especially on public transport and in tourist areas, and to scams aimed at tourists. https://www.safetravel.govt.nz/destinations/china

If you have any questions at all, just reply to this email or call us on 0800 287 888. We are always glad to help.

Warm regards,
Baker Gu
Founder, CTS Tours
```

### 3.4 变体 D（5 月团·Best of China·2 位）——只替换「天气」一段，其余与变体 C 相同

```
WHAT MAY IS LIKE ON YOUR ROUTE
Your tour starts in Beijing on 14 May, then moves on to Xi'an (from 18 May), Hangzhou (from 22 May) and Shanghai (from 23 May). Here are the average May conditions in each city (China Meteorological Administration, 1991 to 2020):
- Beijing: highs around 27°C, lows around 15°C, about 6 wet days
- Xi'an: highs around 27°C, lows around 14°C, about 10 wet days
- Hangzhou: highs around 27°C, lows around 18°C, about 13 wet days
- Shanghai: highs around 26°C, lows around 18°C, about 11 wet days
Mornings in Beijing and Xi'an are cool, and the south is warmer and wetter. Light layers work best, plus a packable waterproof jacket and comfortable shoes with good grip. Our packing guide has more: https://www.ctstours.co.nz/blog/what-to-pack-china-complete-packing-list-by-season?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m5_202612
```

（变体 D 的「Three things worth doing now」与变体 C 相同；开头那句「Over the coming months I'll send you a few short notes…」与变体 C 相同。）

## 4. 逐句出处（变体 A 与 C；B、D 同理）

| 信里的句子 | 依据 |
|---|---|
| 「about three months away」「about five months away」 | F01：天数 ÷ 30.4 四舍五入（§1 表） |
| 路线与日期（「starts in Beijing on 12 March … Shanghai (from 21 March)」等） | F02：团目录行程 + 出发日推算；写「from」是因为同一天可能上午在上一城、下午到下一城 |
| 各城市「highs around … lows around … about N wet days」 | F03：取整规则＝四舍五入到整数（15.5 → 16）；「wet days」＝降水 ≥ 0.1 mm 的天数 |
| 「Mornings in Beijing and Xi'an are cold, and the south is milder but wetter」 | F03：北京 / 西安 3 月平均最低 1.9 / 3.9 °C，杭州 / 上海 7.6 °C 且降水日 13–15 天 |
| 「Guilin is the wettest of these places」 | F03：桂林 5 月降水日 18.2、降水量 321 mm，是信里列出的六处里最多（只对列出的六处下结论，不对没列出的城市下结论） |
| 「you will be there in the last week of May」 | F02：桂林 / 阳朔 5/24–5/28 |
| 「Layers … packable waterproof jacket … shoes with good grip … quick-dry trousers rather than denim for Guilin and Yangshuo」 | F07（官网打包页原话） |
| 「warm jacket, scarf and gloves for the north」 | 建议而非事实，由 F03 的清晨低温推出 |
| 「SafeTravel … 'exercise increased caution' … theft … scams」 | F04 |
| 「If you are unsure about something, ask your guide」 | 建议；团目录行程里每天都有当地导游 |
| 「Chinese New Year falls on 6 February 2027, about a month before your tour starts」 | F05 日期；2/6 到 3/11 为 33 天 |
| 「On our tours the main transfers are arranged for you」 | 团目录行程（接送、高铁、国内航班均已安排） |
| Maps / Payments / Bank / VPN 四条 | 官网 [应用与支付指南](https://www.ctstours.co.nz/blog/essential-travel-apps-china-navigation-communication-payment)（v0.3 已由独立审查员逐句核过，措辞沿用）；F09：没有新证据推翻，所以不加任何数字 |
| 护照 / 保险 / 登记三条 | 官网签证与新手指南（v0.3 已核）；F04 的保险建议；「we strongly recommend it too」只在 Best of China 团页核到「Travel insurance (strongly recommended)」，China Panorama 的团页没找到（见 §5） |

## 5. 当天核查中发现的问题（逐条处理，别烂在这里）

1. **官网自相矛盾（F08）**：「最佳旅行时间」页写 3–4 月 15–25 °C，与气象局平均值和另一页都对不上。已写进设计稿的「冲突检测」例子。建议官网窗口核对改正（不是 126 的活，下面会开台账卡）。
2. **团目录里两个团的「城市」字段是空的**（Best of China、China Panorama 的 `tour_cities` 为 []，只有行程文字里有城市）。设计稿要求：字段为空时必须改读行程并报警，不能当成「没有城市」。
3. **「China Panorama」在团目录里的代号是 `grand-tour`，官网是否有对应页面没找到**（上一轮「站点地图没有 panorama」就是因为代号不同）。信里 C 变体的路线来自团目录，不是官网页面。
4. **保险「we strongly recommend」**：Panorama 没有可核的团页；请 Baker 确认（这是 Baker 以创始人名义说的话，由他认）。
5. **SafeTravel 级别是「Exercise increased caution」**：这是官方原话，客人自己点进 SafeTravel 链接也看得到；信里按原话平静转述，不加评论。属于「黄区」话题（设计稿 §7）：留不留由 PM 定。如果不想写，删 3.1 / 3.3 里带 "exercise increased caution" 的那一句即可，其余不受影响。
6. **「VPN」一句**沿用 v0.3，来自官网应用指南；PM 觉得敏感可整句删。

## 6. 被丢掉的热点（Phase 0 试跑的结果：查了 10 条，用了 0 条）

三道关：①跟这位客人的路线和日期有关吗 ②官方或主流来源能核实吗 ③对品牌安全吗。

| # | 候选 | 来源 | 为什么没用 |
|---|---|---|---|
| H1 | 中国入境游热：2025 年 1.54 亿人次，同比 +17.1% | gov.cn 英文版 2026-09-24（官方） | 过①：客人拿它做不了任何事 |
| H2 | 「China Haul」（外国游客空箱来、满箱回）国庆期间走红 | 聚合新闻摘要 | 过②：没有原始出处；过①：团队游的中老年客人不相关 |
| H3 | 第三季度免签入境同比 +24.1% | 聚合新闻摘要 | 过②；且**免签话题 PM 已关** |
| H4 | 240 小时过境免签覆盖 57 国 | gov.cn（官方） | 过①：CTS 团不是过境；新西兰是否在列来源没写 |
| H5 | 2026 年 3 月「服务包」：优化离境退税、多语种生活应用 | gov.cn（官方） | **保留待查**：官方只提到名字，没写生效日期和做法，不能写进信；发信前看有没有细则 |
| H6 | 外国游客支付便利 | gov.cn（官方，无细则）＋第三方（限额冲突） | 只沿用官网应用页的软话 |
| H7 | 「新西兰人涌向中国」 | 单一旅游博客 | 过②：没有官方统计，不引用 |
| H8 | 中国南航奥克兰—广州每周 10 班 | 航线资讯站（二手） | 过①：与团队客人的行程无关 |
| H9 | 故宫 / 兵马俑预约与限流 | 旅游博客 | 过②：没找到官方出处；这类事该由运营核官方售票页，不进营销信 |
| H10 | SafeTravel 页首：8 月 26 日西藏—尼泊尔边境山洪 | 官方 | 过①：任何 CTS 路线都不去西藏，被「路线相关」这道关挡掉（过滤器有效的证据） |

结论：**当下没有值得写进信的社会热点**，所以信里没有。写这条结论本身就是 agent 的正确输出（设计稿 §7：「没有」是合法答案，不硬凑）。

## 7. 发信前要做的事（别的角色 / PM）

1. 11/30（周一）发送前最后一次重核：F04、F05、F06、F02 四项；变了就改信，并把信里「as at 2 December」的日期同步。已加日历提醒。
2. Mailchimp 里建 4 个一次性标签：`predep_m3_boc_202612`（A）、`predep_m3_t2c_202612`（B）、`predep_m5_pano_202612`（C）、`predep_m5_boc_202612`（D）；每个变体单独建一个活动。
3. 发之前：核这 16 位在 Mailchimp 的订阅状态（11/5 例行查漏时顺带，要 PM 登录）；核每人 7 天内收信不超过 2 封；回复地址设 info@ 并测试。
4. 发送只有 PM 本人说「发」才发（NL-14）。

## 8. 独立复核结果

（待填：审查员重新打开每个出处核对信里的每个事实句、核日期与取整算术、核品牌红线，结果与处理见下。）
