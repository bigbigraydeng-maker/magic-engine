# 每日计划 Reel → Remotion 出片：一页纸方案（R2b + R3）

2026-10-06 · 视频工厂 / Remotion 线开发窗口 · 基线 `origin/main` = `358e4a3da`（本地快照，未刷新远端）
依据：`docs/specs/2026-10-05-video-factory-three-outlets.md`（每日计划行）、`docs/specs/2026-10-06-remotion-template-catalog-and-selector.md` 附录 B、台账卡 `2026-10-06-remotion-pack-c-review-followups`。
读过的手册：`playbook-social-general`、`feedback-viral-reel-recipe-over-montage`、`feedback-reel-selfcheck-missed-no-audio`、`feedback-video-caption-short-big`、`reference-aider-deepseek-oneshot-recipe`。

## 0. 先说结论
1. **现状**：每日计划里的 Reel 只有脚本（`CampaignDailyReelDraft`，`media_status` 只许 `NO_MEDIA`/`DRAFT_MEDIA`）；出片机能领 `montage` 单，但**没有任何代码会建这种单**（包 C 的测试单是 SQL 直插）。
2. **本轮分两个 PR**：**PR1 = R2b「服务端生成视频参数」**（纯函数，不碰数据库、不碰运行中的流程）；**PR2 = R3「接进每日计划」**（管理员触发 → Inngest → 建单 → 回写回执）。PR1 合并前不开 PR2。
3. **不做**：真发布、广告出口（R4）、大模型选模板（选择器 D1）、`quiz`、自动定时触发（R3 先只做「人按一下」）。

## 1. R2b：参数怎么来（缺任何一项 = 不出片，不兜底）
| 参数 | 来源 | 状态 |
|---|---|---|
| 价格、币种、天数、出发日、包含项 | 官网产品事实快照 `getProductFacts`（PR 2270，**草稿未合并**） | **依赖**；本包只定义窄接口 `ProductFactInput`，形状与 2270 的 `ProductFact` 对齐，合并后一行适配 |
| 品牌色、logo | `master_briefs` VI（品牌色）；logo 文件名取客户素材库约定 | 现有 |
| 镜头池（文件+标签+类型+来源） | `clients.factory_config.remotion_asset_pool`（**L4 客户配置**，无新表无迁移）；文件实体在出片机 `remotion-assets/` | 新约定；出片机缺文件会非重试失败并写明缺哪个 |
| 音乐 + 节拍 | 共享乐库目录 `catalog/music.json`；节拍由代码按目录算（`beatGrid` 的同一算法，**加一致性测试对拍引擎**） | 现有 |
| 词串 | **代码**按「行业档案」拼：数字由代码从事实填，固定短语按事实里的**证据**触发（如包含项含 airfare → 「FLIGHTS」）。**不用大模型，不改写事实原文，超长就失败** | 新 |

**平台化**：构建器、校验、回执是 platform-shared；「旅游行业词串」放 `profiles/travel.ts`（**L2 行业档案**，按客户行业选，换地产只补一个 `profiles/real-estate.ts`，构建器不改）；CTS 的一切只在配置与事实里（L4）。共享代码里不出现客户名/ID。

**fail-closed 清单**（每条都返回「原因 + 怎么办」，不建工单）：事实缺失/过期(>14 天)/团期已过 · 价格没有币种 · 镜头池 <8 条或 <3 种类型 · 镜头池某词要的标签不足 2 条 · 音乐目录里没有可用曲目或放不下节拍 · 音乐状态为「待听」（本轮先只放行 `beats_unverified` 之外已核对的？见 §4 问题） · 参数过不了引擎校验（合同测试用真引擎 `loadTemplate`）。

## 2. R3：接进每日计划（PR2，PR1 合并后）
`POST /api/clients/[id]/campaign-daily-plan/reel-video`（仅管理员，参数：日期）→ 校验该日 Reel 脚本存在且 `media_status=NO_MEDIA` → 发 Inngest 事件 `daily_plan.reel_video.requested`（事件 id = 计划修订+日期，重复点击幂等）→ 云端函数（`retries:0`）：
1. 读计划 + 事实 + VI + 镜头池（任一缺失 → 回执 `BLOCKED` + 待办三件套，终止）；
2. 调 R2b 构建器 → 失败同上；
3. 建 `content_work_orders`（`order_type=fresh_angle`，`brief.engine=remotion`，建单前用 `isTemplateId` 校验模板，避免旧出片机把单子作废）→ 回执 `ORDER_QUEUED`；
4. 把回执写回计划 `reel.video_receipt`（请求 id、工单 id、状态、成本 0、`no_publish:true`、`publishing_authorization:'NOT_AUTHORIZED'`、时间）；
5. 工单进审片队列后（`in_review`）把 `media_status` 改 `DRAFT_MEDIA`。**批准→发布仍走现有工厂审核与 Facebook 直发，需 PM 授权，本流程不碰。**

## 3. 风险级别
**PR1：B**（纯新增文件，无 IO，不在受保护路径）。**PR2：A（自报，保持草稿）**——往生产库建工单、碰每日计划数据形状；PM 回「合」才合。

## 4. 待统筹/PM 拍板（业务题，不影响 PR1 开工）
1. **PR 2270（官网事实快照）何时合并？** 没有它，R3 当场试跑没有真实事实；PR1 用其 dry-run 输出当事实快照做试跑。
2. **试跑要在生产库建一张测试工单（只存草稿，不发布）**，需 PM 本人授权（同包 C 先例）。
3. 音乐「待听」曲目要不要拦：本轮默认**只用 `status` 已核对的曲目**，目录里现在几乎都是 `beats_unverified`，所以 PR1 先**允许 `beats_unverified` 并在回执里写出**，对外发布前由马良抽听——PM 若要更严请说。
