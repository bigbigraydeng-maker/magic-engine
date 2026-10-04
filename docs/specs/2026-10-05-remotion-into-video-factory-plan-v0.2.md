> 本文件已被 v0.3 取代：docs/specs/2026-10-05-remotion-into-video-factory-plan-v0.3.md

# Remotion 接进视频工厂：方案 v0.2（已吸收子牙 + 魏征首轮审查，待板桥 + 狄仁杰）

日期 2026-10-05 · 状态：**方案阶段，未写任何代码** · 风险级别：A（给外部成片开口子进发布链路 + 新依赖 + 新对外入口）· 取代 v0.1
依据：审计报告 `docs/audits/2026-10-05-video-factory-brief-remotion-audit.md`（PR #2244）· `scripts/factory-worker/worker.mjs` · `src/lib/factory/complete-work-order.ts`、`review-apply.ts`、`publish/publish-worker.ts`。
首轮审查结论：子牙「需改后可进」、魏征「需改后可进」，两人共 7 条 BLOCKER 已逐条并入，见 §7 对照表。

## 0. 目标与不做

目标：PM 的 Remotion 模板能由 ME 按客户资料自动出片，成片走工厂闸门（红线复扫 → 马良 9 宫格 → 审核 → PM 授权 → 发布），之后可被每日计划和广告调用。
不做：每日计划接工厂、工厂成片自动变广告（另立方案）；不替换 make_promo（并存）；不上云渲染；**不新增发布通道**（Publer 适配器单独立项，见 §5-2）。

## 1. 现状要点（已对照代码）

- 工厂 = 云上管工单与闸门 + Mac 管渲染。`worker.mjs` 领单 → 心跳 → 装配 → 上传三件套 → `complete`；服务端 `completeWorkOrder` 复扫红线、品控、进审核。
- Master Brief 有 `vi_colors`（四个色值）、`tagline`、风格词，**没有 logo**；logo 靠 Mac 上 `brandkitFor()`（找不到就失败，不借别人的）。`verified_cta` 在 `clients.factory_config`，**必填 `departure`**（旅游语义）。
- 已有「出片机掉线」机制：`factory-worker-sweeper` 10 分钟无心跳收回 + 今日待办 `worker_offline`。**缺口是：没有开机自启；Remotion 本地渲染可能超 10 分钟而中途无心跳，会被误收回反复重渲。**
- 工厂发布只有 Facebook 适配器（`publish-worker.ts:22` Publer 被注释；`client-config.ts:29`）。**CTS 的视频走 Publer，工厂发不了。**
- Remotion：仓库零代码；PM 工程 `~/Projects/cts-remotion`（6 模板/57 成片，文案价格 logo 写死）。**已备份到 Dropbox**（文件数核对一致）。

## 2. 分层判定（me-platform-tier-gate）

| 东西 | 层级 | 放哪 |
|---|---|---|
| Remotion 渲染适配器 | L3 Connector（本地渲染连接器，挂在「社媒/内容」下） | `scripts/factory-worker/engines/remotion/` |
| 通用版式（列表/问答/故事） | 平台通用，props = phone / url / headline / 可选 price（**不含 departure**） | `templates/generic/` |
| 旅游版式（路线地图/签证/团价） | L2 旅游行业剧本，props 含 departure | `templates/travel/`，**模板注册表带 `industries`，worker 校验客户行业**（`evaluate.ts:118` 已取 industry）；不靠自觉 |
| 价格/团名/logo/品牌色/Slogan | L4 客户配置，只作 props 传入；品牌色取 `vi_colors`、Slogan 取 `tagline`、logo 复用 `brandkitFor`（logo 进 Master Brief 另立项） | 模板 `defaultProps` 一律为空，缺 props 渲染直接抛错 |
- 仓库 CI 加扫描：模板目录里不得出现 CTS、团价、logo 文件名（红线 2）。换客户测试（CTS→Roman→悉尼地产）靠这条 + 行业校验过。

## 3. 方案：先查授权，再六小步，每步一个 PR，前一步绿了才开下一步

**第 0 步（已做完）**：备份。

**第 0.5 步：授权与许可核查（外网读取，需 PM 先获准；不写代码）**
Remotion 商用授权、素材（Pexels/Pixabay 署名要求）、成片音乐版权，各在台账记一条结论。**它能让整个第 2 步作废，所以前置。**

**第 1a 步：外部成片入口（默认锁死）**
- **只给 PM 会话鉴权的管理员入口（`guardAdmin`），不发 worker 令牌给 PM 面，也不复用 Mac 的共享令牌。** 服务端自己建工单（状态直接 `claimed`、占位 worker，避免被出片机抢走），再直接调 `completeWorkOrder()`；来源标在 `brief.source = external_remotion`，不改表结构。
- `publish_blocked` 由服务端强制为真，**调用方不能传这个字段**。
- 成片内容哈希（sha256）做唯一键：同一条成片不能登记两次。
- 成片里每一句文字作为「声明」写进 `brief.copy.segments`，让现有红线复扫能读到；每句的来源**必须是可点开的官网页面 URL 或 Master Brief 字段路径**，服务端抓取核对原文，查不到标「未证实」且不许通过；**价格行必须对上客户 `verified_cta`/官网，没有价格来源就不许出现价格**。
- **服务端自己抽多帧 OCR，与声明文字比对，不一致拒收**（现状只有 worker 里一帧占位词检查，这是新交付物；失败按「没测成」处理，不当通过）。
- `media_evidence`（音轨、响度、字幕时间轴）由 Mac 上的入口脚本复用 `probeMediaEvidence` 计算后上报，但服务端抽查复核。
- 事件与回执（§3 Inngest）：`factory.external_reel.registered`，带 request_id、client_id、work_order_id、source_sha256、no_publish、created_at；人审只推进下一事件，不等于发布授权。

**第 1b 步：例外授权解锁（只管「样片能不能发」）**
- 授权**不放台账**（台账只是提醒用的卡片，没有操作人身份、没绑成片）。授权记在工单 `review_ref.exception_auth = {by, at, expires_at, video_sha256, scope, revoked}`，只由 PM 会话端点写；**钉死成片哈希，成片一改授权作废**；带到期时间、可撤销。
- 闸装在**真正外发的那一步**：`applyApprove`（`review-apply.ts:68`）和 `publish-worker.processOne` 开头（`:178-192`），查不到有效授权就不发，fail-closed。**不装在 worker，也不用状态字段当授权。**
- 广告线同样读它：`/meta-ads/draft` 拿工厂成片的 video_id 时，没有有效授权拒绝。
- 例外只对「工厂有适配器的平台」生效；CTS 要先有 Publer 适配器（§5-2），否则这条授权在 CTS 上等于「允许手工发」——**这正是 D14 的老路，方案明确禁止**。
- 事件：`factory.external_reel.exception_authorized`（带授权人、范围、到期时间）。

**第 2a 步：单模板参数化渲染 spike（只在仓库内，不接工厂）**
挑一个通用模板，把写死的东西全改成 props，`defaultProps` 为空，带结构断言测试（渲染指定帧的文字/元素存在，不做像素比对），CI 扫描生效。目的：先证明「参数化 + 本机渲染」成立。

**第 2b 步：引擎分支接入出片机**
- 引擎写在**工单级 `brief.engine`**（缺省保持现行行为）；**不用** `clients.factory_config.render.engine`（线 B 已占用，只认 `ffmpeg|creatomate`，别的值会被静默降级）。
- claim 请求带 `engines` 能力，认领函数按能力过滤；worker 遇到不认识的引擎**先拒、不重试**（旧 worker 否则会把 remotion 单当 legacy 拼片，`worker.mjs:474`）。
- 与 recipe 的关系写死：`engine=remotion` 的单**不得带 `creative_recipe`**；插入点在 `worker.mjs:493-495` 之前；规定 `assertClientRecipeIntentMatchesBrief` 在「客户配了 recipe 但本单是 remotion」时的处理（拒收而不是放行）。
- `engine=remotion` 的单 `complete` 必须交**模板编号和配方对账表引用**，缺则拒收（现状 `complete-work-order.ts:74` 无 recipe 一律放行，会绕过对账闸）。
- 渲染期间**定时心跳** + 渲染超时 + 单次重试上限；预算熔断对本地渲染没意义，成本记 0，写明 `complete-work-order.ts:267` 会跳过台账。
- 出片机健康检查加 Chromium 与 Remotion 依赖（参照 `BRANDKIT_REQUIRED`）；验证现有「掉线待办」对 remotion 单同样生效；**开机自启仍没有，PM 接受风险**。
- 渲染回执写 `output.render_receipt`（engine、模板 id+版本、props_hash、耗时、media_evidence 摘要），并发 `factory.work_order.in_review`。

**第 2c 步：配方对账表** —— 每个新模板入库前出一份（`viral_reference_library`），不是每条成片一份（CLAUDE.md §8）。
**第 3、4 步（另立方案）**：每日计划 → 工厂；工厂成片 → 广告（补「个人号视频先传官方号拿 video_id」）。

## 4. 验证与当场试跑

- 1a：用 Dropbox 备份里的一条真成片，在**测试客户**（不用 CTS 真账号）登记，拿到真实 `in_review` 回执；故意带一句「未证实」价格，验证拒收；成片在 `output` 里打「样片」标记。
- 1b：**证明 `publish_blocked` 在发布 cron 的草稿模式下也拦得住**（`FACTORY_PUBLISH_LIVE=false` 只是草稿，仍会把视频上传到 FB）；授权到期、被撤销、成片被改，三种情形各试一次都发不出去。
- 2b：用 CTS 真 Master Brief 领真工单、Mac 真渲染一条，只存草稿，马良 9 宫格自检；再用**非 CTS** 测试客户跑 `generic/` 模板，证明没带出 CTS 事实；旧 worker 遇 remotion 单必须拒收。
- 所有步骤：发布、扣费、给客户发消息，一律不借试跑真发。

## 5. 风险与 PM 拍板项

1. **Remotion 商用授权**：我记得公司用可能要付费，未核实。0.5 步查（外网读取要先获准）。
2. **CTS 发布通道（Publer 适配器）**：魏征 BLOCKER。要让「例外授权后能发布」成立，需单独立项做 Publer 适配器，并收口发布凭证（D14 未做的技术闸）。**本方案不含它；它没做之前，CTS 的 Remotion 成片只能当样片看，不能走工厂发布。**
3. **Mac 要开着**：关机会停摆；掉线提醒已有，开机自启没有。
4. **PM 当初嫌 Creatomate 模板平庸才换 Remotion**：台账记一笔「Remotion 与 make_promo 并存，Creatomate 线不再扩」，PM 确认。
5. 按 §11：频率 中（出片频次我没实测）· IMPACT 高 · 收入 中 → 零低、一高 → **P2**；PM 已点头「接」，按 PM 排。

## 6. 审查与执行安排

设计阶段：子牙 + 魏征（已完成首轮，本版已并入）→ **板桥**（面向 C 端客户，非技术视角）+ **狄仁杰**（新对外入口 + 外部上传 + 发布闸 + 出片机准入，攻击验证）→ 定稿。实施：DeepSeek 写代码，Claude Code 出指令、审 diff、跑测试；每步完成后再审一次。每步一个 PR，A 级保持草稿，**合并由 PM 在对话里回「合」**。

## 7. 审查意见并入对照（7 条 BLOCKER + 重要项）

| 来源 | 意见 | 本版处理 |
|---|---|---|
| 子牙 B1 | 现有 complete 链路承载外部成片走不通（要 worker 令牌/认领/表约束/会被抢单） | 1a：PM 会话入口 + 服务端建 claimed 单直接调 completeWorkOrder，来源放 brief.source |
| 子牙 B2 / 魏征 B4 | OCR 与声明比对代码里没有；media_evidence 无人算 | 1a：服务端多帧 OCR 比对为新交付物；入口脚本复用 probeMediaEvidence |
| 子牙 B3 / 魏征 B1 | 授权放台账不可行；闸在代码里不存在 | 1b：授权存工单 review_ref，闸装在 applyApprove + publish 开头，fail-closed，钉哈希/到期/可撤销；广告线同读 |
| 魏征 B2 | CTS 无工厂发布通道，逼人走旁路 | §5-2：不含发布通道，明文禁止手工旁路；Publer 适配器另立项 |
| 魏征 B3 | 入口鉴权/调用者未写 | 1a：guardAdmin；publish_blocked 服务端强制 |
| 子牙 重要 4 / 魏征 7 | 掉线告警已存在 | 删「新建告警」，改「验证有效」+ 渲染期间心跳/超时/重试上限 |
| 子牙 5/6 | 引擎字段撞名、claim 无路由、与 recipe 关系没写 | 2b：brief.engine、claim 带 engines、不得带 recipe |
| 子牙 7 | verified_cta 必填 departure，换客户过不了；travel 模板无机制 | §2：通用 props 单独定义；注册表带 industries |
| 子牙 8 | logo 来源口径混了 | §2：复用 brandkitFor，logo 进 Master Brief 另立项 |
| 子牙 9 | Inngest 事件回执缺失 | 1a/1b/2b 各列事件与回执 |
| 子牙 10/11/12 | 顺序要调；试跑漏草稿模式；健康检查 | 0.5 前置；1a/1b、2a/2b/2c 拆开；§4 加草稿模式用例；2b 加健康检查 |
| 魏征 5/6/8/9/10/11 | 默认值带出 CTS；绕过配方对账；重复登记/授权期限；来源验证；授权与许可；样片标记 | §2 空默认值+CI 扫描；2b 缺对账引用拒收；1a 哈希唯一键；1a 来源 URL 可抓取核对；0.5 步；§4 样片标记 |

## Reuse Statement（方案阶段）

复用：工厂工单/认领/心跳/上传/`completeWorkOrder`/`applyApprove`/发布 worker、`brandkitFor`、Master Brief、`verified_cta`、已有 worker_offline 机制、Inngest 事件与回执约定。新增（若实施）：`engine=remotion` 适配器（L3）、外部成片入口、`exception_auth` 授权记录与两处闸、服务端多帧 OCR 比对、模板注册表。platform-shared：适配器、generic 模板、闸门；industry-specific：travel 模板；client-specific：CTS 价格/团名/logo/品牌色（只作 props）。无客户名或价格写进共享代码（现有 CTS 写死部分是实施前必须清掉的前置条件，CI 扫描强制）。
