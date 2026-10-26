---
title: Magic Engine「连接 WhatsApp Business」产品功能方案 v1（供子牙/魏征设计复审）
status: draft
owner: session:5d7b9a84（56 号窗口，只出方案、不动 src/）
decided_on: 2026-10-10
source: PM 2026-10-10「Magic Engine 应该具备让用户的 WhatsApp Business 可以接入的功能」
---

**权威说明**：本文件。只出方案，不改 `src/`、不改库、不提交 Meta 审核。
**层级判定（tier-gate）**：L3 Connector，挂在既有「Leads 营销中心 / CRM」下；不新增能力线、不新增支柱、不进候选登记。
**取代/承接**：承接 `docs/specs/2026-09-29-crm-omnichannel-plan-v1.md` 第 0 / 1 段（本文件把「客户自己点一下就接入」这件事展开成可开工的设计）；与 `2026-09-28-whatsapp-groups-crm-design-v1.md` 的群组接口是两件事（见 §6）。

## 1. 要达成什么（一句话）

任何一个 ME 客户，自己（或 FDE 代点）在设置页点「连接 WhatsApp Business」，几分钟内完成：号码绑定 → 收到的客人消息自动进 CRM → 员工能在 CRM 里回 → 断线有人知道。**不需要开发改环境变量、不需要进数据库手填号码。**

## 2. 现状盘点（2026-10-10 读代码 + 只读查库，逐条可核）

| 零件 | 位置 | 现状 | 对本方案的意义 |
|---|---|---|---|
| 统一发信总线 | `src/lib/messaging/channels.ts` + `adapters/whatsapp.ts` | 已写好，WhatsApp 适配器已登记；`isConnected` 用「有没有会话」判断，不是看授权 | **复用**；`isConnected` 要改成看真实授权 |
| 发送 | `src/lib/whatsapp/send.ts`（353 行） | 只读 **两个全局环境变量** `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`，且要求等于该客户绑的号，否则拦；只能发纯文本；超 24 小时发不出（没接模板）；Graph 版本 v20.0 | **最大缺口**：全公司只能发一个号。要改成「按号取凭据」 |
| 收信 | `src/app/api/webhooks/whatsapp/route.ts`（584 行） | 验签 + 按 `clients.whatsapp_phone_number_id` 找客户 + 写会话/消息/CRM 触点；**只认 `messages`**，不认员工手机回声（`smb_message_echoes`）、历史同步（`history`）、送达状态；员工手机回的消息现在是整条丢掉；对话归不到客户时只写日志（#1331 欠账） | **复用骨架**，补三类入口 |
| 绑号 | `api/clients/[id]/whatsapp-number/route.ts` + `WhatsAppNumberPanel.tsx` | 手填数字 ID，存 `clients.whatsapp_phone_number_id`（一客户一号） | 被「一键连接」取代，旧字段留作兜底 |
| 一键授权范式 | `api/auth/facebook/connect|callback`、`lib/meta-oauth/client.ts` | 签名 state（10 分钟）→ Meta 授权 → 换长期令牌 → 加密存库 → 带结果回设置页；Messenger 已在生产跑 | **照抄流程**；WhatsApp 的区别是用 Embedded Signup 弹窗（见 §4） |
| 令牌存储 | 表 `platform_oauth_connections` + `lib/platform-oauth/connection-store.ts` + `cms/crypto`（AES-256-GCM） | 已有 provider 枚举、状态（active/revoked/expired/error）、加密、`last_synced_at`；加新 provider 要改枚举和库约束（`vocabulary.ts` 文件头写明） | **复用**，新增 provider `whatsapp` |
| 断线监控 | `lib/platform-oauth/connection-health.ts`、`conversation-health-heartbeat.ts` | 判据已定（明说断了 / 心跳停了 / 权限变少）；WhatsApp 没有接 | **复用**，补 WhatsApp 的心跳口径 |
| 事件与自动处理 | `lib/conversations/events.ts`、`inngest/functions/conversation-inbound-autoack|draft` | 事件渠道无关，WhatsApp 已能触发安抚和 AI 起草；渠道分发散在 `messenger-agent/channel-dispatch.ts` | **复用**；上线并存号时要默认关自动安抚 |
| 「不许联系」闸 | `lib/crm/manual-send-dnc-gate.ts` | 文件存在；9-29 方案记录的「三条人工回复路由没接闸」是否已修，**本次没核**，列为开工前核对项 | 开工前必须核对 |
| 生产事实 | 只读查库 | WhatsApp 对话 **45 条**；**只有 1 个客户**绑了号码；没有 `messaging_channel_accounts` 表 | 系统几乎没有包袱，改造风险低 |
| Meta 侧事实 | Meta 工具只读查询 | 「Magic Engine」企业已有应用但**没加 WhatsApp 功能**；NAL 企业已通过验证、名下有一个已注册可发送的号，但**没有连任何开发应用**；CTS 企业前置条件满足 | 决定了 §5 的两条路 |

## 3. 两套授权模型，必须二选一（这是本方案最关键的设计决定）

| | A. 现状代码：ME 一把总钥匙 | B. 产品化：每个号一把钥匙（Embedded Signup） |
|---|---|---|
| 做法 | 客户把 WhatsApp 账户「共享」进 ME 的企业，ME 一个系统用户令牌管所有号（#1300） | 客户在 ME 页面弹窗里登录并选号，ME 拿到**只属于这个号**的令牌 |
| 优点 | 不需要 Meta 技术服务商资格，现在就能试 | 客户自助、可批量、客户随时可撤、一客户一令牌，泄漏只影响一家 |
| 缺点 | 一把钥匙管所有客户，泄漏即全灭；每接一个客户要人工去 Meta 后台共享；**不是产品功能** | 要先通过 Meta 技术服务商审核（两项高级权限 + 两段演示录屏） |
| 判定 | **只作 NAL 的过渡桥**，不扩展 | **产品形态，本方案主体**（PM 9-29 已定走这条） |

结论：**代码一律按 B 的数据模型写（按号存凭据）**；A 只是 B 的一个特例（同一个令牌填进多个号），所以两条路可以共用同一份代码，不会写两套。

## 4. 目标设计（B 路线）

### 4.1 客户看到的流程
设置页 →「连接 WhatsApp Business」→ Meta 弹窗（Embedded Signup）选企业、选号、选「并存（手机照常用）」或「迁到接口」→ 弹窗关闭 → 页面先显示「开通中」（授权已保存，正在订阅推送）→ 仅当 §4.2(3) 第③步机器回执成功后才切为「已连接：号码 + 状态 + 最近一次收到消息的时间」→ 订阅步骤重试中显示「开通中」，最终失败显示「开通失败」一句人话 + 「重试」按钮，绝不显示成功；之后出问题显示一句人话 + 一个「重新连接」按钮。状态集：provisioning / connected / error / disconnecting / disconnected。

### 4.2 后端分段（每段对应一个独立 PR）
1. **连接入口**：新路由 `api/auth/whatsapp/connect`（发签名 state）和 `callback`（收弹窗回传的授权码 + 企业账户 ID + 号码 ID，换令牌，加密存 `platform_oauth_connections`，provider=`whatsapp`）。沿用 `meta-oauth/client.ts` 的签名 state 与 `requireDashboardClientAccess`。**落库前必须从 Graph 端校验（fail closed）**：签名 state 与权限检查只证明操作者能访问某个 ME 客户，不证明弹窗回传的 `waba_id` / `phone_number_id` 属于换回的令牌。回调先用换到的令牌向 Graph 查实际授权的企业账户与其下号码，以及实际授予的权限范围（须含 `whatsapp_business_messaging` / `whatsapp_business_management`）；回传的 ID 与 Graph 结果不匹配、或权限不足，一律不写库、不写路由表，并记机器回执。做法对齐 Facebook 回调「先枚举令牌实际授权的 Page、只绑匹配项」（`src/app/api/auth/facebook/callback/route.ts:80-115`）。
2. **按号路由表**（新表，窄）：`phone_number_id`（唯一）→ `client_id`、`waba_id`、`mode`（coexistence / cloud）、`status`、`webhook_subscribed_at`、`history_sync_state`。令牌不放这里，放 `platform_oauth_connections`，避免两处存凭据。**每行必须带 `connection_id`（外键指向经 Graph 校验的那条 `platform_oauth_connections`）**：该表允许同一客户/provider 多行，而 `getValidToken(clientId, provider)` 只取最新一行，两个号由不同 Meta 主体授权时旧号会拿到新号的令牌。发送与健康检查一律经 `getValidTokenForConnection(connection_id)` 精确取令牌，不用按客户+provider 的取法。`clients.whatsapp_phone_number_id` 保留为读兜底，迁完再退役。**租户一致性由数据库保证**：先在 `platform_oauth_connections` 上保证 `UNIQUE(id, client_id)`（`20260920064556_meta_ads_ai_read_grants.sql` 已有同类做法，若该表尚无则同 PR 补），路由表用 `(connection_id, client_id)` 组合外键引用它，使号码与凭据不可能属于不同客户；写入路径禁止用普通 upsert 静默改换 `client_id` / `connection_id`（冲突时报错并下发人工待办），§5 的手工过渡行同样受此约束。**这张表要走 RLS 的 service-role 模板（`TO service_role`），A 级改库，合并前问 PM。**
3. **开户后三件事（不放在授权回调里，走 Inngest 分步工作流）**：回调只做一件事——存下授权，并投递一个幂等事件（如 `whatsapp.connection.authorized`，以企业账户+号码为幂等键）。随后由工作流分三步各自记机器回执（request id、client id、状态、是否重试、created_at）：①把我们的应用订阅到这个企业账户的消息推送；②并存号触发历史同步；③写「已连接」回执（页面据此才显示已连接）。企业账户的消息推送订阅是 **WABA 级共享资源**：同一企业账户下多个号码共用，订阅步骤须幂等。每步可单独重试，不会因回调超时而重复触发或丢失；历史只推一次，所以②必须以①成功回执为前提且只允许成功一次。**必须先把「历史/回声」的处理代码上线，再放客户开户**——历史只推一次，错过拿不回（9-29 方案已写）。
4. **收信改造**：先持久化再处理——验签通过后，先把原始包与幂等回执（payload 哈希、request id、收到时间、状态）可靠落库并立即回 200，再由 Inngest 异步、可续跑地逐条拆分处理（逐条幂等，单条失败只重试该条，不再对整包返回 503 导致整批重放；历史只推一次，不能依赖对方重试补取）。入口三分类——客人新消息 / 员工手机回声（记成「我方发出」，不判退订、不改客人最后说话时间）/ 历史同步（不建人、不写触点、不发事件，先进「待认领」）；再加送达状态回调。验签密钥改用技术服务商应用的密钥；路由改查 §4.2 第 2 条那张表。号码没人认领时，下发人工待办（三件套：what/how/href），不再只写日志（还 #1331 的债）。
4b. **回声作废待发草稿**：并存模式下客人消息可能已生成等待审批（最多四小时）的 AI 草稿；员工从手机回复（回声）落库为我方发出时，必须同时把该会话中、由更早客人消息触发的 pending/approved 草稿置为失效（记回执）。发送阶段（`conversation-inbound-draft.ts` 发送前复查，现仅查退订、渠道开关、窗口）另加一条：触发消息之后若已有任何我方出站消息，则不发、草稿置失效，避免稍后批准造成重复答复。
5. **发信改造**：`sendWhatsApp` 改成按号取凭据（不再读全局环境变量，也不再要求等于某一个号）；`isConnected` 看真实授权状态；超 24 小时走模板消息（模板的创建/列表/状态用官方接口，做成设置页里一个小列表，**模板只许人手逐条发，不许自动群发**）。
6. **健康监控与自愈提示**：接入 `connection-health`——令牌失效 / 号码被封 / 推送订阅被撤，都变成「今日待办」里的一条人话。判据靠**主动检查**（定时查令牌、号码状态、推送订阅是否还在），不用「多久没收到消息」当断线——安静的号码和失效的推送看起来一样，会给低流量客户误报；`connection-health` 对 Meta 的 `staleHours` 本就是 `null`，沿用。最后一条消息时间只作活跃度指标展示。当场试跑见 §8。
7. **PM 看板指标**：已连接号码数、近 7 天收/发条数、窗口关闭的会话数、模板被拒数——先放进现有设置页卡片，不新建页面。

### 4.3 刻意不做（本期）
- 不做官方群组接口（见 §6）；不做通话；不做短信；不做自动群发/营销推送。
- 不把对话正文送大模型（见 §7）。**正文存储边界是开户前置条件，不留作后续**：既有 webhook 会把 `messageBody(msg)` 直接写入 `conversation_messages.body`（`src/app/api/webhooks/whatsapp/route.ts:380-394`），AI 草稿消费者随后读取该正文。因此在书面同意、保留期、AI 使用闸（默认关，未获许可不得把正文送模型）三项未定前，收信改造须把 WhatsApp 正文按元数据模式处理（不落正文或不入 AI 草稿通道），并相应调整 §8 验收；这三项定下之前不对真实客户开户。
- 不做多号轮询/号码池；一个客户一个号起步，表结构允许一客户多号。

## 5. 两条路并行（对应 PM 手上的两样东西）

**路 1 · NAL 过渡桥（不等审核，尽快看到数据）**
- 前提（Meta 后台，需要有管理员权限的人操作）：NAL 的 WhatsApp 账户共享给 ME 企业；ME 应用加上 WhatsApp 功能；生成系统用户令牌；订阅 NAL 账户的消息推送。
- 代码：只需 §4.2 第 4、5 条（按号取凭据 + 回声/历史入口）和第 2 条的表，手工插一行；**不需要连接入口**。
- **我没验证**：以「共享给 ME 企业」的方式、在未通过技术服务商审核时，ME 应用能否拿到 NAL 号的消息推送与发信权限——这要在 Meta 后台实测，不能凭文档猜。
- 这条路要的是「NAL 的 WhatsApp 对话开始进 ME」，不是产品功能；它验证的是收信/回声/历史三类入口是否正确。

**路 2 · 产品主线（客户自助）**
- 前置：在「Magic Engine Messaging」应用加 WhatsApp 用例 → 配置 Embedded Signup → 录两段演示（从我们应用发消息被 WhatsApp 收到 / 建模板）→ 提交 `whatsapp_business_messaging` 与 `whatsapp_business_management` 审核（**对外动作，提交前问 PM**）。
- 审核等待期间，§4.2 第 1–7 条全部可以用开发号/测试号开发和验收；通过后才对真实客户放开。

## 6. 与「官方群组接口」的关系（NAL 的大部分对话在群里）

- 并存号（手机 App 与接口同时用）**不同步群聊，也不能用官方群组接口**（Meta 官方文档，2026-09-29 已核实，见 `crm-omnichannel-plan` §二）。
- 所以 NAL 现有的 32 个员工自建群，**接口永远接不到**；只能靠官方「导出聊天」补历史（本窗口正在做的临时方案），且导出是整段重导、不是增量。
- 官方群组接口只能让 ME「自己新建一个群」，从建群起的消息才能收到（`2026-09-28-whatsapp-groups-crm-design-v1.md`，前提是官方业务账户，且需沙盒实测 payload）。它是**另一个功能**，不在本方案内，等本方案收信通了再排。
- 因此对 NAL，最终是三层并存：一对一 → 接口（本方案）；已存在的群 → 导出（过渡）；新建的协作群 → 群组接口（以后）。

## 7. 隐私与合规红线（PM 2026-10-10 已定，原样承接）

1. 这是客户的客人的个人信息，客户才是持有方；NAL 同意目前是口头转述，**上线前补书面确认**。
2. 默认先存元数据（谁、何时、几次、到哪一步）；对话正文落不落库、落多久、能否送 AI，是**开户前置条件**（见 §4.3），三项未定不对真实客户开户。
3. 含真实姓名电话的对话送大模型前，先看供应商条款与脱敏要求。
4. 历史同步是一次性大批量写入：整批入库升 A 级，入库前先有「待认领」闸与验收（号码解析、时间合并规则）。
5. 令牌加密存储，日志里不许出现令牌；断开连接走**单独的断开工作流**（Inngest）：调 Meta 接口撤销授权；**仅当该企业账户下已没有其它活跃号码时**才取消该企业账户的推送订阅（断开单个号码只停用其路由行与凭据，其余号码继续收信），所需步骤都拿到回执后才把本地连接置为停用；任一步失败则保持「断开中」可重试并下发人工待办。注意 `lib/meta-oauth/data-deletion.ts` 只是接收 Meta 删除请求的回调、只处理 `meta_ads_read` 本地数据，不会撤权也不会退订，**不能当断开入口**；它另需扩展覆盖新 provider 的本地数据删除。

## 8. 当场试跑方案（先设计，开工前就定好）

不拿未来时间当验收。第一次试跑用一个**我们自己的测试号 + 测试企业**（不碰真实客户）：
1. 点「连接」→ 弹窗完成 → 页面显示已连接（看库里多出一行授权、一行路由表）。
2. 用另一部手机给测试号发一条 → 1 分钟内出现在 CRM 抽屉（看会话/触点；测试号为我们自己的号，可按测试用途临时放开正文，真实客户按 §4.3 正文存储边界，仅验证元数据：谁、何时、几次）。
3. 在抽屉里回一条 → 手机收到；再在测试号的手机 App 上回一条 → CRM 里记成「我方发出」，客人最后说话时间**不变**（这条验证回声）。
4. 人为撤销授权 → 10 分钟内「今日待办」出现一条人话待办（验证断线监控）。
5. 每一步记：触发方式、时间、结果、库里行数，写进 PR 的「## 当场试跑」。

## 9. 风险分级与审查

- **A 级**：新表 + 约束改动、凭据存储与验签、一次性历史入库、对外授权入口。
- **B 级**：设置页面板、模板列表、健康卡片。
- 大任务 ≥2 审：设计阶段子牙（架构）+ 魏征（挑刺）；面向客户的连接页面加板桥；涉及凭据/隔离加狄仁杰。**本文件尚未经过任何一审**。
- 写代码：默认交 DeepSeek 分轮（A 级也派，Claude 写指令与审 diff），不在 56 号窗口做。

## 10. 需要 PM 拍板 / 补事实

1. 你说的「新的 WhatsApp Business 账户」具体是哪个？是 NAL 企业里已经注册可发送的那个号，还是另有新建？（决定路 1 能不能立刻开始。）
2. 同意把「向 Meta 提交技术服务商审核」排进来吗？（对外动作，花费主要是人工与等待；消息费 Meta 原价透传，无 360dialog 月费。）
3. NAL 书面同意何时补？（上线前必须有。）

## 11. Reuse Statement

- **复用**：`ChannelAdapter` 总线、`platform_oauth_connections` + 加密 + 断线监控、Messenger 的签名 state 授权流程、`requireDashboardClientAccess`、既有 webhook 骨架与 CRM 身份/触点写入、Inngest 对话事件、人工待办三件套。
- **新增且平台共享**：按号路由表、`whatsapp` provider、连接入口、回声/历史/状态三类入口、按号取凭据的发送、模板管理。
- **行业专属**：无。**客户专属**：号码、企业账户 ID、员工花名册（群场景）——全部是按客户配置/授权记录，不进共享代码。
- **自检（换客户测试）**：把 NAL 换成 CTS 或悉尼地产客户，共享代码不需要改；唯一差别是路由表里的行和授权记录。
- **落点一致性**：与 tier-gate 决策一致（L3，挂 CRM）。

## 附录：Codex 10-14 评审意见（登记，未在本 PR 处理）

统管 2026-10-27 按 #964（机器人评论轮次上限）登记：Codex 机器人 10-14 对本方案和配套台账提了下列 19 条意见，三轮自动修复后停在「需人工」。本 PR 只是方案文档，不逐条修。**WhatsApp 接入真正开工（写代码）之前，必须逐条回应并更新本方案。** 优先级沿用机器人标注（P1 高、P2 中）。

| 优先级 | 意见 | 位置 |
|---|---|---|
| P1 | 将开户副作用移出授权回调 | 本文 |
| P1 | 为断开连接增加真正的 Meta 撤权流程 | 本文 |
| P1 | 在落库前校验号码属于本次 Meta 授权 | 本文 |
| P1 | 将每个号码显式绑定到对应的凭据记录 | 本文 |
| P1 | 先确定正文存储边界再验收 CRM 收信 | 本文 |
| P1 | 用租户组合外键约束号码与凭据 | 本文 |
| P1 | 先持久化历史整包再异步拆分 | 本文 |
| P1 | 仅在最后一个号码断开时取消 WABA 订阅 | 本文 |
| P1 | 将每条会话绑定到实际收信号码 | 本文 |
| P1 | 可靠落盘授权到工作流的交接 | 本文 |
| P1 | 撤权前检查凭据是否仍被其它号码引用 | 本文 |
| P1 | 为过渡桥提供受控的凭据导入入口 | 本文 |
| P1 | 为原始包到 Inngest 增加可靠交接 | 本文 |
| P1 | 在元数据模式下不要持久化完整原始包 | 本文 |
| P2 | 不要把无消息当作 WhatsApp 断线 | 本文 |
| P2 | 将已提交复审的台账标为 done | 2026-10-10-meta-business-verification-recheck-after-address |
| P2 | 收到员工回声时作废尚未发送的 AI 草稿 | 本文 |
| P2 | 等开户回执成功后再显示已连接 | 本文 |
| P2 | 将再次提交推迟到注册地址生效后 | 2026-10-10-meta-business-verification-recheck-after-address |
