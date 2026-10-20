# Instagram 原生发布（Reel）设计说明 — 待复审

权威任务说明：本文件。写入者：本 Claude Code 会话（分支 `claude/codex-social-media-handoff-a3b7bb-x9mowj`）。状态：**设计阶段，未写代码，未碰任何真实账号。**

## 判定与优先级
- **Tier**：L3 Connector（发布适配器），挂在既有「社媒」支柱和 `PublishAdapter` 契约下；不新增能力线，不登记候选。
- **风险级别**：A（对外发布、不可撤销、OAuth 权限升级）。
- **§11**：频率 高（每条社媒内容都要经发布）/ IMPACT 高（Act 段缺口，目前 Instagram 无任何发布路径）/ 收入 中 → 无低项、两项高 → P0。
- **IMPACT 位置**：Act（发布）；回执进入 Check（T+N 监控）沿用现有 `reel.published` 事件，不新建学习层。

## 目标 / 验收 / 不做
- 目标：已授权的 Instagram 专业账号，能通过 ME 视频工厂的发布工单发出 Reel，回执与 Facebook Reel 同等（幂等、可对账、事件）。
- 验收：①`draft=true` 能创建并校验媒体容器、不公开；②获授权后能把同一容器发布并写回执（media id、permalink、`video_state`）；③任一步失败不伪造成功、不双发；④未授权/未开开关/权限不足时 fail-closed；⑤既有 Facebook 发布行为与测试不变。
- 不做（本轮）：Stories/轮播/图文、评论与首评、私信、Threads/X、多账号选择器、给其他客户开通、广告投放。

## 复用声明（Reuse Statement 草稿）
- 复用：`PublishAdapter` 契约与 `publish-worker`（状态机、三落库、红线闸 `scanPublishCaption`、幂等锚 `onStarted`）；`promote` 受控转公开动作的授权与租约；`platform-oauth/connection-store` 加密连接表；`instagram-oauth` 授权与读回校验；`reel.published` 事件。
- 新增（platform-shared，provider 逻辑封在 adapter 内）：`instagram-reel-adapter.ts`、Instagram 令牌按需续期。
- 行业专属：无。客户专属：无（客户只通过 `publish_target` 配置与连接记录注入）。
- 不把客户名/ID 写进共享代码；换成 CTS 或地产客户，adapter 无需改动。

## 现状事实（已核对代码）
- `PublishAdapter`/`PublishTarget`/`PublishedRef` 的 `platform` 现在类型写死 `'facebook'`（`src/lib/factory/types.ts`），`publish-worker.ts` 的 `ADAPTERS` 与 `resolveTarget` 只认 facebook。
- Instagram 授权现为只读资料：`INSTAGRAM_SCOPES = ['instagram_business_basic']`，且默认关闭（`INSTAGRAM_LOGIN_ENABLED`）。令牌为长期令牌，目前无续期。
- 旧的第三方跟发路径已在 2026-10 删除，无可复用的旧 Instagram 发布代码。
- Facebook 的「草稿 → 受控转公开」靠平台原生 `DRAFT` 状态；Instagram Reel 没有同款草稿状态。

## 设计

### 1. 协议（**编码前必须对照官方文档实读核实**；实读属外网读取，需你授权）
Instagram API with Instagram Login 内容发布，主机 `graph.instagram.com`：
1. `POST /{ig-user-id}/media`（`media_type=REELS`、`video_url`、`caption`）→ 返回容器 id。`video_url` 由 Instagram 自己去拉（沿用「ME 不下载」）。
2. 轮询 `GET /{container-id}?fields=status_code` 直到 `FINISHED`（`ERROR`/`EXPIRED` 即失败）。
3. `POST /{ig-user-id}/media_publish`（`creation_id=容器 id`）→ media id。再 `GET /{media-id}?fields=permalink` 取链接（尽力，失败不阻塞）。
需要权限 `instagram_business_content_publish`；容器约 24 小时过期；账号有每日发布条数上限。以上细节都以官方文档为准，设计不依赖我的记忆。

### 2. 草稿与发布的对应（关键设计点）
- `draft=true`：只做第 1、2 步（容器建好并 `FINISHED`），**不调用 `media_publish`**。把容器 id 作为 `video_id` 通过 `onStarted` 落库当幂等锚；回执 `video_state='DRAFT'`。
- 受控转公开：沿用 `promote` 的授权/租约/回读流程，新增 Instagram 版 `meta.promote(target, containerId)` = 再确认容器仍 `FINISHED` → `media_publish`。**容器过期或状态异常 → fail-closed**，提示「草稿已过期，请重新预览」，不自动重建后直接公开。
- 直接发布（`draft=false`）：同一 adapter 内顺序 1→2→3，仍由 worker 的授权闸放行。

### 3. 幂等与防双发
- 主锚：容器 id（`onStarted` 在创建后立即落库）。重试时先查容器状态：`PUBLISHED` → 补记回执，不再发布；`FINISHED` 且未发布 → 可继续；其余 → 终止并推人工核对。`media_publish` 对同一容器重复调用会被平台拒绝，作为第二道保险。
- 副锚：把 `encodeIdemTag` 零宽标记放 caption，`findExisting` 扫最近 25 条媒体。**风险：Instagram 可能剥掉零宽字符**，所以它只当辅助，不能是唯一防线（需在草稿阶段实测，不是通过发布实测）。
- 防误发：`publish_target` 增加 `platform:'instagram'` 与 `ig_user_id`；发布前用令牌读 `/me` 的 `user_id` 与 `username`，必须同时匹配连接记录和品牌，不符不发（对应 Facebook 的页名断言）。

### 4. 授权与令牌
- 新增权限只在 `INSTAGRAM_PUBLISH_ENABLED=true`（新开关，默认关）时申请；未开则维持只读，现有连接不受影响。已有只读授权在开关打开后会因缺权限显示「需要重新授权」（读回校验已覆盖），Celine 需重新授权一次。
- 过期行为：长期令牌约 60 天；采用**使用时续期**（仿 TikTok `getValidTikTokToken`：快到期且满足平台最短间隔时续期并写回，写回新到期时间），不新增定时任务。久未发布导致整条失效 → 面板已按「Instagram 到期要重新授权」处理。续期接口细节同样以官方文档为准。
- 令牌读取只走服务端加密连接表，不日志、不入回执、不入错误文案（沿用 `instagram-oauth/client.ts` 的「绝不记录请求/响应」规则）。

### 5. 接线改动清单（外科手术式）
- `types.ts`：`platform` 放宽为 `'facebook' | 'instagram'`；`PublishTarget` 加 `ig_user_id?`；`PublishedRef` 沿用字段，不加平台私有字段。
- `publish-worker.ts`：`ADAPTERS` 注册；`resolveTarget` 放行 instagram；Instagram 无首评，`ensureFirstComment` 不实现（契约里已是可选）。
- `identity.ts`：新增 `INSTAGRAM_PUBLISH_SCOPES`；connect 路由按开关选择权限集；面板与 `INSTAGRAM_OUTCOMES` 文案从「尚不支持发布」改为按开关显示。
- 新文件：`instagram-reel-adapter.ts`（+测试）、`instagram-oauth/token.ts`（使用时续期，+测试）。
- 不新增表、迁移（`instagram` provider 已在 CHECK 里）、依赖、cron。

### 6. Inngest / 回执
- 沿用 `publish-worker` 现有路径：发布成功后 `reel.published` 事件与 `event_ids` 回写，补发对账任务不变。
- 每个阶段的机器可读回执：工单 id、client id、容器 id/media id、`video_state`、授权状态、`created_at`；没有授权事件与平台回执，不得显示完成。未使用 Inngest 的新增面：无（无新的跨步骤异步）。

## 验证计划
- 单测（全部用平台替身）：创建→轮询→发布的成功路径；容器 `ERROR`/`EXPIRED`；轮询超时；`media_publish` 失败后重试不双发；容器已 `PUBLISHED` 的对账；账号/品牌不符拦截；令牌续期与写回；开关关闭/权限缺失 fail-closed；Facebook 既有测试全绿。
- 变异探针（A 级冻结后跑一次）：去掉账号匹配、去掉授权闸、去掉容器状态检查，各应让对应测试失败。
- **当场试跑**：沿用「不外发」原则——只对 Celine 自己的测试授权跑 `draft=true`（建容器、不公开），记录触发方式、时间、输出摘要；**绝不在试跑里发正式帖**。真发由你另行授权。需要你先完成 Meta 后台与 Render 配置（见下）。

## 你需要做的（云端做不了）
1. 把 `platform_oauth_add_instagram` 迁移应用到生产库（生产写入，需你明确授权）。
2. Meta 后台：独立 Instagram 产品；登记回调 `<站点>/api/auth/instagram/callback`；给 Celine 的账号测试资格（企业/创作者账号 + 应用测试用户）；开启 `instagram_business_content_publish`。
3. Render 环境变量：`INSTAGRAM_APP_ID`、`INSTAGRAM_APP_SECRET`、`INSTAGRAM_LOGIN_ENABLED=true`、`INSTAGRAM_PUBLISH_ENABLED=true`、正式 https 的 `NEXT_PUBLIC_APP_URL`。
4. 对其他客户使用：开发模式只对应用角色里的账号有效，需走 Meta 应用审核（单独的工作，不在本轮）。

## 复审安排
- 设计复审：子牙（架构）+ 魏征（挑刺）；涉及授权与不可逆外发，实施后补狄仁杰（攻击验证）。面向 C 端客户暂不涉及。
- 复审重点：①草稿/转公开语义是否安全；②幂等是否可能双发；③权限升级对现有连接的影响；④令牌续期的并发与写回。

## 待决定（技术项我自拍，业务项抛给你）
- 技术（自拍）：使用时续期 vs 定时续期 → 选前者；零宽标记只作辅助。
- 业务（需你）：①是否先只做草稿（容器预览）验证，再另行授权真发；②Celine 重新授权的时间窗口。
