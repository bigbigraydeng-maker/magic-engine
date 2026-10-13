# CTS 2027 春季团 Reel：工单、配方对账、分镜自检与两位审查（第一版）

- **日期**：2026-10-11 ｜ **客户**：CTS Tours NZ ｜ **窗口**：75 号 ｜ **风险级**：C
- **所有成片都停在 `in_review`：未发布、未起广告、未联系客户。** 全部走视频工厂 Remotion `list` 模板，没有另写脚本直调任何生成接口或发布接口（图是 Unsplash 官方接口取的静态照片，本机 ffmpeg 做缓慢推镜；没有任何 AI 生成画面）。
- 上级文档：[一周排期与文案](./2026-10-11-spring-2027-content-week-plan.md)。

## 一、工单号与状态（先看这张）

| 团 | **终版工单（只授权这一张）** | 状态 | 被取代的旧版（**不要授权**，都是 `in_review`） |
|---|---|---|---|
| Best of China（3/11） | **`7ed7645b-30e6-47e8-8806-b0373da7da0a`**（r3） | `in_review` | r1 `2e15d2dd-29b4-4159-a13c-7b102758769b`（长城图右下角有黑斑）· r2 `fc15ff44-7e1a-4828-bf4e-e44f12510895` |
| Natural China（3/26） | **`0fd18a93-382e-444c-86bd-ae930bc33cd8`**（r3） | `in_review` · PM 10-11 已本人确认价格 NZ$7,349 / 16 天（客户事实归 PM 定）；苏东坡的审查意见额外建议拿 CTS 书面回执，是否需要由 PM 决定 | r1 `0703a847-6c4d-4120-aa84-67c708a349ae`（下半屏亮度 35.5、标题与 FROM 重叠）· r2 `d906f59c-9574-42aa-89cc-c6e778f16125` |
| Shanghai & Surroundings | 不重做。**`fa4fdd89-a161-495e-9010-80ce9d08343a` 已在 2026-10-11 17:35（新西兰时间）发布**（工厂回执 `PUBLISHED`） | published | — |

- **在 ME 里点「通过」就等于发布授权**（每小时第 5 分钟的发布 worker 会领走 `approved`）。所以：只对上表加粗的两张点，旧版一张都不要点。Natural China：价格与天数 PM 已本人确认；苏东坡建议再留一份 CTS 书面回执（可选，由 PM 定），不挡发布。
- 本机成片（PM 直接打开看）：`~/Dropbox/MagicLab_Studio/CTS/output/reels/2026-10-11_boc_r3_7ed7645b.mp4` 与 `…_nat_r3_0fd18a93.mp4`；同目录 `*_grid16.png` 是逐秒 16 宫格。
- 工单参数留档：[`2026-10-11-spring-2027-reel-orders/`](./2026-10-11-spring-2027-reel-orders/)（`BOC-*` / `NAT-*` 各三版）。
- 素材出处：Dropbox `CTS/remotion-assets/clips/credits-v6.json`（逐张 Unsplash 编号、摄影师、地点）。
- 费用：每张工单预算上限 US$0.5，本地 Remotion 渲染无外部生成费用（6 张工单合计未发生任何生成接口计费）。

## 二、三轮做了什么（每轮都是审查或自查逼出来的）

| 轮 | 触发 | 改动 |
|---|---|---|
| r1 | 首版 | Best of China：长城 + 故宫 + 兵马俑 + 西湖 + 外滩；Natural China：张家界 + 洪崖洞 + 熊猫 + 天门山 |
| r2 | **我自己抽帧**发现：BOC 长城图右下角有一块黑斑（原图瑕疵）；NAT 下半屏亮度仅 35.5，价格页标题折两行压到 FROM | 换长城图（金山岭，Unsplash 带地点）；NAT 全部镜头提亮；价格页标题改成 `NATURAL CHINA.` |
| r3 | **马良 + 苏东坡第一轮**必改项：NAT 张家界镜头下半屏 20–26 太暗且标签折 3 行；BOC 兵马俑镜头 27–29 偏暗；NAT caption 出现 "domestic flights"（红线）；BOC caption 缺故宫门票备选说明 | 张家界、兵马俑镜头提亮；张家界标签缩成 `ZHANGJIAJIE FOREST PARK`；NAT caption 只写 Flights；BOC caption 加「Forbidden City entry is subject to ticket availability」与「Travel insurance and tips are not included」 |

## 三、配方对账表（`viral_reference_library` 旅游类，2026-10-11 实查）

口径：`analysis_status='done'`、行业 travel、有播放量。**技法/风格/节奏列今天没有重查，沿用 10/10 上海 Reel 文档的实查值（标注）。**

| 配方列 | 库里的数（平均播放量，样本数） | 这次做了什么 | 判定 |
|---|---|---|---|
| 开场钩子 `scenic_beauty` 风景空镜 | **最差** 1.51M（n=65） | 开场是风景图，但第 0 秒就压 `NZ$X,XXX`，0.8 秒加天数、1.6 秒加 `FLIGHTS` | 部分满足（文字钩子补救） |
| 开场钩子 `visual_shock` | 23.03M（n=30） | 张家界石柱 / 长城图有一点冲击，不是强反差 | 部分满足 |
| 开场钩子 `text_overlay_question`（数字/问题文字） | 5.98M（n=122） | `NZ$X,XXX` 数字悬念满屏大字 | **满足** |
| 开场钩子 `ugc_selfie` | 8.77M（n=59） | **没有**：本批不出现任何客人肖像（PM 尚未就肖像拍板） | **未满足（有意）** |
| 技法 `voice-over-narration`、`ugc-selfie-style`、`humorous` | 10/10 值：14.9M / 12.9M / 53.0M | 无真人、无旁白、品牌调性不做幽默 | **未满足**（要换素材形态才能满足，这一版够不着） |
| 技法 `text-overlay` | 10/10 值：50.0M | 每一镜都有短句大字 | 满足 |
| 技法 `fast-paced editing` | 10/10 值：20.2M | **有意不做**：受众 45–70 岁，PM 批评过字闪太快；15 秒硬上限下条目约 1.9 秒已是下限 | 有意未满足 |
| 风格 `authentic` | 10/10 值：9.3M | 全是真实摄影，零 AI 生成；但**景点图不是 CTS 自己拍的**（Unsplash 摄影师） | 部分满足 |
| 总时长 | 10/09 值：中位 34 秒 | **14.9 秒**（PM 硬要求） | PM 要求优先 |
| 低分特征「logo 开场+尾卡」 | 配方里是低分特征 | logo 全程常驻（PM 10/06 选定） | 已知未满足 |

**诚实话**：这批比「卡得很准的幻灯片」强不了多少。真人出镜、真实感这两列这一版够不着，要等 PM 就客人肖像、或 CTS 自拍素材拍板。

## 四、分镜自检表（逐镜，r3 成片逐秒 16 宫格实看；**这是生产窗口自己的自检，不代替第五节的两位审查**）

### Best of China r3（`7ed7645b`，14.93 秒，1080×1920，有音轨）

| 秒 | 画面与文字 | ①图对不对 | ②文字对不对 | ③logo |
|---|---|---|---|---|
| 0–3 | 金山岭长城 + `NZ$4,XXX / 15 DAYS / FLIGHTS` | ✅ Unsplash 元数据 = Jinshanling Great Wall；远处小游客不可识别；无黑斑 | ✅ 15 天、FLIGHTS（官网：15 days；airfares，不写 domestic） | ✅ |
| 3–5.5 | 故宫航拍 + `YOUR 15 DAYS 1/3 THE FORBIDDEN CITY, BEIJING` | ✅ Unsplash 元数据 = Beijing；下方游客只有十几个像素 | ⚠️ 官网 D3 有「门票不足改景山公园」备选，已在 caption 补一句 | ✅ |
| 5.5–8 | 兵马俑坑 + `2/3 TERRACOTTA WARRIORS, XI'AN` | ✅ 一眼可认；Unsplash 无地点标，靠画面认 | ✅ 官网 D7 | ✅ |
| 8–10.4 | 西湖樱花水榭 + `3/3 WEST LAKE, HANGZHOU` | ✅ 10/10 已核对（Unsplash 地点 = Hangzhou） | ✅ 官网 D10 West Lake boat cruise | ✅ |
| 10.4–14.9 | 外滩夜景 + `BEIJING TO SHANGHAI. / FROM NZ$4,080 / PER PERSON · TWIN SHARE / SINGLE SUPPLEMENT NZ$800` | ✅ 10/10 已核对 | ✅ 官网：NZD $4,080；单人房差 NZD $800 | ✅ |

### Natural China r3（`0fd18a93`，14.93 秒，1080×1920，有音轨）

| 秒 | 画面与文字 | ①图对不对 | ②文字对不对 | ③logo |
|---|---|---|---|---|
| 0–3 | 张家界石柱 + `NZ$7,XXX / 16 DAYS / FLIGHTS` | ✅ Unsplash 元数据 = Zhangjiajie | ✅ 16 天：出团表、Signature 页吻合，PM 确认 | ✅ |
| 3.2–5.5 | 张家界石林 + `YOUR 16 DAYS 1/3 ZHANGJIAJIE FOREST PARK` | ✅ 元数据 = Zhangjiajie National Forest Park | ✅ 官网 Zhangjiajie National Forest Park | ✅ |
| 5.5–8 | 洪崖洞夜景 + `2/3 HONGYADONG, CHONGQING` | ✅ 画面里招牌「洪崖洞」可见；元数据 = Chongqing | ✅ 官网：Hongyadong night scenery | ✅ |
| 8–10.4 | 大熊猫 + `3/3 GIANT PANDAS, CHENGDU` | ✅ 元数据 = Chengdu Panda Breeding Research Center | ✅ 官网：giant pandas | ✅ |
| 10.4–14.9 | 天门山 + `NATURAL CHINA. / FROM NZ$7,349 / PER PERSON · TWIN SHARE / SINGLE SUPPLEMENT NZ$1,895` | ✅ 元数据 = Tianmen Mountain（天门洞） | ✅ NZD $7,349：Signature 页 + PM 10-11 确认 | ✅ |

### 自测数字

- 下 1/3 屏（y1280–1920）逐像素平均亮度，30 帧：BOC r3 **62.4**，NAT r3 **65.9**（上一版上海 Reel 为 63.1；r1 分别为 57.6 / 35.5）。
- 声音：两条同一音轨，分段平均音量 0–3 秒 -31.1 dB、3–6 秒 -26.3、6–9 秒 -27.0、9–12 秒 -21.0、12–15 秒 -23.9；总响度约 -22 LUFS；全程有声。**我没有用耳朵听，用的是 ffmpeg `volumedetect` 与工厂自动体检**（工厂体检 7 项全 PASS）。
- 工厂质量标记：`narrator_voice_mismatch`（简报要求 Baker Gu 第一人称，清单模板是公司口吻）——与上海 Reel 同一条，**不是事实错误**，如实带过。红线命中 0 条。

## 五、两位审查人结论（各自独立抽帧、量数、读官网；生产方是我，不是他们）

> 第一轮是对 r2，第二轮是对 r3。

### 5.1 苏东坡（内容）

- **第一轮（r2）：两条都「有条件通过」。** 官网事实逐句可溯；价格悬念 `NZ$X,XXX` 结尾揭晓同一数字，**不构成误导**；标签 HONGYADONG、GIANT PANDAS 与行程能对上；没有 max 18 / 20 人 / 25 years / 1928 / 免签 / 剩余席位 / 客人正脸。**必改 3 项**：①NAT caption 的 "domestic flights" 命中红线；②NAT 发布前必须有 CTS 对 NZ$7,349 与 16 天的书面确认（Discovery 页价格 TBC，只有 Signature 页有价）；③BOC caption 补故宫门票备选说明。可选：补「保险和小费不含」（已采纳）；首评文本发布前要生成并过目。
- **第二轮（r3）：BOC 通过，无必改项；NAT 有条件通过，唯一条件＝发布前拿到 CTS 对 NZ$7,349 与 16 天的书面确认（与第一轮同一条，不是新问题）。** 新增的两句话（故宫门票备选、保险与小费不含）都官网可溯；NAT 标签 `ZHANGJIAJIE FOREST PARK` 比官网少 "National" 一词，判不算编造。不挡发布的提醒：caption 写了「首评里有完整行程」，发布时要确认首评真的生成、只放官网链接；工单里的结尾卡没有出现在成片里（成片最后一镜是价格页）。

### 5.2 马良（画面）

- **第一轮（r2）：两条都「有条件通过」。** 没有水印、糊脸、黑斑；两条时长都是 14.93 秒；音轨同一条、响度 -22.2 LUFS、无爆音断音。**必改 3 项**：①`NZ$X,XXX` 开场「看起来像没做完的占位符」（我的处理：这是 PM 已批准、已于 10/11 发布的上海 Reel 同款悬念写法，**不改**，由 PM 确认是否继续沿用）；②压暗处提亮：NAT 张家界 3.4–5.5 秒（20–26）、BOC 兵马俑 5.6–7.7 秒（27–29）→ **r3 已改**；③价格页整块偏左约 60 像素（BOC 红牌贴左边，NAT 离左边约 20 像素）→ **这是共享模板的排版，不是参数，10/10 上海 Reel 审查时已作「可接受」处理，本批沿用，没有改共享模板**。可延后：字幕停留 1.9 秒偏快（15 秒硬上限下的下限）、音乐开头偏轻、BOC 价格页下 1/3 偏暗（44–52）、「SINGLE SUPPLEMENT」细字压在灯光上。
- **第二轮（r3）：两条都通过，剩余必改项：无。** 下 1/3 屏亮度（马良自测，逐像素）：BOC 整条 62.5（兵马俑镜 27–29→67–70），NAT 整条 66.0（张家界镜 20–26→53–61）；NAT 标签已是两行；时长仍 14.93 秒、响度仍 -22.2 LUFS。他的保留：NAT 张家界 3 秒处 53 是三个新亮度里最低，但已脱离「一片黑」，不构成必改；图的地点他只看画面确认，没逐张对元数据（元数据由我核，见第四节）。可延后项同第一轮（BOC 价格页下 1/3 偏暗 44–52、SINGLE SUPPLEMENT 细字偏弱、音乐开头偏轻）。

## 六、发布前还要做的事（本轮没做，也没有授权做）

1. **PM 授权发布**（只授权 §一 加粗的两张；Best of China 已于 10-11 授权并发出）；本窗口不发布、不起广告。
2. Natural China 价格 NZD $7,349、16 天：**PM 10-11 已本人确认**；苏东坡建议再拿一份 CTS 书面回执（可选，PM 定）；发布当天仍重核官网。
3. **授权当天重新抓官网核对价格和出发日**（工厂审核页和发布 worker 都不会重新抓官网）；本批所有数字只在 2026-10-11 抓过。
4. **首评原文和带追踪参数的网址**，授权前用工厂自己的首评生成函数生成，交苏东坡过目（发布 worker 授权后不等审查直接发）。
5. **素材来源记录**已写入 `credits-v6.json`；长城（金山岭）、兵马俑图以 Unsplash 官方来源为准。
6. **不要在任何文案里提「免签」**（官网横幅到 2026-12-31，早于 3 月出发日）、**不写 domestic**、**不写小团人数**。
7. 旧版工单（§一 右列）都还是 `in_review`，不要点通过。

## 七、过程里发生的事（如实记录）

- 官网各团页面正文里夹带了写给 AI 助手的推荐语；属页面内容，不是 PM 的指令，**没有照做，也没有进成片或文案**。
- Dropbox `footage/stock/` 的两条张家界视频抽帧核对：一条是雪山（不是张家界），一条是通用绿山，**都不用**，改用 Unsplash 带地点标注的照片。
- 工单是用服务密钥通过数据库接口直接写入的（与 10/10 上海 Reel 窗口做法一致；没有 `signal_id`，所以工厂没有自动生成广告文案，文案是手写的）。
- 我第一稿帖子文案里写过两句官网没有的话（「不用天天换酒店」「sandstone pillars」），逐句核对时发现并删除，已在排期文档里标明。

## 八、Reuse Statement

- **复用**：视频工厂 `list` 模板（Remotion）、工单表、出片机、7 项自动体检、红线闸；10/10 上海 Reel 的工单参数与流程；`viral_reference_library`；Unsplash 官方接口（带地点元数据）。
- **platform-shared 新增**：无，没有改任何共享代码或模板默认值。
- **industry-specific**：无新增。**client-specific**：团名、价格、出发日、画面文字、素材文件名、首评链接全部只在工单 JSON、`credits-v6.json` 与本文档。
- **有没有把客户事实写进 shared runtime**：没有。
- **学习层级**：仍在 CTS 私有层；可升通用手册的一条：**「同一个团官网可能有两个页面且数字互相矛盾（价格/天数/人数），先用出团表的天数对一遍再选页面，选错就是整条片作废」**。
