# 社媒连接治理设计说明 v2 — 吸收子牙+魏征首轮复审(未开工)

权威任务说明:本文件。写入者:本 Claude Code 会话。状态:**设计阶段,未写代码,未改库结构。**
修订:v1 经子牙(架构)与魏征(挑刺)独立复审,两人一致结论「方向对,但不能照原稿开工」;本版吸收全部阻塞项。

## 起因与判定
- 起因(2026-10-20):PM 在 CTS 设置页点「连接 TikTok」,浏览器登录的是 Celine 的 TikTok(`celinesyd222`),系统直接存下,同一账号同时挂在 CTS 与 Celine 两个客户下。已由 PM 授权把 CTS 名下那条标为 `revoked`(只改 1 行)。PM 追问:真实客户碰到同样场景怎么办,并同意 5 条默认规则(见下)。
- **Tier**:平台共享连接治理,属既有 L3 连接层;客户差异只走配置;不新增能力线。
- **风险**:A(授权、客户隔离、数据库结构、对外发布账号归属)。
- **§11**:频率 中 / IMPACT 高 / 收入 高 → P0。

## 5 条规则(PM 已同意)
1. 授权回来先让人确认,再保存。
2. 同一平台账号不能同时挂在两个客户下;对客户不透露占用方;内部给顾问派待办。
3. 同一客户同一平台默认只留一个当前账号;换号需明确确认「替换」。
4. 发布取凭据必须按目标账号,出现多条 active 一律拒绝。
5. 「撤销」文案讲清 ME 内撤销 ≠ 平台内撤销。

## 复审后确认的事实(行号来自两份复审)
- `tiktok/callback/route.ts`:授权回来**直接** `upsertConnection`,且**无 try/catch**(异常=500,违反该文件头「每条出口都跳回设置页」)。
- 库里无跨客户唯一约束(现有只有 `(client_id,provider,account_id)`);`upsertConnection` 会把同账号的 revoked 行改回 active。
- `tiktok/token.ts:21-29` 取凭据 `order by created_at desc limit 1`;`created_at` 在 upsert 冲突时**不变**,重新授权旧账号后它仍排最旧——「取最新」会取错。
- `getValidToken`(`token-manager.ts`)是 GSC/GBP/GA4/GTM/Ads 等**所有 Google 类**共用的通用函数,契约是**抛** `PlatformConnectionNotFoundError`;邮箱类本就允许多条 active。**不能改它。**
- YouTube 唯一调用点是 `inngest/functions/youtube-publish.ts:31`;目标频道本来就有(`clients.youtube_channel_id`、`getClientChannelId`)。YouTube/Instagram 目标账号已被配置锁定(`claimClientChannelTarget`、`instagram_handle` 比对),**换号对它们不是正常场景**,`confirmSocialConnectionWrite` 还要求恰好 1 条非 revoked。
- TikTok **没有「目标账号」**(`social-onboarding.ts:117`),规则 4 对 TikTok 只能做到「恰好 1 条」;TikTok 的 state 不含用户 id(YouTube/Instagram 含);TikTok 无断开接口。
- 每日审计 `cross-client-audit.ts:180-193` 读整张表**不按 status 过滤**:CTS 那条已撤销的行很可能仍让 `cross_client_leak`(critical,`NEVER_DROP_KINDS`)每天报警。**待只读确认。**
- `fetchDisplayName` 失败返回空串,回调回落成 `openId` 展示——卡片无法人眼核对。
- 多条 live 时发布侧报错是「这个客户还没连过 TikTok」(`tiktok-adapter.ts:100/121/171`),误导,且会把客户指到被隐藏的连接按钮(`SocialConnectionsPanel.tsx:62`)。
- `requireDashboardClientAccess` 放行所有 `client_portal_users`;YouTube/Instagram 的断开接口要求 `requireGlobalAdmin`——「替换」不能比「断开」权限更宽。
- 存量风险(推断,待普查):历史上换过号的客户很可能同客户有 ≥2 条 active;规则 4 一上线会让他们静默停发。

## 设计 v2

### A. 适用范围
`tiktok`、`google_youtube`、`instagram`。不含 `meta`(多主页合法)、不含非社媒连接。

### B. 原子确认(核心改动,含新表与 SQL 函数,一批迁移)
- **`platform_oauth_pending`**:`id`、`client_id`、`provider`、`account_id`、`display_name`、加密令牌、`scopes`、`token_expiry`、`authorizing_user_id`、`confirm_nonce_hash`、`created_at`、`expires_at`(数据库时间,15 分钟);`UNIQUE (client_id, provider, authorizing_user_id)`(新的顶掉旧的并删旧令牌);service-role RLS 模板 + 对 `anon/authenticated` 显式 `REVOKE`。**不改**现有表的 `status` 取值。
- **回调**:state 补 `userId`(与另两家对齐)→ 换令牌 → 核对 scopes → **拿不到账号名就当失败**(不进确认卡片,不拿 open_id 糊弄)→ 写 pending → 设 httpOnly `confirm_nonce` cookie(只存其哈希入库)→ 跳设置页确认卡片;全出口 try/catch,统一跳回并带结果码;`Cache-Control: no-store`、`Referrer-Policy: no-referrer`。
- **确认/取消接口**(POST,body 带 `pendingId`、`replaceConnectionId?`):查询**同时带** `id` + `client_id`(取自 pending 行本身,不取路径参数)+ `authorizing_user_id`;对 `pending.client_id` **在确认那一刻**重跑 `requireDashboardClientAccess`;`confirm_nonce` cookie 与库内哈希比对;重复/过期/不存在/取消后确认**返回完全相同的泛化结果**。读卡片数据的接口同样三重条件,且只 `select` 明确列出的无凭据列。
- **SQL 函数 `confirm_social_connection(...)`**(plpgsql,仅 service_role 可执行),单事务内:锁 pending `FOR UPDATE` → 用数据库时间校验未过期 → 占用检查(见 C)→ 同客户已有不同账号时,要求 `replaceConnectionId` **等于**当前 active 行 id,否则拒绝(防「卡片已过期」)→ 撤旧 → 写新 → 删 pending → 写审计。任一步失败整体回滚(**不会出现「零个有效」**)。
- **替换权限**:替换需要 `requireGlobalAdmin`,或同一 `authorizing_user_id` 且无未完成发布任务;客户普通成员只能在「没有现有账号」时确认。
- **撤销行的令牌**:治理撤销时同时覆写令牌密文(**待评审确认列可空/占位值**);现有「撤销保留行备查」保留,但不留可用凭据。
- **过期清理**:不新增 cron;回调与确认时顺手删过期行,并挂到一个**已有**的每日任务里批量清(实现时选定,避免新 cron 与 `render.yaml` 条目)。

### C. 跨客户占用
- 检查放进 B 的原子函数(并发安全),回调阶段再做一次**提前**检查给出早反馈。
- 口径:对方行 `status IN ('active','error','expired')` 都算占用;**忽略已归档客户**;释放路径 = 内部管理员撤销(新增 TikTok 断开接口,管理员权限)。
- **对客户**:占用与其它不可解的失败共用同一个泛化结果码「需要团队核实」,文案不出现「另一个客户」;`account_id` 空串直接判无效,不参与占用检查。
- **对内**:新增一张只追加表 `platform_oauth_blocked_attempts`(provider、account_id、尝试方客户、占用方客户、时间)作为**持久化来源**,由 `pm-todo` 新 pusher 读取生成待办(what/how/href,链接=内部设置页);内部待办**不进** `NEVER_DROP_KINDS`。与已有的 `cross_client_leak` 审计不重复:审计负责「库里已存在的串台」,新待办负责「被拦住的尝试」。
- **数据库兜底**(同一批迁移,先只读查重再征得 PM 授权才应用):`UNIQUE (provider, account_id)` 部分索引与 `UNIQUE (client_id, provider)` 部分索引,均 `WHERE status='active' AND purpose='legacy' AND provider IN (…)`。回调把 23505 映射为统一结果码。

### D. 发布取凭据(规则 4,**不动通用函数**)
- **TikTok**:`getValidTikTokToken` 返回三态 `none | ambiguous | ok`(≥2 条 active=`ambiguous`,不取最新);发布侧给 `ambiguous` 单独一句人话「存在多个 TikTok 授权,已暂停发布,请联系团队核实」;`checkTikTokStatus` 已在轮询场景下 fail-closed 安全。顺带确认刷新失败是否应标 error(`token.ts` 现不像 `token-manager` 那样标)。
- **YouTube**:只改 `youtube-publish.ts:31` 一处,按 `(client_id, provider, account_id=目标频道, status=active, purpose=legacy)` 精确取,0 条或 >1 条都拒绝;不改 `getValidToken`。
- **上线前置**:先做**只读普查**(各社媒 provider 同客户 ≥2 条 active 的客户清单),并配「停发了谁」的人工待办与修复入口——修复入口即 B 的替换流程,所以 **D 排在 B 之后**,除非普查显示零存量问题。

### E. G0(独立最小修复,C 级,不改库结构)
- `cross-client-audit.ts` 读 `platform_oauth_connections` 时**只排除 `status='revoked'`**(过期/出错但没撤销的仍算挂在客户名下,只有撤销才是释放;读不到状态的行照常比对)。**不加 `purpose` 过滤**(避免改变 Meta 只读授权等既有行为),与原稿不同;补 6 条测试。
- 顺带记账(不在本任务内做):`/api/workbench/today` 用 `requireAdmin`,`DEMO_ADMINS` 可读到全部客户待办;若某待办写两个客户名则越界——另开卡。

### F. YouTube / Instagram(G4 收窄)
不接确认卡片。缺口只有「同一频道/用户名被两个客户配置」:在**配置层**与回调里加跨客户占用检查,并且 **占用检查必须在 `claimClientChannelTarget` 之前**(否则被拦的尝试仍把别人的频道写进本客户配置)。

### G. 面板与文案(并入 B)
- 回跳横幅「TikTok 授权已完成」改为「请确认要连接的账号」;`tiktok=` 参数补 `section=social-connections`;`ambiguous` 时给出口(管理员可见的断开/替换)。
- 撤销文案说清 ME 内撤销≠平台内撤销;**具体平台入口路径先对照官方帮助页核实后再写**。
- 卡片名称做长度与控制字符(含 bidi)清洗;展示头像待对照官方文档确认字段。

## PR 切分(新顺序)
| PR | 内容 | 级别 | 库结构 |
|---|---|---|---|
| **G0** | 每日审计只看有效授权(`status`/`purpose`),补测试 | C | 否 |
| **普查** | 只读:各社媒 provider 同客户多条 active;当前 `cross_client_leak` 是否在响;跨客户重复 | — | 否(PM 授权只读) |
| **G2** | B + C + 兜底索引 + 面板/文案:pending 表、原子函数、确认/取消接口、TikTok 回调改造与 try/catch、TikTok 断开(管理员)、blocked_attempts + 待办 | A | 是(PM 授权才应用迁移) |
| **G1a/G1b** | D:YouTube 精确取;TikTok 三态(普查为零存量时可先于 G2) | A | 否 |
| **G4'** | F:YouTube/Instagram 跨客户占用检查(配置层/回调) | A | 否 |

## 验证计划
- 单测:路径客户与 pending 客户不一致被拒;发起者被移出客户后确认被拒;重复/过期/取消后确认返回形态一致;同用户两个 pending 后者顶前者;`replaceConnectionId` 与当前 active 不一致被拒;原子函数任一步失败整体回滚(含「写新失败时旧的仍有效」);并发两次确认同一 pending 仅成功一次;`account_id` 空串不命中占用;被拦与普通失败响应不可区分;TikTok 取凭据 0/1/多条(含重新授权旧账号的 `created_at` 陷阱);GBP/GSC/GA4/GTM/邮箱取凭据行为不变;占用检查在 `claimClientChannelTarget` 之前。
- 数据库行为(唯一索引、事务、并发)**用真实数据库的可重放 SQL 断言验证**,不只靠 mock。
- 变异探针:去掉 pending 查询里的 `client_id`;去掉 `authorizing_user_id` 核对;去掉 `status='active'` 过滤;颠倒过期比较方向;删掉 pending 删除步骤;「多于 1 条拒绝」改成「取最新」;删掉确认时的重新鉴权;颠倒「先撤旧后写新」。
- **当场试跑**:在**一次性测试客户**上走「点连接 → 确认卡片 → 确认」与「第二个客户尝试同账号被拦」,不发布;试完撤销并清 pending;不对真实客户 Celine 写入。

## 复用声明
- 复用:`requireDashboardClientAccess/requireGlobalAdmin`、`upsertConnection`/`revokeConnection` 的语义、加密函数、`social-onboarding` 的 ambiguous 判定、`cross-client-audit` 与 `cross_client_leak`、`pm-todo` 人工待办管道。
- 新增(platform-shared):`platform_oauth_pending`、原子确认函数、`platform_oauth_blocked_attempts`、TikTok 取凭据三态。
- 行业专属:无。客户专属:无。

## 待决定
- 技术(自拍):独立 pending 表;原子函数;不改 `getValidToken` 通用函数。
- 待评审再确认:撤销时覆写令牌密文的列约束;清理挂靠哪个已有每日任务;展示头像字段。
- 待 PM:只读普查授权;迁移应用授权(G2 完成后)。

## 普查结果(2026-10-20,生产库只读,未读任何令牌)
- 社媒平台里**同一客户有 ≥2 条未撤销授权**:只有 CTS 的 `meta` 两条(「CTS Tours」页面授权 + 「Meta Ads read-only」只读授权),是设计如此的合法并存;**tiktok / google_youtube / instagram 为零**。
- **跨客户同一账号(未撤销,排除我们自己的登录邮箱)**:无。撤销 CTS 名下那条之后,TikTok 的重复已清零。
- 各平台行数:tiktok 有效 2(2 个客户)+已撤销 1;google_youtube 有效 2(2 个客户);instagram 0 行;meta 有效 4 + error 3。
- 结论:**G1(发布取凭据多条即拒绝)没有存量停发风险**,按设计里的判断规则可以排在 G2 之前。

## G1 实施记录(2026-10-20)
- TikTok:`getValidTikTokToken` 改为查该客户全部 `active`(`limit(2)`);0 条返回 null、1 条正常、**≥2 条抛 `TikTokAmbiguousConnectionError`**(文案不含 token 字样);报错翻译与讲课发布分支单独处理该提示。保持 `getValidTikTokToken` 签名不变,调用方无需改。
- YouTube:新增 `youtube-publish/token.ts`,**按目标频道精确选**授权(`account_id = youtube_channel_id`),不改通用 `getValidToken`。**与上文规则 4 字面的差异**:YouTube 有真实的目标频道,多条授权时只要其中恰好一条对应目标频道就能发(不拒绝);对不上目标频道、或没配目标频道则拒绝。理由:YouTube 的目标频道本来就被客户配置锁定,按目标取比按条数拒绝更精确,也不会让「留着旧频道授权」的客户停发。发布前 workflow 里的 `lockChannel` 仍会再用令牌核对一次频道。
- 未处理(已知,另记):TikTok 刷新成功后写库的 `update` 未检查 error、刷新失败不标 `error`(魏征 I6 指出的既有问题),不在 G1 范围。

### G1 实施后复审(子牙+魏征,均无阻塞项)后的调整与已知缺口
- **采纳(两人共同建议)**:`getValidTikTokToken(clientId, { accountId? })`。已发出任务的状态轮询(`checkTikTokStatus`)带着原账号编号:该账号恰好一条有效授权就用它,即使客户还有别的有效授权——账号一致性不降低,只是不让无关授权把已发出的任务卡死(轮询只读、本就比对 `expectedAccountId`)。指定账号对不上时按默认规则(1 条返回由调用方比对、≥2 条拒绝)。**发布起点不能挑账号,多条仍拒绝。**
- **补测试**:真实 adapter 透传多授权错误且不向 TikTok 发请求;状态轮询带/不带账号;讲课发布「已有发布编号+多授权」保持 `processing`、不记失败、不重发;YouTube 真实查询条件(client_id/provider/status/purpose)与 inngest 接线断言。
- **已知缺口(未在 G1 处理,已记入 G2 范围或另开)**:
  1. **多授权没有自助解除手段**:TikTok 没有断开接口,重新授权不同账号只会新增一行。G2 的「替换」流程与 TikTok 断开(管理员)就是修复入口;在此之前如出现多授权,只能人工改库。普查显示目前无此情况。
  2. 多授权的提示只是文字,**未进「今日待办」人工任务管道**(待 G2 的待办一并做,避免现在新增 kind)。
  3. TikTok 刷新失败只返回 null、不标 `error`,且刷新成功后写库未检查 error——已失效的旧账号行会一直 `active` 并与新授权一起触发拒绝(魏征 I3/I6)。另开卡。
  4. 订单发布 POST 在「已占用工单、尚未向 TikTok 发起」之间若遇到多授权,工单停在 `sending`(现有对所有发起前失败的统一处理),窗口极小,先记录。
  5. YouTube 目标频道的授权被标 `error` 后,提示会写成「不是目标频道」而非「已失效」(次要)。
  6. `social-onboarding` 对 TikTok 用「所有未撤销行 >1」判多账号,发布用「有效行 >1」;方向安全,口径不同,G2 统一。
