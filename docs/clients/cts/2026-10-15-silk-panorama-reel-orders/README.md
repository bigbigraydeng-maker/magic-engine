# Silk Road + China Panorama Reel 工单与配方对账表（草稿，未建工单）

> 106 号 · 2026-10-15 · 只出片到 in_review，不发布、不起广告。工单 JSON 已备好并通过出片机的参数校验（两条都「schema OK」）；**还没向线上提交**。
> 配方库数值沿用 75 号 10/11 对 `viral_reference_library` 旅游类的实查（见 `2026-10-14-silk-road-reel-requirements.md`），今天没有重查。

## 一、官网核对（2026-10-15 抓取）

| 团 | 页面 | 天数 | 价格（NZD，双人间每人） | 单人房差 | 班期 |
|---|---|---|---|---|---|
| Silk Road | /tours/china/signature/silk-road | 18 天 / 15 晚 | 7,999 | 1,488 | 13–30 May、21 Oct–7 Nov；出发表 5/29，差一天 → **片内与文案都不写日期** |
| China Panorama | /tours/china/signature/grand-tour | 27 天 / 24 晚 | From 10,899 | 2,555 | 8 May–3 Jun、16 Oct–11 Nov，与出发表一致（仍不写日期，免与未核对的页面冲突） |

## 二、配方对账表（两条共用）

| 配方列 | 库里的数 | 这次做了什么 | 判定 |
|---|---|---|---|
| 开场钩子 text_overlay_question / 数字 | 5.98M | 第 0 秒大字「18 DAYS」/「27 DAYS」+路线，无价格 | 满足 |
| 开场钩子 scenic_beauty（空镜） | 最差 1.51M | 开场是风景画面，靠文字钩子补救 | 部分满足 |
| ugc_selfie / 旁白 / 幽默 | 8.77M / 14.9M / 53.0M | 无真人、无旁白、不幽默 | 未满足（有意；要换素材形态才行） |
| 技法 text-overlay | 50.0M | 每镜短句大字（≤9 字符一行） | 满足 |
| 技法 fast-paced | 20.2M | 受众 45–70 岁：每条目约 2.9 秒，不快闪，无白闪 | 有意未满足 |
| 风格 authentic / 真实感 | 9.3M | 真实摄影（Unsplash 真景点 / CTS 既有片段），非 CTS 团友实拍 | 部分满足 |
| 总时长 | 中位 34 秒 | 约 15 秒（PM 硬要求） | PM 要求优先 |
| logo | 低分特征 | 全程常驻（PM 10/06） | 已知未满足 |
| 封面 | — | 工厂不支持指定封面，第 0 帧即封面：单一干净画面，仅开场大字 | 要做到，渲出后核对 |
| **无截止/限时/早鸟/倒计时**（PM 10/14 新增） | — | 画面字、文案、首评均无；无日期，无「next departure」 | **满足** |
| 价格 | — | 模板必须有价格页；用官网真实价（非占位），带单人房差脚注 | 与 75 号需求单「不写价格」不同——模板不能省价格页，请 105/74 确认可接受 |
| 官网可溯 | — | 景点、天数、价格、含项均出自官网行程页 | 满足 |

## 三、素材来源（每张记来源、许可、地点）

| 用在 | 文件 | 来源 | 许可 | 拍摄地点 | 画面核对 |
|---|---|---|---|---|---|
| Silk 钩子 | s1_zhangye_danxia.mp4 | Unsplash 7YJQFxwyV7I，Yisong Dong | Unsplash License | 甘肃张掖肃南，丹霞地貌 | 彩色条纹山谷+盘山路，与官网「Zhangye」一致 |
| Silk 条目 3 | s1b_zhangye_ridges.mp4 | 同一张图的左侧局部（不含公交车） | 同上 | 同上 | **与钩子是同一张照片的不同构图**，已知限制，请审片判断是否可接受 |
| Silk 条目 1 + 价格页背景 | s2_jiayuguan.mp4 | Unsplash z8wG-UUzBJk，飞凌鱼京 | Unsplash License | 嘉峪关关城 | 匾额「嘉峪关」可见，确认 |
| Silk 条目 2 | c1b_terracotta.mp4（既有） | Unsplash ZZV1FOGaQ8s | Unsplash License | 西安（官网 Silk Road 第 3 天） | 兵马俑，确认 |
| Panorama | 既有片段：长城（金山岭）、故宫航拍、成都熊猫、西湖亭、外滩夜景 | 见 `credits-v6.json` | Unsplash/Pexels | 官网 Panorama 行程均含 | 长城片段是金山岭而官网写居庸关，只标「THE GREAT WALL」未写关名 |

不冒充 CTS 团友实拍，不当作客户真实价格/产品画面。片段文件在 Dropbox `CTS/remotion-assets/clips/`，来源登记在 `credits-v7.json`。

## 四、提交前还缺

1. 105/74 确认：Silk 片带真实价格可以（模板必须有价格页）。
2. 提交（建工单）等你们放行；建完读回 7 项自动体检，质量标记逐条解释（口吻标记按 105 口径，由苏东坡/马良按「无旁白·误报」处理）。
3. 成片渲出后：9 宫格分镜自检表（图/文字/logo）我先自检，再交苏东坡（事实+值不值得发）与马良（画面+首帧不撞+有声音）。

## 五、Silk Road 已出片（工单 f236c2e3，in_review，2026-10-15 自检）

费用：工单上限 0.5 美元，实际 0（现成片段/照片，本机 Remotion 渲染，未调付费生成接口）。成片 1080×1920、14.9 秒、有声音（-22.1 LUFS）。9 宫格自检图：`f236c2e3-self-check-grid.jpg`（自检看的是上传到存储桶的那份成片）。

| 项 | 结果 |
|---|---|
| 图对不对 | 丹霞（张掖）、嘉峪关（匾额可见）、兵马俑（西安）均与官网 Silk Road 行程地点一致；无糊脸糊字 |
| 文字对不对 | 「18 DAYS / XI'AN TO / URUMQI」「THE SILK ROAD.」「NZ$7,999 · 单人房差 NZ$1,488」与官网一致；无日期；无截止/限时/早鸟/倒计时字样 |
| logo | 全程常驻左上，完整清晰 |
| 安全区 | 钩子与价格都在 y 270–1248 内 |
| 已知问题 ① | 条目 1「JIAYUGUAN PASS」白字压在浅色天空/屋顶上，对比度偏弱；条目 2 兵马俑标题淡入时也偏淡 |
| 已知问题 ② | 嘉峪关画面出现两次（条目 1 + 价格页背景）；丹霞出现两次（钩子 + 条目 3，同图不同构图） |
| 质检标记 | `narrator_voice_mismatch`（无旁白片误报，已与 105 对口径）；**另有 `placeholder_caption`**（「YOUR 18 DAYS 1/3…」每个条目重复拼接的标签被判成内部标签），Tale/Best of China 同结构那几条没被标，属 AI 打分波动；审片时请按「标签重复」看是否需要换 itemLabel |

## 六、Silk Road 最小修法方案（只改参数，仍走工厂建新单，不写脚本；还没做）

| 问题 | 最小修法 | 为什么够 / 局限 |
|---|---|---|
| 白字压浅天空（嘉峪关标题、兵马俑淡入） | 新单把 `itemOverlayOpacity` 从 0.08 调到约 0.22（允许 0–0.6，纯参数，不动模板）；底部渐变 `footageScrim` 管的是画面下部，标题在上部，调它没用 | 整体压暗条目画面，白字对比度上升；代价是照片变暗一点。调完要再渲一版给审片的人比较 |
| 嘉峪关出现两次（条目 1 + 价格页背景） | 价格页背景换成已有的丹霞钩子片段 `s1_zhangye_danxia.mp4`？会变成丹霞三次，更糟。**真正的修法是拿到敦煌/吐鲁番/乌鲁木齐的新原图**（已在 74 的素材需求单上） | 素材只有 3 个不同场景，模板要 钩子+3 条目+价格背景=5 个槽位，重复不可避免；这版先接受 |
| 丹霞出现两次（钩子 + 条目 3 局部） | 同上，等新图 | 同上 |
| 「标签重复」标记 | 已知 AI 打分波动；审片的人若不接受，再换 `itemLabel`（做法见社媒手册第二十二节，本机多次打分选最低） | 不先改，避免无谓返工 |

方案得到批准后，我会建一张新单（旧单 f236c2e3 保留作对照），不发布。

## 七、请审什么（交苏东坡 / 马良；PM 在 /dashboard/factory 看到后指派）

**苏东坡（事实 + 值不值得发）**
1. 18 天、NZ$7,999、单人房差 1,488 与官网 silk-road 页是否一致；片内无日期是否可接受（官网页与出发表差一天）。
2. 景点是否都在官网行程里（嘉峪关、张掖丹霞、西安兵马俑）。
3. 无「截止/限时/早鸟/倒计时」字样（含画面内文字）。
4. 带真实价格是否可接受（75 号需求单原写「不写价格」，模板必须有价格页）。
5. 值不值得发：3 个场景、其中 2 个重复出现，信息量够不够。

**马良（画面 + 首帧 + 声音）**
1. 嘉峪关、兵马俑标题对比度是否够读（中老年观众）。
2. 第 0 帧（封面）是否干净、与本周其他内容首帧不撞。
3. 丹霞钩子 / 丹霞条目 3 是否看着像同一张图。
4. logo 是否完整清晰；字是否都在安全区（y 270–1248）。
5. 有声音（已测 -22.1 LUFS）、音乐是否合适。

两个人各审一轮，最多两轮；生产方（106）不自己点「接受」。

## 八、China Panorama 已出片（工单 1810e044，in_review，2026-10-15 自检）

费用：实际 0（现成片段，本机渲染）。成片 1080×1920、14.9 秒、有声音；自动体检 7 项全 PASS。9 宫格图：`1810e044-self-check-grid.jpg`（看的是上传到存储桶的成片）。

| 项 | 结果 |
|---|---|
| 图对不对 | 长城、故宫、成都熊猫、西湖亭、浦东夜景均在官网 Panorama 行程内；无糊脸糊字；长城片段是金山岭，片内只写「钩子大字」不写关名（官网写居庸关） |
| 文字对不对 | 「27 DAYS BEIJING SHANGHAI」「CHINA PANORAMA.」「NZ$10,899 · 单人房差 NZ$2,555」与官网一致；无日期；无截止/限时/早鸟/倒计时字样 |
| logo / 安全区 | logo 全程完整；钩子与价格在 y 270–1248 内 |
| 已知问题 | ①钩子「BEIJING / SHANGHAI」之间没有「TO」，读起来像两个城市而不是一条路线（钩子每行最多 9 个字符，放不下）；②熊猫标题淡入时偏淡；③长城画面本周也被 Best of China/Tale 用过，同周别排在一起 |
| 质检标记 | `placeholder_caption`（标签重复，同 Silk Road）+ `narrator_voice_mismatch`（无旁白误报） |

审什么：苏东坡看价格/天数/景点与官网、钩子读法；马良看熊猫标题对比度、第 0 帧是否与本周其他内容撞、长城与 Best of China 同周是否重复。

## 九、Silk Road v2（工单 466d4eb7，in_review，压暗版）与 v1（f236c2e3）对比

只改了 `itemOverlayOpacity` 0.08→0.22，素材、文案、音乐不变；花费 0；14.9 秒，有声音，自动体检 7 项 PASS，质检标记同 v1（标签重复 + 口吻误报）。对比图：`silk-v1-vs-v2-contrast.jpg`（左两格 v1，右两格 v2，取标题区同一时间点）。

量出来的结果（标题区域平均亮度，越低白字越清楚）：嘉峪关标题 121→110、兵马俑标题 161→147，大约降低 10%。**肉眼看改善有限**：嘉峪关白字仍压在浅色天空上，只是稍微好一点。如果审片的人觉得还不够，下一步是加到约 0.35 或给标题加深色底条（后者需改模板，不是参数）；这个由马良判定，不自行再试。

## 十、A 版重做（PM 反馈「两条风格雷同、BGM 一样」；18 号 2026-10-15 定 A+B）

| | Silk Road A（工单 559e801c） | Panorama A（工单 75d0ac9b） |
|---|---|---|
| 状态 | in_review，花费 0，14.9 秒，有声音，体检 7 项 PASS | 同 |
| 开场钩子 | 文案型「STEP ONTO THE SILK ROAD」，叠在兵马俑上 | 文案型「THE GRAND TOUR OF CHINA」，叠在重庆洪崖洞夜景上 |
| BGM | 远方的路（road-afar，低能量抒情，CTS 此前没用过） | 轻松旅行（feel-good-travel，81 BPM，CTS 此前没用过） |
| 条目 | 嘉峪关 → 张掖丹霞 → 甘肃彩丘；标签「ON THE ROUTE」 | 熊猫 → 故宫 → 西湖；标签「ON THE ITINERARY」；不再用长城 |
| 压暗 | 0.22 | 0.08 |
| 质检标记 | 只剩 `narrator_voice_mismatch`（无旁白误报；「标签重复」已消失） | 同 |
| 自检图 | `559e801c-self-check-grid.jpg` | `75d0ac9b-self-check-grid.jpg` |

**诚实的局限**：版式仍是同一个 `list` 模板（「N/N」、对勾方块、进度条都在），肉眼看「骨架一样、内容不同」；BGM 是新曲但没做节拍对齐（目录里状态 beats_unverified，剪点与拍线不一定对上）。要真正不一样，要等 B（`postcard` 模板，设计稿 `docs/specs/2026-10-15-remotion-postcard-template-design.md` v2，待第二轮复核）。
简报里「第一人称 Baker Gu」按「做不到」处理：无旁白、不替真人编亲身经历，已写进工单备注。

## 十一、A2 版（苏东坡/马良复审后改）：Silk 41f64daa · Panorama 5ed4f3bc

两条均 in_review，花费 0，19.7 秒，有声音，体检 7 项 PASS，质检标记只剩 `narrator_voice_mismatch`（无旁白误报，已写进工单备注）。自检图：`41f64daa-self-check-grid.jpg`、`5ed4f3bc-self-check-grid.jpg`。

| 复审意见 | 结果 |
|---|---|
| 1 第 0 帧钩子半句 | **改不了**（旧清单模板的钩子是逐行弹出动画，写死）；发布时手选 ≈1.5 秒帧当封面。新 `postcard` 模板（PR 2672）钩子从第 0 帧完整显示 |
| 2 价格页细字 | 压暗强度 0.35→0.8；Silk 价格页背景换成丹霞纹理；价格页文字区明显更清楚（见自检图第三行） |
| 3 条目停留 | 2.3 秒→3.2 秒；总长 19.7 秒（价格页 6.5 秒） |
| 4/5 Silk 价格与 caption | caption 与 offer 都改「From NZD $7,999 per person, twin share」；去掉「from Auckland」（官网 Day 1 写了「Depart Auckland on your flight to Shanghai」，按复审意见先去掉） |
| 6 JIAYUGUAN FORTRESS | 改官网原词；换更紧更清晰的裁切（源图 2400px，之前缩太小） |
| 7 丹霞重复 | 已去掉同图第二种裁切；钩子换成兵马俑坑全景（Pexels），条目=丹霞 / 嘉峪关 / 兵马俑近景（Unsplash 另一张）。**兵马俑出现两次，但是两张不同照片**；敦煌/火焰山/天池无可核对地点的图，等 74 向 CTS 要真实原图 |
| 8 Panorama 产品名 | 钩子改「THE / CHINA / PANORAMA」，结尾改「CHINA PANORAMA.」 |

**新发现（74 号 2026-10-15）**：丝路没有任何确认过授权的实拍；「带价格的画面必须配确认过的实拍」（10-13 定），所以 **Silk Road 的 Reel 画面里不要出现价格**。41f64daa 与之前 Silk 各版都带价格页，**不能发布**；Silk 要等 `postcard` 模板（价格可不上屏，改用片尾标题卡）合并并升级出片机后重出。Panorama 同理需 74/18 确认它的价格页是否有授权实拍支撑。

新版显示仍是旧模板「骨架」（N/N、对勾、进度条）；整体压暗后画面偏暗。

## 十二、丝路补素材（PM 2026-10-15 授权下载；Pexels 单张页，不花钱）

新增 3 张（共 7MB），来源/摄影师/许可/地点依据见 `silk-road-sources-2026-10-15.json`（同内容在 Dropbox `CTS/footage/photos/silk-road-2026-10-15/SOURCES.json` 与 `remotion-assets/clips/credits-v8.json`）：莫高窟（`s4_mogao_caves.mp4`）、月牙泉+鸣沙山（`s5_crescent_spring.mp4`）、天山天池（`s6_tianchi_lake.mp4`）。**没找到** 页面自述地点的火焰山（吐鲁番）和乌鲁木齐市集图，宁缺毋滥；这两样等 74 向 CTS 要实拍。
现在丝路共 6 个不同景点画面可用：丹霞、嘉峪关要塞、兵马俑（两张）、莫高窟、月牙泉、天池。**无价版 Silk 要用 postcard 模板**（PR 2672 合并并升级出片机后）：钩子=兵马俑坑全景；景点=莫高窟 / 月牙泉 / 天池 / 嘉峪关；片尾=标题卡（背景用暗化的丹霞纹理，不放价格）。

## 十三、Silk Road 无价版（新 `postcard` 模板首次真实出片）· 工单 cd43bb66

PR 2672 已合并（合并提交 446b6db2a）；出片机已升级到该提交并重启（升级时队列为空）。工单 cd43bb66 = 丝路 postcard 无价版：in_review，花费 0，20.0 秒，有声音，体检 7 项 PASS，质检标记只剩 `narrator_voice_mismatch`（无旁白误报）。自检图：`cd43bb66-self-check-grid.jpg`。

| 项 | 结果 |
|---|---|
| 价格 | 全片没有价格（74 号规则）；价格只留首评链接；文案里也没有价格 |
| 第 0 帧封面 | 钩子「STEP ONTO THE SILK ROAD」从第 0 帧起完整显示（postcard 已实现，旧模板做不到） |
| 版式 | 无 N/N、无对勾、无进度条；下半部半透明明信片卡（地点小字 + 一句话），文字淡入 0.6 秒，每景停 3.6 秒 |
| 画面 | 兵马俑坑全景（Pexels）→ 嘉峪关要塞 → 莫高窟（Pexels）→ 天山天池（Pexels）→ 丹霞纹理片尾；6 个画面互不重复 |
| 一句话 | 全部取自官网行程日程：Day 9 Zhangye to Jiayuguan / Day 11 Dunhuang / Day 15 Urumqi to Heavenly Lake；每景带 sourceUrl + 出处片段（闸只证明「填了且相关」，是否真在官网请苏东坡核） |
| 不够好的地方 | ①片尾标题「18 DAYS. ONE ROAD.」被折成两行（「18 DAYS. ONE / ROAD.」），建议改成更短的一行（如「THE SILK ROAD.」）；②嘉峪关那张卡正好压在塔身上，遮了一部分主体；③总长 20 秒，比 PM 原要求 15 秒长（18 号同意样片 16–20 秒） |
| 质检标记 | 口吻误报同前；「标签重复」没有出现（postcard 不拼标签） |

审什么——苏东坡：三句话与官网行程日程逐条一致吗；有没有任何价格/催单感；值不值得发。马良：卡片压塔身是否可接受、片尾标题折行、第 0 帧封面是否干净、首帧与本周其他内容是否不撞、文字对比度。

## 十四、v2 无价版（按苏东坡/马良对 cd43bb66 的复审意见改）：Silk 4bd78644 · Panorama 94edbe0f

两条均 in_review，花费 0，19.0 秒，有声音，体检 7 项 PASS，质检标记只剩 `narrator_voice_mismatch`（无旁白误报，已写进工单备注）。出片机已升级到含 cardTop 的版本（合并提交 89973a26a）。自检图：`4bd78644-self-check-grid.jpg`、`94edbe0f-self-check-grid.jpg`。

| 复审意见 | 结果 |
|---|---|
| 1 去掉「Day N」，改官网亮点原词 | 丝路：「Walk along the Hanging Great Wall」「The world-famous Mogao Caves」「Heavenly Lake (Tianchi)」（地点行 Jiayuguan Fortress / Dunhuang / Tianshan Mountains）；Panorama：「The Forbidden City」「The giant panda breeding base」「West Lake and Longjing tea plantations」（地点行 Beijing / Chengdu / Hangzhou）。每景带 sourceUrl + 官网原句出处 |
| 2 片尾折行、钩子「ROAD」单独一行 | 丝路片尾「THE SILK ROAD」一行；钩子改「WALK THE / SILK ROAD」两行（「THE SILK ROAD」放不进一行）；Panorama 片尾「27 DAYS」 |
| 3 不写 pit、不提免签、无价格 | 照做；全片无价格；价格只留首评链接 |
| 4 卡片压塔身 | 新参数 `cardTop` 930（卡片下移）；嘉峪关塔身基本完整露出 |
| 5 片尾压到 4 秒、每卡 4 秒 | 钩子 3 秒 + 3×4 秒 + 片尾 4 秒 = 19 秒 |
| 6 换 BGM 且两条不同 | 丝路 Horizon's Breath；Panorama Horizon's Call（均为 CTS 此前未用） |

自检看到的小问题：①Panorama 的 West Lake 卡折成 3 行（句子长）；②Hangzhou 卡与熊猫卡会盖到画面下半部分主体；③卡片刚淡入的前 0.5 秒文字偏淡（淡入动画）；④丝路钩子是兵马俑坑全景但标题写 Silk Road，景点与标题不是同一处（官网 Day 3 有 Terracotta Warriors，可溯）。
素材读取修复：PR 2679（唤醒 Dropbox 仅云端文件，缺失/读不出来分开报）等自动合并；当天已把 14 个仅云端素材读回本机。

## 十五、Panorama v3b（工单 00f23d78，in_review）与 Silk caption 更新

苏东坡复审后：丝路 4bd78644 只改了工单文案（caption 末句统一「Travel insurance is not included.」，删签证与小费），不重出；Panorama 因 West Lake 卡折 3 行、卡底超安全区，重出：e5665cce（因素材被 Dropbox 转成仅云端进死信）→ 读回素材后重提 **00f23d78**。旧版 94edbe0f 作废。
00f23d78：花费 0，19 秒，有声音，体检 7 项 PASS，只剩口吻误报；三条 sourceQuote 改成官网原句；West Lake 卡两行（「West Lake & Longjing / tea」，tea 单独落在第二行，可接受）；卡片 `cardTop` 870（比 v2 上移 60px）；caption 只写旅游保险不含。图：`00f23d78-self-check-grid.jpg`。
仍有的小毛病：熊猫卡仍盖到熊猫身体一部分；卡片淡入前 0.5 秒文字偏淡。
**Dropbox 回收速度**：同一批 21 个素材在手工读回后不到 1 小时又变成仅云端（Panorama 因此两次进死信）→ 根治必须靠 PR 2679（出片机读取前自动唤醒）。

## 十六、3 月团三条无价版（postcard，按复审意见重做）：BoC#2 2ef627ff · Tale#2 19c191c5 · Shanghai#2 fd7e3e5a

三条均 in_review，花费 0，15 秒，有声音，体检 7 项 PASS，质检标记只剩口吻误报；全片无价格、无车次、无 Early Bird、无免签/小费字样；caption 末句只写「Travel insurance is not included.」。自检图：`2ef627ff-` / `19c191c5-` / `fd7e3e5a-self-check-grid.jpg`。

| | BoC#2 | Tale#2 | Shanghai#2 |
|---|---|---|---|
| 钩子 | 「BEIJING TO / SHANGHAI」（长城）；已去掉 FLIGHTS | 「A TALE OF / TWO CITIES」（故宫）；不提 G89、不暗示车次 | 「SHANGHAI / 10 DAYS」（南京路夜景） |
| 景点（官网亮点原词） | Xi'an · Big Wild Goose Pagoda → Hangzhou · West Lake | Beijing · Walk the Great Wall → Xi'an · The Terracotta Warriors（按行程北京→西安） | Shanghai · The Bund → Suzhou · A garden in Suzhou |
| 片尾 | 「15 DAYS」 | 「10 DAYS」 | 「7 NIGHTS」（官网：7 晚；caption 写 sample hotels or similar，不写具体酒店） |
| BGM | Second Hand Sunrise | Analytical Scholar | Sunlit Kitchen Window（三首互不同，也不同于丝路/Panorama） |
| 卡片 | 左 · 绿 | 居中 · 橙 | 左 · 金 |

素材不互用：兵马俑只在 Tale；上海夜景只在 Shanghai；西湖只在 BoC。
自检小问题：①BoC 的「Hangzhou · West Lake」画面（c4_westlake_boats）与 Shanghai 的「A garden in Suzhou」画面（v2b_suzhou_garden）是素材库里按名字归类的，**我无法确认画面就是西湖/苏州园林**，所以文字写得很泛（没写 Master of the Nets Garden 等具体园名）——请审片的人看一眼；②Shanghai 片尾外滩夜景与第一景外滩是同一类画面，略重复；③Shanghai 钩子的南京路夜景有路人（背影/侧脸，无可辨认正脸）；④卡片刚淡入前 0.5 秒偏淡。
BoC 的 Big Wild Goose 与 Tale 都只出现一次；BoC 也不含 pit/车次。

## 十七、3 月团三条 v2（按苏东坡/马良复审改）：Tale abd7a705 · BoC bb6b51b7 · Shanghai 46fb06b8

三条均 in_review，花费 0，15 秒，有声音，体检 7 项 PASS，质检只剩口吻误报；图：`abd7a705-` / `bb6b51b7-` / `46fb06b8-self-check-grid.jpg`。
| | Tale v2 | BoC v2 | Shanghai v2 |
|---|---|---|---|
| 响度（成片整体） | −17.4 LUFS（旧版 −23.6） | −17.3 LUFS（旧版 −20.0） | −16.9 LUFS |
| 钩子（第 0 帧完整） | 天坛（官网第一条亮点），「A TALE OF / TWO CITIES」 | 长城，「BEIJING TO / SHANGHAI」 | 南京路夜景（裁掉压 logo 的绿招牌，logo 区干净），「SHANGHAI / 10 DAYS」 |
| 景点 | 长城(北京) → 兵马俑(西安) | 大雁塔(西安) → 西湖亭子+樱花(杭州，换掉乌篷船小河道) | 外滩(夜) → 苏州园林(泛称「A garden in Suzhou」) |
| 片尾 | 故宫俯瞰（不再是长城航拍），「10 DAYS」 | 天安门华表，「15 DAYS」 | 白天外滩天际线，「7 NIGHTS」 |
| caption | 末句只写旅游保险不含 | 去掉门票句，其余同 | 末句只写旅游保险不含；写「sample hotels or similar」 |
核实说明：BoC 官网 essentials 页亮点与 Day 4 确有「Great Wall」、含项确有「Entrance fees and meals as specified in the itinerary」，所以钩子保留长城；门票那句按苏东坡意见删掉是保守处理。西湖画面（`v2_westlake_hangzhou`）素材库名为 Hangzhou，画面是湖边亭子+樱花，仍不能 100% 证明就是西湖；Shanghai 的苏州画面同理，所以文字写得泛。
首评草稿（给苏东坡核价）：`first-comments-march-tours-draft.md`（订单号以 v2 为准：BoC bb6b51b7、Tale abd7a705、Shanghai 46fb06b8）。
过程记录：BoC/Shanghai v2 前后各被 Dropbox 回收素材打进死信一次（def49e91/83ecbf77 → 7e403846/f0fb17c3）；PR 2679 合并后重试，唤醒仍失败（后台程序没有权限，见交接单第 6 节第 5 条），最终靠交互窗口先读回素材再重提（bb6b51b7/46fb06b8）才出片。
