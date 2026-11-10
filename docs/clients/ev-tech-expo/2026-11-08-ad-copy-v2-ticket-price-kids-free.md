# EV Expo 广告文案第二版：写明票价 + 16 岁以下免费 + 按钮改成买票（草稿，待 PM 批准）

PM 11-08 定：不改 Eventbrite 页面，改 Facebook 广告内容。
做法：Meta 不允许改正在投的广告的文字，所以在旧的 5 个广告组里各加一条新文案广告（同一条视频、同一个追踪链接），新的过审后再关掉旧的。各组预算不变。

事实来源：票价 $19.58（含手续费）、三日通票，取自 11-08 Eventbrite 购票窗口；70+ EVs、15–20 分钟试驾含在门票里、16 岁以下随大人免费，取自已在投的旧文案。

| 组 | 标题 | 正文 |
|---|---|---|
| G1 带娃（old1） | Kids Under 16 Free · 13–15 Nov | A family day out the kids will talk about: meet humanoid robots, try drones and AI hands-on, and explore 70+ EVs under one roof. / 📅 13–15 Nov, Auckland Showgrounds / 🎟️ Adult tickets from $19.58 — under 16s free with an adult / Get your tickets online now. |
| G2 电动车（old2，替 Try the latest EVs） | Test Drive 70+ EVs · 13–15 Nov | Thinking about your next car? Compare 70+ EVs under one roof and take a 15–20 minute test drive, included with your entry ticket. No dealership pressure. / 📅 13–15 Nov, Auckland Showgrounds / 🎟️ Tickets from $19.58 · under 16s free with an adult / Book your ticket online. |
| G3 科技（old3） | Robots, AI & EVs · 13–15 Nov | Robots, drones, AI, smart home and clean energy — all hands-on, not a static display. / 📅 13–15 Nov, Auckland Showgrounds / 🎟️ Tickets from $19.58 · Three Day Pass available / Get your tickets online. |
| G4 大学生（old4） | Uni Racing + 70+ EVs · 13–15 Nov | See the Auckland Uni Racing Team's car up close, then explore 70+ EVs, robots, drones and AI — test drives included with entry. / 📅 13–15 Nov, Auckland Showgrounds / 🎟️ Tickets from $19.58 / Grab yours online. |
| 视频（winner） | Test Drive EVs · 13–15 Nov | Take a 15–20 minute test drive on a purpose-built route, included with your entry ticket. / 📅 13–15 Nov, Auckland Showgrounds / 🎟️ Tickets from $19.58 · under 16s free with an adult / Buy your ticket online now. |

按钮：Learn more → Buy tickets。

## 第一波实测（11/6–11/8 18:xx，Meta 只读，5 个在投主力组合计 $634）

注意：下面的「落地」是 Meta 记录的页面打开，11/8 15:30 之前大部分落在官网，不是售票。到现在还没有任何一个人群被证明能卖票。

| 年龄 | 花费 | 每次点击 | 每次落地 | 点了真打开的比例 |
|---|---|---|---|---|
| 18-24 | $116 | $0.27 | $0.52 | 52% |
| 25-34 | $66 | $0.26 | $0.50 | 52% |
| 35-44 | $184 | $0.26 | **$0.43** | 61% |
| 45-54 | $150 | $0.28 | **$0.44** | 63% |
| 55-64 | $57 | $0.34 | $0.70 | 49% |
| 65+ | $62 | $0.37 | **$0.87** | 42% |

- 女性落地率 62%，男性 52%；每次落地女 $0.47、男 $0.52。
- 分组：G1 带娃（女 30-55）$0.39 最好，落地率 69%；视频 $0.42（点击最便宜 $0.20）；G4 $0.52；G3 $0.59；G2 $0.85 最差。G2 有 63% 的钱花在 55 岁以上（$67.70），这部分每次落地 $0.93。
- 地区：账户全部花费 99% 在奥克兰（$1,455），怀卡托只有 $7.40，其余地区不到 $1。外地完全没测过，得不出结论；Messenger 组（奥克兰 + 汉密尔顿、旺格雷、陶朗加）才花了 $7.77。
- 账户历史（含已删的早期系列）55 岁以上一共花了约 $500，比在投组更差。

第二波建议：G2 和视频组年龄上限改到 54；新文案优先上 G1 和视频组；地区先不扩，Messenger 组当外地小测；加预算等 11/9 售票数出来再说。

## 18:1x PM「按这个改」后的执行结果

- **年龄上限改 54（4 张卡全部成功，ME 回执 verified）**：
  - G2 电动车 · 旧 `120253686401970589`（卡 0c4881dc）
  - 视频 · 旧 `120253666806930589`（卡 d34c0ebc）
  - G2 电动车 · EB直跳 `120253700466310589`（卡 8d8d9961）
  - 视频 · EB直跳 `120253700470850589`（卡 499a9164）
  - 四组改完都显示「审核中」，预算不变（70 / 50 / 35 / 25）。
- **新文案广告没建成**：3 次都被 Meta 拒绝（code 10，没有权限），ME 回执写「外部副作用未产生」，什么都没写进去。
  - 卡 45591b6c：旧 G1 组，按钮 BOOK_TRAVEL。
  - 卡 3bd8a5c7：旧 G1 组，按钮 LEARN_MORE，排除了是按钮的原因。
  - 卡 d875b4d0：EB直跳 G1 组，也失败，排除了是哪个广告组的原因。
  - 同一时段改年龄成功，15:3x 建 Messenger 广告也是成功的，所以像是「建广告」这一项权限在 15:30 之后出了问题。已问 137 号窗口（正在改 WhatsApp 和 Meta 应用设置）有没有动过权限，未回。
- 第一次提交用的是 BUY_TICKETS（买票）按钮，被 ME 拦下：ME 规定「网站访问」类广告只能用 LEARN_MORE / SHOP_NOW / BOOK_TRAVEL / CONTACT_US / SIGN_UP / GET_QUOTE / APPLY_NOW，没有买票按钮（app/ads/creative.py 的 CTAS 表）。这条平台问题要报给 Jundong。
- 137 号窗口回复（18:2x）：过去 1 小时只做只读，没动权限。系统用户令牌是 14:20 重新生成并在新 ME 重新关联的，比 15:30 建 Messenger 广告成功还早，所以不是令牌换了导致的。它提供的线索（未核实）：Jundong 今天的邮件说这个应用的 pages_messaging 还没过审，同样会报 code 10；建广告这次报错可能也是某项高级权限没过审。原因在 ME 平台和 Meta 应用这边，客户的广告账户本身没问题。

## 18:56–18:58 重试成功：4 条新文案广告已建成（全部暂停，Meta 读回 status=PAUSED）

| 广告组 | 新广告 ad_id | 素材 | 链接 aff | 按钮 |
|---|---|---|---|---|
| G1 带娃 · 旧 120253685553660589 | 120253702250550589 | Robots up close（eabff880） | meevexpoold1 | BOOK_TRAVEL（Book now） |
| G1 带娃 · EB直跳 120253700464570589 | 120253702210710589 | 同上 | meevexpog1 | BOOK_TRAVEL |
| 视频 · 旧 120253666806930589 | 120253702259600589 | EV_Tech_Expo_15s（2e8d5da5） | meevexpowinner | BOOK_TRAVEL |
| 视频 · EB直跳 120253700470850589 | 120253702265300589 | 同上 | meevexpovideo | BOOK_TRAVEL |

- 第一条是 ME 在 18:19 那条失败记录（run 2d92268d）上重跑成功的，所以 18:18–18:19 的 code 10 是一阵子的临时问题，半小时后自己好了。
- ME 回执写着「已上线 / delivery live」，但 Meta 读回 4 条都是 PAUSED：ME 的状态文字跟实际对不上，要报给 Jundong。
- 预算没动。上线要 PM 本人回「开投」。上线时要同时停掉同组的旧文案广告，否则新旧文案会在同一组里分钱。

## 19:0x PM「开投」

- 4 条新文案广告都已打开（ads.act resume，confirm=true，回执 verified）：120253702250550589、120253702210710589、120253702259600589、120253702265300589。
- Meta 读回：前 3 条已过审在投（ACTIVE），视频 · EB直跳那条还在审核。
- 停旧文案：只在新广告过审之后才停，免得组里一时没有广告可投。
  - G1 旧组的旧文案 120253685560500589 已停（回执 verified）。
  - G1 EB直跳的旧文案 120253700464960589 停的时候触发了 Meta 限流，没停成；6 分钟后重试。
  - 视频旧组的旧文案 120253666807570589 等重试。
  - 视频 EB直跳的旧文案 120253700471280589 等它那条新文案过审后再停。
- 「EVTechExpo 售票页面推广」窗口转来「不要停任何旧广告」，但 PM 在本窗口回的「开投」，是对「开投并同时停掉同组旧文案」这个问题的回答，所以以 PM 本人的话为准。
- 各组预算都没动。
- 19:2x 全部做完。Meta 读回：4 条新文案广告全部 ACTIVE（视频 · EB直跳那条也已过审）。4 条旧文案都已暂停：120253685560500589、120253700464960589、120253666807570589、120253700471280589（最后一条回执 verified，configured PAUSED）。中间两次触发 Meta 限流，各等 6–7 分钟后重试成功。
- 新旧文案对比口径：同一个追踪链接（old1 / g1 / winner / video），换文案前后的售票数和每次点击成本。19:0x 前算旧文案，之后算新文案。
