# postcard「Story 变体」小设计 · 一页版（草稿，待子牙+魏征复核）

> 106 号 · 2026-10-15 · 风险级 **B**（只在 postcard 模板内加可选分支，不改 list/montage/datacard，不动 `list` 的任何导出）。
> 起因：PM 点名 Story 太单薄（只有单图、没音乐）。MVP：每天 3 条 Story 里先把 1 条（08:30 灵感条）做成 6 秒左右竖屏视频：一张景点画面缓慢推近 + 一行字 + 背景音乐烧进视频，无价格，走视频工厂。18 号 2026-10-15 同意「给 postcard 加 story 变体，不新做模板」。
> **本稿只是设计；代码未写。** 交 97 号接手（106 收工）。

## 1. 现有 postcard 为什么做不了 Story

| 缺什么 | 现状（`src/postcard.ts`） |
|---|---|
| 单景 | `scenes` 最少 2 个 |
| 6 秒总长 | 开场 ≥2 秒 + 景 ≥3 秒/个 + 片尾 ≥3 秒 → 最短约 11 秒 |
| Story 安全区 | 只按 Reel 的 y 270–1248；Story 底部被回复框/发送栏盖得更多 |
| 无钩子、无片尾 | `hook` 必填；`price`/`end` 必须二选一 |

## 2. Story 安全区（Meta 官方口径，写进代码常量）

1080×1920 画布，**顶部 14%（≈270px）和底部 20%（≈380px）不放字/logo**，可用区 y 270–1540；右侧仍留 120px。logo 现位置 top 292–463 已在可用区内，不动。Reel 的 y≤1248 约束不适用于 Story。

## 3. 参数（新增，全部可选，缺省 = 现有行为完全不变）

- `variant?: 'story'`：存在才走 Story 规则；不存在 = 原 postcard，**解析与时长逐字不变**。
- Story 规则（只在 `variant==='story'` 时放宽/改变）：
  - `scenes` 必须正好 1 个；`hook` 可以是 `null`（直接以景开场，第 0 帧就是画面+字）；`price` 与 `end` 可以同时为 `null`（不要片尾）；
  - `timing`：`hookSec` 缺省 0（hook 为 null 时必须是 0 或缺省）、`sceneSec` 4–8、`priceSec` 缺省 0；**总长 4–10 秒**（默认样片：景 6 秒）；
  - `cardTop` 范围放宽到 600–1200（卡片约 300px 高，底边 ≤1540）；
  - 字号：卡片一句话 ≥ 72px（比 Reel 的 66 大一档，Story 在手机上更近、更要「大而慢」）；一句话字宽上限收紧到 ≤ 18 单位（约 1.5 行）；
  - 淡入 0.8 秒（Reel 为 0.6 秒）；缩放速度不变。
- 价格：Story 变体**不允许** `price` 非空（价格只放 Reel 首评；Story 无价格）。
- 音乐：沿用 `musicFile`；曲目编号写进工单备注（`angle_source.note`）与周包文档（84 号周包表无曲目列，先写周包文档）。
- 其余闸（禁词、画面价格闸、出处闸、不可见字符）**全部沿用**，不得因 Story 放宽。

## 4. 改动面（只做加法）

- `src/postcard.ts`：加 `variant`、Story 分支校验（superRefine）、`computePostcardTiming` 对 `hook===null`/`price===null && end===null` 的处理、`collectPostcardAssetFiles` 不要访问 `null`。
- `src/PostcardReel.tsx`：`hook`/片尾为 `null` 时不渲染对应 Sequence；Story 用更大字号与更长淡入（读 `props.variant`）。
- `scripts/factory-worker/remotion-branch.mjs`：`buildPostcardText/Caption/Srt`、`assertPostcardTextVisible` 对 `hook===null`、无片尾的处理（SRT 只有 1 条）。
- 测试：`postcard.test.mjs` 新增 Story 用例（最短 4 秒、单景、无钩子无片尾、cardTop 1200 合法/1201 拒绝、非 story 的 1 景仍被拒、带价格被拒）；`remotion-postcard-branch.test.mjs` 新增 hook=null 与无片尾用例。
- 不改：`ListReel.tsx`、`PriceScene.tsx`、`timing.ts`、`schema.ts`。

## 5. 「现有行为不变」的证据（自动、可重跑）

①同一批现有 postcard 工单 JSON（本目录 `docs/clients/cts/2026-10-15-silk-panorama-reel-orders/*.order.json`）改前改后 `loadTemplate` 的 `totalFrames`、`assetFiles` 逐字相同；②现有全部 engine 测试与 `remotion-branch` 测试保持通过（当前基线：engine 474、出片机 vitest 71+）；③`render-smoke` 渲 1 帧静帧逐像素比对（旧 props）。PM 摘要说法：**「旧版视频改完后一模一样」**。

## 6. 复核与实施

设计 → 子牙 + 魏征复核（面向客户内容再加板桥；禁止 Codex 审）→ DeepSeek 写（aider one-shot，预计 2–3 轮）→ 实施后再审 → 合并 → 升级出片机 → 出 CTS 1 条样片（景点用已核实地点的图，如莫高窟/天池/兵马俑；无价格）→ 自检 → 派苏东坡/马良审 → **第一次真实视频 Story 发布要 PM 本人在场点头，由 84 号负责发布端**。

## 7. 待定（复核时定）

1. Story 字号 72 是否够（中老年）；是否要 `cardScale` 参数而不是写死。
2. 总长上限 10 秒是否合适（Meta Story 单条最长 60 秒，但「灵感条」要短）。
3. 无钩子时第 0 帧文字是否要「淡入前就完整可见」（封面要求）——建议 Story 变体文字从第 0 帧完整显示，不淡入。

## 8. 复核意见（魏征 2026-10-15，已采纳；以本节为准，与上文冲突处以本节为准）

1. **安全区更保守**：卡片「顶 + 高」≤ **1480**（不是 1540）；「Meta 官方口径 顶 14%/底 20%」没有附出处，**动手前先去 Meta 官方 Stories 规格页核实**再写进常量。
2. **读得完**：Story 单景至少 **7 秒**（`sceneSec` 7–9）；一句话 ≤ 14 个字（约 1 行半）；字号 ≥ 72px；**文字从第 0 帧完整显示、不淡入**（取消「待定 3」，定为必须）；`cardScale` 做成可选参数。总长上限仍 10 秒。
3. **不削弱红线闸**：Story 变体里每景仍必须带 `sourceUrl` + `sourceQuote` + `placeSourceQuote` 并过出处闸、禁词闸、画面价格闸；`variant` 漏写就回到旧规则（有测试覆盖）。
4. **补写**：封面 = 第 0 帧（文字完整）；BGM 响度按 7 秒量（不是前 15 秒）、尾部 0.5 秒淡出；曲目版权/署名写进工单备注；同日 3 条 Story 的景点/文案去重，纳入 84 号周包去重规则。
5. **价格在 schema 强制**：`variant==='story'` 时 `price` 必须为 `null`，用 `superRefine` 直接拒绝并写测试，不能只靠文档。

## 9. 复核意见（子牙 2026-10-15，已采纳；与上文冲突处以本节为准）

1. **会渲染崩溃的点要写明**：`PostcardReel.tsx` 最后一个 Sequence 一直渲染——`price` 与 `end` 都为 null（`priceSec=0`）时必须**整个跳过**；`hookFrames=0`（hook 为 null）同理跳过 hook 的 Sequence。
2. **`remotion-branch.mjs` 里要处理 null 的地方**（行号来自 PR 2674 之后的版本）：`buildPostcardText` 的 `props.hook.lines.map`、`props.end.title`；`assertPostcardTextVisible` 的 `props.hook.lines`、`props.end.title`；`buildPostcardSrt` 不要插入 0 秒的 hook cue（过滤）。`Root.tsx`、`templates.ts` 只调用 `computePostcardTiming`，不用改。
3. **做法改为「story 单独一个 schema 分支」，不要在现有 schema 上放宽**：`postcard.ts` 里 `HOOK` 改 `.nullable()` 会让原 `superRefine` 里的 `val.hook.lines`（三处）崩，且「非 story 却 hook 为 null」的报错文案会从「Expected object」变掉；基础 schema 里 `scenes.min(2)`、`hookSec min 2`、`sceneSec max 6`、`cardTop 600–940`、`price/end` 二选一都是硬限制。所以：`variant==='story'` 走独立的 `StoryPropsSchema`（`scenes` 恰好 1、`hook` 可空、`price` 必须 null、`end` 可空、`hookSec/priceSec` 可为 0、`sceneSec 7–9`、`cardTop 600–1200`，但卡片顶+高 ≤1480），解析入口按 `variant` 分流；原 schema 一字不改。
4. **措辞更正**：「≤18 单位约 1.5 行」不对——中文卡宽 768px、72px 约 10.7 字/行，18 字就是 2 行；高度按 2 行算够（卡片约 290px，`cardTop` 1200 时底边约 1490）。按魏征意见改成一句话 ≤14 字。
3 条之外：总长校验与音量曲线在 4–10 秒下没有除零问题。
