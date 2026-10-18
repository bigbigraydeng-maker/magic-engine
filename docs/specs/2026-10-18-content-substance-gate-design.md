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

## 10. 子牙 / 魏征首轮复核后的修订（子牙「带条件通过」、魏征「打回，改完再审」；已采纳，与上文冲突处以本节为准）

### 10.1 判据加固（魏征 1、2）
- **按「单个元素连续可见」算，不再累计相加**：每个文字元素必须**连续可见 ≥ 2 秒**才计入；同类元素按**时间区间并集**算，防止 30 个 0.1 秒闪字凑数（list 条目最短 1 帧、montage 词最短约 0.25 秒都够不上）。
- **文字要实质**：`clean()` 之后（去零宽/不可见字符）长度 ≥ 3 个字符（中文 ≥ 2 个字）且含字母/汉字；`place`/`line` 填 "a"、空格、纯符号一律不计。
- **扣掉淡出**：atmosphere 的文字在淡出遮罩开始后不计可见时间（`AtmosphereReel.tsx` 淡出区间）。
- **各模板映射（写死，逐一）**：
  - list：`hook.lines` + `items[].text`（地名）→ `place_or_tour`；`revealTitle` 或价格卡 → `selling_line`/`brand_card` 视内容（价格卡不算 `brand_card`，只有 `revealTitle`≥2s 且非纯价格才算）。
  - postcard：`scenes[].place` → `place_or_tour`；`scenes[].line`（带出处）→ `selling_line`；`end.title` ≥2s → `brand_card`；价格卡不算 `brand_card`。
  - datacard：文字卡的 `hook`/`rows` → `selling_line`（带「仅数字补充，非主力片」标记，仍需过人工项）。
  - montage：`words` 是 10–30 个节奏词（如 "GO"），**不属于任何一类** → 单靠 montage 的词不满足；montage 要过闸必须额外带 `place` 标签或片尾品牌卡（**需要给 montage 加这两个可选字段，或明确 montage 不是「对外成片」模板、只能 `asset_only`**——交 PM/子牙定，我倾向后者，因为现网 montage 近 30 天 0 单）。
  - atmosphere：默认空；路 A 加 `place`/`endCard`，路 B 标 `asset_only`。
- **诚实的局限（必须在给 PM 的汇报里写明）**：闸只能保证「有字、有出处、有时长」，**挡不住「标签齐全但内容仍薄」**（一个 16 秒单镜头 + 「Shanghai」+ 品牌卡也能过机器闸）。「薄不薄」只能靠人工项。品牌卡内容不做语义核对。`line` 的出处检查是词重叠 + http 网址，较弱，已知。
- 新增字段全部 **optional**（旧 props 才能重放）。

### 10.2 服务端复核改为「自己重算」，并有开关（子牙 1、2）
- 服务端**不信出片机自报的 verdict**：用 `wo.brief.remotion.props`（下单方写、出片机改不了）在 `src/lib/factory/` 里用一份**纯函数 `contentSubstanceOf`（TS）**自己重算；引擎是 .ts 但不进运行时（`engine-loader.ts` 注释），所以**两份实现 + 对拍测试**（先例 `montage-contract.test.ts`）：同一批 props 夹具，引擎版与服务端版结果必须一致。
- 完成回执白名单（`complete/route.ts:58-90`）要显式加 `content_substance`（作为审计字段与对拍依据，不作判决依据）。
- **过渡**：出片机回执带 `capabilities: ['content_substance_v1']`；服务端用开关（环境变量/`factory_config`）控制「缺失/不合格 → 拒收」，**默认先只告警**，确认出片机已升级（读回 capabilities）后再翻开关，避免旧出片机白渲后 dead_letter。

### 10.3 `asset_only` 不可发布：堵三处 + 严格枚举（子牙 3、4、5）
- `deliverable` 严格枚举（`'asset_only'` 或缺省）；拼错一律按成片处理（走内容闸），不放行。
- 三处拦截：`review-apply.ts` 的 `applyApprove` → 409；`review-sync.ts` 的 Airtable 通过路径（休眠但路由在）→ 加判断；`publish-worker.ts` 的 `processOne` 兜底：`brief.remotion.deliverable==='asset_only'` 一律失败。
- `archived` 已在数据库 CHECK 与 `types.ts` 内，**无需新迁移**，但目前没有写入方、看板把它当「发布后归档」→ 审片页用 `output.deliverable` 单独分区「素材（不单独发布）」，不混进归档统计。
- **「收入素材库」落地方式（修正）**：素材的真正落点是出片机本机素材目录（`<STUDIO_ROOT>/<客户>/remotion-assets/`），工单状态改 `archived` 并不会把文件放进去。本设计**删掉「收入素材库」这个说法**，改为：`asset_only` 工单审通过 = 记 `review_ref.asset_accepted_by/at` 并置 `archived`，**文件由出片机侧入库脚本/人工搬运到素材目录**（另立小任务，不在本闸内）；本闸只负责「标了 asset_only 才放行、且不可能被发布」。

### 10.4 V3 清单：存版本号，堵降级（魏征 4）
- `review_ref.checklist_version`（`'v3'`）与清单一同存；`humanKeysForStored` 先读 `checklist_version`，缺省才按键推断（兼容旧回执）；**含 v3 版本号却缺新键 = 无效**（防降级）。
- 同步改动清单补全：`review-actions.ts`（35、49 行）、`rejectPayload.ts`（理由标签加新键）、`ReviewInbox.tsx`（HUMAN_CHECK_LABEL 穷尽 Record、一键面板、批量通过）、`content-review.ts`（`CONTENT_CHECK_KEYS`）、`chat.ts` 工具枚举。
- 出路说明：「看不懂」FAIL 打回后，系统会重开一张同 props 的新单（`reopened_from` 对 remotion 单直接拒绝，见 `remotion-branch.mjs`），所以**打回理由必须引导改下单参数（加内容或改标素材）**，打回面板对该项给出专门提示，而不是重跑原参数。

### 10.5 风险级别与拆 PR（魏征 5、子牙 6）
- **整体按 A**：PR-2 改的是审批与发布授权语义（`review-apply`/`complete-work-order`/发布兜底），属「状态字段当发布授权」老坑，虽 `risk.mjs` 按文件只判 B，**一律草稿 + 正文「风险级别：A」+ PM 回「合」**（不靠 risk.mjs 自报）。
- **拆 3 个 PR**：PR-1（先合，服务端安全面）：V3 常量+`checklist_version`、`asset_only` 三处拦截、发布兜底、完成回执白名单（此时无 `asset_only` 工单，不起作用，先合安全）；PR-2（A，出片机侧）：引擎 `contentSubstanceOf` + 出片机渲染前拒单 + 回执 + capabilities；PR-3：服务端重算复核（默认只告警）+ 审片页分区/人工项 UI，之后翻开关。

### 10.6 验收：只读重放，不往生产队列写（魏征 3）
- **17419d99 的重放**：props 取自 `content_work_orders.brief.remotion.props`（只读调查 PM 已常规授权）或存储 `segments.json` 的 `props`；脱敏后存成**测试夹具**，用 `processRemotionOrder` 的依赖注入（`healthFn`/`loadEngineFn`/`renderFn` 可替换）重放：期望 `RemotionOrderError('内容闸…')` 且 `renderFn` 未调用；同夹具加 `deliverable:'asset_only'` → 放行；服务端侧对同 props 的重算 verdict = fail。**不再提交整链测试单**（会写生产、会污染 PM 的审片队列）；翻开关前再做一次**升级后的只读冒烟**即可。
- 正例夹具：7049d162、cc876dc3（list）、00f23d78、cb752a8f（postcard）的真实 props → 全部 pass。
- 回执计数：dead_letter 可被一键复活会反复被拦刷屏 → 拦截原因标注「需改下单参数，复活无效」。

## 11. 第二轮复核后的补丁（子牙「带条件通过」、魏征「带条件通过」；已采纳，与上文冲突处以本节为准）

**判据（魏征 1–4，写死）**
- **每个文字元素自己必须连续可见 ≥ 2 秒才计入；时间区间并集只用来去掉重叠，不用来凑够 2 秒**（30 个紧挨着的 0.25 秒词不算）。
- list 的条目/hook 行按 `ITEM_BEATS=2` 拍约 1 秒，**达不到 2 秒，不计**；list 只靠 `revealTitle`（非纯价格文字、8 拍 reveal 段内连续显示）过闸，**固定归为 `brand_card`**，不做语义分类；list 没有 `sourceUrl`，不套 `selling_line` 的出处要求。postcard 带价格卡时没有 `end`，品牌卡走不通 → postcard 以 `scene.place`（≥3 秒的 `sceneSec`）满足 `place_or_tour`。
- atmosphere 的文字可见时间 = **自 `fadeInFrames + 18 帧` 起、至 `总长 − fadeOut` 止**。
- **如实写进给 PM 的汇报**：这道闸对 list / postcard / datacard 基本是「空转」——它们在 schema 层就必填文字；**真正有牙的只有 atmosphere（`line` 可为 null）和 montage**。所以验收里「正例全 pass」只能证明没误伤，不能证明闸有效；有效性只能由 17419d99 重放被拦来证明。闸挡的是「空」，挡不住「乱填」（"aaa"）。

**服务端与发布（子牙 1–5）**
- **PR-1 不能让服务端先「必填 V3」**：`review-apply.ts:77/116`、`ReviewInbox.tsx`、`rejectPayload.ts`、`chat.ts:44` 现都是 V2，PR-1 若先必填 V3，通过/打回全部报 400。**PR-1 只做：版本号读写、`asset_only` 拦截、完成回执白名单、「V2/V3 都收」**；必填 V3 与界面**同一个 PR** 一起上。
- `humanKeysForStored` 改签名读 `review_ref.checklist_version`，**4 个调用点**：`publish-worker.ts:191`、`instagram-crosspost.ts:477`（首轮漏了它）、`review-sync.ts:214`、`:242`；`applyApprove` 写 `review_ref` 时补写 `checklist_version`。**切换日之后批准的回执必须带版本号才放行**（魏征 5，防降级）；`review-sync.ts` 的通过路径按同一规则强制。
- `asset_only` 补四点：①`publish-worker` 兜底用 `markFailed(..., forceTerminal=true)`（否则落成 `publish_failed` 排重试）；②「审通过置 `archived`」需要一个**新接口**：仅管理员、仅 `asset_only`、仅 `in_review` 条件更新；③`review-sync` 通过路径同样拦 `asset_only`；④`week-overview/build.ts:84` 只隐藏 `archived` 等状态，`in_review` 的 `asset_only` 会混进周概览 → 加标注/过滤。已核实无其它入口能把工单推到 `approved`（仅 `review-apply.ts:93`、`review-sync.ts:222`；sweeper/revive/TikTok 路由都过不去）。
- **闸的位置钉死**：`remotion-branch.mjs` 里放在 `TEXT_WIRED_TEMPLATES` 检查**之后**、素材 ffprobe 预检与音乐人声检查**之前**——这样用 17419d99 的 props 重放时不依赖本机素材文件，且能证明 `renderFn` 未被调用。
- 回执 `capabilities`：`parseMediaEvidence` 现会丢未知键，**先加白名单**才能读回；**下单入口是否放行 `brief.remotion.deliverable` 未核实**（仓库里目前没有任何 `deliverable` 实现），实施 PR 第一件事就是核。
- 「默认只告警」期间服务端没有防线 → 台账卡写明**翻开关的条件**（读回 capabilities=content_substance_v1 且 0 张旧回执在飞）并**加日历提醒**。服务端重算 list 要复制 `HOOK_BEATS/ITEM_BEATS/REVEAL_BEATS` 与 `fb()` 取整，夹具覆盖 beats 边界；montage 若定为只能 `asset_only`，服务端只需「非 `asset_only` 一律 fail」。

**打回（魏征 6）**：remotion 单「看不懂」FAIL 打回时**不再重开新单**（新单带 `reopened_from` 会被 `remotion-branch.mjs:623` 直接拒绝成死单），与 `chat.ts:119` 现有行为对齐；打回面板提示「改下单参数：加内容或改标素材」。
