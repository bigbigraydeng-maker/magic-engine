# Remotion「明信片」模板（postcard）小设计 · v3（已吸收子牙+魏征+板桥两轮意见）

> 106 号 · 2026-10-15 · 状态：**设计稿 v2，待第二轮复核后才动手写代码**。风险级 **B**。复核人：子牙（架构）+魏征（挑刺）；面向客户成片内容再加板桥；禁止 Codex 审。
> 起因：PM 当面指出 CTS 的 Silk Road / Panorama 两条片「风格过于雷同」。实查根因：CTS 所有 Remotion 片用同一个 `list` 模板，版式写死「`{标签} N/总数` + 红色对勾方块 + 进度条」，只有 3 首 BGM 轮换。


## 0. v3 修订（第二轮三位复核后；以本节为准，与下文冲突处以本节为准）

1. **文字宽度闸（魏征）**：不再用「字符数」。按「字宽单位」算：中文/全角 = 1.0，英文字母/数字 ≈ 0.55，空格 0.3。可用宽度 = 1080 − 右侧 120 − 左右内边距 2×60 = 840px。一句话上限：字号 66 → 每行 ≤ 840/66 ≈ 12.7 单位，**最多 2 行 ≈ 25 单位**；钩子字号 96 → 每行 ≈ 8.7 单位。schema 用这个算法拒绝超长。卡片位置按实际算式写：卡片区 y 780–1100（安全带 270–1248 内），不再叫「底部」，叫「下半部卡片」。
2. **禁词闸（魏征）**：中英文词表分开；英文按**整词**匹配（`limited` 不误杀 `unlimited`）；词表补全：deadline、limited time、early bird、countdown、last chance、hurry、book now、today only、seats left、spots left、selling fast、only N left、限时、截止、早鸟、倒计时、最后机会、仅剩、名额、限量、抢、先到先得、还剩。合法事实（如「小团 12 人」）不拦。
3. **出处闸（魏征 + 板桥）**：schema 只证明「填了出处网址和原文片段、且片段里含这句话的主要词」，**并不证明官网真有**；说明里必须写明这一点。**第二道（本期不做，记为后续）**：出片机渲染前真去抓 `sourceUrl` 核对 `sourceQuote`。在它做出来之前，事实核对仍靠人工 + 苏东坡审。`place` 也必须带出处。
4. **出片机接线补全（子牙）**：`remotion-branch.mjs` 的 `loadRemotionEngine`（约 74–97 行）要把 `computePostcardTiming` 挂上 `eng`；`templates.ts` 的 `loadTemplate` 里 postcard 分支落在 `datacard` 分支之后、montage 兜底之前，并补 `compositionId: 'PostcardReel'`；`Root.tsx` 注册同名 Composition；时长体检 `expected` 约 599–607 行；`assertMontageTextVisible` 在约 503 行（新增 `assertPostcardTextVisible`）；字幕/caption 三元约 590–597 行。
5. **PRICE 对拍（子牙）**：postcard 里自己定义同形状的价格 schema；对拍测试把同一批价格样例（正例 + 字段缺失、超长、`footnoteSize` 越界反例）分别喂给两个 schema，结果必须一致。`PriceScene` 本身复用。
6. **「旧模板不变」的证据（子牙 + 魏征，降级可执行版）**：①同一份 list 与 datacard 的 props，改动前后 `loadTemplate` 得到的 `totalFrames` 与 `assetFiles` 逐字相同；②字幕/caption/体检结果回归用例；③`render-smoke` 渲 1 帧，存静帧后**逐像素比对**（不要求视频逐帧 SSIM=1，H.264 不保证）。完整 SSIM 不做。PM 读到的说法：**「旧版模板出的视频，改完后一模一样」**。
7. **两条新片之间也要各有特色（板桥）**：加 `cardSide`（`left`/`center`）与 `accent` 两个可选参数，同周两条用不同值；验收时要两条并排看。
8. **读得完吗（板桥）**：每景停留做两档样片对比——3.6 秒与 4.5 秒（总长约 16.4 / 18.4 秒）。PM 看片后选。验收：把手机拿远一臂，一句话能读完。
9. **时长**：总长上限算上 logo 与片尾余量，设 25 秒；默认样片 2 景 ≈ 16.4 秒（18 号 2026-10-15 定，只是样片）。
10. **PM 可读版**（板桥）：文档里的「SSIM、安全带、superRefine、出片机升级顺序」只留在技术段落；PM 摘要只讲三件事——和旧片并排是否一眼不同、读得完吗、价格和地名是否与官网一致（这一条机器没验，靠人看）。

## 1. 要什么 · 和 list 并排肉眼不同的三点（魏征 #1）

1. 没有「N/N」计数、没有红色对勾方块、没有进度条。
2. 文字是底部一张半透明「明信片卡」（地点小行 + 一句话），不是画面中央的大字叠标题。
3. 节奏慢：每景 ≥ 3.6 秒、文字淡入 0.6 秒，没有弹跳/旋转入场动画。
**通过标准**：样片和旧片并排放，PM 看了认可「不一样」才算通过；技术自检不能代替。

## 2. 版式（1080×1920；文字全部落在 y 270–1248 内，且距右边缘 ≥ 120px，避开互动栏）

| 段 | 内容 |
|---|---|
| 开场 | 全屏素材 + 钩子 1–3 行（每行 ≤ 12 字符，字号 ≥ 96），无数字徽章 |
| 场景 ×2–4 | 全屏素材慢推；底部卡片：地点行（字号 ≥ 44）+ 一句话（**≤ 48 字符**，字号 ≥ 66，≤ 2 行）；卡片算式：2 行 ×66×1.15 + 地点行 44×1.3 + 内边距 ≈ 300px，卡片顶 y≈820、底 y≈1120，落在安全带内；schema 里用「字符数×字宽」做粗检，渲染后体检做一次实测 |
| 价格卡 | 复用现有 `PriceScene`，停留 ≥ 6 秒 |
| logo | 复用 `Logo` |

## 3. 参数（新 `postcard.ts`，`.strict()`；不用节拍表，用秒）

`brandColor` · `logoFile` · `logoMode` · `musicFile`/`musicStartSec` · `hook{clip, lines[1..3]}` · `scenes[2..4]{clip, place, line, sourceUrl, sourceQuote}` · `price`（**在 postcard.ts 里自己定义同形状的 schema，不去动 `schema.ts` 里私有的 `PRICE`，两份用同一份测试对拍**）· `timing{hookSec=3.2, sceneSec=3.6, priceSec=6}`。
- **机器闸（魏征 #3）**：①`line`/`place`/钩子/价格文字过**禁词检查**（截止、限时、早鸟、倒计时、还剩、最后机会、deadline、limited、early bird、countdown、last chance，大小写不敏感）；②`sourceUrl` 必须是 http(s) 且 `sourceQuote` 必须包含 `line` 里的核心词之一（这只证明「填了且相关」，**不证明官网真有**；真正的闸仍是人工和苏东坡审——子牙 #6）。
- 总时长上限 25 秒（`.max()` + `superRefine`）。
- **默认时长（魏征 #2，不自己拍板）**：2 景 ≈ 16.4 秒；3 景 ≈ 20 秒。**向 PM 问一句：「明信片版要比 15 秒长，能接受 16–20 秒吗？」**得到答案前，样片按 2 景（≈16.4 秒）做。

## 4. 真实改动面（子牙第一轮核实后的完整清单）

**新增**：`src/postcard.ts`（schema + 禁词/出处闸 + `computePostcardTiming` + `collectPostcardAssetFiles`，素材去重，含 hook、各景、价格背景、logo、音乐）· `src/PostcardReel.tsx`（音乐淡出按自己的 `totalFrames` 算）· `test/postcard.test.mjs` · `examples/postcard.props.json`（**虚构数据**，不得含客户名/地名，否则 `no-client-facts.test.mjs` 会红）。

**只做加法的既有文件**：
- `src/templates.ts`：`TEMPLATE_IDS` 加 `'postcard'`，`loadTemplate` 加一支。
- `src/Root.tsx`：加一个 Composition，`calculateMetadata` 用 `computePostcardTiming`。
- `scripts/factory-worker/remotion-branch.mjs`：**不需要改白名单**（`isTemplateId` 已自动放行，第 483 行），**但必须**补三处，否则 postcard 会掉进 montage 分支崩溃或出错字幕——约 590–597 行字幕/caption 的三元写法加 postcard 分支（`buildPostcardSrt`、`buildPostcardCaption`，红线复扫也用同一处 caption）；约 502–507 行补 `assertPostcardTextVisible` 并给 `timing` 赋值；约 598 行时长体检用 `computePostcardTiming`（容差 0.5 秒）。
- `test/templates.test.mjs:65`：写死的 `deepEqual(TEMPLATE_IDS, ['list','montage','datacard'])` 必须改为含 postcard。
- `render.mjs` USAGE 帮助文字、`README.md` 模板清单与升级顺序说明（新模板需先升级出片机再建单）。

**不改**：`ListReel.tsx`、`PriceScene.tsx`、`timing.ts`、`schema.ts` 的任何已有导出。

## 5. 「list 不变」的证据（魏征 #6，自动化）

- 基准 SHA = 本设计动手前的出片机提交（PR 里写明）；在 CI/本机用脚本对同一份 list props 渲「基准版」与「新版」，抽 6 个时间点算 SSIM，要求全部 = 1.000000，脚本入库可重跑。
- `remotion-branch.mjs` 加回归用例：list 与 datacard 的字幕、caption、体检结果与改动前逐字相同；postcard 走自己的分支。
- `schema.test.mjs`、`templates.test.mjs`（已改）、`no-client-facts.test.mjs`、`render-smoke.test.mjs` 全绿。

## 6. 复用声明

- 复用：`PriceScene`、`Logo`、`Footage`、`Reveal`、音乐目录与 `stagedFileName`、出片机认领/回执链路（补完第 4 节三处后才成立）、体检 7 项。
- 平台共享：模板与参数（与客户无关）。行业/客户专属：BGM、文案、素材、节奏数字进客户 props；`src` 内不出现客户名/地名。

## 7. 配方对账（模板层）

开场文字钩子 满足 · text-overlay 满足 · fast-paced 有意不满足（受众 45–70）· 真人/UGC/旁白 未满足 · 真实感取决于素材 · logo 低分特征同 list，可选 `last`。

## 8. 实施与复核流程

DeepSeek 写（aider one-shot，CLAUDE.md §5），106 出指令并审 diff；预计 4–5 轮；PR 写明轮数与花费。设计 v2 → 子牙+魏征第二轮 → 动手 → 实施后再审一次；板桥看非技术视角。**PM 必须回答的一句：见第 3 节时长问题。**
