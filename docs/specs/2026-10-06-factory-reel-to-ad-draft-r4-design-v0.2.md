# R4 设计 v0.2（最小版）：工厂发布成功的 Reel → 自动起草一条「暂停」广告

状态：v0.1 作废（G2 写错、开关放错表）。已吸收卫青 / 子牙 / 魏征三审。风险级 **A**。写代码一律 DeepSeek。**全程只建暂停；激活、花钱、改预算要 PM 本人点头。**
读了：`playbook-ads-meta-general` §十三 §十五 §二十七 §二十八 · 三审原文要点见文末「采纳/后放」。

**1 路线（待试跑验证的假设 H1）**：Reel 发布后，直接用 `object_story_id = <page_id>_<video_id>` 建**新独立系列→1 暂停广告组→1 暂停广告**（`video_thruplay`，版位锁 FB+IG，不碰任何在投组）。
证据：同一个个人号 `act_2775766642787274` 上 winner-reel-sync 已用这招在生产跑了 72 次、建出 10 条广告（子牙查库）；反证：CTS 9/7、9/23 记录说引用主页 Reel 报「没推广权限」——但那是 **DRAFT** Reel，不是已发布的。H1 若成立：不传官方号、不等转码、不要封面、不推导标题/落地页（素材就是帖子本身）。
**H1 的帖子编号风险（魏征复审，已并入）**：winner-reel-sync 成功过的是**自然帖子的 `post_id`**，建进的是**已有**广告组；`post_id == video_id` 只是 `facebook-reel-adapter.ts:187` 的假设——9/23 那条真发的 Reel 就是 `video_id=1108513211669229`、`post_id=1771767171422137`，两个不同。所以**不许直接拼 `<page_id>_<video_id>`**：函数须先只读向 Graph 取出这条 Reel 真正可推广的帖子编号（取不到/对不上 → `blocked`），且「新系列下用 `object_story_id` 建广告」本身也没有生产先例。验证放在试跑第 0 步（只读，用 `f9f05b76`），不通过直接走下面的备选，不让 DeepSeek 写死拼接。
**H1 备选（3 行，不现在做）**：传官方号走 `file_url`（`content-factory` 桶是公开的，不用签名链接）→ 等转码 → `video_data`（要封面+标题+链接，需配方映射表）→ 同样建暂停。

**2 触发与闸门（全部 fail-closed，不满足一律 `blocked`，不建）**
1. 订阅 `me/factory.reel.published`；开关 = `ad_strategy_configs` 新增 jsonb 配置（关/`dry_run`/开三态；读不到或 `source=fallback` 一律关）。配置显式给：国家/城市、年龄、日预算（≤`MAX_AUTO_DAILY_BUDGET`）、时长；不用代码默认值。
2. 身份：以 `content_work_orders.published_ref` 为主锚（page/video/published_at/`video_state=PUBLISHED` 全对）；审核证据用 `review_ref.approved_by` + `validateContentChecklist/checklistPasses`；`redline_hits` 为空。
3. **新鲜度**：发布距今 ≤ N 小时，否则不建（防 Inngest 手动重放：生产里 9/6 测试文案那条 `f9f05b76` 就会被重放）。
4. 客户禁用词：读不到名单 → `blocked`（现有 `checkDraftRedlines` 对视频类是读不到就放行，新函数前置自判）。
5. **令牌先探活**（`resolveMetaTokenForClient().source` 非 `shared_fallback` + 只读 `debug_token`，账户号须在 `client_meta_ad_accounts` 里）；探不活 → 不动手。
6. 「素材来自 Dropbox」闸**删除**（工单里判不出来，是装饰）；PM 已确认 Dropbox 授权，改以第 2 条的人工签字为准。

**3 幂等 / 防孤儿**：任何 Meta 写入**之前**先落一行意图记录（新 `action_type='ads.factory_reel_draft'`，键 `work_order_id+video_id`），配 1 个部分唯一索引（先例 `flywheel_actions_social_publish_idempotency`，撞 23505 回读）；系列名带 `[ME-DRAFT]`+工单号缩写便于按名找孤儿。`actionId===null` 一律当失败。**一个 migration**（配置 jsonb 列 + 这个索引），apply 前要 PM 本人点头。

**4 「只建暂停」的结构性保证**
- 建：三层写死 `PAUSED`（沿用 `publishDraftPaused`，**加性小改**：创意可给 `postId`→写 `object_story_id`）。
- **建完回读三层都是 PAUSED，否则补暂停并落 `blocked`**：现有回读对视频类**不生效**（`wantsExpected` 只认私信），需在共享 `draft-and-gate.ts` 把「暂停检查」扩到 `video_thruplay`（私信专用的目标检查不动）+ 回归测试。这是 A 级共享改动，单列。
- 子牙复审补三条（并入）：①共享改动还包括 `ad-draft.ts`：`validateCommon/isCreativeShape` 现要求视频类有 `videoId`+正文+标题，H1 创意没有 → 加 `postId` 字段，**仅 `video_thruplay` 可用、与 `videoId` 互斥、lead_form/私信带 `postId` 一律拒**；暂停检查只导出 `pausedFindings` 单用（别整体调 `checkCreatedAsExpected`，其目标检查写死「私信」会误拦）；对视频类系列状态读不到按 `blocked`；配回归测试（无 `postId` 时三种 kind 请求体字节不变、任一层 ACTIVE→补暂停+`blocked`、`draft-and-gate.test.ts` 第 184 行 thruplay 夹具补 `status`）。②**文案红线由函数自己扫**工单 caption+endcard（H1 草案里没有文字，`checkDraftRedlines` 扫不到）。③开关列**不进共享 `loadAdStrategyConfigWithSource`**（migration 晚于代码会让所有读者 400 落 fallback，9/25 事故）：照 `ad-outcome-config` 做独立 loader + 独立 GET/PATCH 路由（全局管理员，migration 未 apply 返回 503，任何非法值/`source≠row`/读错误一律按「关」，jsonb 带 `updated_by/updated_at`）；再加全仓测试冻结所有「写 ACTIVE」调用点，对外说法限定为「**ME 代码内**唯一入口」。
- 新文件**不能**碰开关：架构测试按「导入符号精确等于白名单」判（禁 `activatePublished/approveDraft/setCampaignStatus/setAdSetStatus/createAdFromPost/ad-approval/spend-activation`，防 `import *`/动态 import/别名，且不得出现字面量 `'ACTIVE'`），每条配「往合成文件加违规就变红」的探针；再冻结 `createDraftForApproval/publishDraftPaused` 的调用方名单（只准变短）。
- 开 = 仍只有 `/api/ad-approval`（PM 本人，ADMIN_EMAILS）；本设计**不改它**。待办里只放「去审批页」链接，不放一键开。

**5 Inngest 写法**：函数级 `retries:0`，每个 `step.run` 内部自己 try/catch 返回带类型结果（不抛）；`onFailure` 写失败回执；并发键 `client_id` limit 1；「意图行已开始、N 分钟无终态」也要变待办。部署后到 Inngest 后台手动 Sync。回执字段：request id、client id、work order id、status、provider 影响、`no_publish`/授权状态、created_at。

**6 失败/成功变待办（拉模式）**：新写 pusher 读 `flywheel_actions`，加新 `ManualItemKind` + `five-kinds.ts` 分车道。只有「待你批」「内容被拦需人看」进 PM 清单（三件套 what/how/href，href→`/dashboard/ad-approval`，不承诺单条预览）；令牌死/Graph 报错/孤儿/卡住进开发欠账车道。「待你批」文案须写明：批了才开、**这条视频目前不在任何受众池收人规则里（不给池子供血）**、日预算与账户上限数字、到期日。

**7 试跑**：① `dry_run`：除 Meta 写之外全真跑，贴真实回执/待办/台账行（无需授权）。② **经 PM 点头**后，用 9/6 那条已发布工单 `f9f05b76` 真建一次暂停对象→立刻三层回读→按清单删除（只读+建完回读，不碰在投对象）；这同时验证 H1。H1 不成立则停下来，走备选（另开一轮，不在本 PR）。

**8 采纳 / 后放（ROADMAP）**：采纳：以上全部。后放：激活时重设起止时间（先让待办写明到期日；批晚了 Meta 拒激活不会误开）· 过期自动删 Meta 对象（v1 只标过期、保持暂停）· 账户每日总上限硬拦与占用余量（CTS 个人号已 $115>$100，待办先只亮数字）· Kernel 收编（选 D：不新增 Kernel 动作，因会被「自治同步」悄悄接管；登记收编清单，退出条件=`ads.add_retargeting_adset` 类建暂停动作真实现）· lead_form / 官方号上传 / 封面 / 文案映射表（H1 成立则永不需要）。
**Reuse Statement**：复用 draft-and-gate（建→回读→审批）· ad-publisher · ad_creative_links（`AdCreationPath` 加 `factory_reel_draft`，并改名避免与预留 `me_ad_launch` 冲突）· 工厂 checklist/published_ref · ad_strategy_configs（开关）· manual-items。新增 platform-shared：1 个 Inngest 函数+纯函数+1 个 migration；client-specific 全在配置；无客户名进共享代码。落点与层级门一致（L3，不新增能力线）。
