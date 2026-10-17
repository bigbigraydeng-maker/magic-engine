# 氛围片模板 `atmosphere` · 一页设计（草稿，待子牙 + 魏征审；禁 Codex 审）

> 106 号 · 2026-10-18 · 风险级 **B**（Remotion 引擎新增一个模板，只做加法，不改 list/montage/datacard/postcard 的任何导出）。DeepSeek 写；设计稿先审，成品再审一次。
> 起因：PM 参考了一条 Instagram Reel（香港维港日落单镜头 + 女生背影，几乎无字幕，情绪歌）。要做的是**只借风格**的 CTS「单镜头氛围片」：画面和那首歌都不能用。18 号 10-18 转 PM「做」。
> 一切出片只走视频工厂；样片只发 PM 看，不发布、不进广告素材池。

## 1. 为什么要新做（调研结论）
现有 4 款都做不了：list 要 3–7 条清单 + 价格页；montage 要 ≥8 镜头 / 3 类镜头 / ≤20 秒；datacard 是信息卡；postcard 要开场 + ≥2 景 + 一句话卡且 ≤25 秒。postcard 的 Story 变体只有设计稿、代码里没有，且限 4–10 秒。凑 montage 要伪造镜头数，违背素材真实原则。

## 2. 版式与参数（`brief.remotion = { template: 'atmosphere', props }`）
- **画面**：一个素材铺满 1080×1920，**不切镜**；`clip`（暂存相对路径）、`sourceIn`（秒，缺省 0）、`crop?`（`[w,h,x,y]`，把 16:9 原片裁成竖版）；缓推镜可选且**极慢**（`push` 缺省 0：不推；上限 1.04 倍），**不调色、不压暗**（保留日落原色）。
- **时长**：`durationSec` 12–20；素材可用时长（`sourceIn` 起）必须 ≥ `durationSec`，**不循环、不定格**（不足直接拒单）。
- **淡入淡出**：`fadeInSec`（0.6–1.5，缺省 1.0）、`fadeOutSec`（0.8–2.0，缺省 1.5），画面与音乐同时进出；**第 0 帧不是黑屏**（淡入从 25% 亮度起，保证封面/首帧完整可用）。
- **文字（可选，≤1 行）**：`line`（≤12 个字宽单位，缺省无）+ 必填 `sourceUrl` + `sourceQuote`（有字就必须官网可溯，沿用 postcard 的出处闸）；位置在安全区 y 270–1248 内；缓入。无字也是合法成片。
- **品牌**：`logoFile` / `logoMode`（沿用现有 Logo 组件，位置同其它模板）。
- **音乐**：`musicFile`、`musicStartSec`，**必须过人声闸**（出片机已按 sha256+区间检查，`music-vocals.json`；本模板不另写）。响度沿用引擎默认（成片 −16～−17 LUFS 为验收区间）。
- **不允许**：价格字段（模板里没有）、倒计时/限时等禁词（沿用共享禁词表）、画面价格闸（沿用）。

## 3. 改动面（只做加法）
`engines/remotion/src/atmosphere.ts`（schema + 时长计算 + `collectAtmosphereAssetFiles`）、`AtmosphereReel.tsx`、`templates.ts` / `Root.tsx` 注册、`render.mjs`；出片机 `remotion-branch.mjs` **显式接线** `buildAtmosphereText/Caption/Srt` 与 `assertAtmosphereTextVisible`（datacard 曾因漏接被 `DATACARD_NOT_WIRED` 拒单，必须有测试证明新模板接到了红线复扫）；禁词表走现有共享那份，不复制第三份。品牌色/系列名等不写进模板默认值（`no-client-facts.test.mjs` 会扫）。
接线进 `remotion-branch.mjs` 是 A 级受保护文件 → **本 PR 会被判 A，需 PM 回「合」**（2721 的规则）。

## 4. 配方对账表（动手前先出，出片时逐列回填；库：`viral_reference_library` travel 类 306 条，其中 33 条氛围/慢节奏标签、72 条有分镜配方）
| 配方列 | 参考片做法 | 我们这次做法 | 状态 |
|---|---|---|---|
| 首秒直接出现最精彩画面 | 落日圆盘+水面 | 日落画面第 0 帧即出（淡入从 25% 亮度） | 满足（待验） |
| 单镜头一镜到底 | 是 | 一个素材、不切 | 满足 |
| 真实素材（非 AI 假动态） | 实拍 | Pexels 实拍，不用 Ken Burns 静图 | 满足 |
| 极少文字 | 几乎无字幕 | 0–1 行，有字必须官网可溯 | 满足 |
| 情绪配乐、无人声 | 情绪歌 | 登记表内无人声曲（jade_river_journey，成片 ≤19 秒） | 满足（弱证据，仅审片通过） |
| 人物背影/真人出镜 | 女生背影 | **没有**（无自有素材、无肖像授权；不用库里有人的片冒充） | **未满足** |
| 地点真实可溯 | 维港 | 上海外滩/黄浦江（Pexels 作者与页面可查），不冒充别的城市 | 满足 |
| 时长 | 约 15–20s | 12–19s | 满足 |

## 5. 验收与试跑
- 单测：schema 边界（11/12/20/21 秒、素材可用时长不足、缓推上限、有字无出处被拒、禁词/价格被拒）、时长与淡入淡出算术、第 0 帧亮度、`collectAtmosphereAssetFiles`、出片机接线（红线复扫对新模板生效）。
- **当场试跑**：真实出片机出 1 条样片（外滩日落 + jade_river_journey），只到待审；出分镜自检 9 宫格（逐镜核对画面是否为外滩/黄浦江、有无人像、文字、logo）；样片只发 PM，不发布、不进广告素材池；对外发布另需 PM 授权。
- 基线：修改前后各记 engine `node --test`、出片机 vitest 的命令与退出码。

## 6. 素材（只来自 Pexels，Pexels 许可：免费商用、无需署名、不得转售原片）
候选与授权证据入 `credits-*.json`（Pexels 页面、作者、许可）；下载进 `~/Dropbox/MagicLab_Studio/CTS/remotion-assets/` 下指定目录（不进仓库）；每条下载前先报 文件名/来源/时长/分辨率/大小，经 PM 确认再下。
