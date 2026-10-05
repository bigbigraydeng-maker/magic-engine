# CTS · 上海周边团（Shanghai & Surroundings）常年培育序列 + 首期冲刺邮件 · 草稿方案

> 状态：**草稿，未发送、未排期、未改名单、未在 Mailchimp 建任何东西**（2026-10-06）。
> 风险级：C（文档）。发送本身属 A 类动作（对外发布 + 客户可见），**必须 PM 本人同意**。
> 对应 Campaign：`campaign_briefs` 6f143a16-0abf-462f-8dad-d37a7c52de29（刻意停放 archived）· 草稿目标 287dc046-0b95-42fd-9fc1-4f5d39ecd8be。
> 英文正文里的 `[W] [W*] [B] [P] [N] [U]` 是溯源标记，**发送前必须全部剥掉**（见 §1）。

---

## 0. 先说结论（一页版）

1. **官网现在还是旧价。** 2026-10-06 实测团页仍写 NZD $3,399（页面里 `3,399` 出现 11 次，`2,699` 出现 0 次）。chinatravel 仓 PR #223 没上线之前，**任何含 2,699 的邮件都不许发**。本文所有价格都写成变量 `{{PRICE_FROM}}`，上线后从官网实时值填入。
2. **交付 7 封邮件草稿**：常年培育序列 5 封（N1–N5）+ 首期冲刺 2 封（SP1–SP2，2027-03-25 出发）。
3. **Mailchimp 里已经有一套在跑的欢迎机制**（每天早上 8:02 自动发 E1 + 一条只有一封信的欢迎流程），新序列必须跟它们对接，否则新留资的人会同时收到好几封"欢迎信"（§2.3，**这一点没核实到底会不会重复，要在启用前查**）。
4. **Mailchimp 名单里没有"这个人对哪个团感兴趣"的信息**（`TOURPREF` 字段抽查最新 100 人全是空）。所以"哪些人对上海周边感兴趣"目前只能从 ME 自己的留资记录里算，不能直接在 Mailchimp 里点选。
5. **Meta 留资表单最近没有"上海周边"这个选项**（最后一个选它的人是 8/22；8/31 之后的新表单只有 Still deciding / Best of China / Christmas / Golden China）。培育序列没有入口 = 空转，要先补入口（§3.1）。

---

## 1. 文案铁律与溯源方法

**每个事实句都标来源，标不出来的句子删掉。** 标记含义：

| 标记 | 含义 |
|---|---|
| `[W]` | 官网可溯：2026-10-06 抓取团页逐句核对过（见 §1.1） |
| `[W*]` | 官网可溯，**但依赖改价上线**：只有 PR #223 上线后、页面上真的写着这个价才算数；上线前不得发 |
| `[B]` | brief 可溯：来自 `campaign_briefs` 6f143a16（PM 2026-10-06 指令） |
| `[P]` | PM 口头确认、**官网还没写**：团人数上限 20（2026-10-06 由架构审核窗口转述 PM 口头确认，PM 本人在本窗口没说过）。**发送前以官网为准：官网当天页面没写这个数，整句删除** |
| `[N]` | 无事实主张（称呼、语气、行动号召） |
| `[U]` | 未证实 → 草稿里已经**删掉或改写**，只在 §7 留痕，不会出现在英文正文里 |

**禁用词**：cheapest / lowest price / best value / "最便宜" 一类；不写 "was NZD 3,399 / now"（见 §7「参考价风险」）；不编评价；邮件里不约会议、不留电话预约；签证只写"以出发时政策为准"；`1928` 只能和 `25 years in NZ` 成对出现（`project_cts_1928_vs_nz_25_years`）。
**署名人**：沿用现有邮件的 "Baker, CTS Tours"（CTS 真实同事，角色 China specialist）；**只用名字+角色，不替他编个人经历**（不写"我带爸妈去过"）。
**拼写**：NZ 英语。**每封必须有至少一个指向官网团页的可点链接**（`feedback-marketing-email-must-contain-landing-link`：历史上打开率最高的三封信点击率是 0，就因为没链接）。

### 1.1 官网团页事实底座（2026-10-06 抓取，页面原句）

页面：https://www.ctstours.co.nz/tours/china/discovery/shanghai-surroundings（HTTP 200）

| 事实 | 页面原文 / 取值 | 状态 |
|---|---|---|
| 团名 | China Discovery — Shanghai & Surroundings | 官网 |
| 天数 / 首期出发 | 10 Days · "Next confirmed departure: 25 March 2027" | 官网 |
| 价格 | 页面现写 "NZD $3,399 Per person"；单人房 "Own room + NZD $400" | **旧价，待 #223** |
| 概述 | "Yangtze Delta loop from Auckland: Suzhou gardens and Shantang Street, Wuxi lakeside sights and Three Kingdoms City, Hanfu and afternoon tea in Xinshi water town, Hangzhou's West Lake and Longjing tea, then Shanghai's Bund." | 官网 |
| 含 | "International and domestic airfares, Hotel accommodation as specified in the itinerary, English-speaking tour guide, Entrance fees and meals as specified in the itinerary, Land transfer" | 官网 |
| 餐 | "7 Breakfasts, 5 Lunches, 1 Dinners"（合计 13 餐） | 官网 |
| 住宿 | 7 nights / 5 hotels：Rosedale Chunshenhu Resort（5★标准）· Holiday Inn Express Wuxi（4★）· Holiday Inn（4★）· New Century Hotel Hangzhou（5★）· Holiday Inn Express Shanghai（4★），均 "or similar" | 官网 |
| 不含 | "Travel insurance (strongly recommended), Personal expenses, Transportation and guide services during free time, Meals not listed in the itinerary, Tips (suggested NZD $10 per day per person), Optional activities (e.g. Shanghai Acrobatics Show, Maglev ride)"；选配约 NZD $80 / $30 | 官网 |
| 改期 | "Free changes up to 60 days. Amend dates or travellers at no fee until 60 days before departure." | 官网 |
| 签证 | "NZ passport holders: visit China visa-free for 30 days (until 31 Dec 2026)." → **2027 出发不适用，邮件不引用** | 官网（过期） |
| 口碑 | "Rated by real travellers ★★★★★ Google 4.4 · 12 reviews"；页面无任何具名团友故事 | 官网 |
| 资质 | "TAANZ member & IATA-accredited" · "Backed by CTS · Founded 1928" · 25 years Kiwi-led | 官网 |
| **团规模** | **页面没写**（只有订单表单可选 1–8+ 人）。2026-10-06 转述 PM 口头确认「人数上限 20 人」，官网正在补写 → 邮件只写 "group size up to 20"（变量 `{{GROUP_SIZE_MAX}}`），**不写 small group 之类形容词、不写余位**；发送前官网仍没写这个数就删句 | PM 口头确认（`[P]`） |

升级目标团（2026-10-06 抓取，均 HTTP 200）：

| 团 | 页面 | 页面事实 |
|---|---|---|
| A Tale of Two Cities | /tours/china/discovery/beijing-xian | 10 天 · "From NZD $3,480" 双人间每人 · 下期 18 Mar 2027 · "Beijing's Forbidden City, Great Wall, and hutongs, then high-speed rail to Xi'an for the Terracotta Warriors." |
| Best of China | /tours/china/discovery/essentials | 15 天 · "NZD $4,080" 双人间每人 · 下期 11 Mar 2027 · "Fifteen days from Beijing's Temple of Heaven, Forbidden City, Great Wall and hutongs, by high-speed train to Xi'an's Terracotta Army, then by air to Hangzhou … finishing in Shanghai before your return via Beijing." |

> 注意：这两个团的价格/出发日**会变**，邮件里一律用变量 `{{TALE_PRICE}} {{TALE_DATE}} {{BOC_PRICE}} {{BOC_DATE}}`，发送前从官网当天页面取值。

### 1.2 变量表（草稿里所有 `{{…}}` 的来源）

| 变量 | 取值 | 取值来源 | 谁/什么时候填 |
|---|---|---|---|
| `{{FIRST_NAME}}` | Mailchimp 合并字段 `*|FNAME|*` | Mailchimp | 自动；空值要有兜底 "there" |
| `{{PRICE_FROM}}` | 改价后写 "NZD $2,699" | **官网团页，PR #223 上线后** | 发送前人工核对页面再填 |
| `{{PRICE_BASIS}}` | "per person, twin share" | 官网/brief | 固定 |
| `{{SINGLE_SUPP}}` | "NZD $400" | 官网（"Own room + NZD $400"） | 发送前核对 |
| `{{NEXT_DEPARTURE}}` | 如 "25 March 2027" | 官网 "Next confirmed departure" | 发送前核对（常年邮件不得写死） |
| `{{FREE_CHANGE_DAYS}}` | 60 | 官网 | 发送前核对 |
| `{{FREE_CHANGE_CUTOFF_CLAUSE}}` / `{{FREE_CHANGE_CUTOFF}}` | 仅冲刺邮件：出发日减 60 天（25 Mar 2027 → 24 Jan 2027） | **推算值**，需 CTS 确认"60 天"的算法 | CTS 确认前冲刺邮件不带这一句（见 SP2 备注） |
| `{{GROUP_SIZE_MAX}}` | 20 | PM 口头确认（经 2026-10-06 架构审核窗口转述）；官网补写后以官网为准 | 发送前核对官网；官网没写这个数 = 整句删除；**常年邮件不写死**，改了人数只改这一处 |
| `{{SEATS_NOTE}}` | 可选整块；只有 CTS **书面**确认余位才出现 | CTS | 没有确认 = 整块不出现，**绝不凭感觉写"快满了/仅剩 X 位"** |
| `{{GOOGLE_RATING}}` `{{GOOGLE_REVIEWS}}` | 如 4.4 / 12 | 团页 "Rated by real travellers" 行 | 发送前核对 |
| `{{TALE_PRICE}}` `{{TALE_DATE}}` | 如 "NZD $3,480" / "18 March 2027" | beijing-xian 团页 | 发送前核对 |
| `{{BOC_PRICE}}` `{{BOC_DATE}}` | 如 "NZD $4,080" / "11 March 2027" | essentials 团页 | 发送前核对 |
| `{{TOUR_URL}}` | `https://www.ctstours.co.nz/tours/china/discovery/shanghai-surroundings` | 官网（200） | 每封加 `?utm_source=mailchimp&utm_medium=email&utm_campaign=sh_nurture&utm_content=<邮件编号>`，方便"按团统计" |
| `{{ENQUIRY_URL}}` | `{{TOUR_URL}}#enquiry` | 团页 "Check availability →" 指向页内询价表单 | 同上 |

**常年邮件的变量陈旧问题**：序列会自动发好几个月，价格/日期如果在发送时才取值，邮件不会旧；如果是建稿时写死，改一次价就全错。所以本方案的规则是——**价格/日期/余位只出现在 N1、N4、N5 和冲刺邮件里；N2、N3 不含价格和日期**；Mailchimp 里用"一处改、处处生效"的方式放这些值（具体用哪种 Mailchimp 机制，建稿时再验证，**本草稿未验证**）；官网每次改价后，要对所有进行中的序列邮件做一次"页面价 vs 邮件价"对账（§6 闸门 5）。

---

## 2. Mailchimp 现状（只读核实，2026-10-06）

读取方式：用 PM 已登录的 Chrome 打开 Mailchimp 后台逐页读，**没点保存、没改任何东西**；数据库部分用 ME 生产库只读查询。

### 2.1 名单与标签
- 名单 "CTS Tours"（us19）：**827 个联系人 · 769 订阅 · 56 退订 · 2 非订阅**（近 30 天净增 262；来源：API 263 / Make 246 / Meta Lead Ads 158 / Zapier 81 / Import 76 / Admin Add 3）。
- 已存分群 **"Newsletter Safe v2 (excl paid+suppressed+sales+nurture+booked)" = 744 人**（2026-09-21 建，本次实时点开读到 744）。**这是冲刺邮件的发送底座**。另一个旧的 "Safe to Market" 只排除已付款，**不要用**。
- 标签（共 55 个）：排除类 `suppressed_do_not_email` · `sales_active` · `nurture_2027` · `paid_customer` · `booked_oct_nov_2026`；其他 `fb_lead`（最新 100 人里 96 个有）· `reborn_leadform` · `hold_active_jul2026` · `welcome_catchup_aug17` · 以及 **每天一个的 `auto_e1_batch_YYYYMMDD`**（7/14 起）。
- **没有**：任何"对哪个团感兴趣"的标签；没有"已报名上海周边"的标签（首期还没人报名，所以暂时没问题，但卖起来之后就需要，见 §4.3）。

### 2.2 历史邮件结构（已发 / 草稿）
- **每天 8:02 一封 `auto_e1_batch_YYYYMMDD`**：主题固定 "Your China itinerary inside · Baker from CTS Tours"，每批 1–15 人（近 10 天样本，打开 0%–100%，点击 0%–28.6%，**每批人太少，单批比例不能用来判断好坏**，要累计看）。9/1 那批是 192 人。
- **9/29 W3 "Christmas in China — and everything after it"**：647 人 · 打开 39.9% · 点击 7.3%（沿用的分群是 1 个 segment）。
- 草稿堆：E1–E4 老草稿、W1 "Where would you fly from" 分群信、10/14 / 10/15 / 11/3 三个团的行前须知（草稿）、Christmas & New Year 草稿等。
- **一条已激活的自动流程 "Welcome new contacts"**：9/18 启动，触发=有人订阅名单（带 1 个筛选条件，我没点开看条件内容），**只有一步：发 1 封 Welcome email**，累计 425 人 · 打开 56.0% · 0 人在途。

### 2.3 对接风险（必须在启用新序列前处理）
1. **欢迎信可能重复（未核实）**：9/18 之后，新留资者理论上同时满足"自动流程的触发"和"当天的 `auto_e1_batch` 标签批次"。我没有核对同一个人是否真的收到了两封，也没找到每日批次的代码位置（仓库里只在一个测试文件里出现过名字，运行方不在仓库内）。**启用前必须先查：新留资者实际收到几封欢迎信。**
2. **新序列的第一封不能再叠一封欢迎**：本方案让 N1 **替代**上海留资者的通用 E1（见 §3.2 入口规则），前提是每日批次能排除带 `interest_shanghai` 标签的人——**这一步还没做，也没验证能不能做**。
3. **撞车**：同一个人一周内可能同时被每日 E1、W 系列群发、N 序列、冲刺邮件触达。冲刺邮件发送前要手工看一遍最近 6 天的群发日历，同一人不要在 3 天内收两封营销信（Mailchimp 能不能用"最近收到过某邮件"做分群条件，**我没验证**）。

### 2.4 ME 库里的留资画像（只读，2026-10-06）
CTS 在 ME 库里共 1,116 个联系人，其中**有邮箱、没标"别联系"、阶段不是已付款/已报名/临行/没兴趣** = 898 人。Meta 留资表单里选的"感兴趣的团"（`tour_interest_raw`）分布（按联系人去重，2026-06-14 至 10-05）：

| 选项 | 人数 | 最近一次 |
|---|---:|---|
| Still deciding — show me all（新旧两版合计） | ≈387 | 10/05 |
| Best of China（15 days / March 2027） | ≈242 | 10/05 |
| Christmas in China（Auckland / Christchurch） | ≈60 | 10/05 |
| Tale of Two Cities | 45 | 8/31 |
| Silk Road Discovery | 44 | 8/30 |
| Golden China — November | 41 | 10/04 |
| **Shanghai & Surroundings** | **13** | **8/22** |

结论：**上海周边团过去几乎没人主动选**（13 人），首期冲刺不能指望"选过它的人"，要从"还在比较"的人里招。

---

## 3. 常年培育序列（N1–N5）

### 3.1 入口：先补一个入口，序列才有人进
- **推荐入口**：给"上海周边团"的 Meta 留资广告 / 表单加上 "China Discovery — Shanghai & Surroundings" 这个选项（现行表单没有），以及官网团页的 "Check availability" 表单。选了它的人 → 打标签 `interest_shanghai` → 触发序列。
- 标签名 `interest_shanghai` 与现有命名风格一致（`booked_oct_nov_2026`、`fb_lead`）。**本次没有建这个标签**（建标签属于改名单，需 PM 点头；ME 已有的 `src/lib/mailchimp/tags.ts` 只改"名单里已有的人"，符合规矩）。
- 这是 Campaign 里 "度量要能按团统计" 那个缺口的前半截：**留资来源不分团，就算不出这个引流款到底带来多少人**。

### 3.2 规则（整条序列共用）
- **进入**：带 `interest_shanghai` 且订阅状态为 subscribed 的人。
- **立即退出**（任何一个满足）：`suppressed_do_not_email` · `sales_active`（销售已在人工跟进，含他在官网填了询价表单后 CRM 自动打上的情况）· `paid_customer` · `booked_*` · `nurture_2027` · 退订。
- **通用 E1 不再发给他们**：每日 8:02 批次需排除 `interest_shanghai`（§2.3-2 未验证）。
- **时间**：以进入当天为 Day 0，发送时间统一 NZ 时间 8:02 之后的上午（沿用现有批次时间，打开数据以此为准）。
- **频率**：Day 0 / 2 / 5 / 9 / 15（刻意不用 7 的倍数）。
- **不放折扣倒计时、不放假紧迫感**：余位/截止日只有拿到 CTS 书面确认才写。

### N1 · Day 0 · 欢迎 + 行程亮点

| 项 | 内容 |
|---|---|
| 目的 | 让他收到询价后的第一封就看到完整行程骨架，并有一个能点的团页 |
| 主题 A | Your Shanghai & Surroundings itinerary, day by day |
| 主题 B | 10 days from Auckland to the Yangtze Delta — here's the plan |
| 预览句 | Suzhou, Wuxi, Hangzhou and Shanghai: what each stop looks like. |
| 唯一主 CTA | 按钮 "See the full itinerary →" → `{{TOUR_URL}}`（utm_content=n1） |
| 含变量 | `{{FIRST_NAME}}` `{{PRICE_FROM}}` `{{PRICE_BASIS}}` |

正文：

> Hi {{FIRST_NAME}}, [N]
>
> Thanks for your interest in China Discovery — Shanghai & Surroundings. [W]
>
> It's a 10-day loop from Auckland through the Yangtze Delta: Suzhou's gardens and Shantang Street, Wuxi's lakeside sights and Three Kingdoms City, Hanfu photos and afternoon tea in Xinshi water town, Hangzhou's West Lake and Longjing tea, then Shanghai's Bund. [W]
>
> Here's how the days fall: [N]
> • Suzhou — Master of the Nets Garden, Panmen and Shantang Street [W]
> • Wuxi — silk factory, Three Kingdoms City, Purple Sand Museum and Li Garden [W]
> • Xinshi — Hanfu photos and afternoon tea in an ancient town [W]
> • Hangzhou — West Lake boat tour, Su Causeway and Leifeng Pagoda [W]
> • Shanghai — The Bund, City God Temple and Nanjing Road [W]
>
> The price is from {{PRICE_FROM}} {{PRICE_BASIS}}, and it includes international and domestic airfares, seven nights in hotels (4- and 5-star standard, or similar), an English-speaking tour guide, entrance fees and 13 meals as listed in the itinerary. [W*]
>
> [ See the full itinerary → ]
>
> Baker
> CTS Tours [N]
>
> CTS Tours is Auckland-based, backed by CTS (China's travel brand since 1928), and has run China tours from New Zealand for 25 years. We're a TAANZ member and IATA-accredited. [W]

### N2 · Day 2 · 真实的一天

> **素材闸门（硬规则）**：页面上**没有任何具名团友故事**，旧手册有编造评价的前科。N2 默认走 **N2-B（行程里的一天）**，只用官网行程事实。只有当 CTS 提供了**真实团照 + 团友书面同意使用的原话（含是否署名）** 时才启用 N2-A；素材要从 CTS 的 Dropbox 素材库取，每张图自己打开看过、确认就是文案里那个地方。

| 项 | 内容 |
|---|---|
| 主题 A | What a day on this tour actually looks like |
| 主题 B | A morning in Xinshi, an afternoon in Hangzhou |
| 预览句 | Three days from the itinerary, in order. |
| 唯一主 CTA | 按钮 "Read the day-by-day itinerary →" → `{{TOUR_URL}}`（utm_content=n2） |
| 含变量 | `{{FIRST_NAME}}` `{{GOOGLE_RATING}}` `{{GOOGLE_REVIEWS}}`（**不含价格、不含日期**） |

**N2-B 正文（默认）**：

> Hi {{FIRST_NAME}}, [N]
>
> Itineraries can read like lists, so here are three consecutive days from this tour, in order. [N]
>
> **Day 5 — Wuxi to Xinshi (about 1.5 hours).** The day brings Hanfu photos and afternoon tea in an ancient town. [W]
>
> **Day 6 — Xinshi to Hangzhou.** The day is West Lake: a boat tour, Su Causeway and Leifeng Pagoda. [W]
>
> **Day 7 — Hangzhou to Shanghai (about 2 hours).** The day takes in the G20 Expo Centre, Six Harmonies Pagoda and Longjing tea, then continues to Shanghai. [W]
>
> CTS Tours is rated {{GOOGLE_RATING}} on Google from {{GOOGLE_REVIEWS}} reviews. [W]
>
> [ Read the day-by-day itinerary → ]
>
> Baker
> CTS Tours [N]

**N2-A 骨架（仅素材闸门通过时启用）**：把 Day 5–7 三段里的其中一段换成 "From a recent CTS departure"，放 `{{REAL_PHOTO}}`（来源路径+拍摄日期留档）和 `{{TRAVELLER_QUOTE}}`（逐字、带授权记录；不改写、不拼接）。没有授权记录的原话 = 不出现。

### N3 · Day 5 · 常见顾虑

| 项 | 内容 |
|---|---|
| 主题 A | Visa, insurance, tips: the questions people ask us first |
| 主题 B | Before you book: what's included and what isn't |
| 预览句 | Straight answers, with the details linked. |
| 唯一主 CTA | 按钮 "Check the full inclusions →" → `{{TOUR_URL}}`（utm_content=n3） |
| 含变量 | `{{FIRST_NAME}}` `{{SINGLE_SUPP}}` `{{FREE_CHANGE_DAYS}}`（**不含价格、不含日期**） |

> Hi {{FIRST_NAME}}, [N]
>
> Here are the things people usually ask before they book. [N]
>
> **Visas.** Entry rules are set by China and can change, so the policy that applies on your departure date is the one that counts. Our visa guide for New Zealanders is here: https://www.ctstours.co.nz/china-visa-guide-for-new-zealanders [N / link W]
>
> **What's included.** International and domestic airfares, hotels as listed in the itinerary, an English-speaking tour guide, entrance fees, land transfers, and 7 breakfasts, 5 lunches and 1 dinner. [W]
>
> **What's not.** Travel insurance (strongly recommended), personal expenses, transport and guide services during free time, meals not listed in the itinerary, tips (suggested NZD $10 per day per person) and optional activities such as the Shanghai acrobatics show (about NZD $80) and the Maglev ride (about NZD $30). [W]
>
> With only one dinner included, it's worth budgeting for your other evenings. [W — 由 "1 Dinners" 推出]
>
> **Travelling solo?** You get your own room for an extra {{SINGLE_SUPP}}. [W*]
>
> **If your plans change.** You can amend dates or travellers at no fee until {{FREE_CHANGE_DAYS}} days before departure. Cancellation conditions are set out in our terms: https://www.ctstours.co.nz/terms-and-conditions [W]
>
> [ Check the full inclusions → ]
>
> Baker
> CTS Tours [N]

### N4 · Day 9 · 价格是怎么构成的

| 项 | 内容 |
|---|---|
| 主题 A | What {{PRICE_FROM}} covers on the Shanghai & Surroundings tour |
| 主题 B | Reading the price: what's in and what's extra |
| 预览句 | Airfares, hotels, guide and entrance fees — and what you pay on top. |
| 唯一主 CTA | 按钮 "Check availability →" → `{{ENQUIRY_URL}}`（utm_content=n4） |
| 含变量 | `{{FIRST_NAME}}` `{{PRICE_FROM}}` `{{PRICE_BASIS}}` `{{SINGLE_SUPP}}` `{{NEXT_DEPARTURE}}` `{{GROUP_SIZE_MAX}}`（`[P]` 句，官网没写就删）`{{SEATS_NOTE}}`（可选） |

> Hi {{FIRST_NAME}}, [N]
>
> A price on its own doesn't tell you much, so here is what it's made of. [N]
>
> The Shanghai & Surroundings tour is from {{PRICE_FROM}} {{PRICE_BASIS}}. [W*]
>
> That covers: [N]
> • International and domestic airfares [W]
> • Seven nights across five hotels, 4- and 5-star standard or similar, including Rosedale Chunshenhu Resort and New Century Hotel Hangzhou [W]
> • An English-speaking tour guide [W]
> • Entrance fees and land transfers [W]
> • 13 meals: 7 breakfasts, 5 lunches and 1 dinner [W]
>
> Group size is up to {{GROUP_SIZE_MAX}} travellers. [P]
>
> Not covered: travel insurance (strongly recommended), tips (suggested NZD $10 per day per person), meals not listed, free-time transport and optional activities. A single room is an extra {{SINGLE_SUPP}}. [W / W*]
>
> The next confirmed departure is {{NEXT_DEPARTURE}}. [W]
>
> {{SEATS_NOTE}} [仅在 CTS 书面确认余位时出现，否则整行删除]
>
> If you'd like to check availability, the enquiry form is on the tour page. You can also just reply to this email with questions. [N — 回复邮箱需有人看，见 §7]
>
> [ Check availability → ]
>
> Baker
> CTS Tours [N]

### N5 · Day 15 · 升级路径（不喊"换更贵的团"，只给对照）

| 项 | 内容 |
|---|---|
| 主题 A | If you want more of China in one trip |
| 主题 B | Two longer trips that start where this one stops |
| 预览句 | Beijing and Xi'an in 10 days, or a 15-day loop that ends in Shanghai. |
| 唯一主 CTA | 按钮 "Compare our China tours →" → `https://www.ctstours.co.nz/tours/china`（200）（utm_content=n5） |
| 含变量 | `{{FIRST_NAME}}` `{{TALE_PRICE}}` `{{TALE_DATE}}` `{{BOC_PRICE}}` `{{BOC_DATE}}` |
| 发给谁 | 仍在序列里的人（没进销售跟进、没付款、没退订）。**不发给已点过 N4 询价按钮并转人工的人**（他们已被 `sales_active` 排出） |

> Hi {{FIRST_NAME}}, [N]
>
> If Shanghai & Surroundings feels like a good start but you'd like more of China in one trip, these are the two we'd look at next. [N]
>
> **A Tale of Two Cities (10 days).** Beijing's Forbidden City, Great Wall and hutongs, then high-speed rail to Xi'an for the Terracotta Warriors. From {{TALE_PRICE}} {{PRICE_BASIS}}; next departure {{TALE_DATE}}. [W]
> https://www.ctstours.co.nz/tours/china/discovery/beijing-xian
>
> **Best of China (15 days).** Beijing's Temple of Heaven, Forbidden City, Great Wall and hutongs, high-speed train to Xi'an's Terracotta Army, then Hangzhou's West Lake and Longjing tea, finishing in Shanghai. {{BOC_PRICE}} {{PRICE_BASIS}}; next departure {{BOC_DATE}}. [W]
> https://www.ctstours.co.nz/tours/china/discovery/essentials
>
> Still deciding between them? Our tour pages list the dates and what's included for each. [N]
>
> [ Compare our China tours → ]
>
> Baker
> CTS Tours [N]

> 备注：**这条是 Campaign 里 "引流款→升级" 的核心一步，但目前没有任何数据证明会有人升级**。上线后第一个要看的数是 N5 的链接点击里，点 Tale/Best of China 的占比，以及它们之后是否出现在询价记录里；当前系统不分团统计，**这一步现在度量不了**（见 §7）。

---

## 4. 首期冲刺邮件（SP1–SP2，2027-03-25 出发）

> 这两封是"一次性群发"，跟 N 序列不同：**给已经在名单里的历史询价人**。变量照样一律用 §1.2，**不把 2027-03-25 或人数上限 20 写死**（用 `{{NEXT_DEPARTURE}}`、`{{GROUP_SIZE_MAX}}`）。

### 4.1 分群（估算，ME 库只读，2026-10-06）
下表是 ME 库里"有邮箱、没标别联系、阶段不是已付款/已订金/临行/没兴趣/已报价"的人，按**第一条命中**归组（互斥）。**Mailchimp 实际可发人数一定 ≤ 这些数**（ME 库 824 人 vs Mailchimp 安全分群 744 人；还要再扣退订和销售跟进中的人）。

| 组 | 定义 | ME 库估算人数 | 冲刺默认处理 |
|---|---|---:|---|
| A | 选过 Shanghai & Surroundings | 13 | **发 SP1 + SP2** |
| B | 选 "Still deciding — show me all"（没选过上海） | 349 | **发 SP1 + SP2** |
| E | 在名单里但不是 Meta 表单来的（电话/Messenger/邮件） | 102 | **发 SP1 + SP2** |
| C | 只选过 Best of China / Tale of Two Cities / Silk Road | 271 | **默认不发**：Best of China 下期 11 Mar、Tale 下期 18 Mar，跟 25 Mar 的上海团出发期只差 1–2 周，发了容易互相抢单；PM 如果想招这批人，改成只发 SP2 |
| D | 只选过 Christmas / Golden China | 89 | **默认不发**：他们的团马上出发，先让行前/促成流程走完 |
| — | 阶段=已报价 | 74（已排除） | 销售正在谈，不发 |

→ **SP1/SP2 的目标人数上限 ≈ 464（A+B+E），Mailchimp 实际预计在 400 上下**（**这是估计，不是实测**；发送前要在 Mailchimp 里以最终分群的人数为准）。

### 4.2 在 Mailchimp 里怎么圈人 + 手工排除（抑制标签不拦邮件）
`suppressed_do_not_email` 只是个标签，**不会自己拦邮件**，必须在建群发时手工排除（`reference-mailchimp-suppression-tag-needs-manual-exclusion`）。操作清单：

1. **Send to**：已存分群 "Newsletter Safe v2"（744）。它已经排除了 paid / suppressed / sales / nurture / booked。**不要选 "All subscribers"，也不要选旧的 "Safe to Market"。**
2. **再手工叠加的排除**（Mailchimp 的 Do not send to / 分群条件里逐个核对一遍，别信分群名字）：
   - 标签：`suppressed_do_not_email` · `sales_active` · `paid_customer` · `nurture_2027` · `booked_oct_nov_2026`（分群已含，**仍要在预览页核对规则里这五项真的都在**）
   - **将来新增的已报名标签**：首期一旦有人报名上海周边，必须有一个"已报名该团"的标签并加入排除（目前**不存在**这个标签，也**没有**自动同步——`docs/sops/cts-newsletter-send-checklist.md` 第 3 条同样写了这个已知缺口；该 SOP 目前在分支 `claude/determined-dewdney-a724f5` 上，**尚未合入主干**）。**没有这个排除能力之前，冲刺邮件发送前必须走人工任务向 CTS 要"已报名名单"**。
   - 排除 C 组 / D 组：Mailchimp 里**没有**"对哪个团感兴趣"的字段（`TOURPREF` 空），所以不能直接在 Mailchimp 点选。做法：由 ME 按本节规则从 ME 库导出 A+B+E 的邮箱清单，**打一个一次性的批次标签（如 `sprint_sh_202703_batch`）并只发给带这个标签的人**；打标签这一步属于"改名单"，**需 PM 批准后才做，本次没做**。
3. **已退订 / 已反弹**：Mailchimp 会自动不发（unsubscribed、cleaned 不在 744 里），**但不要手工"重新订阅"任何人**。
4. **发送前对一遍人数**：最终分群人数 ≤ 4.1 的上限；多出来的人 = 圈错了，停。

### 4.3 时间线（只是建议，等 PM 同意后才排）
- **SP1**：官网改价**上线并验证页面价 = 邮件价**之后第一个工作日上午；不早于此。
- **SP2**：SP1 之后 10–12 天（不用 7 的倍数）；**只发给 SP1 没点链接且没退订的人**；**主题和主图必须换**（同内容重发打开从 44.4% 掉到 20.1%、点击掉到 0%，见 send-checklist 第 2 条）。
- 距出发 60 天（≈2027-01-24）之后"免费改期"的说法会变，**SP2 不得晚于这个日期之后再发含"免费改期"的句子**（见 SP2 备注）。

### SP1 · 新价格 + 一次讲清楚值什么

| 项 | 内容 |
|---|---|
| 目的 | 把"想去中国、又觉得贵/复杂"的人推到询价 |
| 主题 A | China from Auckland, flights and guide included: {{PRICE_FROM}} |
| 主题 B | Shanghai & Surroundings: 10 days, {{NEXT_DEPARTURE}} departure |
| 预览句 | Airfares, hotels, an English-speaking guide and entrance fees are in the price. |
| 唯一主 CTA | 按钮 "Check availability for {{NEXT_DEPARTURE}} →" → `{{ENQUIRY_URL}}`（utm_campaign=sh_sprint_202703, utm_content=sp1） |
| 含变量 | `{{FIRST_NAME}}` `{{PRICE_FROM}}` `{{PRICE_BASIS}}` `{{SINGLE_SUPP}}` `{{NEXT_DEPARTURE}}` `{{GROUP_SIZE_MAX}}`（`[P]`）`{{SEATS_NOTE}}` |

> Hi {{FIRST_NAME}}, [N]
>
> You've been in touch with CTS about China, so this one is for you: China Discovery — Shanghai & Surroundings, leaving Auckland on {{NEXT_DEPARTURE}}. [W]
>
> It's from {{PRICE_FROM}} {{PRICE_BASIS}}. That includes international and domestic airfares, seven nights in hotels (4- and 5-star standard, or similar), an English-speaking tour guide, entrance fees and 13 meals as listed in the itinerary. [W*]
>
> The route is a 10-day loop through the Yangtze Delta: Suzhou's gardens, Wuxi's lakeside sights, Hanfu photos and afternoon tea in Xinshi water town, West Lake in Hangzhou, then the Bund in Shanghai. [W]
>
> Group size is up to {{GROUP_SIZE_MAX}} travellers, a single room is an extra {{SINGLE_SUPP}}, and you can amend dates or travellers at no fee until 60 days before departure. [P / W*]
>
> {{SEATS_NOTE}} [仅在 CTS 书面确认余位时出现，否则整行删除]
>
> [ Check availability for {{NEXT_DEPARTURE}} → ]
>
> Baker
> CTS Tours [N]
>
> CTS Tours is Auckland-based, backed by CTS (China's travel brand since 1928), and has run China tours from New Zealand for 25 years. TAANZ member, IATA-accredited. [W]

### SP2 · 换角度：把行程里的几天讲具体（只发 SP1 未点击的人）

| 项 | 内容 |
|---|---|
| 目的 | 给 SP1 没点的人换一个入口：不再讲价格，讲"这 10 天里你会去哪" |
| 主题 A | Four places in ten days: Suzhou, Wuxi, Hangzhou, Shanghai |
| 主题 B | Three questions before you decide on {{NEXT_DEPARTURE}} |
| 预览句 | Where you'll stay, what's included and what to budget for. |
| 唯一主 CTA | 按钮 "See dates and availability →" → `{{ENQUIRY_URL}}`（utm_content=sp2） |
| 含变量 | `{{FIRST_NAME}}` `{{NEXT_DEPARTURE}}` `{{PRICE_FROM}}` `{{SINGLE_SUPP}}` `{{FREE_CHANGE_CUTOFF}}`（可选句）`{{SEATS_NOTE}}` |

> Hi {{FIRST_NAME}}, [N]
>
> Last time we talked about the price. This time, a closer look at the trip itself. [N]
>
> **Where you'll stay.** Seven nights across five hotels: Rosedale Chunshenhu Resort, Holiday Inn Express Wuxi, Holiday Inn, New Century Hotel Hangzhou and Holiday Inn Express Shanghai (or similar). [W]
>
> **What to budget for.** Travel insurance is strongly recommended and isn't included. Tips are suggested at NZD $10 per day per person, and only one dinner is included, so plan for your other evenings. [W]
>
> **What's flexible.** You can amend dates or travellers at no fee until 60 days before departure{{FREE_CHANGE_CUTOFF_CLAUSE}}. [W / 推算值：CTS 确认 60 天算法前，把 {{FREE_CHANGE_CUTOFF_CLAUSE}} 整段留空]
>
> **Visas.** The policy that applies on your departure date is the one that counts: https://www.ctstours.co.nz/china-visa-guide-for-new-zealanders [N]
>
> The next confirmed departure is {{NEXT_DEPARTURE}}, from {{PRICE_FROM}} {{PRICE_BASIS}}. [W / W*]
>
> {{SEATS_NOTE}} [仅在 CTS 书面确认余位时出现，否则整行删除]
>
> [ See dates and availability → ]
>
> Baker
> CTS Tours [N]

---

## 5. 序列总图

| 邮件 | 何时 | 谁收 | 唯一主 CTA | 含价格/日期？ |
|---|---|---|---|---|
| N1 欢迎+行程亮点 | Day 0 | `interest_shanghai` | 看完整行程（团页） | 价格 |
| N2 真实的一天 | Day 2 | 同上 | 看逐日行程（团页） | 否 |
| N3 常见顾虑 | Day 5 | 同上 | 看含项清单（团页） | 否（单人房补差） |
| N4 价格怎么构成 | Day 9 | 同上 | 查余位（团页询价表单） | 价格+下期出发日 |
| N5 升级路径 | Day 15 | 同上 | 比较各团（/tours/china） | 另两团价格+日期 |
| SP1 首期冲刺 1 | 改价上线后第一个工作日 | A+B+E 组（≈400，估） | 查 {{NEXT_DEPARTURE}} 余位 | 价格+出发日 |
| SP2 首期冲刺 2 | SP1 后 10–12 天 | SP1 未点击者 | 看日期与余位 | 价格+出发日 |

---

## 6. 发送前必过的闸门（缺一不发）

1. **改价已上线并验证**：PR #223 合并 + 线上团页真的显示新价（抓页面核对，不是看 PR 状态）。
2. **价格/日期/人数上限变量逐个对照官网当天页面**；`{{GROUP_SIZE_MAX}}` 官网当天没写这个数就整句删（不能只凭口头确认发出去）；`{{SEATS_NOTE}}` 没有 CTS 书面确认就整行删。
3. **每封至少一个官网团页链接**，每个链接 `curl -sL -o /dev/null -w "%{http_code}"` = 200；团名文字和配图各自成链接（`docs/sops/cts-newsletter-send-checklist.md` 第 1 条，分支 `claude/determined-dewdney-a724f5`）。
4. **收件人手工排除核对**：§4.2 清单逐项在 Mailchimp 预览页看规则，不信分群名字。
5. **进行中序列的价格对账**：官网每次改价后，对 N1/N4/N5 里的价格对一次。
6. **剥掉所有 `[W] [B] [N] [U]` 标记和所有 `{{…}}` 占位符**；预览页搜一次 `{{` 和 `[W`，命中即停。
7. **PM 本人同意发送**（A 类动作）。

---

## 7. 没验证的部分 / 风险 / 等 PM 决定

**没验证（如实）**
1. 每日 8:02 的 `auto_e1_batch` 是谁在跑、能不能排除 `interest_shanghai`：仓库里找不到运行代码（只在一个测试文件里出现过名字）。
2. 欢迎信是否已重复发送（自动流程 + 每日批次）。
3. Mailchimp 里"一处改价、处处生效"的具体做法（可复用内容块是复制还是链接）没验证。
4. 冲刺分群人数是**估算**：ME 库与 Mailchimp 的人数口径不同（824 vs 744）；Mailchimp 里没有"感兴趣的团"字段，无法直接实测各组人数。
5. `{{FREE_CHANGE_CUTOFF}}`（24 Jan 2027）是我从"出发前 60 天"推出来的，CTS 没确认过算法。
6. 回复邮件（"reply to this email"）的收件箱有没有人看，没核对 Mailchimp 的 reply-to 设置。
7. 团人数上限 20：只是转述的 PM 口头确认（官网正在补写），PM 本人没在本窗口说过；邮件只写 "group size up to 20" 这一句事实，已按 `[P]` 标记，发送前以官网为准，官网没写就删。
8. 同一人短时间内被多封营销邮件触达的上限，Mailchimp 能否用分群条件自动控制，没验证。
9. 签证：官网只写到 2026-12-31，2027 年是否延续**没查到**；所有邮件只写"以出发时政策为准"。

**风险**
- **参考价风险**：邮件里不要出现 "was NZD $3,399"、划线价或 "reduced from"。NZ 的公平交易法对"原价"有要求（原价是否真实、持续多久），这里没有 CTS 的证明，也不是法律意见；要写降价字样，先让 CTS 确认旧价真实挂过一段时间。
- **抢单风险**：升级目标团（Best of China 11 Mar、Tale 18 Mar）与上海团（25 Mar）出发期挨着，冲刺默认不发给 C 组（§4.1）。
- **旧经验**：9/29 W3 点击 7.3%，没链接的几封是 0%，**链接缺失比文案差更致命**；同内容重发会崩。
- **度量缺口**：系统不分团统计，N5 的"升级"现在量不出来（§3 N5 备注）。

**等 PM 决定**
1. 是否批准这份草稿（可改任何一封）。
2. 官网改价上线后，是否开始发送（发送需 PM 本人同意）。
3. 冲刺是否包含 C 组（Best of China / Tale 的人）：默认不含。

**本次没有做的事**：没发送、没排期、没在 Mailchimp 建草稿或标签或分群、没改名单、没花钱、没碰官网仓/广告账户/视频工厂。
