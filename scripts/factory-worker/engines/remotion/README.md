# Remotion 渲染引擎（R1 模板试做）

通用「费用包含清单」竖版视频（1080×1920，30fps）：开场三行字 → 3–7 个条目各配一段镜头 → 价格揭晓 → 常驻 logo → 可选音乐。
**模板里没有任何客户内容**：文案、价格、颜色、素材文件名、节拍全部来自一份 props JSON，换客户只换这份文件。

这是独立的 npm 包，自带依赖和锁文件，**不是**主站的一部分：根目录的类型检查、lint、`npm test` 都不会扫它（见根 `tsconfig.json` / `vitest.config.ts` 的排除项）。
目前没有接入任何运行中的流程（没有接出片机、没有读 Master Brief、没有每日计划）。

## 安装

```bash
cd scripts/factory-worker/engines/remotion
npm ci
```

需要 Node ≥ 22.18（props 校验文件是 TypeScript，Node 直接运行；渲染本身走 Remotion 自带打包）。

## 渲染

```bash
node render.mjs --props <props.json> --out <out.mp4> [--public-dir <素材目录>] [--concurrency 2] [--timeout-sec 600]
```

- `--public-dir`：props 里写的所有文件名都相对这个目录，默认是本目录下的 `public/`（已 gitignore，视频/音乐/大图一律不进仓库）。
- `--timeout-sec`：总超时，默认 600 秒（10 分钟），超时会终止并以退出码 124 结束。
- `--browser-executable` 或环境变量 `REMOTION_BROWSER_EXECUTABLE`：指定已有的 Chrome Headless Shell，省去首次下载。

退出码：`0` 成功 · `2` 命令写错 · `3` props 不合格 · `4` 素材文件缺失 · `5` 渲染失败 · `124` 超时。每种失败都会打印一句中文原因。

渲染前一定先校验：缺字段、多字段、超长、网址、绝对路径、`..`、条目数越界、颜色非法，全部在**打开浏览器之前**拒绝。**没有任何默认值**：缺哪项就报哪项。

## props 规则

| 字段 | 规则 |
|---|---|
| `brandColor` | `#RRGGBB` |
| `itemOverlayOpacity` | 条目页镜头上黑色遮罩的深浅，数字 0–0.6（含）；`0.4` 是原来的效果，越小背景越亮，`0` 不加遮罩；必填，无默认值 |
| `musicStartSec` | 可选，0–600 秒：音乐从文件的第几秒开始放（`beats` 是相对这个起点的时间）；缺省按 0，旧 props 不受影响。由 `excerptFor` 算出，音乐起点落在视频帧边界上 |
| `logoFile` / `musicFile` / 各 `clip` | 只允许相对文件名（可带子目录），禁止网址、绝对路径、`..`、空格；扩展名限制：logo `png/jpg/jpeg/webp`，音乐 `mp3/wav/m4a`，镜头 `mp4/mov/webm`。`musicFile` 可为 `null`（无音乐） |
| `logoMode` | 可选，`last_beats`（缺省）＝ logo 只在最后 2 拍出现；`always` ＝ logo 全程常驻 |
| `beats` | 剪辑节拍时间（秒），严格递增，最多 80 个；条目数 N 时至少需要 `2N+13` 个；用到的最后一个节拍不得超过 90 秒 |
| `hook.lines` | 恰好 3 行，每行 `{ badge, text }`：`badge` 可为 `null`（最长 6 字符），`text` 最长 9 字符，且「徽章长度+1+文字长度」不超过 9（再长会折行，版面会乱）；第 3 行带高亮底色 |
| `items` | 3–7 条，每条 `{ text(≤48), clip, blurBackdrop }`；`blurBackdrop=true` 表示该条是抽象概念，镜头只当模糊氛围背景，避免画面假装在表现它 |
| `itemLabel` / `revealTitle` | 条目上方小字、价格上方标题 |
| `cutFlash` | 可选布尔；`false` 去掉切镜时的闪白，不写＝照旧闪白 |
| `footageScrim` | 可选数字 0–1，所有镜头上「下半屏压暗渐变」的强度倍数；`1` 或不写＝原来的效果，`0.35` 约为三分之一强度，`0` 不压暗；字幕靠自带阴影保持可读 |
| `price` | `{ backdropClip, fromLabel, currencyPrefix(直接拼在金额前，如 `A$`), amount(正整数), qualifier, dateLine, footnote }` |
| `price.dateLine` | 可选；不写＝价格页不显示日期那一行 |
| `price.footnoteSize` | 可选整数 30–60，脚注字号，缺省 30 |

时长随 `beats` 与条目数动态计算：开场 4 拍，每条目 2 拍，价格揭晓 8 拍（`src/timing.ts`），没有写死条目数。

### 例子（虚构，非任何真实客户）

`examples/sydney-apartment.props.json`：4 条目、无音乐。生成占位素材后可以直接渲：

```bash
node tools/make-placeholder-assets.mjs --out /tmp/remotion-demo
node render.mjs --props examples/sydney-apartment.props.json --public-dir /tmp/remotion-demo --out /tmp/remotion-demo/out.mp4
```

占位素材是 ffmpeg 生成的渐变色块，只用来验证流程，不是真实镜头。

## 音乐目录与自动节拍（包 A）

`catalog/music.json` 登记了可用的库乐（29 首，来自 `MagicLab_Studio/Music` 与 `MagicLab_Studio/_shared/music`；客户专属曲不入共享目录）。节拍不再手写：`src/music.ts` 的 `beatsFor(entry, itemCount)` 从目录里的 BPM / 首拍偏移 / 小节位算出 props 里的 `beats`，`stagedFileName(entry)` 给出 `props.musicFile` 要写的安全文件名（渲染时音频要以这个名字放进素材目录，原文件名带空格和中文）。

- **音乐人声登记（出片前必过，2026-10-16 起）**：出片机在渲染前按**暂存后实际文件的 sha256**查 `catalog/music-vocals.json`，只有登记为「无人声」且已核验区间覆盖本次用到的 `[musicStartSec, +成片时长+1 秒]` 才出片；含人声、未登记、区间没覆盖、登记表坏了都一律拦下（旧版 legacy 与 recipe 路径同样检查，`music_mood` 由引擎自选曲的一律拒绝）。新增或换了一首曲子（包括 `_n/_q` 等派生文件，各自独立登记，不继承母曲）后，必须由**真人**听过再登记，`signedBy` 只接受 `human:<名字>` 或回填脚本生成的 `PM审片@<工单号前8位>`；转写（whisper）只能用来提名可疑，不能当作「无人声」的依据。登记表改动一律按 A 级流程。回填脚本：`node ../../tools/backfill-music-vocals.mjs --studio-root <镜像目录> --out entries.json`（只读，只认 PM 已通过的已发布工单）。
- **新增一首**：`python3 ../../tools/analyze-music.py <音频文件>` 输出一行 JSON（时长、检测 BPM、首拍偏移、小节位），照格式补 `id / folder / file / energy / style / mood` 进 `music.json`，状态先写 `beats_unverified`（只表示节拍还没量过，与版权无关）。需要 python3 + numpy + scipy + ffmpeg（出片机已有 Python3 + ffmpeg）。
- **检测会翻倍**：算法偏向报更快的拍，同一首曲子的两个版本测出过 199 与 100。所以检测值 > 150 一律按双倍速折半（`FOLD_ABOVE_BPM`）；**每首歌第一次渲完要量一次音画偏差**（PM 备份里的 `qa.py`），在 ±50 毫秒内才把状态改成 `ready`。
- **`beats_unverified` 的歌先不让选器选用**（选器是后续包）——只因为节拍还没用渲后偏差量过，不是版权问题；目前只有 `pipa-trap` 量过（偏差 −10 毫秒），其余 28 首待量。
- 音乐只用 PM 已拍板可商用（含广告）的三个文件夹（`Music`、`_shared/music`、`CTS/remotion-assets/music`），不再核对；名字带 `temp` 的是临时文件，不入目录。
- **从指定小节起播**：`excerptFor(entry, itemCount, startBar)` 返回 `{ musicStartSec, beats }`（`beats` 相对起点，第一个值是所选小节的起点，落在 0–1 帧内）；把两个值一起写进 props。`beatsFor` 仍是「从文件开头放」的老用法，不变。
- **目录里的 BPM / 首拍还是旧分析器算的**（只看前 60 秒、拍点偏早一帧）。`analyze-music.py` 现已改为整首分析并修掉偏一帧（合成鼓点轨：旧版首拍早 20 毫秒，新版 ±2 毫秒），新数值会让首拍晚 12–46 毫秒；有 5 首 BPM 与目录对不上（`big-stomp-kick` 122.5→124.5、`feel-good-travel` 81→121.9、`founders-in-motion` 194.6→97.1、`snap-the-floor` 179→159、`analytical-scholar` 81→104.1），所以**没有批量重写目录**，等这些听过、量过再重生成。
- logo 现在只在最后 2 拍出现（`LOGO_BEATS`），不再常驻每一帧。可选 `logoMode: "always"` 恢复常驻；不写则仍是最后 2 拍。
- 音乐的测试在 `test/music.test.mjs`，由 `schema.test.mjs` 末尾一行 import 带进 `npm test`（`package.json` 是受保护路径，本包不动它）。

## 蒙太奇快切模板（包 B，`--template montage`）

快速切镜头（每拍一切，指定小节半拍加速）、切点卡在音乐节拍上、满屏大字词串，1080×1920，目标 15 秒左右（`beats[totalBeats]` 不得超过 20 秒）。渲染：`node render.mjs --template montage --props <props.json> --public-dir <素材目录> --out <out.mp4>`；不写 `--template` 就是原来的清单模板。示例：`examples/sydney-montage.props.json`（虚构，镜头文件用 `tools/make-placeholder-assets.mjs` 生成的占位素材，音乐自备一首约 120 BPM 的）。

props 里没有任何默认值，缺项直接拒。`src/montage.ts` 的卡口（对应方案 §1.1，防「卡得很准的幻灯片」）：
- **第一个词必须从第 0 拍开始，且是数字或问句**；视频第 0 帧就有镜头和大字（第 0 拍恒为第 0 帧，音乐首拍晚于 0 秒也不会黑屏）。
- 镜头池至少 8 条、至少 3 种类型（`aerial` 航拍 / `street` 街景 / `person` 画面里有人 / `detail` 细节）；相邻两镜不重复；有 `person` 镜头时每第 3 个无标签镜头位固定用它。`person` 只表示「画面里有真人」，**库存里的路人也算，不等于真人出镜 / 自拍感，那一列仍是未满足**。
- 词可带 `clipTag`，该词所在拍只用同标签镜头，找不到同标签镜头直接拒；一个标签至少要有 2 条镜头（只有 1 条会连续重复）。**含地名、景点、产品名的词必须带 `clipTag`**：props 里的 `placeTerms` 列出本片出现的地名（可为空数组，但必须写），词里含其中任何一个（不分大小写）而没绑标签就拒。试跑里没绑标签的「YANGTZE」词叠在长城镜头上，正是这种张冠李戴。
- 闪白只在每 4 拍的重拍（光敏安全；第 3 拍的轻闪已去掉），其余只推近 / 抖动；`buildMontageSegments` 会检查任意 1 秒内闪白不超过 3 次，超了拒；logo 只在最后 2 拍；音乐必填。
- `loadTemplate('montage')` 同时返回 `recipeGaps`（配方里这套 props 满足不了的列）：镜头池没有 `person` → 「真人出镜/自拍感」未满足；没有 `own` 来源 → 「真实感」未满足。`render.mjs` 会打印出来，出片机写进 `segments.json` 的 `recipe_gaps`。
- 每条镜头带 `lenFrames`（时长帧数）、可选 `luma`（平均亮度，用来拉平镜头间亮度差）、`source`（own / stock / ai）。
- 音画偏差：节拍对应帧整体后移 `MONTAGE_SYNC_SHIFT_FRAMES = 2` 帧（实测：1 帧时偏差 −33 毫秒，2 帧时 +1 毫秒）。

## 明信片模板（`--template postcard`）

一句话一景：全屏素材慢推，下半部一张半透明「明信片卡」（地点小字 + 一句话），**没有 N/N 计数、对勾方块、进度条、弹跳动画**，字幕放慢（每景默认 3.6 秒，文字淡入 0.6 秒），给 45–70 岁观众。开场 1–3 行文字钩子 → 2–4 景 → 价格卡（复用 `PriceScene`）→ 可选 logo、音乐。1080×1920，30fps，文字在安全区 y 270–1248、x ≤ 960 内。渲染：`node render.mjs --template postcard --props <props.json> --public-dir <素材目录> --out <out.mp4>`；示例（虚构）：`examples/fictional-postcard.props.json`。

参数与闸（`src/postcard.ts`，`.strict()`，**没有默认值**，缺项直接拒）：
- 用「字宽单位」限长（中文 1.0、英文字母数字 0.55、空格 0.3）：钩子每行 ≤ 8.7、一句话 ≤ 25、地名 ≤ 19，避免折行爆版。
- **禁词闸**：钩子、地名、一句话、价格文字里出现「限时/截止/早鸟/倒计时/最后机会/仅剩/名额/限量/deadline/early bird/countdown/last chance/book now/only N seats left…」一律拒；英文按整词匹配（`unlimited` 不误杀）。它只拦这些词，**拦不住编造的行程或价格**。
- **出处闸**：每景必须带 `sourceUrl`（http/https）和 `sourceQuote`/`placeSourceQuote`（出处原文），且原文里要含这句话的主要词。**这只证明「填了且相关」（一句话里至少一半的主要词要出现在出处原文里），不证明官网真有这句话**——事实核对仍靠人工与苏东坡审；渲染前自动抓网页核对是后续项。
- **价格可以不上屏**：`price` 填 `null`、改填 `end: { backdropClip, title }`，片尾换成一张只有标题的卡（有的团画面里不许出现价格）；两者必须二选一。
- 总时长 = 开场 + 景数×每景 + 价格卡/片尾卡 ≤ 25 秒；默认样片 2 景约 16.4 秒。
- 同周多条片请用不同的 `cardSide`（`left`/`center`）和 `accent`，避免又像同一个模子。

**出片机已接它**：`remotion-branch.mjs` 收到 `postcard` 工单，把钩子、每景「地名 + 一句话」、价格块拼成字幕和红线复扫用的 caption；不可见字符/双向控制字符会被拒；仍受客户准入名单（`FACTORY_REMOTION_CLIENT_IDS`）约束。**旧版出片机不认识 `postcard`，会拒收**——升级出片机之前不要建 `postcard` 工单。

## 数据卡模板（`--template datacard`）

纯数字画面，**没有镜头素材**：钩子大字（第 0 帧就是字，不是风景）→ 3–7 行数据逐行出现（标签、数值、可选副标签）→ 可选对比条形或阶梯 → 底部固定一行免责小字 → 可选 logo、可选音乐。1080×1920，30fps，内容都在安全区 y 270–1248、x ≤ 960 内，不烧 CTA。渲染：`node render.mjs --template datacard --props <props.json> --public-dir <素材目录> --out <out.mp4>`；示例（虚构）：`examples/fictional-datacard.props.json`。

模板里没有任何客户内容，所有文案、数字、颜色都来自 props，**没有默认值**，缺项直接拒（`src/datacard.ts`）：

| 字段 | 规则 |
|---|---|
| `bgColor` / `textColor` / `brandColor` | `#RRGGBB`；文字色按各自合成后的实际底色（背景、卡片、副标签 0.85 透明、免责 0.8 透明）对比度都 ≥ 4.5，品牌色（数值与条形，按半透明卡片合成后的底色算）≥ 3，不够直接拒 |
| `logoFile` / `musicFile` | 相对文件名或 `null`（不要就写 `null`）；`musicStartSec` 可选 |
| `hook.lines` | 1–2 行，每行 ≤ 12 字符，按实测宽度缩放，最宽那行也不越过 x=960；最后一行用品牌色；开场先在画面中央放大停留 `hookSec` 秒，再缩到顶部 |
| `hookSec` / `rowSec` / `holdSec` | 开场停留 1–4 秒 / 每行出现间隔 0.6–2.5 秒 / 结尾停留 1–6 秒；总时长 = 三者相加，没有节拍 |
| `rows` | 3–7 行，`{ label(≤20), value(≤10), sublabel(≤28 或 null), bar(0–1 或 null) }`；渲染时按实际字形宽度测量，超出所在栏就整体缩小（不折行、不越界） |
| `barMode` | `none`（所有 `bar` 必须 `null`）/ `bars`（等起点条形，行间比长度）/ `steps`（条形起点逐行右移成阶梯）；非 `none` 时每行都要写 `bar` |
| `disclaimer` | 底部固定一行小字，≤ 44 字符，整片常驻（过宽按实测缩小） |

`loadTemplate('datacard')` 返回 `recipeGaps`：对照 `viral_reference_library` 的逐列对账见 `DATACARD_RECIPE_RECONCILIATION.md`（2026-10-14 实查：库里没有数字画面配方，也没有物流/贸易行业）；视觉冲击、真人出镜/自拍感、真实感、行业配方 4 列恒为未满足，`render.mjs` 每次都打印。数据卡只做纯数字补充内容，不能替代有真人/实拍的主力片。

已知限制：极端文案（整行全是最宽字母 W）在渲染器每个并行页的第 0、1 帧（约 66 毫秒）仍会短暂超宽，第 2 帧起按实测缩放正常，原因未查清；普通文案第 0–3 帧平滑，无此现象。

**出片机已接它**：`remotion-branch.mjs` 收到 `datacard` 工单，会把屏幕上全部文字拼成字幕和红线复扫用的 caption；仍受客户准入名单（`FACTORY_REMOTION_CLIENT_IDS`）约束，名单没动。

## 出片机怎么用这些模板（包 C）

出片机（`scripts/factory-worker/remotion-branch.mjs`）按工单 `brief.remotion = { template, props }` 渲染：`template` 必须是 `src/templates.ts` 注册表里有的（现在是 `list`、`montage`、`datacard`、`postcard`；`datacard`、`postcard` 已接，见上节），不认识的直接拒（不重试）；`--template` 会原样传给 `render.mjs`。**旧版出片机不认识 `montage`，也会拒收**——所以升级出片机之前不要建 `montage` 工单。

- **音乐从共享乐库取**：`props.musicFile` 如果是 `catalog/music.json` 里某首的暂存名（`stagedFileName`，如 `pipa-trap.m4a`），出片机从 `<STUDIO_ROOT>/<目录里的 folder>/<file>`（即 `Music/`、`_shared/music/`）拷进该单暂存目录，路径必须落在该乐库文件夹内（含符号链接）；不在目录里的音乐名仍按 R2a 老办法从该客户的 `remotion-assets/` 取。出片机 Mac 上这两个乐库文件夹要在（Dropbox 同步到 `MagicLab_Studio/` 下）。
- **目录里的暂存名是保留名**：目录里有的暂存名（如 `pipa-trap.m4a`）一律从乐库取，即使客户素材库里也有同名文件（出片机会写一条「乐库优先」日志）。客户专属授权曲不要放进共享目录，用不同的文件名放在该客户的 `remotion-assets/` 里。
- 目录里状态是 `pending_listen`（节拍没量过）的歌，**出片机不拦**，由上游选择器决定用不用；用了哪首、状态如何，都记在成片的 `segments.json` 的 `music` 字段里。
- **旧版出片机遇到 `montage` 会把单子永久作废**（claim 接口不看出片机会什么）：必须先把所有出片机升级到含包 C 的版本，再建 `montage` 工单。错误信息以 `UNKNOWN_TEMPLATE:` 开头，方便搜。
- 节拍间隔不得小于 0.25 秒（`MONTAGE_MIN_BEAT_GAP_SEC`）。
- 字幕与 `caption`：`list` 沿用原来的三段；`montage` 一个词一条字幕，`caption` 是所有词用 ` · ` 连起来（服务端红线复扫扫的就是它）。
- 成片体检、心跳、上传、`complete` 与 R2a 完全一致；`montage` 的 `musicFile` 必填，所以音轨检查一定会查。

## 测试

```bash
npm test                 # 校验 / 源码扫描 / 命令行护栏，几秒钟，不开浏览器
npm run type-check       # 本包自己的类型检查
RUN_REMOTION_RENDER=1 npm run test:render   # 真渲染冒烟（本机，需要 Chrome + ffmpeg，约 1 分钟；不进 CI）
```

`test/no-client-facts.test.mjs` 会扫描 `src/`、`examples/`、`tools/`、`render.mjs`，出现客户事实字样（客户名、官网域名、货币+价格、地名、产品名，词表在测试文件里）就失败，防止客户内容混进共享模板。

## 授权结论与已知限制

- **Remotion 授权**：官网写明个人和 3 人以内的公司免费（含商用）；4 人及以上要付费，自动出片系统走 Automators 档（每次渲染 $0.01、每月最低 $100）。2026-10-05 PM 确认 Magic Lab 目前 3 人以内，可以免费用；**团队长到 4 人时必须改买授权**。「3 人」是否含兼职/外包、免费档下自动出片是否有额外限制，官网摘要没有说明，不能当结论。
- **音乐**：只用 PM 已拍板可商用（含广告）的三个 Dropbox 音乐文件夹，不再核对。
- **本机需要 Chrome**：首次渲染会自动下载 Chrome Headless Shell；也可用 `--browser-executable` 指向已有的。
- **字体**：Montserrat 通过 `@remotion/google-fonts` 在渲染时联网加载，离线环境会等到超时。
- **素材不随包提供**：镜头、logo、音乐都要放进素材目录；客户真实产品/价格的画面只能用客户自己提供的素材。
- **版面**：针对 1080×1920 与 Meta Reels 安全区设计（文字在 y≈270–1248、右侧留 120px）；价格串很长时字号会自动缩小，但整体仍是为「一行价格」设计的。
- **字体**只加载了 Montserrat 的拉丁字符集，中文等会回退到系统字体；文字固定白色，品牌色太浅时对比度会不够。
- **预览**：`@remotion/cli` 仅用于本地预览（`npx remotion studio src/index.ts`，在面板里粘贴 props JSON）；渲染不依赖它。
- **接出片机（R2）前注意**：①`--public-dir` 会被整个拷进临时打包目录，工单渲染应给每张工单建一个只放 props 引用素材的暂存目录；②只信退出码，不信输出文件是否存在（每次启动已先删旧成片）；③打包与选片阶段不支持取消，硬超时最多比设定值晚 20 秒；④本包要求 Node ≥ 22.18，出片机现在写的是 ≥ 22.4，接线时要统一。
- 只迁了 `ListReel` 一个模板；原来的「运营在 X 国 / 已经 N 年」徽章因为带客户声明没有迁移。


## atmosphere（单镜头氛围片，2026-10-18）
一个素材铺满 1080×1920、不切镜、可选一句话（最多折成两行；有字必须带 `sourceUrl` + `sourceQuote`，沿用 postcard 的出处闸与禁词/价格闸）、库乐、无价格、12–20 秒。props 见 `src/atmosphere.ts`：`clip`、`sourceIn`、`crop`（源画面的比例 `{x,y,w,h}`，用来把 16:9 原片裁成竖版，裁出的像素区域必须是 9:16）、`durationSec`、`fadeInSec`/`fadeOutSec`、`push`（≤1.04）、`line`（可为 `null`=无字）、`textTop`（480–1100，避开 Logo）、`musicFile`（可为 `null`）。第 0 帧不是黑屏（黑色遮罩从 60% 淡入，默认淡入 0.8 秒——出片机的封面亮度体检在 0.5 秒取样，遮罩要在那之前褪得足够多），**封面请取淡入结束后的帧**。
出片机在渲染前用 ffprobe 查暂存素材的真实时长与分辨率（素材不够 `sourceIn + durationSec` 就拒单，不循环不定格；回执 `atmosphere_preflight` 记放大倍数，放大 >1.05 倍标「weak: upscaled」）；音乐走人声闸；未接线的模板一律拒单，不再回落到 montage。配方缺口「真人背影/真人出镜」随每次出片写进 `recipe_gaps`。本地冒烟：`node render.mjs --template atmosphere --props <json> --public-dir <素材目录> --out <mp4>`。
