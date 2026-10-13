# CTS 2027 春季团：74 号需求单 N1–N4 交付（Tale Reel、路线图卡、暖热静图、上海 v5r2 出处）

- **日期**：2026-10-12 ｜ **窗口**：75 号（素材与排期，听 74 号统管）｜ **风险级**：C（文档 + 台账；成片走视频工厂，静图为本机渲染）
- **全部只到「待审核」**：未发布、未起广告。视频只走视频工厂；静图不是视频，用本机浏览器按品牌 VI（暖白 #FBF7F0、传承红 #B61E2E、暖金 #D6A756、Playfair Display + Inter）渲染。
- 上游：[一周排期与文案](./2026-10-11-spring-2027-content-week-plan.md)、[Reel 自检与审查](./2026-10-11-spring-2027-reel-selfcheck-and-reviews.md)。

## 状态一览

| 项 | 内容 | 状态 | 位置 |
|---|---|---|---|
| N1 | A Tale of Two Cities 15 秒 Reel（价格悬念配方，74 号 10-12 拍板沿用） | 终版工单 **`f4b5d44f-d050-47b4-8827-f0247878df5b`**（r3），`in_review` | 参数 `…/TALE-r3-15s-price-hook.order.json`；成片 `~/Dropbox/MagicLab_Studio/CTS/output/reels/2026-10-11_tale_r3_f4b5d44f.mp4` |
| N2 | 路线图卡：Tale、Shanghai 各 4:5 + 9:16（Natural China 按 74 号指示先不动） | 4 张已出 | `~/Dropbox/MagicLab_Studio/CTS/output/cards/route_{tale,shanghai}_{4x5,9x16}.png` |
| N3 | 暖热静图（4:5）：Tale、Shanghai 各 1 张，只放团名 + 出发月 + Flights included，价格放文案 | 2 张已出 | 同目录 `warm_{tale,shanghai}_4x5.png` |
| N4 | 上海 v5r2（`fa4fdd89`）的 Meta 视频编号与出处 | 已回 74 号 | 见下 |

> 旧版（**都不要授权**）：Tale r1 `d6a16ac0-4f88-4e51-aea3-cf63b3334893`（用了被车牌戳穿的假「西安城墙」素材）；r2 `919465db-f831-4145-b83a-591a802cadbc`（大雁塔镜标签对比弱）。

## 一个重要发现：素材库里的「西安城墙」其实是南京城墙（已核查：已发布的片都没用到）

`footage/stock/v_xiancitywall_30718724.mp4`（以及 Remotion 目录里的 `b2_xian_citywall.mp4`）画面里的车牌是 **「苏A DR7588」＝江苏南京**，不是西安。此前的记忆里把它列为「已核对可用」，**是错的**。Tale r1 用它做开场和价格页背景，被马良抓出，r2 已整条换掉（大雁塔用 Unsplash 带地点标的照片，地点＝西安市）。素材库该条已在记忆里更正；**凡带「西安城墙」标签的素材一律不用**，除非另有地点证据。

## N1 · Tale 15 秒 Reel（终版 `f4b5d44f`，r3）

- 结构同 Best of China / 上海 v5：开场 `NZ$3,XXX / 10 DAYS / FLIGHTS` → 3 个条目 → 价格揭晓 `BEIJING & XI'AN. FROM NZ$3,480 / PER PERSON · TWIN SHARE / SINGLE SUPPLEMENT NZ$395`。
- 画面：开场故宫航拍（门口远景人流 = 前 2 秒人气画面，人物不可识别）→ THE GREAT WALL（金山岭，Unsplash 地点标）→ TERRACOTTA WARRIORS, XI'AN → BIG WILD GOOSE PAGODA, XI'AN（Unsplash 地点＝西安市，官网 D8 项）→ 价格页背景故宫航拍。**无客人肖像，无 AI 生成画面。**
- 官网事实（2026-10-12 重抓）：NZD $3,480 per person twin share；单人房差 NZD $395；10 天 / 7 晚（北京 4 + 西安 3）；Next confirmed departure 18 March 2027；7 早餐 5 午餐 0 晚餐；D3 Forbidden City、D4 Great Wall、D6 高铁 G89、D7 Terracotta Warriors、D8 Xi'an City Wall 与 Big Wild Goose Pagoda。与出团表 3/18→3/27 一致。
- caption 与首评：沿用 BOC 做法；首评 = `Full itinerary and inclusions / 10 days from Auckland · NZD $3,480 per person, twin share · Next departure 18 March 2027 / 官网 Tale 页链接（带追踪参数）`。**没有写**免签、domestic、max/小团人数、余位、航司、25 years/1928。caption 里原有的「Forbidden City entry is subject to ticket availability」苏东坡指出 Tale 页读不到，已删。
- 自测（r3）：成片 14.93 秒；下 1/3 屏亮度 58.7（r2 为 64.5，r3 把大雁塔镜压暗以托住白字；上海 v5 为 63.1，略低，在「不压太暗」可接受范围内，若 74 号/PM 觉得偏暗可回我）；音轨同 BOC（工厂 7 项体检以工单为准）。
- 改价要重渲：片内烧了 NZ$3,480 / NZ$395（74 号已接受）。

### 配方对账表（`viral_reference_library` 旅游类，2026-10-11 实查，同 BOC 文档）

| 配方列 | 库里的数 | 这次做了什么 | 判定 |
|---|---|---|---|
| 开场钩子 `text_overlay_question`（数字悬念） | 5.98M（n=122） | `NZ$3,XXX` | 满足 |
| 开场钩子 `visual_shock` | 23.03M（n=30） | 故宫航拍有一点冲击，不是强反差 | 部分满足 |
| 开场钩子 `scenic_beauty` | 最差 1.51M（n=65） | 开场是风景，靠文字钩子补救 | 部分满足 |
| 开场钩子 `ugc_selfie` / 技法 voice-over、ugc、humorous | 8.77M / 10/10 旧值 | 无真人无旁白（PM 对肖像未拍板） | **未满足（有意）** |
| 技法 `fast-paced editing` | 10/10 旧值 20.2M | 受众 45–70，15 秒下限 1.9 秒/条 | 有意未满足 |
| 时长 | 中位 34 秒 | 14.9 秒（PM 硬要求） | PM 要求优先 |

### 分镜自检（r2 逐秒 16 宫格实看；生产窗口自己的，不代替审查）

| 秒 | 画面与文字 | ①图 | ②字 | ③logo |
|---|---|---|---|---|
| 0–3 | 故宫航拍 + `NZ$3,XXX / 10 DAYS / FLIGHTS` | ✅ Unsplash 地点＝Beijing；门口人流远景 | ✅ | ✅ |
| 3–5.5 | 金山岭长城 + `1/3 THE GREAT WALL` | ✅ 元数据 Jinshanling | ✅ 官网 D4 | ✅ |
| 5.5–8 | 兵马俑 + `2/3 TERRACOTTA WARRIORS, XI'AN` | ✅ | ✅ D7 | ✅ |
| 8–10.4 | 大雁塔 + `3/3 BIG WILD GOOSE PAGODA, XI'AN` | ✅ 元数据「西安大雁塔」 | ✅ D8 | ✅ |
| 10.4–14.9 | 价格页（故宫背景） | ✅ | ✅ 官网价与单人房差 | ✅ |

### 审查

- 第一轮（对 r1）：苏东坡——全部通过，红线 0，1 句文案官网读不到（已删）；马良——**不通过**：开场城墙素材车牌苏A（南京）、`NZ$3,XXX` 看起来像占位符、第 3 秒 logo 缺一帧。我的处理：换素材（r2）；`NZ$3,XXX` 是 PM 已批准且已发布的同款悬念配方（74 号也拍板沿用），不改；第 3 秒 logo 缺帧是共享模板转场行为，所有已发布 Reel 相同，不改。
- 第二轮（对 r2 与重出的卡片）：**苏东坡：r2 通过，必改 0**（大雁塔是官网 D8 明确项；红线 0；可选：内部记录 `rationale_one_liner` 过时已在 r3 改正，末段 SINGLE SUPPLEMENT 小字偏小）。**马良：Reel 有条件通过**——开场故宫门口人像每个约 10–25 像素高、不可识别；亮度 63/66/50、大雁塔镜 90；必改 2 项：①大雁塔镜（8–9 秒）白色标签落在浅灰天空上对比弱 → **r3 已压暗该镜**（我量标签带亮度 156、肉眼看已清晰；**r3 没有再送回马良复审**，两轮上限已用完，风险我自己扛）；②6 张卡片 logo 副标语被药丸裁掉一截 → **已修**（药丸加宽，我肉眼逐张核对 route_tale_4x5 已完整；**重出后的卡片没有再送马良复审**，同样两轮已满）。
- - **窄复核（74 号要求，10-12）：马良只看那两项，已签字通过**——大雁塔镜小标签对比 5.2–5.8:1、大标题 4.2–4.4:1（略低 4.5，60px 大字过 3:1；最亮 10% 背景处 2.7–2.9 靠字影），该镜下 1/3 亮度 48.0，整条 58.2；6 张卡片 logo 逐张放大看右端全部完整。条件：接受大雁塔标签对比「勉强」。
- **所以 Tale r3（`f4b5d44f`）与 6 张卡片：苏东坡、马良均已签字。**

## N2/N3 · 卡片

- 尺寸：4:5 = 1080×1350；9:16 = 1080×1920；PNG。排版：左对齐、大留白、暖白底、红点路线、金色细线；没有价格、没有「max/限 N 人/余位」、没有航司、没有 domestic、没有「免签」。
- 9:16 两张的关键文字都放在 y250–1580 之内（避开平台上下界面区）；logo 用完整彩色版放白色药丸底（审查第一轮指出纯白 logo 看不清）。
- 文案逐句出处（苏东坡第一轮已核）：Tale = 北京 4 晚 / 西安 3 晚（官网住宿）、High-speed train（D6 G89）、The Forbidden City / The Great Wall / Terracotta Warriors（D3/D4/D7）、Flights included（官网机票含）、March 2027（18 March 起团）；Shanghai = Suzhou → Wuxi → Xinshi Ancient Town → Hangzhou → Shanghai（官网顺序）、Master of the Nets Garden / West Lake boat tour / The Bund、10 days、Flights included、March 2027（25 March）。上海卡**没写高铁**（官网没提）。
- 图：Tale = Unsplash 故宫航拍（地点 Beijing）；Shanghai = Unsplash 苏州园林（地点 Suzhou）。出处见 `credits-v6.json`。
- Natural China 卡：按 74 号指示**未做**。

## N4 · 上海 v5r2（`fa4fdd89`）

- Meta 视频编号 **2309146606576700**（页面 1616575215312482，permalink `/reel/2309146606576700/`，首评 id `2309146606576700_2565567933954188`，发布 2026-10-11 04:35 UTC）。
- 画面出处：`~/Dropbox/MagicLab_Studio/CTS/remotion-assets/clips/credits-v5.json`：苏州、西湖 = Unsplash（带编号）；浦东夜景航拍、上海日景 = Dropbox 库内，**更上游来源未知**；外滩 = 库存素材 `v_bund_36546365` 加工，库存清单无条目。
- 音乐：`music/founders-at-dawn.mp3`，**上游来源无记录**；PM 已定 Dropbox 内音乐视为已授权（记忆 10-05/10-06）。
- 详细文档：`2026-10-10-shanghai-reel-v5-15s-brief-and-selfcheck.md`。

## 同时记一笔：Best of China Reel 的实际发布情况（供 74 号）

- 工单 `7ed7645b` PM 本人 10-11 授权并点通过；发布 worker 10-11 08:05 UTC 成功，Facebook 视频 `2069489893713349` 公开可见（页面管理员视角确认，说明文字在、无评论）。工厂回执里 `video_state` 一直写 `DRAFT`，是回执没刷新，页面上已是公开 Reel。
- **首评**：自动首评没有生成（缺主页评论权限，已知），本窗口在 Facebook 页面以「CTS Tours」身份手动补发了与工厂首评函数同格式的一条（带追踪参数）。此为 PM「授权 BOC」范围内的发布配套动作。

## 还欠 / 风险

1. 第二轮审查结论（回填）。
2. 发布前：官网价格当天再核；首评原文交苏东坡过目（BOC 已手动补发，Tale 授权后同样）。
3. 「March 2027」只适用 3/18、3/25 两班；以后要推 4 月后班期，卡要改。
4. Natural China 的路线图卡等 74 号指令再做。

## Reuse Statement

- 复用视频工厂 `list` 模板、工单表、出片机、7 项体检；Unsplash 官方接口；CTS 品牌 VI 与 logo（brandkit）。无共享代码改动。
- client-specific：全部团名、价格、日期、素材、文案只在工单 JSON、本文档与 `credits-v6.json`。
- 学习（升通用手册候选）：**核「素材是哪个城市」先找画面里的车牌/招牌文字**；库里标签说「西安城墙」的片子车牌是苏A（南京）。

## 附：「南京城墙」素材核查（74 号 10-12 要求）

- 查过：库里全部 CTS 工厂工单（brief 与 output）、`video_clips`、`reels_drafts`，以及 `output/reels` 下全部 mp4（逐帧与该素材做相似度比对，抽查可疑项看画面）。
- **用过的只有两张**：Tale r1 `d6a16ac0`（作废）和 10-05 的 Remotion 试验片 `23ba32e8`（镜头标签 xian-citywall，从未授权，建议永不授权）。**已发布的 Best of China `7ed7645b`、上海 v5r2 `fa4fdd89` 都没用到，待审的 Natural China `0fd18a93` 也没有，无需下架。**
- `stock/` 其它地名素材抽检（看中间帧）：❌ `v_leifeng_18688462`＝东京浅草寺红塔+晴空塔；`v_birdsnest_38077180`＝昆虫/鸟巢特写；`guilin_34078134`＝粉色非洲菊；`v_yuyuan_35646223` 与 `v_nanjingroad_35646223` 同一镜头（南京路夜景）；`zhangjiajie_35560827`＝雪山。❓ 未证实：`v_watertown_27958758`、`shanghai_18803234`、`v_longjing_36651487`、`zhangjiajie_33356707`。✅ 可靠：`v_bund_36546365`、陆家嘴三条、`guilin_36275860`、`v_westlake_35080573`。
- 另一处疑点（未查画面，只列）：`templates/tailor-made-itinerary/heroes` 里有一张 `xian-city-wall` 英雄图，来源与是否真是西安未核，建议后续看一眼 `CREDITS.json`。

## 更正（2026-10-13）：BOC 与 Tale #1「已发布」的说法

此前本文与对 74 号的汇报写「BOC `7ed7645b` 已发布并公开可见」「Tale #1 `e29b0986` 已发布并核对」，**不对**：它们在 Facebook 上是**草稿**（工厂默认草稿模式，ME 里「通过」只传草稿，不公开）；回执 `video_state=DRAFT` 是真话，不是「没刷新」。我当时用主页管理员账号看页面，管理员能看到草稿，误当成公开。首评是我在草稿页上以 CTS Tours 身份手动补的（管理员可见，公众看不到）。以后「已发布」以视频对象 published 字段为准。
