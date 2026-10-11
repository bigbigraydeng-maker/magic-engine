# CTS 搜索结果标题 / 描述体检（线上真实页面）— 2026-10-05

> 取数：对 `https://www.ctstours.co.nz/sitemap.xml` 里的 179 个页面逐个做一次公开网页 GET（5 并发、无登录、无付费接口、零花费），解析 `<title>`、meta description、robots。2026-10-05 NZ。
> 目的：纠正此前只靠站点抓取表（`client_site_pages.title` 与线上 `<title>` 对不上，抽查的页面里它等于页面大标题，不是搜索结果里显示的标题）得出的判断。

## 结论（先说事实）

- 179 个页面**都有** `<title>` 和 meta 描述，没有 noindex。
- 标题超过 60 个字符（谷歌里可能被截断）：**88 个（49%）**；超过 75 个：17 个；最长 100 个字符。
- 描述超过 160 个字符：113 个（63%）。**但**数据不支持把描述长度当点击率杠杆（见下），先不动。
- **品牌后缀重复**（`… | CTS | CTS Tours`）：**4 个页面**，其中 2 个是赚钱页（`/best-china-tours`、`/china-tours-from-new-zealand`，后者近 28 天 88 次点击、排第 6.5）。网站模板本来就会自动加 ` | CTS Tours`，标题里再写 `| CTS` 就重复；这两个赚钱页在标题自动改写的保护名单里，自动流程碰不到，只能人工改。
- 此前判断里**错了**的地方：①以为站点没有 meta 描述——有，是抓取表没记；②用抓取表里的"标题"做长度体检——它与线上 `<title>` 不一致，不能代表搜索结果里显示的标题。

## 标题长度和点击率（页面已排第一页、近 28 天曝光 ≥300，31 个页面）

| 标题长度 | 页面数 | 曝光 | 点击 | 点击率 |
|---|---|---|---|---|
| ≤60 | 13 | 29,494 | 600 | 2.03% |
| 61–75 | 12 | 9,501 | 148 | 1.56% |
| >75 | 6 | 6,567 | 50 | 0.76% |

读法（诚实版）：越长点击率越低，方向和"被截断"的说法一致；但这只是 31 个页面的**描述性对照**，话题、名次、搜索意图都没控制，**不能当作因果**。点击率最低的页面里还有好几个标题并不长（50–60 个字符），说明还有别的原因（同主题页面互相分食、搜索结果里别的板块、搜索意图不匹配），不要把所有页面都一股脑缩标题。描述长度与点击率：数据不支持（描述 >160 的组点击率反而更高 2.04% vs 0.92%，后者几乎由一个页面决定）。

## 品牌后缀重复的 4 个页面

- `/best-china-tours` — Best China Tours from NZ 2026-27 · Compare 4 Itineraries | CTS | CTS Tours
- `/china-tours-from-new-zealand` — China Tours from NZ 2026-27 · 4 Tours from NZD $3,399 | CTS | CTS Tours
- `/liziba-station-chongqing` — Liziba Station Chongqing: Train Through a Building | CTS | CTS Tours
- `/forbidden-city-travel-guide` — Forbidden City Tour Guide: Beijing Imperial Palace | CTS | CTS Tours

## 标题超过 75 个字符的页面（共 17 个，按长度排序）

- 100 字符 `/blog/liziba-monorail-chongqing-guide` — Liziba Monorail Through-the-Building: How to Visit Chongqing's Most Photographed Station | CTS Tours
- 91 字符 `/blog/holidays-to-china-from-new-zealand` — Holidays to China from New Zealand: A Kiwi Traveller’s 2026 – 27 Planning Guide | CTS Tours
- 90 字符 `/blog/sichuan-hot-pot-tradition` — Sichuan Hot Pot: The History, Ritual, and Heat Behind China's Most Famous Dish | CTS Tours
- 89 字符 `/china-travel-specialists-nz` — China Travel Specialists NZ | CTS Tours Auckland (Since 2000, backed by CTS founded 1928)
- 88 字符 `/blog/yangtze-river-cruise-from-chongqing` — Yangtze River Cruise from Chongqing: NZ Traveller's Complete Guide (2026-27) | CTS Tours
- 88 字符 `/blog/china-tour-packages-including-airfare-from-nz` — China Tour Packages Including Airfare from NZ: What’s Actually in the Price? | CTS Tours
- 85 字符 `/blog/suzhou-gardens-classical-beauty` — Suzhou Classical Gardens: China's UNESCO Masterpieces of Landscape Design | CTS Tours
- 83 字符 `/blog/hangzhou-west-lake-romance` — Hangzhou West Lake: Romance, Poetry, and China's Most Beloved Landscape | CTS Tours
- 81 字符 `/blog/beijing-hutong-culture` — Beijing Hutong Culture: A Deep Dive Into Old Peking's Hidden Laneways | CTS Tours
- 81 字符 `/blog/terracotta-warriors-history` — Terracotta Warriors: History, Discovery, and What You'll Actually See | CTS Tours
- 80 字符 `/blog/chengdu-panda-tour-new-zealand` — Visiting Giant Pandas in Chengdu: A Guide for New Zealand Travellers | CTS Tours
- 79 字符 `/blog/chongqing-night-city-lights` — Chongqing Night City: Why This Mountain Metropolis Glows After Dark | CTS Tours
- 79 字符 `/blog/chongqing-three-gorges-scenic` — Chongqing and the Three Gorges: China's Most Dramatic River Scenery | CTS Tours
- 78 字符 `/china-tours-for-seniors` — China Tours for Seniors 2026-27 · NZ-Friendly Pace, Mobility-Aware | CTS Tours
- 78 字符 `/blog/forbidden-city-insider-tips` — Forbidden City Insider Tips: What First-Time Visitors Need to Know | CTS Tours
- 77 字符 `/chongqing-travel-guide` — Chongqing Travel Guide: Hongyadong, Hotpot & Cyberpunk Skyline | CTS Tours NZ
- 76 字符 `/campaigns/chongqing` — Chongqing Tours from New Zealand | Packages & Custom Itineraries | CTS Tours

## 这份体检没有做的
- 没有逐页判断"标题写得好不好"，也没有核对它们和该页真实搜索词的匹配（那一步由每周清单的诊断去读该页自己的谷歌搜索词）。
- 没有看搜索结果页本身（AI 概览、视频、问答板块是否占位；AI 概览探测目前不工作，另有卡跟进）。
- 改标题的执行仍走现有通道（标题自动改写，有保护名单与事实核对）；本文件不授权任何改动。

