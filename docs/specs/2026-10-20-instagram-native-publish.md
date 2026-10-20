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

---

# v3 修订（第二轮复审后）— 与上文冲突处以本节为准

第二轮复审（子牙+魏征）结论：v2 仍不能整体开工；下列决定写入设计。事实均有行号，见两份复审原文（PR 评论/会话记录）。

## 硬决定
1. **转公开结果三态（魏征 B1）**：确定没发（调用前的开关/令牌/账号/容器状态检查失败）｜确定已发｜请求已发出但结果未知。第三态**粘性**：保留 `promote_called_at`、禁止再次 `media_publish`，只允许对账或人工解除，并下发人工任务。调用前先持久化「即将发布」。
2. **id 状态机（B2 + 子牙4）**：容器期 `published_ref` 只存 `container_id`，**不写 `video_id/post_id`**（同时避免下游拼出错误的 Facebook 链接）。`media_publish` 一返回，先单独做一次带栅栏的写入，把 `media_id` 记入 `promote_authorization`，再对齐工单与流量记录。`checkIds`/`resumeContext` 识别「容器已转为 media」的中间态；`finishStage` 用新 id。账号校验改为平台无关的 `target_account_id`。
3. **重新生成（B3 + 子牙5）**：先现读旧容器状态，只有 `EXPIRED/ERROR/404` 才放行；用 `status+updated_at` 做 CAS；旧流量记录归档或复用（不新插第二条，否则 `checkRows` 永久 409）；旧回执追加进 `previous_refs[]`，不覆盖。
4. **通知闭环（B4）**：不新增 cron，容器监控挂在现有 `factory-publish-worker` 里（独立 try，仿 `reconcileMissingReelEvents`）。容器就绪即进待办并即时通知（不等工作日邮件）；过期提醒窗口覆盖周末；新 manual kind 登记 `LANE_OF_KIND` 与 `NEVER_DROP_KINDS`；「已核对」提供真实的 API+UI 入口，三件套 href 用探活稳定的工厂页链接。
5. **强制草稿（B5 + 子牙2）**：`processOne` 里 Instagram 一律 `draft=true`（不是拒绝）；adapter 的 `publish` 里根本没有 `media_publish` 代码；返回后断言 `video_state==='DRAFT'`；边界测试 grep 全库，`media_publish` 只能出现在一个文件；`graph.instagram.com` 的 fetch 只能出现在一个客户端模块。
6. **caption 与指纹（I1/I2）**：`buildInstagramCaption` 纯函数产出最终发给接口的原始字符串，`caption_sha256` 对它计算，不做归一化；指纹纳入 `container_id`、`caption_sha256`、视频路径与大小/etag；预览与红线扫描用库内重算的 caption，公开后按 `media_id` 读回再扫一遍。
7. **账号锚点（I3/I4/I5）**：回执记 `ig_account_id`；promote 时 `/me.user_id` 必须等于回执，`/me.username` 归一化后必须等于 `clients.instagram_handle`；Instagram 的 `publish_target` 不填 `page_id`；`lecture-publish.ts:133-134` 加平台断言。
8. **令牌（I6/I8）**：唯一出口 `getInstagramPublishToken()`，内部检查开关、权限、状态、唯一连接；续期要提前很多天（不用 5 分钟缓冲）；乐观锁用 `.select('id')` 数行，0 行命中视为失败；临近过期进待办，不靠把 `refreshable` 改成 true；金丝雀令牌测试证明不出现在日志/库/响应。
9. **pending（I7）**：独立字段，有总时限与上限，超限转终态并出人工任务；不得堵住 `claimOne` 队列（含别的客户的 Facebook 工单）；reconcile 只作用于容器就绪前的 provisional 工单，且覆盖 401/限流/404/`PUBLISHED` 读不到 media id。
10. **回执措辞（I9）**：Instagram 容器期不写「已发到 meta_graph」的工作日志与完成事项，用专用文案；审片清单 `cta_in_first_comment_not_body` 等对 Instagram 平台感知。
11. **抽端口先写特征测试（I10）**：抽 `PromotePlatformPort` 前，先给 Facebook 路径补特征化快照测试（错误文案顺序、指纹值、payload 形状），重构后须逐字相同；保留 `deps.meta` 名称与签名；端口声明「跳过首评」的默认值是「不跳过」；`ig_crosspost_blocked` 在 `publish-steps.ts:108` 处理；端口注册表放在 `promote/` 目录之外以满足 `boundary.test.ts`。
12. **当场试跑升级**：合并 PR6 前，用**一次性 Instagram 专业测试账号**做完整演练（含注入「响应丢失」），不对客户账号调用 `media_publish`。

## PR 切分（顺序即依赖）
| PR | 内容 | 级别 |
|---|---|---|
| 0 | 官方协议实读，回填待核实清单，更新本文 | 文档（需 PM 授权外网读取） |
| 1 | Facebook 行为不变的端口抽取 + 先补的特征测试 | A |
| 2 | `onStarted` 写库错误检查 + `reconcile?` 钩子 + `platform` 类型放宽 | B |
| 3 | 设置页防回归与 `client-config` 支持 instagram | B/C |
| 4 | 开关 + 发布权限集 + `assessGrant` 按开关 + 令牌唯一出口与续期 + `scope-change-gate` | A |
| 5 | Instagram adapter **只建容器到就绪**，含 pending、过期提醒、重新生成、强制草稿；此 PR 无 `media_publish` 代码 | A |
| 6 | `media_publish` 与 Instagram 端口、三态、id 状态机、人工任务；实施后狄仁杰攻击验证 | A |
| 7 | 展示与监测占位、台账卡 | C |

PR5 合并后即可做「只建容器、不发布」的当场试跑；发布能力只在 PR6 出现。

---

# PR 0 结果:官方文档实读(2026-10-20,Meta for Developers)

来源(均为 Meta 官方文档页,下载后只提取文本,未执行页面脚本):
- Content Publishing(更新 2026-06-30)`…/instagram-api-with-instagram-login/content-publishing`
- Get started(更新 2024-12-02)`…/get-started`;Business Login for Instagram `…/business-login`
- Refresh Access Token(更新 2025-07-17)`…/reference/refresh_access_token`
- Graph API 参考:`ig-container`、`ig-user/media`、`ig-user/media_publish`(更新 2026-09-28)、`ig-user/content_publishing_limit`(均在 `…/instagram-graph-api/reference/` 下)

## 已核实(可作为设计依据)
| 项 | 官方说法 |
|---|---|
| 主机与权限 | Instagram Login 用 `graph.instagram.com`;权限 `instagram_business_basic` + `instagram_business_content_publish` |
| 建容器 | `POST /<IG_ID>/media`,`media_type=REELS`,`video_url`(Instagram 会自己 cURL 这个地址,**必须是发布时公开可访问的服务器**),可选 `caption`、`share_to_feed`、`cover_url`、`thumb_offset`、`is_ai_generated` 等;成功返回 `{"id": "<容器id>"}` |
| 容器状态 | `GET /<容器id>?fields=status_code`;取值 `EXPIRED`(24 小时内未发布)、`ERROR`、`FINISHED`、`IN_PROGRESS`、`PUBLISHED`;`status` 在出错时给子错误码。官方建议**每分钟查一次、最多 5 分钟** |
| 容器过期 | 容器 24 小时过期;账号 24 小时内最多建 400 个容器 |
| 发布 | `POST /<IG_ID>/media_publish`,参数 `creation_id`;成功返回 `{"id": "<媒体id>"}` |
| 发布恢复路径 | 官方原话大意:建了容器但 `media_publish` 没返回媒体 id 时,用 `status_code` 查询容器发布状态——`PUBLISHED` 即已发布 |
| 部分成功 | `media_publish` 响应可带 `config_issue`(如 `CAPTION_NOT_ATTACHED` = **帖子已发出但没有文案**);官方说这是「部分成功,应当对账而不是当错误」 |
| 条数上限 | 参考页写 24 小时 50 条;Content Publishing 指南写 100 条(两页不一致)→ **设计按 50 条保守处理**;可用 `GET /<IG_ID>/content_publishing_limit` 查 `quota_usage`/`config.quota_total` 预检 |
| Reel 规格 | 视频 H.264 或 HEVC、逐行扫描、闭合 GOP、4:2:0;音频 AAC、最高 48kHz、单/双声道;帧率 23–60;码率 VBR 最高 25Mbps;**时长 3 秒–15 分钟;文件最大 300MB**;宽高比允许 0.01:1–10:1,推荐 9:16;封面图最大 8MB |
| 文案规格 | caption 最多 2200 字符、30 个话题标签、20 个 @ 提及 |
| 令牌 | 登录流程得到的是 1 小时短期令牌;用 `grant_type=ig_exchange_token` 换 60 天长期令牌(须服务器端,含 app secret);**续期**:`GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=…`,条件是令牌**至少已存在 24 小时且未过期**,续期后再有 60 天;过期后不能再续,须重新授权;续期只需 `instagram_business_basic` |
| `/me` | `GET graph.instagram.com/me?fields=user_id,username`,返回形态是 `{"data":[{"user_id":…,"username":…}]}`;`id` 是 app-scoped,`user_id` 才是专业账号 id |
| 访问级别 | **Standard Access** 仅用于「你自己拥有/管理且已在应用后台加入的」专业账号;服务**不属于你的客户账号需要 Advanced Access(要过 App Review)** |
| 分块续传 | `upload_type=resumable` **只给实现了 Facebook Login for Business 的应用**;我们走 Instagram Login,所以只能用 `video_url` 方式 |
| 页面授权限制 | 若账号关联的 Facebook 主页需要 Page Publishing Authorization 或双重验证,未完成时请求会失败(需把该错误映射成可读的人工任务) |

## 官方文档**没有**写明(仍需试跑验证,不能当事实)
1. `media_publish` 对同一容器重复调用会发生什么(文档不保证幂等)。→ 设计继续把「请求已发出但结果未知」当粘性状态,发布前不再依赖重试安全。
2. 发布成功后容器 `status_code` 多久变成 `PUBLISHED`;`media_publish` 响应丢失时,如何拿到媒体 id(文档只给了「用 `status_code` 判断是否已发布」,没给「用容器查到媒体 id」)。→ 候选办法:`GET /<IG_ID>/media` 列出最近媒体并按时间、文案匹配。**媒体字段(`permalink`、`timestamp`、`caption`)的参考页是脚本渲染的,未能抓到正文,待补读或试跑确认。**
3. 容器 `status_code` 在视频还在 Instagram 侧拉取时的实际耗时(官方只说每分钟查、最多 5 分钟)。
4. 开发模式下测试账号的行为是否与 Standard Access 的描述完全一致。
→ 以上由 PR 6 前的**一次性测试账号完整演练**(含注入「响应丢失」)验证;未验证前不对客户账号调用 `media_publish`。

## 对 v3 设计的修订(由实读结果触发)
1. **`config_issue` 必须处理**(新增):`media_publish` 返回 `CAPTION_NOT_ATTACHED` 时帖子已公开但没有文案。这属于「发出去了、但内容不对」,**不是失败也不是成功**:回执必须记录 `config_issue`,工单标红,并立即下发人工任务(what:这条 Reel 已公开但缺文案;影响:客户主页上是一条没有文案的帖子;how:在 Instagram App 里补文案或删除重发;href:该帖链接)。测试要覆盖。
2. **轮询与 cron 预算**:官方建议每分钟查、最多 5 分钟,而 `factory-publish-worker` 每小时一次、预算 300 秒。→ 不在 cron 内长时间轮询:建容器后最多在预算内轮询一两次,其余交给下一轮的 pending 接续(与 v3 第 9 条一致)。
3. **条数预检**:发布前读 `content_publishing_limit`,按 50 条保守;接近上限直接拒绝并出人工任务。已从「待办」升为第一期必做(接口已确认存在)。
4. **视频来源**:Instagram 自己 cURL `video_url`,所以必须是发布时可公开访问的地址(例如足够长有效期的签名链接);建容器前由 adapter 自检该地址可访问,过期则重新签名。**不能**用「ME 上传文件」的分块方式。
5. **规格预检数值定稿**:时长 3 秒–15 分钟、≤300MB、H.264/HEVC + AAC、23–60fps、推荐 9:16;不合格不建容器(工厂成片本就是 9:16,主要预检文件大小与编码)。
6. **文案预检**:≤2200 字符、≤30 话题标签、≤20 个 @。
7. **令牌续期规则定稿**:每次发布前若令牌存在 ≥24 小时且距到期少于约 7 天则续期;续期用乐观锁;长期未发布(>60 天)的令牌失效后只能重新授权,待办里要提前(例如到期前 10 天)提醒。
8. **新的产品决定(需你拍板)**:官方有 `is_ai_generated` 参数,用于自我声明内容含 AI 生成。ME 的视频含 AI 生成素材。是否默认勾上?这是合规与品牌取舍,不是技术选择——在 PR 6 前请你定。
9. **访问级别**:Celine 的账号需先作为被管理账号加进应用后台(Standard Access);给**其他客户**开通要先过 Advanced Access 的 App Review。这条已在「你需要做的」里,补充为 PR 4 的前置。

## 实施记录:PR3 并入 PR5;PR4 已做(2026-10-20)
- **PR3 并入 PR5**:现在没有 Instagram 发布程序,设置页放开 `instagram` 只会让 FDE 配出必然失败的目标(`client-config.ts` 注释早有警告)。待 PR5 的 adapter 就绪时一并放开并做设置页防回归。
- **PR4 内容**:开关 `INSTAGRAM_PUBLISH_ENABLED`(`identity.ts`);`INSTAGRAM_PUBLISH_SCOPES`;授权链接、回调权限校验、面板判定都按开关取权限集;`getInstagramPublishToken()`(`src/lib/instagram-publish/token.ts`)作为取凭据唯一出口,续期规则按官方文档(只续未过期的长期值,续后 60 天;距到期 7 天内续期;乐观锁;保存失败报错);`scope-change-gate` 登记新常量。
- **简化**:续期的「至少存在 24 小时」条件在 60 天长期值上天然满足(距到期 <7 天 ⇒ 已存在 >53 天),不单独实现。
- **刻意未做**:连接文案按开关区分(面板是客户端组件,读不到服务端开关,留给 PR7);重新授权自动待办。

