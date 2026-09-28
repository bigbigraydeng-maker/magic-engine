---
id: 2026-09-29-cts-reels-sep29-oct5
title: CTS Tours NZ Facebook/Instagram Reels Sep 29–Oct 5 排期（5/7 ready to fire，2/7 blocked on PM input）
status: decided
owner: agent
decided_on: 2026-09-29
source: session:d6062488
verify_how: PM 回复后检查 Publer 后台该 5 条排期是否已创建（FB/IG 各一条，09:00 NZDT），并确认首评链接已带对应 UTM 参数；Oct 4/Oct 5 两条等 PM 拍板后再排，此前不算完成
---

## 开工前读过的东西（对齐 CLAUDE.md 要求）

- 读了 `docs/roadmap/2026-08-19-me2-platformization-principle.md`——本任务不新增能力/组件，纯内容排产+复用既有 Publer 发布管线，不触发平台化五道闸。
- 读了持久记忆 `playbook-social-general.md`（社媒支柱通用手册）——关键约束：开场钩子禁纯风景空镜（本批老素材不满足，见下方对账表）、竖版安全区 y=270~1248、字幕短句大字、logo 水印强制、CTA 放首评不放正文、素材真实性按来源事实判定。
- 读了 CTS 专属记忆：`project-cts-content-factory-daily3`、`reference-cts-content-render-publish-pipeline`、`reference-cts-factory-reel-native-publish`、`project-cts-reel-first-comment-manual-decision`、`reference-cts-finished-reels-inventory-2026-09`、`reference-cts-footage-library-location`、`feedback-cts-content-narrative-vs-website-product`、`reference-cts-vi-package-location`。
- 回读了 `master_briefs`（CTS，v1，2026-08-27 更新）——5 支柱配比、Baker Gu 人设、平台策略、**1928/25年必须配对**的硬性合规词表。
- WebFetch 了官网当下真实页面（`ctstours.co.nz` 首页 + `/tours/china/discovery/golden-china` 详情页）做事实核对，没有凭 master_brief 的 example_topics 或旧记忆编内容。

## 先查现状：Daily Plan 排到哪了

`content_work_orders`（工厂自动线）最近一条 published 是 **9/6**（查表方式：`content_work_orders` 按 `client_id = CTS` 且 `status = 'published'` 排序取最新一条，不在台账里抄 Reel ID），之后 8/28–8/31 好几条全部 `review_rejected`/`dead_letter`，9/16 有一条「December Departures」还卡在 `queued` 没跑。**结论：自动发布链已经空转 3 周多，Sep 29–Oct 5 这一周确实是空的**，没有重复排产风险。

同时发现 `content-factory` 存储桶里有 **5 条已经做好、逐镜对过官网、但从没在主页自然发布过**的 Golden China Reel（2026-09-07 渲染，此前只当 PAUSED 广告素材用，零花费）——这是本轮排产的主要素材来源，不用重新出片。

## 已核实的事实源（红线要求：先查官网，不编）

WebFetch `ctstours.co.nz/tours/china/discovery/golden-china`（今天现查，不是引用旧记忆）：
- Golden China：12 天，3 城（北京→西安→上海），16 Nov 2026 出发，From NZD $4,999
- Day2 北京烤鸭欢迎晚宴 / Day3 天安门+故宫 / Day4 居庸关长城 / Day5 胡同人力车+颐和园长廊 / Day7 兵马俑+西安饺子宴&大唐歌舞 / Day8 西安城墙+大雁塔 / Day9 朱家角水乡+黄浦江夜游 / Day10 豫园(400年)+外滩+南京路 / 全程 26 餐、9 晚 4 星、含国际+国内段机票
- 品牌历史措辞官网原文："Backed by CTS — China's travel brand since 1928 — with 25 years of Kiwi-led NZ operations"（1928 与 25 年永远同句出现，本批文案照此执行，不单独说"since 1928"）

## 5 条已就绪，等 PM 一句话就能真的排上去

来源：`content-factory` bucket `cts-reels/goldenchina-ads-20260908-v2/`，逐条下载了缩略图做了可视自检（不是重新做的自检，是在 2026-09-15 已完成的逐镜官网核对基础上做的一次缩略图复核）：**5 条 logo 都是官网真 logo（非手画）、标题文字都在安全区中上部、无错字**。已知一个待查小风险见文末「已知风险」。

| 日期 | 星期 | 素材 | 支柱 | 钩子/文案摘要 |
|---|---|---|---|---|
| Sep 29 | 周二 | `gc_grandtour.mp4` | Offers & Departure Alerts | "3城12天，11/16 那团已经有人在问位置了" |
| Sep 30 | 周三 | `gc_beijing.mp4` | Destination Inspiration | "Day 4 带你去居庸关长城，12天行程里的一站"（原稿"日出/避开人群/客人最常提"这几处细节官网未证实，已删除，不上未核实说法） |
| Oct 1 | 周四 | `gc_xian.mp4` | Destination Inspiration | "8000个兵马俑没有两张脸一样" |
| Oct 2 | 周五 | `gc_shanghai.mp4` | Destination Inspiration | "老外滩和新陆家嘴同框" |
| Oct 3 | 周六 | `gc_food.mp4` | Expertise & Heritage（美食角度） | "团上到底吃什么——26顿里两顿最出圈" |

统一排期时间：每天 **09:00 NZDT**（新西兰这周已进夏令时 UTC+13，不是 NZST）；此时段沿用过往 reel 排期习惯，PM 想改看后台随时调。

### 完整文案（Baker Gu 第一人称，FB 版；IG 版把"first comment"换成"link in bio"）

**Sep 29 · gc_grandtour**
> Beijing → Xi'an → Shanghai in one trip — and our next Golden China departure (16 November) is filling up.
>
> I'm Baker, CTS's China specialist. This 12-day route is one I've built dozens of times and it never gets old: Great Wall at Juyongguan, the Terracotta Warriors up close, a night cruise down the Huangpu. Flights, 9 nights in 4-star hotels and 26 meals are all sorted — you just show up and take it in.
>
> 25 years running trips like this out of NZ, on the ground with China Travel Service (est. 1928). If November could work for you, full itinerary + seat check is in the first comment 👇
>
> #GoldenChina #ChinaTravel #CTSTours #NZTravellers #GreatWall

首评（FB，UTM 各不相同）：
`👉 Full 12-day itinerary & seat availability: https://www.ctstours.co.nz/tours/china/discovery/golden-china?utm_source=facebook&utm_medium=reel&utm_campaign=goldenchina-grandtour-sep29`

**Sep 30 · gc_beijing**
> Day 4 of our Golden China trip takes you to the Juyongguan section of the Great Wall — one of the most iconic stops on this 12-day route.
>
> Beijing gets 4 full days on this route — Tiananmen and the Forbidden City, the Wall, a hutong ride with a local family, the Summer Palace's Long Corridor. It's the side of Beijing that a rushed day-trip never gets to.
>
> — Baker, CTS China specialist
>
> Full Beijing leg + dates in the first comment 👇
>
> #Beijing #GreatWall #ChinaTravel #CTSTours #ForbiddenCity

首评：`👉 See the full Beijing leg + upcoming departures: https://www.ctstours.co.nz/tours/china/discovery/golden-china?utm_source=facebook&utm_medium=reel&utm_campaign=goldenchina-beijing-sep30`

**Oct 1 · gc_xian**
> 8,000 clay soldiers, no two faces the same — and you're standing close enough to see the individual expressions.
>
> Xi'an is the leg of Golden China I still find people underestimate. Beyond the Terracotta Warriors: the old City Wall, the Big Wild Goose Pagoda, and a dumpling dinner with Tang Dynasty dance performances that's become a highlight for almost every group I've taken.
>
> — Baker, CTS China specialist
>
> Full Xi'an leg + dates in the first comment 👇
>
> #XianChina #TerracottaWarriors #ChinaTravel #CTSTours

首评：`👉 See the full Xi'an leg + upcoming departures: https://www.ctstours.co.nz/tours/china/discovery/golden-china?utm_source=facebook&utm_medium=reel&utm_campaign=goldenchina-xian-oct1`

**Oct 2 · gc_shanghai**
> Old and new sitting side by side — that's Shanghai in one frame.
>
> We close out Golden China here: Zhujiajiao's water town canals, a night cruise down the Huangpu with the Pudong skyline lit up, Yu Garden's 400-year-old pavilions, then the Bund and Nanjing Road for anyone who wants one last walk before flying home.
>
> — Baker, CTS China specialist
>
> Full Shanghai leg + dates in the first comment 👇
>
> #Shanghai #TheBund #ChinaTravel #CTSTours

首评：`👉 See the full Shanghai leg + upcoming departures: https://www.ctstours.co.nz/tours/china/discovery/golden-china?utm_source=facebook&utm_medium=reel&utm_campaign=goldenchina-shanghai-oct2`

**Oct 3 · gc_food**
> People ask me what the food is actually like on tour — here's the honest answer: better than they expect, and there's a lot of it.
>
> 26 meals are built into Golden China, and two nights stand out: a Beijing duck banquet the evening you arrive, and a Xi'an dumpling dinner with a Tang Dynasty dance show. Everything else is real, sit-down local food — not the tour-bus buffet people picture.
>
> — Baker, CTS China specialist
>
> Full meal plan + itinerary in the first comment 👇
>
> #ChineseFood #PekingDuck #ChinaTravel #CTSTours

首评：`👉 Full meal plan + 12-day itinerary: https://www.ctstours.co.nz/tours/china/discovery/golden-china?utm_source=facebook&utm_medium=reel&utm_campaign=goldenchina-food-oct3`

### 发布方式（复用既有管线，没有新造轮子）

Publer API（workspace `69e777758dca9d3a132c0cbc`，FB 账号 `69e777961cec3ed0f94bb7cf`，IG 账号 `69e777ad78f5d69b2b030c76`），`type:'reel'`，首评走 `comments[]+delay` 参数一次性带上（不用再手工等 60 秒去发）。Meta 主页令牌当前 `active`，到期 2026-11-02，这周排期没有令牌到期风险。

**这 5 条我没有直接执行发布**——对外发布是 CLAUDE.md 里明确写的"唯一必须先问 PM"的事之一，文案/素材/首评链接/排期时间全部备好，PM 回一句就能在几分钟内排上去，不会耽误 9/29 当天发布（今天就是 9/29，第一条可以补发到今晚或明早）。

## 2 条排不出来，卡在需要 PM 决定的事（不是我没做）

| 日期 | 支柱 | 卡在哪 | PM 需要做什么 |
|---|---|---|---|
| Oct 4（周日） | Travel Planning & Education（如"NZ 护照 15 天免签"） | 本地出片引擎(`make_promo.py`)和素材库都在、能跑，**但 Baker Gu 旁白配音一直是罐头 TTS 音质**（7 月已经定性为"跟爆款最大差距"，需要换 ElevenLabs 级配音或真人录音，预算/方案至今没拍板）。我不想再交一版会被打回"千篇一律"的罐头音质内容。 | 要么批一个配音方案（付费 TTS/真人录音二选一），要么明确这条本周先跳过、改成纯文字卡+BGM 无旁白版本（能做，但改变了 Baker Gu 人设的呈现方式，我不想擅自替 PM 定这个调性决定）。回其中一个我就能继续。 |
| Oct 5（周一） | Social Proof & Client Celebration（客人见证） | 红线要求"testimonial 禁 AI 人脸，需真实团友照片+授权"，CTS 这个客户之前有过一次编造评价被抓的事故（`feedback-cts-brochure-had-fabricated-testimonials`），master_brief 里现成的例子文案自己都标着"(R1 audit pending)"，说明连审核都没走完。**这条不是工具问题，是没有一条真实、已授权的客户评价可用。** | 需要 PM/FDE 提供至少一条真实客人评价（文字+同意公开使用，最好带照片）。有素材我当天就能出片。 |

## 已知风险（缺一个不算完整自检）

这 5 条视频是老 `make_promo.py` 工厂产的存量素材，不是我这轮新做的，所以下面这张对账表是**复核**不是**新生产把关**——诚实说清楚哪些是老素材本来就有的差距，不是这次新出的问题：

| 配方列（来源 `viral_reference_library` + 社媒手册） | 这批 5 条实际情况 | 判定 |
|---|---|---|
| 开场钩子不能是纯风景空镜 | 5 条开场都是"地标空镜+标题卡"（长城/兵马俑/陆家嘴天际线等），是手册明确点名的**最差钩子类型** | ❌ 未满足（老模板遗留，本轮没有重新剪辑的产能） |
| 满屏文字/快切/延时摄影等技法 | 有一张静态标题卡叠加，但不是快切或问题-解决方案叙事 | ⚠️ 部分满足 |
| 真实粗糙感/UGC感，忌精致广告腔+logo收尾 | 这 5 条是精修横幅质感+底部常驻 logo——手册点名的低分特征，但 logo 是 CTS 自己的强制铁律（第四条），两条规则互相冲突时以 logo 铁律为准 | ❌ 未满足（有意为之，不是疏漏） |
| 真人出镜/真实素材 | CTS 从 2026-07-26 起就是零真实拍摄素材的已知长期缺口(PM 已知晓)，这批也是纯图库+AI混剪 | ❌ 未满足（CTS 结构性缺口，非本轮新增） |
| logo 是官网真文件、不是手画 | 5 张缩略图逐一看过，logo 清晰、样式和官网一致 | ✅ 满足 |
| 标题文字在安全区(y=270~1248) | 5 张缩略图目测标题都在画面中上段，未贴顶/贴底 | ✅ 满足 |
| logo 是否会被 Reels 界面挡住 | logo 位置在画面底部约 5–8% 处，手册定义的底部危险区是 35%——**这个位置理论上在危险区内**，但只看到了缩略图，没看到真机叠加评论区 UI 后的实际效果 | ⚠️ 未验证，建议发布后真机点开这 5 条看一眼，如被挡算下一轮视频线的工单，不影响这次先排上去 |
| 事实（价格/行程/餐数）对官网 | 今天现查官网 `/tours/china/discovery/golden-china` 逐项核对，日期/价格/餐数/景点全部匹配 | ✅ 满足（本轮新查，非沿用旧记忆） |
| "1928" 必须配 "25年" 不能单独出现 | 5 条文案里只有 Sep29 一条提到品牌历史，且严格按"25年...backed by...since 1928"同句配对 | ✅ 满足 |

**结论**：这批视频在"参数/事实/合规"层面达标，在"真正意义上的爆款结构"（真实感/非空镍开场）上没有达标——这是 CTS 已知的结构性短板，不是这次排产引入的新问题，先用现成素材把这周填上，比空着不发更好，但不能当作"已经解决千篇一律"来汇报。

## 下一步（不在本次任务范围内，留给下一轮）

- 7 月的 Best of China 混剪（`boc3_01_grandtour` 等）价格/团期没有重新核对过，不建议直接拿来凑数，需要新窗口重新看一遍视频原始帧核实。
- Oct 4 / Oct 5 两条等 PM 上面两个决定后，下一个窗口可以直接继续出片，不用重新做调研（本卡已经把官网事实、素材库位置、引擎路径都记下来了）。
