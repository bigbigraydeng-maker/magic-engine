# 社媒连接治理设计说明 — 待复审

权威任务说明:本文件。写入者:本 Claude Code 会话。状态:**设计阶段,未写代码,未改库结构。**
起因(2026-10-20):PM 在 CTS 设置页点「连接 TikTok」,浏览器登录的是 Celine 的 TikTok(`celinesyd222`),系统直接存下,同一账号同时挂在 CTS 与 Celine 两个客户下;页面显示「存在多个授权账号」。已由 PM 授权把 CTS 名下那条标为已撤销(只改 1 行)。PM 追问:真实客户碰到同样场景怎么办。PM 已同意下列 5 条默认规则。

## 判定
- **Tier**:平台共享的连接治理,属既有 L3 连接层(`platform-oauth`),不新增能力线;客户差异只走配置;不登记候选。
- **风险级别**:A(授权、客户隔离、数据库结构、对外发布账号归属)。
- **§11**:频率 中 / IMPACT 高 / 收入 高 → P0。
- **IMPACT 位置**:Act 之前的授权入口(Inspect→…→Act 的前提)。

## 现状事实(已读代码/库)
- `tiktok/callback/route.ts`:授权回来后**直接** `upsertConnection` 存库,无确认;`ON CONFLICT (client_id,provider,account_id)` 只防同客户重复。
- 库里**没有跨客户**的唯一约束:同一 `(provider, account_id)` 可以同时在多个客户下 active。
- `tiktok/token.ts:21-29`:取凭据 `order by created_at desc limit 1`,**不按账号、不检查是否有多条 active**。`vocabulary.ts` 注释承认 YouTube 同样「取最新一条」。
- 面板侧已把多条 live 判为 `ambiguous` 并阻止当作可发布(`social-onboarding.ts`),所以展示是 fail-closed,但**发布取凭据不是**。
- `status` 有库级 CHECK(`active/revoked/expired/error`);「撤销」= 只改状态、保留行与加密凭据备查(`revokeConnection`)。
- TikTok 现有权限(`user.info.basic`、`video.publish`)**取不到可精确核对的用户名**,所以不能像 Instagram 那样「登记用户名 → 授权后自动比对」。

## 5 条规则(PM 2026-10-20 已同意)
1. 授权回来先让人确认再保存(显示账号名称,点确认才存)。
2. 同一 TikTok 账号不能同时挂在两个客户下;被拦时对客户**不透露**占用方是谁,内部给顾问派待办(what/how/href)。
3. 同一客户同一平台默认只留一个当前账号;授权新账号先问「替换吗」,确认后旧的标为已撤销。
4. 发布取凭据必须按目标账号,不能「取最新」;出现多条 active 一律拒绝。
5. 「撤销」文案讲清:在 ME 里撤销不等于在平台里撤销,给客户一句人话与去平台撤销的指引(与隐私页一致)。

## 设计

### 适用范围
`tiktok`、`google_youtube`(频道)、`instagram`(专业账号 id)三个社媒平台。**不含 `meta`**:Facebook 主页本来就允许一个客户多条授权(`social-onboarding.ts` 对 meta 放行多条),另行设计。不含 GBP/GSC/GA4/邮箱等非社媒连接(同一 Google 账号服务多个客户是正常的)。

### 待确认授权(规则 1)
- 新增表 `platform_oauth_pending`(service-role RLS 模板 `FOR ALL TO service_role USING (true)`):`id`、`client_id`、`provider`、`account_id`、`display_name`、`access_token_enc`、`refresh_token_enc`、`token_expiry`、`scopes`、`authorizing_user_id`(发起者)、`state_nonce`、`created_at`、`expires_at`(15 分钟)。**不改**现有 `platform_oauth_connections`,也不新增 `status` 取值(避免波及所有按 `status` 过滤的读取方)。
- 回调:换令牌 → 核对 scopes → **跨客户占用检查**(规则 2)→ 写 pending → 跳到客户设置页的确认卡片;不再直接 `upsertConnection`。
- 确认接口(POST,需 `requireDashboardClientAccess` 且调用者 = `authorizing_user_id`,带一次性确认令牌防 CSRF):重查占用与同客户已有账号 → 规则 3 → 写正式连接 → 删 pending。取消或过期 → 删 pending(令牌随之丢弃)。
- 确认卡片只显示账号名称与简短说明,**不显示令牌**,不显示其他客户信息。

### 跨客户占用(规则 2)
- 回调与确认两处都查「同 `(provider, account_id)` 在**其他客户**下 active」:有则拒绝,客户侧结果码 `account_in_use`,文案不含占用方。
- 内部待办:`pm-todo` 新增 kind(登记 `LANE_OF_KIND`、`NEVER_DROP_KINDS`),what=「某客户尝试连接已被另一客户使用的 <平台> 账号」,how=「核实这个账号该归哪个客户;如要转移,先在原客户处撤销」,href=两个客户的设置页。去重按 `(provider, account_id)`。
- **数据库兜底(单独 PR、需 PM 授权应用迁移)**:部分唯一索引 `(provider, account_id) WHERE status='active' AND purpose='legacy' AND provider IN ('tiktok','google_youtube','instagram')`。迁移前先做**只读**重复检查(2026-10-20 已知 TikTok 的重复已清;YouTube/Instagram 待查)。

### 同客户换号(规则 3)
- 确认时若该客户同平台已有**不同账号**的 active:卡片多一个选项「替换当前账号 @旧账号」,不勾则拒绝保存。
- 勾选后顺序:先把旧的标 `revoked`,再写新的(**先撤旧、后写新**:中途失败结果是「零个有效」=fail-closed,客户重新连接;不会出现两个同时有效)。不引入数据库函数/事务。
- 库级兜底(与上同 PR):`(client_id, provider) WHERE status='active' AND purpose='legacy' AND provider IN (…)` 唯一。

### 发布取凭据(规则 4,独立小 PR,不改结构)
- `getValidTikTokToken`(与 YouTube 的 `getValidToken` 路径)改为:查该客户同平台所有 `active`;**0 条返回 null、恰好 1 条用它、多于 1 条返回 null 并告警**(不取最新)。
- 与规则 3 配合,正常状态下永远只有 1 条。

### 撤销文案(规则 5,C 级)
- 面板与回跳消息:ME 内撤销 ≠ 平台撤销;TikTok/YouTube/Instagram 各给一句平台侧入口说明。**具体入口路径需在 PR 前对照各平台官方帮助页核实后再写**,不凭记忆。

## PR 切分
| PR | 内容 | 级别 | 改库结构 |
|---|---|---|---|
| G1 | 发布取凭据 fail-closed(TikTok、YouTube):多条 active 拒绝;测试 | A | 否 |
| G2 | `platform_oauth_pending` + TikTok 回调改为待确认 + 确认/取消接口 + 确认卡片 + 跨客户占用检查 + 内部待办 | A | 是(新表) |
| G3 | 数据库兜底部分唯一索引(先只读查重,PM 授权后应用) | A | 是 |
| G4 | 把 G2 的机制接到 YouTube 与 Instagram 回调 | A | 否 |
| G5 | 撤销与占用的人话文案 + 官方入口核实 | C | 否 |

顺序理由:G1 最小、立刻消除「拿错账号发布」的风险;G2 起才改授权流程。

## 验证计划
- 单测:回调不再直接写正式连接;确认接口鉴权(未登录/别的用户/别的客户/过期/已用);跨客户占用被拒且文案不含他客户;同客户换号需明确勾选;撤旧后写新失败时零个有效;取消删除 pending;pending 过期不能确认;凭据取用 0/1/多条三态。
- 变异探针:去掉占用检查、去掉发起者核对、去掉过期检查、去掉「多条拒绝」、颠倒「先撤旧后写新」顺序。
- **当场试跑**:用 Celine 的测试账号走一遍「点连接 → 确认卡片 → 确认」与「第二个客户尝试同一账号被拦」,不发布;记录触发方式、时间、输出摘要。

## 复用声明
- 复用:`requireDashboardClientAccess`、`upsertConnection`/`revokeConnection`、加密函数、`social-onboarding` 的 ambiguous 判定、`pm-todo` 人工待办管道。
- 新增(platform-shared):`platform_oauth_pending` 表与确认流程、跨客户占用检查、发布取凭据三态。
- 行业专属:无。客户专属:无(无客户名/ID 进入共享代码)。

## 待决定
- 技术(自拍):pending 用独立表而非新增 `status`;先撤旧后写新而非事务。
- 业务(已定):5 条规则。
- 尚未核实:TikTok 授权返回里除名称外是否有头像字段可展示(`user.info.basic` 含头像,待对照官方文档确认);各平台「去平台撤销」的入口路径。
