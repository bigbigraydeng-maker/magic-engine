# Remotion 模板目录 + 配套音乐 + 模板选择器：方案 v0.2

2026-10-06 · **草案，未写任何实现代码** · 风险级别 C（纯文档）· 基线 `origin/main` = `6e8af28d7`（本地快照，未刷新远端）
依据：`2026-10-05` 的 `remotion-into-video-factory-plan-v0.3`、`remotion-engine-dev-plan`、`video-factory-three-outlets`、`docs/audits/…remotion-first-real-run-recipe-check.md`、`…remotion-r2a-worker-branch.md`；事实接口对齐 PR #2270（官网产品事实快照）
审查：子牙 + 魏征已审一次（结论「需改」，7 条已并入本版 v0.2）；**板桥（成片面向客户）还没审。**

## 0. 先说结论（给 PM）

1. **第一版只做 3 个模板**：清单（已有）· **蒙太奇快切（新，重点）** · 悬念提问（新，条件做）。备份里另外 4 个（圣诞、15 天、10 天、地图）不移植：带中国地图和雪景，只对旅游成立，还要多装 4 个依赖包。
2. **音乐不再手写节拍**：复用备份里已写好的 `beats.py` 自动算。今天本机对 30 个音乐文件全跑出结果；但**同一首歌的两个版本算出过 199 对 100、179 对 118**，要加「折半规则 + 渲后复核」，不能全信机器。
3. **选择器宁可不出片也不乱出片，分两步交付**：第一步（D1）**用规则选、不调大模型**——广告打法和模板近乎一对一，规则就够；价格、天数、日期只从官网事实快照（PR #2270）拷贝，状态不是 `ok` 就不出片，今日待办出一条带原因和链接的提醒；每次选择都留记录。第二步（D2）才加大模型，且只在第一步的候选里挑歌和钩子样式，一个数字都不许自己写，一次预计花不到 US$0.01。**你要的「让大模型选」在第二步兑现**，见 §7 第 4 条。
4. **模板解决不了的一件事**：配方里最值钱的「真人出镜 / 自拍感 / 幽默」，模板只能留「真人镜头位」，**没有真人素材就做不出来**，对账表如实标「未满足」。这是业务题（§7 第 2 条）。
5. **顺序**：音乐自动节拍 → 蒙太奇 → 模板接出片机 → 选择器 →（看数据再定）悬念提问。共 5 个小包，每包一个窗口。

**我对「蒙太奇剪辑」的理解**：**快速切换的短镜头（约 0.4–0.7 秒一镜）+ 切点卡在音乐节拍上 + 满屏大字**，即备份里 PunkReel 那种。如果指的是别的（如更长的叙事剪辑），§1.1 要重写。

## 1. 模板目录（封闭：选择器只能从这张表里选）

| id | 用途 | 对应打法 `PlayKey` / 草案 `DraftKind` | 时长 | 适合音乐 | 来源与移植工作量 |
|---|---|---|---|---|---|
| `list` 清单 | 「包含什么 + 价格」说清楚，给已有兴趣的人 | `warm_pool_retarget`（首选）· `lead_form_harvest` / `lead_form`（视频版）· `messenger_direct`（备选） | 12–16 秒 | 80–110 BPM，温和 | **已移植**（R1）；只改节拍自动、logo 只留最后 2 拍。**小** |
| `montage` 蒙太奇 | 信息型快切：抓眼球、攒受众池（是否适合冷人群是假设，待小预算验证） | `thruplay_pool_build` / `video_thruplay`（首选）· `reach_awareness` | **15–16 秒**（ThruPlay 按「看满 15 秒或看完」计） | 打击感强，90–140 BPM，每拍一切 | 备份 `PunkReel.tsx`（129 行）+ `clip_luma.json` + `components.tsx`；写死的镜头池、词串、「城市词只配该城市镜头」改成参数。**中** |
| `quiz` 悬念提问 | 好奇心钩子：「X 里包含什么？」逐条累加后揭晓价格 | `messenger_direct`（首选）· `lead_form_harvest`（备选） | 15–17 秒 | 90–110 BPM，带悬念 | 备份 `QuizReel.tsx`（91 行）；本质是 `list` 换开场，复用价格段。**小–中，条件做** |

`boost_organic_post` 给已发帖子加钱推、不产生新视频：选择器返回「不需要新片」，不算失败。「打法 → 模板」用 `Record<PlayKey, …>` 写，词表加打法而不补表就编译不过。**各模板的参数从哪来见附录 B**（价格/天数/日期/包含项只来自官网核对底稿，品牌色/logo 来自品牌包，打法/语言/最长秒数来自广告计划，镜头来自素材池，节拍来自音乐目录）。

### 1.1 蒙太奇怎么避开「卡得很准的幻灯片」

那次事故（记忆 `feedback-viral-reel-recipe-over-montage`）的根因：**只抄了「改个数字就能满足」的节奏参数，没动「要换素材形态才能满足」的内容形态**。能机器卡的做成卡口，不靠自觉：

1. **文字是主角，镜头是背景**：第 1 帧就是大字（数字或问句），不用风景空镜起手；之后每 1–2 拍一词，连起来是一句完整的话（几天 · 去哪 · 多少钱 · 哪天走）。*卡口*：首词不是数字/问句就拒。
2. **镜头按标签配字**：城市词只配该城市镜头（备份 `FORCE` 的做法，防 PITFALLS D6「张冠李戴」）；找不到同标签镜头 = 失败。**镜头池 ≥3 种类型、相邻两镜不重复。** *卡口*：schema。
3. **节奏有起伏**：普通小节每拍一切、指定小节半拍加速；只在每 4 拍重拍闪白（光敏安全），其余轻推近/抖动。渲后 `qa.py` 量音画偏差与每秒闪光次数。
4. **留真实感的位置**：镜头槽带「真人/航拍/街景/细节 + 自有/库存/AI」标签；有真人镜头时至少占 1/3。**没有就在对账表写「未满足」**，选择器理由里不许写「符合爆款配方」。
5. **弱化 logo**：只在最后 2 拍，不常驻、不加尾卡。
6. **交付前不省**：9 宫格逐镜自检 + 马良/苏东坡审（生产方与质检方分开），**不发布**。

*如实的风险*：每镜 0.4–0.6 秒，**比 58 条旅游爆款的镜长中位数 2.14 秒快得多**，是押「快切」的假设，试跑后要看完播率，不能当结论。

### 1.2 移植顺序与砍掉的

**`list` 改造（随音乐包）→ `montage` → `quiz`（条件做）。** `list` 已能出片、只差节拍对上音乐，最快见效；`montage` 是唯一对得上配方「文字钩子 + 快切」的模板，且冷人群/攒池是广告 agent 当前最主要的视频需求；`quiz` 等前两个有广告数据再定。
**砍掉**：`Reel` · `BocReel` / `TaleReel` / `MapScene`（要 4 个新依赖包，A 级，地图写死中国）。备份里名字带 `temp` 的 9 个音乐来源不明，一律不用。

## 2. 配方对账表

出处：`viral_reference_library` 旅游类按平均播放加权（上述记忆 + 10/5 审计）。**本窗口没有查生产库**，数字沿用这两份文件；WP-B 现场查库复核。

| 配方列 | `list` | `montage` | `quiz` |
|---|---|---|---|
| 第 1 帧文字钩子（数字/问题），禁风景空镜 | **部分**：数字✓，底图若是风景✗→强制选「人/街景/细节」标签 | **满足**（卡口） | **满足**（问句） |
| 满屏大字（67M） | 满足 | 满足 | 满足 |
| 快切（29M） | 部分（约 1.6 秒/镜） | **满足**（0.4–0.6 秒，是假设） | 部分（约 2.4 秒） |
| 清单 / 问题—答案框架（51M） | 满足 | 部分（词串成句，非问答） | 满足 |
| 航拍（18M）/ 延时（35M） | 有航拍素材就用；延时**不适用** | 同左 | 同左 |
| **真人出镜 / 自拍感（均播第一）· 幽默 / 共鸣** | **未满足**：只留「真人镜头位」 | **未满足**（有素材时占 ≥1/3） | **未满足** |
| **真实感（评分最高）· 弱化 logo/尾卡** | **未满足**→改后 logo 只留 2 拍；库存镜头真实感仍缺 | **部分**：logo✓，库存镜头✗ | 同 `list` |
| 音乐卡点 / trending | 现状**未满足**（等间隔）→改后卡点**满足**；trending **不适用**（只用拍板的库乐） | 卡点满足 | 同 `list` |
| 素材真实性（按来源，不按文件名） | 满足（槽位强制带来源标签）；CTS 现有镜头多为库存，**只当氛围，不当「客户真实产品」** | 同左 | 同左 |
| 文字事实可溯 | 满足（§4 fail-closed） | 满足 | 满足 |

结论：三个都是「**信息清楚 + 节奏对**」，**不是配方意义上的爆款结构**；真人 / 幽默 / 真实感是天花板，补法只有素材（§7 第 2 条）。

## 3. 音乐库与自动节拍

**范围**：只用 `MagicLab_Studio/Music`（12 首）、`_shared/music`（18 首 + 3 个试听片段）、`CTS/remotion-assets/music`（与 `_shared` 里 Jade River Journey 同一首），PM 2026-10-05 拍板可直接用（含广告）。盘点见**附录 A**。

**检测工具（Reuse First，已查）**：仓库里**没有**节拍检测（搜了 `src/` `scripts/` `tools/`；`lecture-render.ts` 的 `onset` 是语音词起点，无关）。复用 PM 备份里的 **`tools/beats.py`**（Python，只用 numpy + scipy + ffmpeg，无 librosa）和 **`tools/qa.py`**（渲后量音画偏差与闪光），已在 4 条成片上用过。不引入 librosa/essentia，不用付费接口。
**实测（本机，只读）**：30 个文件全部出结果，一批 12 首约 3.5 秒。**弱点**：偏向报更快的拍，同一首两个版本差一倍（Sunday Hammer 199/100、Snap the Floor 179/118、龙旗破云 137/90）。对策：**自动值 >150 折半**；每个模板每首歌第一次渲完用 `qa.py` 复核，**超 ±50 毫秒标红、人工改目录值**；入库时马良抽听一遍。

**最小实现**：①`scripts/factory-worker/tools/analyze-music.py`（`beats.py` 原样搬 + `ffprobe` 取时长）；②`engines/remotion/catalog/music.json`（id、文件名、文件夹、时长、BPM、首拍、小节位、情绪、能量档、风格、季节；后四项人填一次）；③`src/music.ts` 纯函数 `beatsFor(entry, needBeats, startBar)` 生成 props 里的 `beats`（props 仍存数组，渲染可复现，只是不再手写）；④音频不进仓库，渲染时按 id 拷进每单暂存目录（R2a 现只认客户自己的 `remotion-assets`，WP-C 放开到「已登记乐库」）。
**依赖变化**：Node 侧**零新增**（`package.json` 不动）；出片机 Mac 要 python3 + numpy + scipy（本机已有，出片机 README 已写 Python3 + ffmpeg）；无新付费服务。
**选歌预筛（代码做）**：时长 ≥ 成片秒数 + 2 · 能量档匹配 · 季节曲（如 `cts_xmas_suno`）只在档期 · 同客户最近 3 条不重复同一首 · **状态为「待听」的歌不选**（来源不明或两个版本节拍对不上的，如 Jayden小弟、MiniMax、Snap the Floor、龙旗破云，入库默认标「待听」，马良抽听后才转正）。

## 4. 模板选择器（分两步：D1 规则选 + 事实校验；D2 才加大模型）

**为什么分两步**：打法→模板近乎一对一（§1 表），3 个模板、≤5 首歌，规则就能选对；大模型只对「挑哪首歌、哪种钩子样式」有一点增益，却带来花钱、编造、注入三类风险。所以 **D1 不调大模型**，先把「事实校验 + fail-closed + 回执」这套安全底座做实；D2 再加大模型，且只在 D1 的候选里挑。

**输入**（zod 校验，缺字段即拒）：`{ clientId, play, draftKind?, audienceStage: cold|warm, language, maxSeconds, assetPoolRef }`；事实不作为输入传入，选择器自己读。**输出**（严格 JSON，zod `.strict()`）：`{ template, props, music, copy: { endcard: { cta, url } }, rationale }` + 回执。

**事实接口（对齐 PR #2270，**尚未合并**，字段以合并版为准）**：经 `getProductFacts(clientId)`（`src/lib/product-facts/`）读 `ProductFact`：`name`、`duration_days`、`from_price{amount,currency}`、`price_basis`、`departures: string[]`（只有日期）、`inclusions: string[]`（**无 key，只能按下标引用**）、`source_url`、`verified_at`、`status: ok|stale|fetch_failed|not_measured`（**14 天过期已内置**，选择器不再自设期限）；**没有 footnote 字段**。**选择器只放行 `status=ok`。** 映射：金额/币种←`from_price`；限定语←`price_basis`；日期行←`departures` 里未过期的日期（格式由代码化）；条目文字←`inclusions[i]` 原文（超长即失败，不改写）；footnote←模板固定词表里的中性句（不含数字）；`endcard.url`←`source_url` + 追踪参数（沿用现有首评链接规则）、`cta`←固定词表。选择器只认通用形状（价格 / 时长 / 日期列表 / 条目列表）：**含日期的字段取未过期者**——旅游是团期、地产是开放日，各写一个适配器映射到同一形状，选择器本身不改。

**R2a 审核硬要求**（R2a 审计 §六第 4 条）：`musicFile` 必填（没有音轨，音频自动检查判 FAIL，成片批不了）；`brief.copy.endcard` 必须带 `cta` 和 `url`（否则「CTA 放首条评论」「首评带追踪参数」两项判 FAIL）。**选不出歌、或拼不出 endcard，一律 fail-closed。**

**D1 四步**：①**代码预筛**：打法→模板、`maxSeconds`、素材池标签够不够、音乐预筛 → 最多 3 个模板、5 首歌，按固定规则取第一。②**代码拼 props**：数字、日期、包含项只从事实包拷，钩子数字由代码按样式填，再过模板自己的 props 校验。③**事实回显**：成片上每个数字和日期必须出自所引事实；**比对前先做格式归一**（`10899` ≡ `10,899` ≡ `$10,899`；`2027-05-08` ≡ `8 MAY 2027`）。④写进工单 `brief`（接 R2a 的 `brief.engine='remotion'`）+ 发 Inngest 事件；**只进审核队列，不发布**。D1 成本为 0。

**D2（先不做，D1 跑满一周、看回执再定）**：用仓库已有 `callClaudeChat`（`src/lib/anthropic/client.ts`，`singleAttempt: true`——注释即「限额流程：不走网关、不重试、不二次扣费」）+ `parseJsonResponse`，模型用该文件的 `MODEL_HAIKU`；**不手写直连**。只在 D1 候选里挑 `{ music, hookPattern, rationale }`，不碰价格日期。成本按该文件价表约 US$0.006/次，单次硬顶 US$0.03，每天最多 40 次，0 次自动重试。**约束只落在会进成片的字段**：这些字段里出现任何数字或货币符号就整条作废；`rationale` 等内部字段不受限（可以写「15 秒」「90 BPM」）。**`angle`**（广告计划里的自由文本，是注入口）：≤80 字、只留字母数字和基本标点、去网址与控制字符、放在分隔的数据块里、**永不进 props**；因为输出只能是目录 id，最坏也只影响「选哪个」。

**fail-closed**（不建工单；待办出「是什么 / 怎么办 / 直达链接」三件套 + 事件 `factory.video_template.selection_blocked`）：事实 `status` 不是 `ok` · 没有未过期的日期 · 选不出歌 · 拼不出 endcard · 校验或事实回显不过 · 素材池不够 ·（D2）模型输出非法 / 选了候选外 / 会进成片的字段带数字 / 超成本。**永不拿别的客户的事实或默认值兜底。**
**怎么留记录**（不新增表：存进工单 `brief.selection`，事件载荷同内容）：请求 id、客户 id、打法、事实的 `source_url` 与 `verified_at`、预筛候选、选中的模板与音乐、`rationale`、`recipe_gaps`（取自 §2 + 素材池实况）、`no_publish: true`、时间；D2 另记模型名、token、花费。以后按工单 id / 广告 id 关联即可复盘；**只记，不做自动学习**。
**props 生成归谁、编号**：10/5 三出口文档把「服务端生成 props」叫 R2b，但 `#2261` 已用 R2b 指「遮罩深浅」并合并，**不再借用**。归属：选模板 / 选歌 / 拼文字槽位 / 事实校验 = 本方案 **WP-D**；**镜头文件怎么挑、怎么由服务端下发**（现在 R2a 只读出片机本机素材目录）= 新包，暂编号 **R2c**，**目前没人认领，请统筹窗口指派**；选择器只输出「镜头需求」`[{tag, kind}]`，**不要两边各做一套 props 生成**。

## 5. 分层判定（平台层级门 · Inline）与 Reuse Statement

**判定**：引擎适配器 = L3（已有）；`list`/`montage`/`quiz` 通用版式 + 目录 + 音乐目录 + 选择器 = **平台共享**（挂在既有「社媒/广告」出片能力下，不新增支柱、能力线、能力名）；旅游专用路线地图 = L2 行业包，**本期不做**；事实适配器 = L3 + L4；props、品牌包、事实快照、素材池标签 = **L4 客户配置**。
**换成地产客户，这套要不要改？** 目录与选择器**代码不用改**，只补三样**数据**：①该行业的事实适配器（楼盘价格、卧室数、开放日，取代团期）；②该行业配方对账行（查 `viral_reference_library` 地产类）；③素材池标签词表（外观/客厅/社区，取代城市/航拍）。模板字段名是通用的（`dateLine`、`itemLabel`、`qualifier`），「PER PERSON TWIN SHARE」这类词只存在于 props。自检：R1 的 `no-client-facts` 扫描要纳入新模板并加旅游词与地产词。
**Reuse Statement**：*复用*——R1 引擎与 `ListReel`/`PriceScene`/参数校验、R2a 出片机分支、`getProductFacts`（#2270）、`callClaudeChat`（仅 D2）、`PlayKey`、`DraftKind`、`pm-todo` 待办出口、Inngest 回执约定、PM 备份的 `beats.py`/`qa.py`/`PunkReel`/`QuizReel`。*新增*（若实施）——模板注册表、音乐目录、两个新模板、选择器，**全部 platform-shared**；industry-specific 本期无；client-specific 只有 props；客户名/ID 没写进共享代码；学习只在 client-private 回执，未升级。

## 6. 开发拆包

写代码默认交 DeepSeek，Claude Code 出指令、审 diff、跑测试。行数不含 JSON 数据与夹具。级别按 `risk.mjs` 路径规则，**已对真实路径跑过 `classifyFile`**：`scripts/factory-worker/` 下的 `.py`、`music.json`、`.ts`/`.tsx`/`.mjs`，以及 `src/lib/factory/`、`src/lib/inngest/functions/`、`src/lib/pm-todo/` 下的新文件，**全部判 B**（只有 `package.json` / 锁文件、`.github/`、`render.yaml`、`kernel`/`billing`/`publisher`/`guardrail`/`cred` 等才升 A，本方案都不碰）。WP-C 碰出片机准入，机器虽判 B，沿用 R2a 先例**自报 A（作下限）、保持草稿**。每个 PR 须带台账卡。

| 包 | 内容 | 行数 | 级别 | 依赖 | 当场试跑 |
|---|---|---|---|---|---|
| **A** 音乐目录 + 自动节拍 + `list` 改造 | `analyze-music.py`、`music.json`、`music.ts`；`list` 的 logo 改最后 2 拍 | ≤300 | B | 无 | 25 首跑出目录；用 `琵琶陷阱` 渲一条 `list`，`qa.py` 量音画偏差（目标 ±50ms），与 10/5 等间隔成片对比，出 9 宫格 |
| **B** `montage` | schema（含 §1.1 卡口）、组件、测试；`no-client-facts` 纳入 | ≤500 | B | A（试跑要自动节拍；单测用夹具） | CTS 真实 props（官网核对值）+ 一套**非 CTS 假 props（悉尼公寓）**各渲一条，各出 9 宫格与 `qa.py` 数字；**现场查 `viral_reference_library` 复核 §2** |
| **C** 模板注册表 + 出片机接线 | R2a 的 `template` 白名单改读注册表；乐库目录放开 | ≤200 | **A（自报，草稿）** | R2a 合并；B | 本机真领一张 `montage` 工单渲一条（`FACTORY_PUBLISH_LIVE=false`），进审核队列；旧 worker 遇未知模板必须拒收 |
| **D1** 选择器（规则版） | 预筛、拼 props（含 endcard、musicFile）、事实回显（含格式归一）、回执、待办与事件 | ≤700（含测试） | B | A、B、C；**依赖 #2270 合并**；与 R2c 对表 | CTS 真实计划 dry-run 3 次（攒池/留资/再营销）；再故意制造 5 种失败（事实 `stale` / `fetch_failed`、日期全过期、选不出歌、endcard 缺、素材池不够），**各自必须不建工单并出待办**；无外部调用、无花费；全程不发布 |
| **D2** 选择器（加大模型） | 只挑歌/钩子样式；`angle` 过滤；成本上限 | ≤250 | B（真调模型要花钱） | D1 跑满一周、看回执再定 | 注入文本、带数字输出、选了候选外各一次必须拒；真调 1 次记录花费 |
| **E** `quiz`（条件做） | 问句开场 + 清单累加，复用价格段 | ≤250 | B | B；PM 回 `做` | 同 B 的双套 props |

**顺序** A → B → C → D1，E 可插在 B 后，D2 看 D1 回执再定。**优先级（CLAUDE.md §11 打分）**：频率**中**（每日计划里 Reel 是周期需求，不是每天）/ IMPACT **中**（在 Act 段但不阻塞：`list` 已能出片）/ 收入**中**（间接影响广告效果）→ 中中中 → **P2**，排队、资源富余时做；PM 已点头要做，排期听 PM。

## 7. 不做清单与待 PM 拍板

**不做**：路线地图类模板 · 接 trending 原声 / 付费音乐接口 / AI 生成音乐 · 自动生成真人或 UGC 镜头（AI 脸不算真人出镜）· 让大模型写模板代码或自由写数字 · 自动发布 / 自动开广告（仍走 R3/R4 与 PM 点头）· 自动学习闭环（只记回执）· 新增数据库表 · 配音/旁白/字幕生成 · 视觉模型自动挑镜头（靠标签）。

**待 PM 拍板（只有业务题）**
1. **「蒙太奇」我理解成：快切 + 卡节拍 + 满屏大字——对吗？**（回 `对`；不对请说差别。）
2. **要不要让 CTS 的导游/员工拍一批真人出镜短片放进素材库？** 不拍，「真人/自拍感/真实感」永远是「未满足」，成片上限就是信息型。
3. **（范围/优先级）第一版只做清单 + 蒙太奇，悬念提问等有数据再说，地图类不做——同意吗？**
4. **（交付方式）你要的「让大模型选模板」我分两步交：先用规则选（不花钱、不会编造），跑一周看回执，再把大模型加在「挑歌和钩子样式」上——同意吗？**

---

## 附录 A：音乐盘点

`ffprobe` 读时长，本机 `beats.py` 自动 BPM（>150 折半，粗体为折半值）。**情绪与适合模板是我按曲名和 BPM 的推测，没听过，入库时要人听一遍。**「(1)」是同曲另一版本（时长不同），各自入库；`Music` 文件夹的文件无标签信息。

| 曲目（文件夹） | 时长 | 自动 BPM → 采用 | 情绪（推测） | 适合 |
|---|---|---|---|---|
| Bass Drop（Music） | 120s | 133 | 强力、冲击 | montage |
| Big Stomp Kick（Music） | 122s | 122 | 重鼓点 | montage |
| Building Momentum（Music） | 120s | 100 | 渐强、推进 | montage · quiz |
| Tension Building（Music） | 120s | 81 | 悬念、紧张 | quiz |
| Clean Final Hit（Music） | 32s | 132 | 结尾重音（短） | montage 收尾 |
| Reveal Hit（Music） | 29s | 103 | 揭晓感（短） | quiz · list 价格段 |
| Feel Good Travel（Music） | 162s | 81 | 轻松愉快 | list |
| Horizon's Call（Music） | 30s | 110 | 开阔、期待（短） | list |
| Horizon's Breath（Music） | 29s | 167 → **84** | 舒缓（短） | list |
| Vinyl Groove（Music） | 168s | 154 → **77** | 复古律动 | list（待听） |
| 琵琶陷阱（Music） | 64s | 139 | 中式乐器、紧凑 | montage |
| 远方的路（Music） | 30s | 91 | 抒情（短） | list |
| Jade River Journey（_shared，CTS 同） | 235s | 132 | 流动、旅行感 | list · montage |
| Founders at Dawn（_shared） | 154s | 90 | 沉稳、励志 | list |
| Founders in Motion（_shared） | 88s | 195 → **97** | 推进、商务 | list · quiz |
| Second Hand Sunrise / (1) | 51s / 64s | 109 / 109 | 温暖、轻快 | list |
| Sunlit Kitchen Window / (1) | 102s / 60s | 100 / 98 | 温暖、居家 | list |
| Sunday Hammer / (1) | 63s / 60s | 199 → **100** / 100 | 打击感 | montage |
| Snap the Floor / (1) | 146s / 175s | 179 → **90** / 118 | 节奏感强 | montage（**两版不一致，待听**） |
| 龙旗破云 / (1) | 61s / 77s | 137 / 90 | 中式、气势 | montage（**两版不一致，待听**） |
| 青瓷回声（_shared） | 30s | 138 | 中式、清亮（短） | montage |
| The Dragon's Dance（_shared） | 19s | 108 | 中式、喜庆（过短，仅够 15 秒版） | montage（勉强） |
| Jayden小弟（_shared） | 180s | 131 | 未知 | 待听 |
| cts_xmas_suno（_shared） | 122s | 120 | 圣诞 | **仅圣诞档期** |
| MiniMax Analytical Scholar（_shared） | 27s | 81 | 冷静（短） | 待听 |
| `_preview/*`（3 个 15s 片段） | 15s | — | Jade River Journey 试听 | 不入库 |

## 附录 B：参数从哪来（缺任何一项 = 不出片）

来源代号：**F** 官网产品事实（`getProductFacts`，#2270：`from_price`/`price_basis`/`duration_days`/`departures`/`inclusions[i]`/`source_url`/`status`）· **B** 品牌包（`master_briefs` VI、`brandkitFor`）· **P** 广告计划 · **A** 素材池（镜头文件 + 标签 + 来源）· **M** 音乐目录 · **T** 模板固定词表（如 INCLUDED，按语言）

| 参数 | `list` | `montage` | `quiz` | 来源 |
|---|---|---|---|---|
| 品牌色 / logo 文件 | ✓ | ✓ | ✓ | B |
| logo 显示方式 | 最后 2 拍 | 最后 2 拍 | 最后 2 拍 | T（固定，不可调） |
| 音乐 id + 节拍数组 | ✓ | ✓ | ✓ | M（代码算，不是模型写） |
| 开场钩子文字（≤9 字符/行） | 3 行 | 词串首词 | 问句 3 行 | 钩子样式封闭清单 + F（数字由代码填） |
| 条目文字（≤48 字符） | 3–7 条 | — | 3–5 条 | F（`inclusions[i]` 原文，按下标；超长就失败，不改写） |
| 词串（每词 1–2 拍，≤12 字符） | — | 14–20 个 | — | 样式清单 + F；城市/卖点词可绑镜头标签 |
| 镜头 | 开场 + 每条目 1 + 价格底 | 池 ≥8 条、≥3 种类型 | 开场 + 每条目 1 + 价格底 | A |
| 价格行：金额、币种前缀、限定语、日期行 | ✓ | 末 4–6 拍 | ✓ | F（`from_price`、`price_basis`、`departures` 未过期者） |
| 价格脚注（事实包没有这一项） | ✓ | — | ✓ | T（中性固定句，不含数字） |
| 音乐文件（R2a 审核硬要求） | 必填 | 必填 | 必填 | M（选不出 = 失败） |
| `copy.endcard`：cta + url（R2a 审核硬要求） | 必填 | 必填 | 必填 | cta←T；url←`source_url` + 追踪参数 |
| 语言 | ✓ | ✓ | ✓ | P → 选 T 词表 |
| 价格/日期以外的数字 | 禁 | 禁 | 禁 | — |

## 附录 C：核对了什么、没核对什么

**已核对（读了文件或本机跑了）**：5 份依据文档；`engines/remotion/` 的 `schema.ts` `timing.ts` `ListReel.tsx` `components.tsx` `Root.tsx` `README`；PM 备份（只读）的 6 个模板、`beats.py`、`qa.py`、节拍 json、`package.json`；`play-vocabulary.ts` 的 `PlayKey` 与 `ad-draft.ts` 的 `DraftKind`；`anthropic/client.ts` 的 `callClaudeChat`；`risk.mjs` 与 `merge-authorization.md` 的路径规则（并对 11 个计划新增路径实际跑了 `classifyFile`：文档 C，其余全 B）；#2261 标题（R2b = 遮罩深浅）；3 个音乐文件夹的 `ffprobe` 与 `beats.py`（只读，临时文件在会话临时目录，不在仓库）。
**没核对**：`viral_reference_library` 现值（沿用记忆与 10/5 审计里的数字，WP-B 现场复核）；#2270 的 `ProductFact` 已按其 head `000873947` 对齐，但 **#2270 尚未合并**，字段以合并版为准；音乐情绪（没听过）；台账卡 `2026-10-05-cts-music-jade-river-ok` 在本基线里不存在（在别的分支；PM 的拍板以对话为准）；没有渲染任何视频、没查生产库、没刷新远端。
