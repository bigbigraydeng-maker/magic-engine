# 「有没有实际内容」闸 · 设计稿（只设计，未写代码；待子牙 + 魏征审，再给 PM 看）

> 106 号 · 2026-10-18 · 起因：氛围片样片 17419d99 被 PM 批「没有实际内容，不是合格短视频」——可它的 7 项自动体检全是 PASS。体检全是**技术项**（有声音、9:16、字幕时间轴、封面不黑…），没有任何一项问「这条单独发给粉丝，能看懂在讲什么吗」。这是**系统缺闸**，不是个别疏忽。
> 范围：视频工厂 Remotion 成片（CTS、East Inter 等对外 Reel）。风险级别见 §5（**A**，别降）。

## 1. 现状事实（已读代码核实）
- 封面「黑屏」检查（`cover_frame_not_blank_or_placeholder`）目前只是自动清单里的一项：服务端 `complete-work-order.ts:288` 用 `buildReelMediaAutoChecks` 生成，**判 FAIL 时工单照样进 `in_review`**，只是审片页「通过」按钮被禁（自动清单必须全 PASS，`review-apply.ts` 的 `applyApprove` 会 422）。也就是说它并不是「不进审片页」；本设计要的 fail-closed 比它更严。
- 出片机已有「渲染前拒单」的惯用做法：`remotion-branch.mjs` 里 `throw new RemotionOrderError(...)`（如音乐人声闸、`TEXT_WIRED_TEMPLATES`、素材时长预检）→ 工单失败（dead_letter）、不出片、不进审片页，原因写进失败记录。
- 每个模板的「屏幕上会出现的字」在出片机里本来就有精确来源：`buildRemotionText / buildPostcardText / buildDatacardText / buildMontage… / buildAtmosphereText`（都从 props 取，不靠 OCR）；`segments.json` 也记了 `props`。
- 氛围片（atmosphere）现在的 props：`line` 可为 `null`、没有片尾卡、没有地点/团名字段 → 17419d99 屏幕上除左上角 Logo 外**没有任何文字**。

## 2. ① 机器闸：`content_substance`（出片机算，服务端复核，fail-closed）
**判据（结构化，不靠 OCR、不靠语义猜测）**：对 CTS 等对外成片，整条片屏幕上必须同时满足：
1. 出现下列至少一类**有出处/有结构的文字元素**：
   - `place_or_tour`：地点/团名标签（postcard 的 `scene.place`、list 的 `item.text`/`revealTitle`、atmosphere 新增的 `place`），
   - `selling_line`：一句带 `sourceUrl + sourceQuote` 的卖点/信息句（postcard `scene.line`、atmosphere `line`），
   - `brand_card`：片尾品牌卡（团名/网站，≥2 秒；postcard `end`、atmosphere 新增 `endCard`、list/datacard 的收尾卡）；
2. 这些文字在屏幕上的**累计可见时长 ≥ 3 秒**（由各模板的时间轴算出，防止「闪一帧就算有字」）。
**怎么取「屏幕上有字」**：每个模板导出一个纯函数 `contentSubstanceOf(props)` → `{ kinds: ['place_or_tour'|'selling_line'|'brand_card'], textSeconds, texts: [...] }`，直接读 props 与该模板的时间轴（与现有 `buildXText` 同源，不用 OCR/不用字幕推断）。
**哪些模板天然满足**：list（hook 文字 + 条目地名 + 收尾标题）、postcard（地名 + 一句话 + 片尾标题/价格卡）、datacard（文字卡本身就是文字）、montage（`words` 非空且累计 ≥3s，空词表不满足）。**atmosphere 默认不满足**（`line=null`、无 `place`、无 `endCard`）。
**不满足时**：出片机在**渲染之前**拒单（`RemotionOrderError('内容闸：整条片屏幕上没有团名/地点/卖点/品牌卡，不是能单独发布的成片…')`）→ 工单失败，**不出片、不进审片页**（像音乐人声闸一样 fail-closed）。
**服务端复核（纵深防御）**：出片机把 `content_substance` 写进 `segments.json` 与完成回执（`mediaEvidence.content_substance`）；服务端 `complete-work-order.ts` 对 `brief.remotion` 工单**必须带它且 `verdict ≠ fail`**，缺失/不合格 → 422 拒收（旧版出片机、被绕过的出片机也过不了）。
**例外必须显式**：纯氛围/养池素材要在工单里**显式标记** `brief.remotion.deliverable = 'asset_only'`（「素材，不单独发布」）。标了才放行；放行后：`output.deliverable='asset_only'`，审片页单独分区「素材（不单独发布）」，**没有「通过·待发布」按钮**，只有「收入素材库」（把工单置为已有状态 `archived` 并记 `review_ref.asset_accepted_by/at`）；服务端 `applyApprove` 对 `asset_only` 工单一律 409，发布链路只认 `approved`，所以它**不可能被发布**。不标 = 按成片处理 = 过内容闸。

## 3. ② 人工闸：审片页清单加一条
在审批清单（现 `REEL_HUMAN_CHECK_KEYS_V2` 那套，含「已开声音听过」）再加：`standalone_understandable` —「**这条单独发给粉丝，他们能看懂在讲什么吗**」（建议措辞，PM 可改），通过前必须 PASS。做法同上次加「已听声音」：`REEL_HUMAN_CHECK_KEYS_V3` = V2 + 新项；审批入口（`review-apply`/`review-actions`/`chat`/`ReviewInbox`/打回面板）一律 V3；**已存的回执按 `humanKeysForStored` 自适应**（含新项用 V3，含「已听声音」用 V2，否则旧 9 项），旧的已通过未发布单继续能发布。一键通过面板里这项**不预勾**、「全部标为通过」**不替人勾**（与「已听声音」同规则）。
**这道闸的局限（如实）**：机器闸只能保证「有字」，不能判断字写得有没有意义；「能不能看懂」只能靠这条人工项。

## 4. ③ 氛围片自身：两条路，给 PM 选（我只写利弊，不替他定）
**路 A：做成有内容的成片版**——加地点标签（如「Shanghai · Huangpu River」，须有出处）+ 一句卖点或信息句（须官网可溯）+ 片尾品牌卡（团名/网站 ≥2s）。
- 利：能单独发主页/广告；走现有「通过·待发布」；符合新闸；沿用已出的片子与流程，改动小（给 atmosphere 加 `place`/`endCard` 字段）。
- 弊：加了字就更像普通宣传短片，失去参考视频「几乎无字」的气质；一句卖点必须有官网出处，外滩日落本身没有对应的 CTS 产品事实，写不好就是空话（PM 刚批评的就是「没实际内容」）；只靠加字未必让 PM 认为它「是合格短视频」——内容感还得靠分镜/故事，单镜头 16 秒本身就薄。
**路 B：降格为「素材，不单独发布」**——显式标 `asset_only`，只入素材库，用作 postcard/list 等成片的片头/片尾背景（例如外滩日落做 postcard 的 end backdrop）。
- 利：诚实——它本来就是一段好镜头，不是一条完整的片；不碰「内容」判断；素材可被多条成片复用（日落片尾比现在用的夜景外滩更贴题）；风险最小。
- 弊：「单镜头氛围片」这个产品目标（PM 参考视频那类）就没有了，要另想办法（例如后续做有故事线的版本：多镜头+旁白/字幕+品牌卡）；需要 §2 的 `asset_only` 流程（审片页分区、收入素材库）先做完才能放行这类素材；素材库的使用要另有人去用，不然只是堆积。
（也可以 A、B 并行：这条降格为素材，另做一条有内容的新片——这是第三种，PM 可选。）

## 5. 风险级别（我判 **A**，不降）
碰 `scripts/factory-worker/remotion-branch.mjs`（受保护文件 = A，`risk.mjs` 实测）；同时改审批语义（`review-apply`、`content-review`、`complete-work-order` 实测各为 B，但与受保护文件同一语义的闸，整体按 A 处理）。拆 PR：**PR-1（A，草稿，PM 回「合」）**：引擎 `contentSubstanceOf` + 出片机渲染前拒单 + 回执字段；**PR-2（B）**：服务端复核 + `asset_only` 的 approve 拒绝 + 审片页分区/「收入素材库」+ `standalone_understandable` 人工项（V3，含旧回执兼容）。PR-1 先合并并升级出片机，PR-2 再合；两者之间服务端对「缺 `content_substance`」先只告警、PR-2 合并后转拒收，避免合并日停产。写代码走 DeepSeek，子牙+魏征审实际 diff，禁 Codex。

## 6. 验收（怎么证明闸生效）
- **真实证据（必须）**：拿 **17419d99** 的真实 props（`line:null`、无 place/endCard）重放：`contentSubstanceOf` 判 fail；整链提交一张同 props 的无害测试单到升级后的出片机 → **被拦**，日志含「内容闸」原因、无成片、不进审片页；再提交同画面但标 `deliverable:'asset_only'` 的单 → 放行并出现在「素材（不单独发布）」分区、**没有通过按钮**，且直接调 approve 接口得 409。
- **正例（不能误伤）**：重放 7049d162（list）、cc876dc3（list）、2772 之前已通过的 postcard 工单 props（如 00f23d78、cb752a8f）→ 全部 `pass`，回执 kinds 非空。
- 单测：每个模板的 `contentSubstanceOf`（含 montage 空词表、atmosphere 三种组合、文字累计 <3s 判 fail、`textSeconds` 边界 2.9/3.0）；出片机拒单接线（未标 asset_only 且无内容 → 不渲染）；服务端复核（缺字段/fail → 422；asset_only → approve 409）；V3 清单（缺新项被拒、旧 9 项与 V2 回执仍能发布、一键面板需勾选且批量不替勾）。
- 基线：引擎 `node --test test/*.test.mjs`、`npx vitest run scripts/factory-worker src/lib/factory src/app/dashboard/factory src/lib/social` 修改前后各记命令与退出码。

## 7. 回执（每次拦截写原因）
- 出片机拒单：工单失败记录里写「内容闸」+ 缺什么 + 各类别累计秒数；`segments.json` 写 `content_substance = { verdict: 'pass'|'asset_only'|'fail', kinds, textSeconds, reason }`（通过与 asset_only 也写，便于审计）。
- 服务端 422 拒收：返回并记录 `content_substance_missing` / `content_substance_failed`。
- 拦截计数进每日待办的「做了没验」口径（沿用台账/cron_run_logs），避免静默拦很多条没人知道。

## 8. 不做什么
- 不做 OCR、不用大模型「看画面」来判有没有内容（不可复现、会漂）；
- 不判断文字是否「有意义/写得好」（交给人工项）；
- 不改已发布内容、不追溯旧单（旧工单按旧口径）；
- 不在本设计里替 PM 选氛围片路 A/B；
- 不改 list/postcard/datacard/montage 的画面与时间轴（只新增纯函数读取）。

## 9. 待 PM 决定
1. 氛围片走哪条：**A 加内容 / B 降格素材 / A+B 并行**（利弊见 §4）。
2. 人工项措辞是否就用「这条单独发给粉丝，他们能看懂在讲什么吗」。
