---
title: ME 作为 Meta 技术提供方：Embedded Signup v4 + 并存（coexistence）接入 NAL 的 WhatsApp v1（设计稿，待子牙/魏征两审）
status: draft-for-review
owner: session:12233466（93 号窗口，只出文档）
decided_on: 2026-10-14
source: 56 号转述 PM「先把 NAL 的 WhatsApp 打通」；18 号统筹 10-14 令：只出设计稿、纯文档 C 级 PR、不写代码、不碰生产、不改开关
---

**层级判定（tier-gate）**：L3 Connector，挂在既有 Leads/CRM 下；不新增能力线、不新增支柱、不进候选登记。
**范围**：只到设计稿。**不做**：任何代码、任何生产库写入、任何 Meta 后台开关、迁移 176 号到 Cloud API、群聊接口、模板消息、自动发送开关。

## 0. 一句话（给 PM）

要让 NAL 员工**继续用手机上的 WhatsApp Business App，同时消息实时进 ME**，唯一的路是「并存接入」：由 **ME 自己的应用（作为 Meta 认可的「技术提供方」）** 弹出 Meta 官方的接入窗口，NAL 老板（或 FDE 代点）在窗口里选自己的号。这要先过两道门——**ME 企业认证**（已重新提交，审核中）和 **应用审核**（两项高级权限，要录两段演示）；并且「成为技术提供方」**撤不回**，必须你本人点头。接入后的第 24 小时内，必须各调一次「联系人同步」和「历史同步」，**各只能一次**，错过只能让 NAL 断开重来。并存会**踢掉 NAL 所有已链接设备**（Windows 版不支持），并让手机 App 里的若干功能（问候语/离开语/快捷回复/标签/广播列表/通话等）在这个号上失效——这是 NAL 的日常工作方式，**开工前必须先问清**。**不是「迁到 Cloud API」**：并存不会让手机 App 停用；纯迁移才会，那条没有你的明确「确认迁移」不会做。

## 1. 硬前提 / 门（缺一不可，按顺序）

| 门 | 内容 | 现状（2026-10-14） | 谁来点 |
|---|---|---|---|
| G0 | ME 企业认证通过 | 已重新提交，审核中（约 2 个工作日；日历 10-19/20 复查；56 号 10-16 先看） | Meta |
| G1 | 在 **ME 自己的应用**上申请 `whatsapp_business_management` + `whatsapp_business_messaging` **高级权限**（App Review，要两段演示录屏：①从我们应用发消息被 WhatsApp 收到 ②建一个模板；见 09-29 总方案第 1 段） | 未提交 | **提交是对外动作，PM 本人点头** |
| G2 | **成为技术提供方**（Tech Provider）——不可逆 | 未做 | **PM 本人点** |
| G3 | Embedded Signup 配置（Facebook Login for Business 的「配置」，选 v4、启用手机 App 用户接入） | 未做 | 56 号在 Meta 后台做（我给清单） |
| G4 | webhook 订阅字段：`messages`、`history`、`smb_app_state_sync`、`smb_message_echoes`、`account_update`（并存必须订阅前三者） | 目前 NAL 应用只订阅 `messages` | 56 号（并存当天才开，历史只推一次） |
| G5 | NAL 手机上的 WhatsApp Business App ≥ **2.24.17** | 未核 | NAL 员工 |
| G6 | NAL 书面同意把客人对话进 ME + 书面确认并存对手机 App 的影响（见 §7） | 口头转述，**无书面** | PM/FDE |

**重要**：现在手头的「NAL 新应用 977213705442240」归 **NAL 的商务账户**，只是过渡桥；技术提供方必须是 **ME 自己企业名下的应用**（09-29 总方案里的「Magic Engine Messaging」应用 1799741334398250，**是否仍是目标应用须 56 号核**）。以后每个客户都从这个应用接入，NAL 不是特例。【假设，待 56 号核】

## 2. 官方事实（2026-10-14 读 Meta 开发者文档；逐条可复核）

来源：onboarding-business-app-users、embedded-signup/overview、implementation、onboarding-customers-as-a-tech-provider、versions（均在 developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/ 下）。

- **Embedded Signup v2 将于 2026-10-15 弃用**；v3 同在 2026-10 到期；**v4 是目标**（2025-10-08 发布，到期 TBD）。要用 v4：在 Facebook Login for Business 里**新建配置并选产品**，会自动落到 v4。**【待实测，官方页之间不一致】** versions 页称 v4 的 `extras` 留空、「手机 App 接入」的 `featureType` 为 `whatsapp_business_app_onboarding`；implementation 页的示例却是 `extras:{setup:{}}` 且没提 `featureType`——以第一次真实跑通的参数为准。**我们没有任何 v2 存量，直接做 v4。**
- 前端：加载 JS SDK（`https://connect.facebook.net/en_US/sdk.js`，`FB.init({appId, autoLogAppEvents:true, xfbml:true, version})`），`FB.login(cb,{config_id, response_type:'code', override_default_response_type:true, extras:{...}})`；所有域名必须 HTTPS 且在「允许域名/有效 OAuth 回调」里；监听 `window` 的 `message` 事件（`event.origin` 以 `facebook.com` 结尾，`type==='WA_EMBEDDED_SIGNUP'`），完成事件里有 `phone_number_id / waba_id / business_id`；并存完成的 `event` 为 `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`（`version:3`，`data.waba_id`）。
- **可兑换的 code 只活 30 秒**：前端一拿到就立刻 POST 给我们后端，后端立刻换。（文档未说明是否一次性，按一次性处理。）
- 后端（**必须服务器到服务器**）：①`GET https://graph.facebook.com/<v>/oauth/access_token?client_id&client_secret&code` 换「商务令牌」（业务集成系统用户令牌；有效期文档未写）；②`POST /<WABA_ID>/subscribed_apps`（Bearer 商务令牌）订阅应用到客户 WABA；③`POST /<PHONE_NUMBER_ID>/register`（带 6 位 PIN）——**并存接入要跳过**（号码已注册）；④可选 `GET /<phone_number_id>?fields=is_on_biz_app,platform_type`，期望 `true` / `CLOUD_API`。
- **接入后 24 小时内**必须各调一次（必须已订阅对应字段，且手机 App 保持打开）：`POST /<PHONE_NUMBER_ID>/smb_app_data` body `{"messaging_product":"whatsapp","sync_type":"smb_app_state_sync"}`（联系人，**一次**）和 `{"sync_type":"history"}`（历史，**一次**）；各返回 `request_id`（要存）。错过 → 必须让客户**断开**后重走流程。
- 历史：客户可拒绝分享（拒绝时 `history` webhook 带错误码 2593109）；同意则含接入前 **180 天**的 1:1；**不含群聊**；媒体编号只给前 14 天，其余为 `media_placeholder`；phase 0/1/2 = 0–1 天/1–90 天/90–180 天，`progress=100` 表示同步完成，`chunk_order` 可乱序。
- 并存限制：已链接设备**全部被解除**，客户可重新链接受支持的（**WhatsApp for Windows 与 WearOS 不支持**，最多 4 个链接设备）；不支持的设备发的消息不会触发 webhook、看不到镜像；定速 **20 条/秒**；手机 App 发的消息仍免费、不影响 Cloud API 的服务窗口；Cloud API 的 24 小时窗口只在客人**接入后**来信才开。
- 并存后**不支持/改变**：群聊、阅后即焚、一次性查看、实时位置、**广播列表（变只读）**、语音/视频通话、商品目录/订单/状态、**营销消息、问候语/离开语、快捷回复、标签**、商家资料、频道。
- 断开：只能在手机 App「设置→账户→商业平台→断开账户」，触发 `account_update`（`PARTNER_REMOVED`，`disconnection_info.reason/initiated_by`）；并存号**不能**用 Deregister API。
- 技术提供方不分担信用额度，客户自己在 WhatsApp Manager 加付款方式；每 7 天可接入的新客户数 10（过企业认证/应用审核/访问验证后 200）。
- **文档里没写清/要实测**：商务令牌的有效期；`override_callback_uri` 的写法；`config_id` 如何打开「手机 App 接入」（只见 `featureType`）；WABA 是否可被并存选中（见 §6 风险 R1）。

## 3. 现状（读代码核实，基线 2026-10-14 主干）

- 已合并：验签按应用选密钥（#2541）、回声记我方发出/失败回执/历史先拒收（#2592）、历史待认领收件箱 + 无人认领号码待办（#2595，**线上表已建**）、拒收日志（#2622）。回声只挂**已有会话**；历史**只存元数据**进收件箱，**没有认领流程**。
- 已有可复用：`platform_oauth_connections`（provider `whatsapp`，account_id=phone_number_id，令牌 AES-256-GCM）、`whatsapp_app_credentials`（按号码的应用密钥）、签名 state 授权范式（`api/auth/facebook/connect|callback`、`lib/meta-oauth/client.ts` 的 `buildState/verifyState`）、`requireDashboardClientAccess`、`lib/meta-oauth/data-deletion.ts`、`register-whatsapp-number.ts`（手工登记，校验 `clients.whatsapp_phone_number_id`）。
- **缺口**：①没有「连接页/一键授权」；②`smb_app_state_sync`（联系人同步）目前被分类为 `ignored` 直接回 200，**一次性的联系人同步会被我们丢掉**；③没有 24 小时同步调用与追踪；④没有 `account_update` 处理；⑤没有「接入记录」（谁、哪个号、几点接入、同步到哪一步）。

## 4. 目标流程（按段，每段一个独立 PR；全部 A 级，凭据/对外授权入口）

**段 A · 连接入口（前端 + 签名 state）**——设置页「连接 WhatsApp Business」：服务端签名 state（沿用 `buildState`，10 分钟）→ 页面加载 JS SDK 并 `FB.login({config_id, response_type:'code', override_default_response_type:true, extras:{…}})`（extras 以实测为准，见 §2） → 监听 `WA_EMBEDDED_SIGNUP` 消息，拿到 `waba_id/phone_number_id` 与 `authResponse.code` → **立刻 POST 到后端**（带 state）。页面只在 `requireDashboardClientAccess` 通过后渲染；客户私有信息不进页面源码。

**段 B · 回调（服务端，A 级）**——校验 state（客户 id 来自 state，不信前端）→ `oauth/access_token` 换商务令牌（30 秒内）→ `subscribed_apps` → **跳过 register** → `is_on_biz_app/platform_type` 回读确认 → 加密存令牌（`platform_oauth_connections`，provider `whatsapp`）→ 把「这个号的应用密钥」登记到 `whatsapp_app_credentials`（**同一个 ME 应用，密钥是 ME 应用的**）→ `clients.whatsapp_phone_number_id` 绑定（若该客户已绑别的号→**拒绝并报错，不覆盖**）→ 写「接入记录」→ 发 Inngest 事件 `whatsapp.onboarding.finished`。任何一步失败：明说哪一步、不留半截（令牌已存但没订阅 → 记 `error` 状态、下发人工任务三件套）。

**段 C · 24 小时同步（Inngest 工作流，A 级）**——收到 `whatsapp.onboarding.finished` 后：①确认字段已订阅；②**立刻**调 `smb_app_data` 的联系人同步，存 `request_id`；③再调历史同步，存 `request_id`；④每一步**幂等**（接入记录里记「已请求」，重放绝不第二次调——各只能一次）；⑤到点（接入后 20 小时）仍未成功 → 今日待办「需要你动手」（what/how/href）；⑥历史按 §3 已有路径进收件箱；⑦联系人同步需要新入口（见 §5）。**没有 Ray 授权事件和 provider 回执，不得伪造完成。**

**段 D · 联系人同步入口（`smb_app_state_sync`）**——新增分类 `contact_sync`，**只存元数据**（电话号码 + 动作类型 + 时间；**姓名是否落库要 PM 另定**，默认不存），进「待认领」同类收件箱；否则这次一次性同步会丢。

**段 E · 生命周期**——`account_update` 的 `PARTNER_REMOVED / account_offboarded / account_reconnected`：令牌标 revoked、号码绑定保留但状态置「已断开」、下发待办；接入记录状态机：`created → token_ok → subscribed → synced_contacts → synced_history → live | failed | disconnected`。

**段 F · 断线与健康**——并入既有 `connection-health`（WhatsApp 心跳口径：超 N 小时没有任何事件）。

**上线顺序（硬）**：G0→G1→G2→G3 全过 →（PM 点头）→ 先在**备用号**上跑通一遍（§8）→ 才轮到 NAL；NAL 当天按 G4 订阅字段 → 接入 → 段 C 同步。历史**只推一次**，所以段 C、段 D、历史收件箱必须先于 NAL 接入上线。

## 5. 数据模型（先证明现有零件承载，再说新增）

| 要存的 | 现有零件 | 结论 |
|---|---|---|
| 商务令牌 | `platform_oauth_connections`（provider `whatsapp`） | 够用；`token_expiry` 取文档实测值，不再写死 2099（**商务令牌有效期要实测**） |
| 应用密钥 | `whatsapp_app_credentials` | 够用（按号码一行；ME 应用的同一把密钥） |
| 号码归属 | `clients.whatsapp_phone_number_id` | 够用（一客户一号；多号留到真有需求） |
| 接入进度 / 两个 `request_id` / 同步截止时间 | 无 | **新增窄表 `whatsapp_onboardings`**：`id, client_id FK, waba_id, phone_number_id, mode('coexistence'), status, onboarded_at, contacts_sync_requested_at, contacts_request_id, history_sync_requested_at, history_request_id, history_progress, disconnected_at, error_summary`；`UNIQUE(client_id, phone_number_id)`；RLS 一律 `FOR ALL TO service_role USING (true) WITH CHECK (true)`；A 级迁移（PM 点头才应用） |
| 联系人同步元数据 | 无 | 并入「待认领」收件箱（新增一个 `kind` 或同族新表，设计时再定；**不存姓名**，除非 PM 另说） |

## 6. 风险清单（先列，不替 PM 接受）

- **R1（可能卡死）· NAL 现有 WABA 能否被并存流程接入**。56 号转述「WABA 若原本由开发者应用创建则不能被 Embedded Signup 直接选中」；**我在官方页里没核到这句**，所以标【待核】。NAL 的 WABA = 1464825838919702；176 在 Meta 里是「WhatsApp Business 手机应用」类号码（已核，56 号）。若不能被选：按官方做法走**离线再接入/由客户从手机 App 侧发起**，设计要追加一条「R1 失败的备用流程」。**核对方法**：先用备用号（§8）走一遍，再对 NAL 的账户做只读检查（`is_on_biz_app`、账户类型），**在拿到结果前不承诺 NAL 的接入日期**。
- **R2 · 一次性的两次同步**：任何一步做错，只能让 NAL 断开重来（还会再次解除设备）。段 C 的幂等与「先订阅后同步」是硬要求，且要有**试跑**。
- **R3 · NAL 员工的链接设备**：并存会解除全部已链接设备；**Windows 版与 WearOS 不支持**。NAL 员工用哪些设备要**逐人列清**（电脑上是网页版/Mac 版可以重新链接；Windows 桌面版不行）。
- **R4 · 手机 App 的功能损失**：问候语/离开语、快捷回复、标签、广播列表（只读）、通话、目录/订单——NAL 若在用，会**当天失效**。这条是业务风险，**必须 NAL 书面确认**后才接入。
- **R5 · 群聊不同步**：NAL 的大部分对话在 32 个员工自建群里，接口接不到（已知）；只能靠导出补（56 号在做）。并存**不改变**这一点。
- **R6 · 客人隐私**：历史 180 天的 1:1 对话元数据（客人号码）进收件箱；**默认不存正文**；联系人姓名默认不存；保留期未定（认领流程那一轮定）。书面同意必须先有（G6）。
- **R7 · 技术提供方不可逆**：一旦成为，不能撤回；之后每个客户接入都挂在 ME 应用下，应用被封=所有客户断。要 PM 本人点；建议同时评估应用的备份/所有权（谁是管理员）。
- **R8 · 20 条/秒定速**与 24 小时窗口：并存号的 Cloud API 发信只在客人**接入后**来信才开窗；刚接入时的老对话只能用模板回——本设计**不做模板**（范围外），员工继续用手机 App 回即可（这正是并存的意义）。
- **R9 · 企业认证/应用审核被拒**：G0/G1 都可能被退；设计在 G0 通过前**不开工写代码**（18 号冻结令），只留本稿。
- **R10 · Embedded Signup 文档本身前后不一**（官方页之间对 `featureType` 与 `extras` 的说法不一致）：以 **v4 + 真实一次跑通** 为准，段 A/B 的参数以试跑结果落定，不照抄文档。

## 7. 必须 PM / NAL 先回答的问题（一次只问一个，按此顺序）

1. NAL 手机上有没有在用：问候语/离开语、快捷回复、标签、广播列表、Windows 桌面版？（决定 R3/R4 能不能做）
2. NAL 书面同意把对话进 ME（G6）什么时候补？
3. 成为技术提供方（G2，不可逆）——等 G0 通过后由你点。
4. 联系人姓名要不要存（默认不存）。

## 8. 试跑方案（不碰 NAL、不碰 176）

- **备用号演练**：找一个**我们自己的**手机 + WhatsApp Business App ≥ 2.24.17 + 一个能收验证码的备用号（需 PM 提供/同意用哪一个）。**不能用 NAL 的 176，不能用 Meta 免费测试号**（测试号触发不了回声/历史，已在 10-14 实测，未见到达证据）。
- 在 G0–G3 通过后，用 ME 应用 + 一个**名字带「测试」的临时客户**（写生产库，PM 点头）走完整段 A→E；验收看：库里接入记录状态机走到 `live`、两个 `request_id` 都有、收件箱里有历史行且无正文、手机里回一条 → ME 里出现「手机 App 员工」发出的消息且客人最后来信时间不变、再来一条客人消息 → 正常入库并触发既有安抚/起草（该客户自动开关保持关闭）。
- 演练完：令牌 revoked、密钥行 disabled、号码解绑、手机 App 里「断开账户」；台账记回执。**这一步演练会让备用号手机的链接设备被解除**，要先告知。
- 当场试跑每段都按仓库规则写进 PR 的「## 当场试跑」。

## 9. 风险级、审查与 PR 切分

- 本稿：C 级（纯文档）。后续每段代码：A 级（凭据、对外授权入口、新表、一次性外部调用），大任务两审（设计前一次已含本稿的两审；实施后各一次）。
- 切分：PR-A（连接入口，前端）→ PR-B（回调与令牌，含接入记录表迁移）→ PR-C（24 小时同步工作流）→ PR-D（联系人同步入口 + 生命周期 webhook）→ PR-E（健康监控）。**各自可单独回滚；迁移只写不应用，PM 点头才应用。**

## 10. Reuse Statement

- 复用：`platform_oauth_connections` + 加密、`whatsapp_app_credentials`、签名 state 与 `requireDashboardClientAccess`、`buildState`、Inngest 事件工作流、既有 webhook 骨架与待认领收件箱、待办三件套。
- 新增且平台共享：接入记录表、连接入口、回调、24 小时同步工作流、联系人同步入口、生命周期处理。
- 行业专属：无。客户专属：只有表里的行（号码、WABA、令牌、请求编号）；NAL 的事实（176、群、员工设备）只写在本稿的「现状/风险」里作为案例，不进共享代码。
- 换客户测试：把 NAL 换成 CTS 或地产客户，共享代码不用改，只多一条接入记录。
- 落点与 tier-gate（L3 Connector，挂 CRM）一致。

## 11. 与已有方案的关系

承接 `2026-10-10-whatsapp-business-connect-plan-v1.md`（56 号工作区，§3 授权模型、§4.2 分段）与 `2026-09-29-crm-omnichannel-plan-v1.md` 第 1 段；本稿把「并存」落成可开工的分段，并补上它们没写的：v4 要求、24 小时同步纪律、联系人同步入口、R1 风险与备用号演练。

## 12. 设计审查修订（子牙 + 魏征，2026-10-14，已并入；与前文冲突处以本节为准）

**A. 官方事实降级（魏征）**：`extras` 写法、`featureType`、`config_id` 如何打开手机 App 接入——一律标【待实测】，以备用号第一次真实跑通为准（R10 升级为「段 A 的参数不预先写死」）；`override_callback_uri` 不写；`register` 的「并存跳过」出自 onboarding-business-app-users 页（已核），商务令牌换取与 `subscribed_apps` 出自 tech-provider 页（已核），**code 30 秒** 出自 implementation 页（已核，是否一次性文档没说，按一次性处理）。官方还要求「必须使用带会话日志（session logging）的 Embedded Signup」——段 A 必须监听 `WA_EMBEDDED_SIGNUP` 并把事件落到接入记录（补上）。

**B. 硬门补强（魏征）**：
- **G5 加子条件**：NAL 必须先给出**员工设备清单 + 手机 App 功能使用清单**（§7 第 1 问），并**书面确认**接受 R3/R4 后果；没有书面确认**不接入**。G6（书面同意）不变。
- **新增 G7（只读前置检查）**：接入前对 NAL 的 WABA 和 176 做只读检查（`is_on_biz_app`、账户类型、WABA 创建来源、已有订阅），把 **R1 升为前置检查**——**拿到结果前不承诺 NAL 的接入日期**。
- **G2 加前置**：成为技术提供方前，确认 ME 应用有**至少两位管理员/备份所有人**（R7：应用被封 = 所有客户断）。
- 联系人姓名与 180 天元数据落库：**默认不存姓名**，要存必须 PM 书面点头（成为一道门，不是默认）；保留期未定前，历史收件箱不对外使用。
- PR-E（健康监控）上线前不得对真实客户接入。

**C. 段 B 重写（子牙 + 魏征）**：回调不再是「一口气做完」，而是 **Inngest 工作流五步，每步一条机器可读回执**（request id、client id、waba id、状态、时间、no_publish/授权状态）：①验 state（**单次使用 nonce，防重放；与登录会话绑定；回传的 `waba_id`/`phone_number_id` 必须是同一次会话里 Meta 事件给出的，且该 WABA 尚未绑定别的客户**）→ ②30 秒内换商务令牌 → ③订阅 → ④回读 `is_on_biz_app/platform_type` → ⑤加密存令牌 + 登记密钥 + 绑号码。状态机：`created → token_ok → subscribed → verified → live`；任何一步失败停在对应状态并下发人工待办（what/how/href），**不假装完成**；已存的令牌随状态一起标 `error`，号码绑定冲突时（该客户已绑别的号）**拒绝且清理已存令牌**。商务令牌有效期**未知**：`token_expiry` 存实测值；未知时按「短有效期」处理并在健康检查里主动回读，不再写死 2099。

**D. 段 C「各只能一次」的硬保证（子牙，最重要）**：
- 调用前的**原子占位**：`UPDATE whatsapp_onboardings SET contacts_sync_requested_at = now() WHERE id = ? AND contacts_sync_requested_at IS NULL RETURNING id`（历史同步同理用 `history_sync_requested_at`）；**抢到的那一个才有权调用 Meta**，Inngest 重试/重放拿不到就不调。
- 调用前**再核一次**：字段已订阅（`history`/`smb_app_state_sync`/`smb_message_echoes`）、手机 App 在前台（只能问人，写进待办让员工确认）、距接入不足 24 小时（留 ≥2 小时余量）。
- **调用后超时/没拿到 `request_id`**：状态置 `needs_manual_check`，**停止重试**，下发待办「这一步 Meta 可能已执行，别再调；去核对 webhook 是否到达」。绝不自动重试。
- 联系人同步入口（段 D）与 `account_update` 入口**必须先于段 C 上线**——PR 顺序调整见 §E。

**E. PR 顺序调整（子牙 + 魏征）**：PR-1 联系人同步入口 + `account_update` 入口（先上，纯入库/记录，不碰 Meta）→ PR-2 接入记录表（迁移只写不应用）+ 段 B 回调 → PR-3 段 C 24 小时同步 → PR-4 段 A 连接页 → PR-5 健康监控 + 备用号演练工具。每个 PR 都是 A 级、迁移只写不应用、PM 点头才应用。

**F. 数据表补强（子牙）**：`whatsapp_onboardings` 增加 `UNIQUE (phone_number_id)`（同一个号不能同时属于两个客户）、`status` 的 CHECK 取值、两个 `request_id` 各自部分唯一索引、`state_nonce` 唯一；并写明并发规则：同一 WABA/号码并发接入时，由唯一约束拒绝后到者。

**G. 备用号演练补强（魏征）**：①演练客户创建后必须**程序化校验**其号码 ≠ NAL 的 176、≠ NAL 任一 WABA（不同才能继续）；②**演练前必做确认项**：备用号手机上的已链接设备会被解除，机主确认；③演练前写明备用号所属 WABA 是否独立于任何真实客户，演练失败时如何在手机 App 里「断开账户」重来；④演练客户的自动安抚/起草/自动审核开关**全程保持关闭**，所以 §8 的验收「触发既有安抚/起草」改为「**能触发但被开关挡住并留下回执**」，不是真的自动发送；⑤§8 验收「出现手机 App 员工发出的消息」的前提：**必须先有客人来信建立会话**（回声只挂已有会话）。

**H. 对 18 号冻结令的一致性**：本稿只是文档；G0–G7 全部过之前不写一行代码；所有对外或不可逆动作（提交审核、成为技术提供方、应用迁移、订阅字段、断开/重连）都在门表里标了由谁、何时、要谁点头。

