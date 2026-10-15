# 把 Codex 的出片能力搬进视频工厂 · 调研 + 一页设计（只读调研，未写代码）

> 106 号 · 2026-10-16 · 受 18 号转 PM 指示：「PM 对 Codex 窗口做的视频（YouTube Shorts / TikTok 那批，煎饼/上海/重庆等）很满意，要求保持下去，并以代码形式在 ME 后台实现」。
> 状态：调研 + 设计稿，待子牙 + 魏征复核（面向客户内容再加板桥；禁止 Codex 审代码）。风险级预估 **B**（新增模板，只做加法）；其中「配音/付费接口」那一块若自动化属资金动作，按 **A** 另议。

## 1. 先纠正一个认知：PM 满意的那批片，**不是 Remotion 做的**

| 事实 | 证据 |
|---|---|
| 「China, Up Close」长片（上海/杭州/重庆/苏州，16:9，约 2 分钟，已发 YouTube）是 **Python + ffmpeg + PIL 脚本**拼的，不是 Remotion | `~/Documents/ChatGPT/Magic Engine 小工具/outputs/cts-shanghai-film-20261015/`：`render.py`、`add_branding.py`、`finish_audio.py`、`alignment.json`、`captions.ffconcat`、`render-receipt.json`；全目录搜 remotion 无命中 |
| 文字短片（Shorts/TikTok，1080×1920，约 25 秒，无旁白）也是 **Python + ffmpeg + PIL** | `…/outputs/cts-text-shorts-20261016/*/render_text_short.py`（76 行/条）、`text-short-style-v1.json`、`batch-specs.json`、`completion-receipt.json` |
| 「煎饼」不是一条成片，是**待采集的素材清单** | `outputs/cts-food-specific-intake-20261016/煎饼.json、jianbing.json`；`topic-and-ending-direction-v4.json` 写明「5 Must-Try Street Foods in China」尚是计划，素材未齐 |
| Codex 真正的 Remotion 只有两处，且都不是成片管线 | `~/Documents/Codex/2026-10-14/task-2/work/cts-remotion-info/`（3 个旅行信息模板：城市推介/景点推介/旅行指南，**占位素材、20 秒样例**）；`~/Projects/cts-remotion/`（Quiz/Tale/Punk/BoC/List 等早期版式，也是本工厂清单模板的来源之一） |
| Codex 自己 10-13 的交接单也说「未定位到可确认的 Remotion package.json，勿凭文件夹名断言渲染器已部署」 | `outputs/cts-video-factory-handoff/完整交接_2026-10-13.txt` 第 4 节 |

结论：**「Codex 的 Remotion 能力」要搬的其实是两套 Python/ffmpeg 出片逻辑 + 一套素材/授权/质检流程**；用 Remotion 重写是对的（可参数化、可进工单、可逐帧验收），但要如实说「是重写，不是搬运」。

## 2. 两套成片的版式与参数（要保留的观感）

**A. 文字短片 `text-short`（Shorts / TikTok，1080×1920，约 25 秒，无旁白，有 BGM）**
- 版式：开场 1.8 秒大字钩子（3 行，字号 78–92，象牙白 `#FFF8EC` 描黑边）+ 小字副题 → 每景：红色排名牌（`#D11D3A`，60,320,125×125）+ 标题（66px，≤2 行）+ 灰色小标签（28px）+ 底部「一句话」黑底圆角条（46px，居中，≤2 行，y≈1285）→ 最后 1 秒收尾卡「CTS TOURS | ctstours.co.nz」→ 左上常驻角标「CTS PICKS / CHINA, UP CLOSE」+ 真实 logo。
- 布局常量（`text-short-style-v1.json`）：rank[60,320,125,125]、title[220,330,790]、context[60,495]、payoff[70,1280,940]、footer[70,1440]；`first_hook_seconds` 1.8、`end_prompt_seconds` 2、`no_source_loops` true。
- 景参数：`relative_path`（素材库相对路径）、`source_in`（片内起点）、`duration`、`crop`（[w,h,x,y] 竖裁）、`rank/title/label/line`、**每景自带出处**：`source_url、author、license、sha256`。
- 音乐：曲子放 `01_Platform/shared/music/cts-winter-20261015/`（如 `curious-journey-v2.mp3`；有 CC BY 3.0 来源片段，署名写进描述）；淡入 0.15 秒、淡出 0.6 秒、`loudnorm I=-17 TP=-1.5 LRA=10`；无源音频。
- 字体：Arial Bold（系统字体）。
- 质检：render 后断言（时长、非静音抽查、同源不重复、抽 7 帧 QA 图、`render-receipt.json` 记全部来源）。

**B. 长片 `documentary`（YouTube，1920×1080，约 2 分钟，英文新西兰口音旁白）**
- 旁白：ElevenLabs「Sam – New Zealand」（`voice-preset.json`；`eleven_multilingual_v2`，stability 0.4/similarity 0.75/style 0.3，语速系数 0.9）；脚本约 313 词；`narration-receipt.json` 记脚本哈希与字符数。
- 字幕：按真实配音**强制对齐**（`alignment.json`）→ 逐句 PNG → `captions.ffconcat` 叠加；不是估时。
- 画面：约 14 个互不重复的 Pexels 实景源（每个记 `source_url/author/licence/sha256`），逐景剪成 `scene-N.mp4` 再 concat。
- 品牌：开场（0.35–6.8 秒，「CHINA, UP CLOSE / SHANGHAI / BEYOND THE SKYLINE / A CTS TOURS SERIES」+ logo）、常驻右上角标（白底 logo）、片尾（109–118 秒，地址/网站）；`branding-receipt.json`。
- 其余：封面 `youtube-cover.png`、描述草稿、`final-approval.json`。

**与工厂现有模板的差异**

| | 工厂 `list`/`postcard`（Remotion） | Codex `text-short` | Codex `documentary` |
|---|---|---|---|
| 画幅/时长 | 1080×1920，15–20 秒 | 1080×1920，约 25 秒 | 1920×1080，约 120 秒 |
| 文字 | 大字 + 短卡，字体 Montserrat | 排名牌 + 大字钩子 + 一句话条，Arial Bold | 逐句强制对齐字幕 |
| 声音 | 仅 BGM | 仅 BGM（无源音频） | 旁白 + BGM |
| 素材 | 预剪好的 `clips/*.mp4` | 原片 + 起点 + 裁切（逐景） | 原片逐景剪 |
| 来源登记 | `credits-*.json` 手写 | **每景强制** url/作者/许可/sha256 | 同左 + 证据文件 |
| 出处闸 | postcard 有「一句话必须官网可溯」 | 有「素材可溯」，没有「文案可溯」 | 有事实核对笔记 |

## 3. 搬进工厂的最小做法（复用出片机与引擎，不另起炉灶）

**阶段 1（先做，最接近 PM 满意的观感）：Remotion 新模板 `textshort`**，加在 `scripts/factory-worker/engines/remotion/`，与 `postcard` 同一套机制（`templates.ts` 注册、`remotion-branch.mjs` 的字幕/caption/红线复扫、同一批机器闸）。
- 参数进工单 `brief.remotion.props`：`hook{lines[],small}`、`scenes[]{clip(sourceRelativePath), sourceIn, duration, crop?, rank?, title?, label?, line, source{url,author,license,sha256}}`、`closing{text}`、`brandBug{kicker,series}`、`music{file, fadeIn, fadeOut}`、`layout`（缺省 = `text-short-style-v1.json` 的坐标）。
- 复用：`Footage`（加 `startFrom` 与 `crop` 两个可选参数，缺省行为不变）、`Logo`、音乐目录与响度归一、出片机认领/回执、体检 7 项、禁词闸/画面价格闸（原样沿用）、`stageRemotionAssets`。
- 新增机器闸：每景 `source.*` 四项必填、`sha256` 在批内不重复（同源去重，比文件名去重可靠）、`no_source_loops`；`crop` 必须落在原片尺寸内。
- 素材：出片前从 Dropbox 库按 `relative_path` 读入出片机素材目录（沿用 `stageRemotionAssets`；**同时要解决 Dropbox「仅云端」读不出来的问题**，见出片机交接单第 6 节）。

**阶段 2：`documentary`（16:9 长片）**：同一引擎加第二个 Composition；旁白与字幕对齐作为**工单的输入文件**（`narration.mp3` + `captions[]` 时间表），Remotion 只负责排版/混音/品牌包装；ElevenLabs 合成与对齐留在工单之外（属 Buy，且花钱，按 A 级单独审批）。

**阶段 3（另议）**：把「选题 → 脚本 → 配音 → 对齐」接成 Inngest 工作流，每步留回执（符合 CLAUDE.md §3 的工作流硬约束）。本稿不做。

## 4. 「保持 PM 满意的观感」怎么验收（逐帧对拍）

用 Codex 已发/已评审的成片当基准（先做 `three-china-double-takes-v2` 与 `food-steam-sizzle-sip`，各自带 `spec.json` 与 `render-receipt.json`，素材路径都在 Dropbox 库里）：
1. 把 `spec.json` 机械转换成 `textshort` 工单 props（写一个小转换脚本，转换规则入库，可重跑）。
2. 经工厂真实出片（不另写脚本直调渲染）。
3. 对拍：同一批时间点（钩子 0.5 秒、各景首尾、收尾卡、末帧）抽帧，**逐像素/SSIM** 比较；文字卡区域 SSIM ≥ 0.95、素材区域按裁切一致性判定；总时长误差 ≤ 0.1 秒；响度 −17 ± 1 LUFS；字体用 Arial Bold，确认 Remotion 渲染机上能加载（本机 Mac 可用，换机要随包带字体文件，**Arial 是系统字体，不能随仓库分发**，要评估改用同形字体）。
4. 不一致的点写成差异表交苏东坡/马良判断「可接受 / 要改」，不自行裁定。

## 5. 复用声明与边界

- 复用：出片机、Remotion 引擎、postcard 的机器闸、`stageRemotionAssets`、素材来源登记习惯（credits JSON）、Dropbox 素材库（`99_Catalog/inventory.json` 记录了 Codex 的来源字段，是现成的来源数据）。
- 平台共享：模板与闸。行业/客户专属：系列名「China, Up Close」、角标文字、红色 `#D11D3A`、Sam 音色、每景素材与文案全进客户 props / 配置，**模板默认值里不写客户名**。
- 不做：不改 `list/postcard/montage/datacard` 任何已有导出；不自动调用付费配音；不写发布。
- 流程：设计 → 子牙 + 魏征 + 板桥 复核 → **DeepSeek 写**（aider one-shot，预计 3–4 轮）→ 实施后再审 → 合并 → 升级出片机 → 当场试跑一条 → 对拍 → 苏东坡/马良审。**禁止 Codex 审代码。**

## 6. 需要向 Codex 窗口要的（请 18 号转 PM）

1. 哪几条成片是 PM 点名满意的（文件名/链接）；我现在只能猜是 `cts-text-shorts-20261016` 里的 `food-steam-sizzle-sip`、`three-china-double-takes-v2`，和 4 条 China, Up Close 长片。
2. `01_Platform/shared/music/cts-winter-20261015/` 里每首曲的来源与商用授权证据（Suno/CC BY 3.0 混杂；`completion-receipt.json` 只写了署名，没写授权证明）。
3. Arial Bold 的替代方案（出片机若换机/上云）与 Codex 是否另有字体要求。
4. ElevenLabs 的账号/额度归属与成本（长片用）；对齐用的是什么工具（`alignment.json` 的生成脚本没找到）。
5. 「5 Must-Try Street Foods」的素材何时到位（煎饼/肉夹馍/生煎包/biangbiang 面/糖葫芦，目前只有清单）。
