# Instagram 原生发布（Reel）设计说明 v2 — 待第二轮复审

权威任务说明：本文件。写入者：本 Claude Code 会话（分支 `claude/codex-social-media-handoff-a3b7bb-x9mowj`）。状态：**设计阶段，未写代码，未碰任何真实账号。**
修订记录：v1 经子牙（架构）+ 魏征（挑刺）复审，两人一致结论「不能开工」；本版吸收全部阻塞项，范围收窄为第一期。

## 判定与优先级
- **Tier**：L3 Connector（发布适配器），挂在既有「社媒」支柱下；不新增能力线，不登记候选。
- **风险级别**：A（对外发布、不可撤销、OAuth 权限升级）。
- **§11**：频率 高 / IMPACT 高（Act 段缺口）/ 收入 中 → 无低项、两项高 → P0。
- **IMPACT 位置**：Act。第一期**不接 Check（效果监测）**，见下「第一期的已知缺口」。

## 目标 / 验收 / 不做
- 目标：已授权的 Instagram 专业账号，经视频工厂工单，由 PM 逐条点击授权后发出 Reel。
- 验收：①工单到「容器就绪（未公开）」不会公开；②只有 PM 点击授权才会 `media_publish`；③任一步失败不伪造成功、不双发、不卡死无人知；④开关关闭、权限不足、账号对不上 → fail-closed；⑤既有 Facebook 发布行为与测试不变。
- 不做（第一期）：效果监测事件、Stories/轮播/图文、评论与首评、私信、Threads/X、同客户同时发 Facebook+Instagram、给其他客户开通、定时直发。

## 复审后确认的事实（均有文件行号，来自两份复审）
- 转公开（promote）整套写死 Facebook：`guards.ts:110`、`resume.ts:56,282`、`context.ts:28-35,181-193`、`meta-port.ts:37-45`；且 `promote/boundary.test.ts:17` 禁止该目录 import 名含 instagram 的模块。
- promote 假定 `video_id` 在草稿→公开前后不变（`publish-steps.ts:281-282,336-340`、`guards.ts:183-186`）。Instagram 容器 id ≠ 发布后 media id。
- 工单到 `published/DRAFT` 后无任何路径重建（`claimOne` 只领 approved/publish_failed，`publish-worker.ts:38-47`）。
- worker 对账只调 `findExisting(target, tag)`，无按容器 id 对账钩子（`publish-worker.ts:229-246`）；`onStarted` 不检查写库错误（`:291-297`）。
- `reel.published` 事件、补发、测量对非 Facebook 静默跳过（`publish-worker.ts:428,473`、`reel-published-event.ts:56`、`factory-reel-measurement-adapter.ts:96`）。
- cron 直发的唯一闸是全局 `FACTORY_PUBLISH_LIVE`（`cron/factory-publish-worker/route.ts:24`），不分客户/平台。
- 设置页与配置投影只认 `facebook`+`page_id`（`client-config.ts:29,126,226-234`）。
- 权限读回校验用的是常量 `INSTAGRAM_SCOPES`（`social-onboarding.ts:137,142`、`client.ts:73,107`），打开发布权限后旧只读连接仍会显示「已保存」。
- TikTok 取令牌不按账号取、无并发保护（`tiktok/token.ts:21-29,59-71`）。

## 复用声明（Reuse Statement 草稿）
- 复用：`publish-worker` 状态机与红线闸；`promote` 的授权/租约/回读/所批即所发框架（**改造为按平台分发，不复制第二套**）；`connection-store`；`instagram-oauth` 授权。
- 新增 platform-shared：promote 平台端口（接口）、`instagram-reel-adapter`、Instagram 令牌取用。行业专属：无。客户专属：无（只经 `publish_target` 配置与连接记录注入）。
- 换成 CTS 或地产客户，共享代码无需改动。**已知限制**：一个客户只有一个 `publish_target`，切到 Instagram 会停掉该客户的 Facebook 发布（Celine 的 Facebook 本就在等公司认证，可接受）。

## 设计（第一期）

### 1. 协议（编码前必须对照官方文档实读核实；实读属外网读取，需 PM 授权）
Instagram API with Instagram Login，`graph.instagram.com`：建容器（`media_type=REELS`、`video_url`、`caption`）→ 轮询容器状态 → `media_publish`。需要 `instagram_business_content_publish`；容器约 24h 过期；有每日发布上限。以下**待官方文档核实**，设计不依赖记忆：容器状态取值与是否返回 media id、`media_publish` 超时后的可对账方式、caption 不可变、长期令牌续期规则与最短间隔、发布条数预检端点。

### 2. 流程：容器就绪 → PM 授权发布（不开放 cron 直发）
1. worker 处理 Instagram 工单：红线闸照常 → 建容器 → 轮询。**轮询在 cron 预算内做完；未完成则存 `pending` 并下一轮用容器 id 接着查**，不进「人工核对」终态。容器就绪后工单进入「草稿（容器就绪、未公开）」，`published_ref` 记 `container_id`、`container_expires_at`、`caption_sha256`。
2. 发布只经 PM 点击的受控动作（沿用 promote 的授权、租约、栅栏）：重查开关与账号 → 确认容器仍就绪 → `media_publish` → 取 media id 与 permalink → **用 `media_id` 覆盖工单与流量记录的 `video_id`/`post_id`，`container_id` 另存作审计**。
3. **Instagram 永不走 cron 直发**（`draft=false` 在 Instagram 平台上被拒绝）。这样 `FACTORY_PUBLISH_LIVE` 误开不会误发 Instagram。

### 3. promote 改成平台端口（不复制）
- 抽出 `PromotePlatformPort`：`checkTarget`、`readView`、`promote`、`ensureFirstComment?`（可选）、`idsAfterPromote`。Facebook 实现 = 现有代码原样搬入，行为与测试不变；Instagram 实现新增。
- `readView` 对 Instagram：容器读不到 caption，**所批即所发改由「建容器时存 `caption_sha256` + 容器不可变」担保**，转公开前用库里工单文案重算比对；`from/page` 归属改为核对 `/me.user_id` 与连接记录。
- `boundary.test.ts` 同步调整：允许 `promote/` 通过端口按平台选择实现，但 Instagram 模块只能被端口注册处引用，不得被其他目录直接 import。
- `finishStage` 不再无条件补首评：Instagram 无首评，端口声明即跳过，不产生 `first_comment_pending`/`needs_attention`；不写 `ig_crosspost_blocked`（该字段仅指「Facebook 转公开后禁止跟发」，与本功能无关）。

### 4. 幂等、对账与过期（补管道断头）
- `onStarted` 必须检查写库错误，失败即抛出并**不再继续调用 `media_publish`**；同时修 Facebook 路径同一漏洞（外科手术式，属同一函数）。
- `PublishAdapter` 加可选 `reconcile({ target, priorRef })`，worker 对 provisional 工单优先调用：容器 `PUBLISHED` → 补记 media id；`FINISHED` 未发布 → 回到「容器就绪」；处理中 → 保持 pending；`ERROR/EXPIRED` → 终止并出人工任务。
- **不在 Instagram caption 里放零宽标记**（会污染公开文案，且被红线扫描的文本与实际发出的不是同一串）。主锚 = 容器 id。「发布成功但响应丢失」无法自动认领时，**不静默**：终态必须同时下发人工任务（what: 这条 Reel 可能已发出，影响: 可能重复；how: 打开账号核对并在工单上标记；href: 工单页与 Instagram 主页）。
- 容器过期：`container_expires_at` 前 4 小时用现有「今日待办·需要你动手」管道（`pm-todo/manual-items.ts`）提醒；过期后工单显示「草稿已过期」并提供**重新生成**动作（把工单退回 `approved`、换新幂等序号），不是死胡同。

### 5. 目标配置与账号绑定
- `publish_target` 增 `platform:'instagram'`，**不存 `ig_user_id`**；账号以连接表 `account_id` 为唯一来源，发布前用令牌读 `/me`，`user_id` 必须等于该连接的 `account_id`，用户名只作辅助显示。
- 同客户存在多条 active Instagram 连接 → 直接拒绝（与面板 `ambiguous` 一致）。`expect_brand` 与 `/me` 任一缺失 → 拒绝（不沿用 Facebook 「缺了就放行」的行为）。
- 设置页（`client-config.ts` 与 `FactoryConfigPanel.tsx`）一并支持 `instagram`，不要求 FDE 直写库。

### 6. 授权与令牌
- 新开关 `INSTAGRAM_PUBLISH_ENABLED`（默认关）。**每次发布与每次授权都重查**，关闭即全部拒绝（含已有带发布权限的连接）。
- `INSTAGRAM_PUBLISH_SCOPES`：connect 路由按开关选权限集；`assessGrant`/`client.ts` 的 `requiredScopes` 按开关取值，使旧只读连接在开关打开后显示「需要重新授权」；`INSTAGRAM_OUTCOMES.connected` 文案按开关区分；`scope-change-gate.test.ts` 与 `connection-health.ts`（「无刷新调用方」口径）同步更新。
- Celine 重新授权下发成人工任务（what/how/href 三件套），不只写在文档里。
- 令牌取用：**按 `account_id` 取**；续期用 `token_expiry` 乐观锁（`UPDATE … WHERE token_expiry=<读到的值>`），写库失败必须报错不静默；续期放在发布步骤开头，不在 `media_publish` 前后同一次调用里再续；续期规则待官方文档核实。错误文案一律经 `sanitizeFailReason`，并核实 Instagram 令牌形态被覆盖，cron 的 `finish({error})` 也要脱敏。

### 7. 视频只走工厂的结构性保证
`instagram-reel-adapter` 只导出给 worker 与 promote 端口，边界测试禁止其他目录 import；adapter 内不做任何生成。发布前对视频 URL 做规格预检（比例/时长上限，待官方文档核实具体数值），不合格不建容器。

### 8. 回执与可见性
- 第一期机器可读回执（存 `published_ref`）：`platform`、`container_id`、`media_id`（发布后）、`container_expires_at`、`caption_sha256`、`video_state`、`promote_request_id`、`created_at`；授权事件沿用 promote 的授权记录。
- 展示：`publish-display.ts` 放行 Instagram 域名的 permalink；工厂页状态文案按平台区分（`statusMeta.ts`、`page-text.ts`）；`creative-pool-labels.ts`、`ads/creative-link.ts` 对非 Facebook 的 `post_id` 不再拼 `facebook.com`。
- **效果监测第一期不做，但不静默**：`published_ref` 记 `event_skipped_reason:'instagram_measurement_not_built'`，工厂页显示「暂无效果监测」，并开台账卡（`verify_by` = 第二期开工日）。

### 9. 第一期的已知缺口（诚实声明）
- 没有 Check 段：Instagram Reel 发出后系统不会自动追踪效果，IMPACT 闭环在 Act 后暂断。第二期补：`reel.published` 事件放宽平台、Instagram 指标读取、测量适配器。
- Instagram 容器在 App 里看不到画面，「草稿」只验证转码与格式，**不能代替人工看片**：PM 授权前仍以工厂预览成片为准。
- Instagram 正文链接不可点：首评 CTA 与追踪链接这一产品选择第一期不做，caption 用不带链接的结尾文案；`publish-worker.ts:215-219` 对首评 CTA 的强制要求对 Instagram 跳过。是否改用「主页链接」等做法留给 PM 后续决定。
- 并发上限预检、同视频 Facebook 跟发造成的重复内容（`ig_crosspost_blocked` 的历史背景）：本期只做文档提示。

## 验证计划
- 单测（平台替身）：建容器→轮询→就绪；轮询超时→pending→下轮接续；`ERROR/EXPIRED`；`onStarted` 写库失败不再前进；发布后 media id 覆盖 `video_id` 且监测/事件不读容器 id；响应丢失→人工任务；同客户两条连接拒绝；`/me` 对不上拒绝；`expect_brand` 缺失拒绝；开关关闭拒绝（含已有连接）；`FACTORY_PUBLISH_LIVE=true` 时 Instagram 工单不被直发；旧只读连接在开关打开后显示需重授权；实际发出文本与被红线扫描文本一致；Facebook 既有 promote/worker 测试全绿；边界测试与 scope-change-gate 同步通过。
- 变异探针（A 级冻结后跑一次）：去掉账号匹配、去掉开关重查、去掉容器就绪检查、去掉 `onStarted` 错误检查、去掉 media id 覆盖，各应令对应测试失败。
- **当场试跑**：只对 Celine 测试授权跑「建容器到就绪」，**不点发布**；记录触发方式、时间、输出摘要。真发由 PM 另行逐条授权。能验证：授权、容器创建、转码状态；不能验证：画面内容与真实发布后的行为。

## 你需要做的（云端做不了）
1. 授权我对照官方文档实读上述待核实项（外网读取）。
2. 把 `platform_oauth_add_instagram` 迁移应用到生产库（生产写入，需明确授权）。
3. Meta 后台：独立 Instagram 产品；登记回调；Celine 账号测试资格（企业/创作者账号 + 应用测试用户）；开启 `instagram_business_content_publish`。
4. Render 环境变量：`INSTAGRAM_APP_ID`、`INSTAGRAM_APP_SECRET`、`INSTAGRAM_LOGIN_ENABLED`、`INSTAGRAM_PUBLISH_ENABLED`、正式 https `NEXT_PUBLIC_APP_URL`。
5. 其他客户使用：开发模式只对应用角色账号有效，需走 Meta 应用审核（单独工作，不在本轮）。

## 复审安排
- v2 设计送第二轮：子牙 + 魏征（不带结论，只给文档与代码）；涉及授权与不可逆外发，实施后补狄仁杰。
- 重点：promote 平台端口是否真的保住 Facebook 行为；容器过期与响应丢失的人工任务是否闭环；开关与授权闸是否可被绕过。

## 第二期（本文不承诺时间）
`reel.published` 事件与测量适配器放宽到 Instagram；指标读取；并发上限预检；首评/CTA 产品决定；多客户审核路径。
