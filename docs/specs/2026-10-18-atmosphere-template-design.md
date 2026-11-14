# 氛围片模板 `atmosphere` · 一页设计（草稿，待子牙 + 魏征审；禁 Codex 审）

> 106 号 · 2026-10-18 · 风险级 **A**（模板本身是只做加法，但要接线进 `remotion-branch.mjs`——A 级受保护文件，PR 保持草稿、正文写「风险级别：A」，需 PM 回「合」）。DeepSeek 写；设计稿先审，成品再审一次。
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

## 7. 子牙 / 魏征复核后的修订（2026-10-18，均「带条件通过」，已采纳；与上文冲突处以本节为准）
1. **复用点更正**：postcard.ts 里 `bannedWordHits`/`priceMentionHits`/`textWidthUnits`/`normalizeForScan`/`ENGLISH_BANNED`/`CHINESE_BANNED` 已 export 可直接用；**出处闸 `isAcceptableSourceUrl`、`quoteSupports` 是私有的**，需给 postcard.ts 加 `export`（只加 export，不改逻辑，附「postcard 行为不变」测试）；不复制第三份。「不改 postcard 的任何导出」改为「不改 postcard 的任何已有行为」。
2. **画面组件**：`Footage` 写死 `contrast(1.1) saturate(1.12)`、不支持 `crop`，`startFrom` 是帧数 → **新写 `AtmosphereFootage`**（不碰 `Footage`，不影响另外 4 个模板）：无调色、无压暗、可选极慢缓推、支持 `crop`、`sourceIn` 秒×FPS 换算。
3. **淡入与封面**：淡入用黑色遮罩 `opacity = interpolate(frame,[0,fadeIn*FPS],[0.75,0])`，第 0 帧不是黑屏；但 25% 亮度的首帧不适合当封面 → **封面取淡入结束后的帧**（工单里写明 `cover_frame`），对账表「首秒最精彩画面」标「弱满足：首帧偏暗，封面另取」。
4. **接线不许静默兜底**：`remotion-branch.mjs` 里 SRT/caption 的三元链与 `templates.ts` 的 `loadTemplate` 末尾默认走 montage → 改为**未知模板直接 throw**；`atmosphere` 分支插在 montage 兜底之前；测试证明漏接会拒单而不是崩在 `props.shots`。同时给 `Root.tsx`、`render.mjs`（`--template` 帮助）加注册。
5. **素材真实时长/分辨率必须渲染前验**：引擎不读文件 → 在出片机 stage 之后、render 之前用 ffprobe 测暂存素材的真实时长与分辨率：`sourceIn + durationSec` 超出时长即拒单；`crop` 越界即拒单；素材高度 < 1920（需放大）在回执里标「画质弱」+ 放大倍数。schema 里的 `sourceDurationSec`（若有）只是自报，不作证据。
6. **`musicFile` 用 `.nullable()`（不是 optional）**，与 postcard 一致（出片机用 `props.musicFile !== null` 判断体检）。人声闸窗口：jade_river_journey 登记 `cleanUntilSec: 20`，窗口算术 `musicStartSec + 总帧数/FPS + 1 ≤ 20` → **成片 ≤19 秒**；schema 上限仍 20 秒，但配这首曲子时以 19 秒为准（其它已签字的整首曲不受此限）。
7. **无字片流程**：不写 `line` 时 caption/SRT 为空，`assertAtmosphereTextVisible` 不得抛错；`probeMediaEvidenceFn`/`completeFn` 是否接受空 caption/空 SRT 要**实测**，不行就用固定占位 caption（如「Shanghai · golden hour」这类不含事实断言的中性文案，须过禁词/价格闸）。
8. **对账表机器输出**：照 datacard，`loadTemplate` 返回 `recipeGaps`（如「人物背影：未满足」），写进 `segments.json`；对账表补列：画质（原片分辨率/放大倍数）、素材授权证据（Pexels 页面+作者）、封面与首帧是否不同、相邻音乐是否与近 7 天重复、文字在安全区且不压 Logo（Logo 在 y292–463，字区从 270 起会重叠 → 字区下移到 y≥480）。
9. **当场试跑补三项**：①ffmpeg 抽第 0 帧验证亮度不为黑；②对一个短素材故意触发「素材时长不足」应被拒；③无字片完整走一遍（空 caption 场景）。基线命令写明：engine 目录 `node --test test/*.test.mjs`；仓库根 `npx vitest run scripts/factory-worker`。
10. **平台化**：schema 字段名/注释不写「日落」「维港」，用「主视觉」「氛围」；新文件不得出现 CTS/Auckland 等词（`no-client-facts.test.mjs` 会扫）。
