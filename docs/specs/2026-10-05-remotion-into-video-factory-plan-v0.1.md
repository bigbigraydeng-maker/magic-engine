> 本文件已被 v0.2 取代：docs/specs/2026-10-05-remotion-into-video-factory-plan-v0.2.md

# Remotion 接进视频工厂：方案 v0.1（草稿，待子牙/魏征/板桥审）

日期 2026-10-05 · 状态：**方案阶段，未写任何代码** · 风险级别：A（给外部成片开口子进发布链路 + 新依赖 + 新对外入口）
依据：`docs/audits/2026-10-05-video-factory-brief-remotion-audit.md`（PR #2244，只读检查）、`scripts/factory-worker/worker.mjs`（认领→心跳→装配→上传三件套→complete）、`src/lib/factory/complete-work-order.ts`（服务端复扫红线/品控/进审核）。

## 0. 目标与不做

目标：PM 用 Remotion 做的视频模板，能由 ME 按客户 Master Brief **自动出片**，出来的片子走工厂现有的检查闸门（红线复扫→马良 9 宫格→审核→PM 授权→发布），之后能被每日计划和广告调用。
不做（本方案范围外）：每日计划接工厂、工厂成片自动变广告（见 §6，各自另立方案）；不替换现有 make_promo 引擎（并存，按工单选引擎）；不上云渲染（Mac 出片机做渲染）。

## 1. 现状（已核对代码，行号见审计报告）

- 工厂 = 云上管工单与闸门 + 一台 Mac 管渲染。Mac 上的 `worker.mjs` 向 `/api/factory/worker/claim` 领单，用 `make_promo.py` 拼片，签名链接上传 `video / segments_json / srt` 三件，再 `complete`。服务端 `completeWorkOrder` 复扫红线、品控，进审核队列。
- Master Brief 有 `vi_colors / vi_style_keywords / vi_dos / vi_donts / tagline`，**没有 logo**。logo 现在靠 Mac 上 `MagicLab_Studio/<客户>/brandkit` 文件夹；`brandkitFor()` 找不到就失败，绝不借别的客户的（2026-08-03 Oztop 事故）。
- Remotion：仓库零代码；PM 的工程在 `~/Projects/cts-remotion`（6 个模板、57 条成片，文案/价格/品牌色/logo 全写死，不是 git 仓库）。**已备份到 Dropbox**（`01_CTS_Tours/Remotion_Reels_backup_20261005/`，文件数核对一致）。

## 2. 分层判定（me-platform-tier-gate）

| 东西 | 层级 | 放哪 |
|---|---|---|
| Remotion 渲染引擎适配器（worker 里按工单 `engine` 选 remotion） | L3 Connector（本地渲染连接器，挂在既有「社媒/内容」能力下） | `scripts/factory-worker/engines/remotion/` |
| 模板的版式骨架（列表/问答/故事/价格卡） | 通用版式 → 平台可复用；**路线地图、签证、团价** 这类 → L2 旅游行业剧本 | 模板库分 `generic/` 与 `travel/` |
| 价格、团名、logo、品牌色、Slogan | L4 客户配置：来自 Master Brief + 客户 `verified_cta` + 客户素材，**模板里不许写死** | 渲染时作为 props 传入 |
- 换客户测试：CTS→Roman（地产）→ 悉尼地产客户：`generic/` 模板不改代码即可出片；`travel/` 模板不会被地产客户选到（工单配方限定）。通过。
- 红线 1/3/6：不新增支柱、不直建 L1、本身不是新 Capability（是已有工厂的新引擎）。红线 2：客户名/价格不进共享代码（当前 CTS 模板里全是，必须先参数化才允许进仓库）。

## 3. 方案：四步，每步一个 PR，前一步绿了才开下一步

**第 0 步（已做完）**：备份。

**第 1 步：收片入口——先让今天这几条成片进闸门（A 级，最小）**
- 新增一个只给 PM/内部角色用的入口：把一条已渲染的外部成片登记成一张「外部成片工单」（`source = external_remotion`），带：成片、成片里出现的每一句文字及其来源标注（官网可溯 / brief 可溯 / 未证实）、价格行、使用的素材来源。
- 走与工厂相同的 `complete` 复扫：红线词、品牌名防发错、成片抽帧 OCR 与声明文字比对；进入审核队列。
- **默认只能当样片：`publish_blocked = true`**，要发布/投放必须在台账里有 PM 的一条「例外」授权记录，系统读到授权才解锁；没授权就算马良通过也发不出去。
- 不改 worker、不引入 Remotion 依赖。

**第 2 步：引擎接入——让 ME 自己用模板出片（A 级，最大一步）**
- 把模板挪进仓库（参数化：文案、价格、团名、品牌色、logo、片段素材全部来自 props），锁 Remotion 版本，模板有自己的测试（给定 props 渲染第 N 帧的结构/文字断言，不做像素比对）。
- worker 加 `engine = 'remotion'` 分支：从工单 brief 取文案与事实（来自 Master Brief + `verified_cta`），品牌色取 `vi_colors`，logo 取客户素材（保持「找不到自己的 logo = 工单失败，绝不借别人的」）；渲染 → 沿用现有上传三件套与 `complete`。
- 每个新模板入库前必须出 **配方对账表**（`viral_reference_library`），不是只有每条成片出（CLAUDE.md §8）。
- 选引擎：客户 `factory_config` 或工单显式指定，默认仍 make_promo，**不改既有客户行为**。
- Mac 掉线告警（现在没有）：本步一并加心跳超时→今日待办人工任务（what/how/href 三件套），否则 Remotion 订单会静默卡死。

**第 3 步（另立方案）：每日计划 → 工厂**：把 `daily_plan.publish_queue.ready` 接成「建工单→请工厂出片→审核→发布」的 Inngest 链，补上审计查出的三处断头回执。
**第 4 步（另立方案）：工厂成片 → 广告**：补「个人号视频先传官方号拿 video_id」这一步进 `asset-upload.ts`，工厂发布后事件自动起草（建成暂停→回读→人审批）广告；素材备货池由真实产出填充。

## 4. 验证与当场试跑（每步交付前，不是事后）

- 第 1 步：用 Dropbox 备份里的一条真成片，登记成外部成片工单（测试客户或 CTS 的「只存草稿」模式），拿到真实 `in_review` 回执与媒体证据；故意带一句「未证实」的价格，验证 `publish_blocked` 生效、没授权发不出去。
- 第 2 步：用 CTS 的真 Master Brief 领一张真工单，Mac 上真渲染一条，`FACTORY_PUBLISH_LIVE=false`（只存草稿），出 9 宫格给马良自检；再换一个**非 CTS** 的测试客户跑 `generic/` 模板，证明没有把 CTS 事实带出去。
- 所有步骤：发布、扣费、给客户发消息一律不借试跑真发。

## 5. 风险与要 PM 拍板的事

1. **Remotion 的使用授权**：我记得公司商用可能要付费授权，审计也没联网核实。第 2 步开工前必须查清（外网读取，要先获准）。费用未知。
2. **依赖 Mac 开着**：现在没有开机自启和掉线告警。本方案第 2 步补告警，但 Mac 本身关机仍会让出片停摆（PM 接受风险）。
3. **PM 当初嫌 Creatomate 模板平庸才换 Remotion**：换引擎是 PM 的决定，台账记一笔「Remotion 与 make_promo 并存，Creatomate 线不再扩」。
4. **投放例外**：今天这几条在第 1 步完成并被 PM 授权例外之前，不发布、不投放。
5. 按 §11 打分：频率 中（出片频次我没实测数据）· IMPACT 高（广告素材备货线这一环断了）· 收入 中（素材疲劳目前没有证据，是预防）→ 零低、一高 → **P2**。PM 已点头「接」，按 PM 的优先级排，但这不是今天最赚钱的事。

## 6. 审查与执行安排

- 设计阶段：子牙（架构）+ 魏征（挑刺）；面向 C 端客户 + 板桥；新增对外入口 + 外部上传 + 发布闸门 + 出片机准入 + 狄仁杰攻击验证。
- 实施阶段：写代码交 DeepSeek（Claude Code 出指令、审 diff、跑测试）；每步完成后再审一次。
- 每步一个 PR，A 级保持草稿，PR 正文写风险级别 A，**合并由 PM 在对话里回「合」**。

## Reuse Statement（方案阶段）

复用：工厂工单/认领/心跳/上传/complete 全链路与服务端红线品控；Master Brief、`verified_cta`、素材池；Inngest 事件与回执约定。新增（若实施）：`engine=remotion` 适配器（L3）、外部成片工单入口、`publish_blocked` + 例外授权读取。哪些是 platform-shared：适配器与 generic 模板；industry-specific：travel 模板；client-specific：CTS 的价格/团名/logo/品牌色（只作为 props）。没有把客户名或价格写进共享代码（现有 CTS 模板写死的部分是实施前必须清掉的前置条件）。
