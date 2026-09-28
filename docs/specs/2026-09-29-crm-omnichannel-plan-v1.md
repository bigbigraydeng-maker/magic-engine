---
title: CRM 多渠道收发中心方案 v1——WhatsApp（并存）/ Messenger+IG 私信 / 邮件 / 短信 / 电话外呼
status: draft
owner: session:5b9407a2
decided_on: 2026-09-29
source: PM 原话「CRM 内需要尽快整合对外发 SMS、电话外呼、WA message（coexistence 模式）、email 往来、站内 message 往来的多渠道功能（基于 Meta 生态），这是承接广告和后面业务的关键核心部分」
---

**权威说明**：本文件。**写入者**：本会话，唯一。**本轮只出方案，不动 `src/`。**

按 §11：频率 高（跟进团队天天用）/ IMPACT 高（卡在 Act——广告带来的线索接不住就白花钱）/ 收入 高（NAL 月目标 300 开聊、CTS 成交都走这里）→ 零低 → **P0**

**层级判定（me-platform-tier-gate）**：统一收发中心 = 既有 CRM 能力的扩展（平台共享，不新增支柱）；每个供应商（360dialog、Twilio、Outlook、Meta Graph）= L3 Connector，挂在同一个渠道接口下。不进 platform-candidates。

## ⭐ v1.1 复审后定稿（2026-09-29，采纳子牙必改 7 条 + 魏征 🔴 三条；下文 v1 原稿保留作对照，冲突以本节为准）

**纠正 v1 的事实错误**：员工手机回复现在是被**整条丢掉**（不是记成客人消息）；渠道取值至少**六处**对不上（不是三处）；方案漏了现成的语音模块和 `channel-dispatch.ts` 两套分发；「员工回复署名到人」做不到，只能署名「经手机 App 发出」。

**🔴 现存漏洞，不等并存、先修**：员工手点的三条回复路由（WhatsApp / Messenger / 邮件）一行都没查「别再联系」名单——今天就能给说过 STOP 的人手动发消息。→ 独立小 PR 立即修，DNC 闸查不出来按拦。

**定稿分段**：
- **0-DNC（立即）**：三条人工回复路由接 `isDoNotContact`，查询失败按拦；抽屉按钮置灰。
- **0a（不花钱，A 级）**：六处渠道取值一个 PR 对齐（两张表约束 + 四处代码常量，加对比测试）；`channels.ts` 成唯一注册表、`channel-dispatch.ts` 从它取；DNC 闸焊进 `sendOnChannel`；WhatsApp 进线三分类处理入口（客人新消息 / 员工手机回声 / 历史同步），历史不建人、不写触点、不判退订、不发事件、不改时间，先进「待认领」；回声按客人号挂会话、记我方发出、不判退订；时间字段只往前走；发送号按客户取（不再要求等于环境变量那一个号）。代码可写、用样例测，**员工回声和历史的当场试跑挂到第 1 段**（没真号码跑不了，开台账卡）。
- **0b（B 级界面）**：抽屉合成一个回复框；发送前提示「X 分钟前已有我方回复」。
- **1（花钱，A 级）**：360dialog 入口只管验签再交 0a；新建窄表 `messaging_channel_accounts`（按号存，复用 `cms/crypto` 加密，支持一客户多号）；**先上线处理代码、先订阅 `history` / `smb_message_echoes`，再开户**（历史只推一次，错过拿不回）；并存号默认关自动安抚、模板只许人手逐条发；当场试跑加「用 WhatsApp 网页版回一条看收不收得到」；断线监控。
- **2（A 级）**：IG 私信——加 Meta 权限会静默断现有连接，必须同时下发重连任务 + 断线监控；先查应用审核状态。
- **3（花钱，A 级）**：短信先上（send 接口下的一个适配器）；外呼+录音复用语音模块、另走 `CallAdapter` 窄接口不进 send；外呼闸同时过 CRM DNC（两套名单只留一个真相源）；每客户月上限 / 每人日上限 / 每客人日次数硬闸，发出去收不回的动作一律不自动重试；录音转存私有存储、按客户隔离、定保留期、报卡号可暂停录音。
- **4（A 级）**：AI 打标签——先把旅游「出行日期」逻辑从共享 CRM 抽到行业配置；通话文字送外部模型前过隐私审。

**待法务 / PM 核（不阻塞 0 段）**：NZ/AU 营销短信退订、澳洲谢绝来电登记册、录音告知、个人信息出境。

## 一、现状（2026-09-29 只读盘点，证据见文末）

| 渠道 | 收 | 发 | 员工在抽屉里能回 | 凭据 |
|---|---|---|---|---|
| WhatsApp | ✅ webhook | ⚠️ 只能纯文本，**超 24 小时发不出**（没接模板） | ✅ `WhatsAppReply` | ⚠️ 全局单号，不能多客户 |
| Messenger | ✅ webhook + 每小时同步 | ✅ | ✅ `MessengerReply` | ✅ 按客户 |
| 邮件 | ✅ 仅 Outlook（无 Gmail） | ✅ | ✅ `EmailReply` | ✅ 按客户 |
| Instagram 私信 | ❌ | ❌ | ❌ | — |
| 短信 SMS | ❌ | ❌ | ❌ | — |
| 电话 | ⚠️ 只有 AI 接听来电 | ❌ 不能外呼 | ❌ | ⚠️ Twilio 变量在、无代码用 |

**地基问题**：
1. `src/lib/messaging/channels.ts` 的统一渠道接口已写好，但**生产代码一次都没接上**，三个回复框各走各的发送路由。
2. 渠道取值三处对不上：`conversations.channel` 不允许 sms / instagram / phone，写进去会被数据库拒。
3. WhatsApp 连接本身没通：CTS 缺 4 个库字段 + 5 个环境变量；接号码这条路径 9-26 PM 定「先不花」暂停（`docs/ledger/2026-09-26-whatsapp-crm-no-spend-park.md`）。

## 二、关键外部事实（决定方案形状）

- **并存模式（coexistence）**：同一号码手机 WhatsApp Business App 和系统同时可用，员工手机回的消息由 Meta 通过 `smb_message_echoes` 推给系统，近 6 个月 1:1 历史可同步。经 360dialog 托管开户，**ME 不需要先拿 Meta 技术服务商资格**（360dialog 9-07/09-10 书面确认）。起步 €250/月含 5 个号，Meta 消息费原价透传。
- **并存号的硬限制（Meta 官方文档原话）**：**不能打 WhatsApp 电话、群聊不同步也不能用官方群组接口**、群发列表禁用、固定 20 条/秒。→ 电话外呼走 WhatsApp 这条路不通，必须走电信供应商。
- **短信和普通电话不在 Meta 生态里**：Meta 没有短信产品；WhatsApp 通话接口本身也不录音。短信 + 外呼 + 录音统一走一家电信供应商（仓库已有 Twilio 变量占位，优先它）。
- 🔴 **并存上线前必须先修的坑**：现在 webhook 把所有消息的 `from` 当客人（`route.ts:361/384`）——并存一开，员工手机回的每条消息都会被记成「客人说的」，客人的「最后说话时间」被员工冲掉，跟进提醒全部失真。**这条不修不许切并存。**

## 三、分段（每段独立 PR，各自过风险闸）

**第 0 段 · 地基（不花钱，可立即开工）**
- 统一渠道接口接上生产：抽屉里一个回复框，按客人有哪些渠道自动给选项，发送都走 `channels.ts`。
- 渠道取值对齐：`conversations.channel` 放开 sms / instagram / phone（**A 级：改库结构，合并前问 PM**）。
- WhatsApp webhook 支持 `smb_message_echoes`（员工回复记成「我方发出」、署名到人）+ 送达状态回调。
- WhatsApp 凭据从全局单号改成按客户按号（为多客户、多号铺路）（**A 级：碰凭据/验签**）。
- 超 24 小时用模板消息发（WhatsApp 规则，否则老客人联系不上）。

**第 1 段 · WhatsApp 并存接入（要花钱，需 PM 点头）**
- 经 360dialog 开户，CTS、NAL 各接一个号；webhook 验签和发送改走 360dialog（**A 级**）。
- 当场试跑：私人手机给号发一条 → 抽屉里出现 → 员工在手机回 → 系统记成我方发出、署名对。

**第 2 段 · Meta 站内私信：Messenger（已有）+ Instagram 私信（新接）**
- Instagram 私信走同一套 Meta 接口，复用 Messenger 的页面令牌与同步逻辑。

**第 3 段 · 短信 + 电话外呼 + 录音（要花钱，需 PM 点头）**
- 抽屉里「点一下拨号」：供应商先呼员工手机、再接通客人，通话自动录音 → 转文字 → 落客户时间线。
- 短信收发同一家供应商、同一个号。录音开头播一句提示（合规，NZ/AU 各自规定待核）。

**第 4 段 · AI 分析打标签（WP-C，等前面跑稳）**
- 聊天 + 通话文字 → 复用既有 `segmentContact` / note-parser 打标签分类，不另造一套。

**不在本方案里**：WhatsApp 官方群（并存号用不了，另开纯系统号时再议，见 `2026-09-28-whatsapp-groups-crm-design-v1.md`）；网站在线聊天插件（如 PM 说的「站内」指这个，另议）。

## 四、需要 PM 拍板（花钱 / 不可逆）

1. 360dialog 每月 €250（恢复 9-26 暂停的那笔）。
2. 电信供应商（短信 + 外呼 + 录音）按量计费 + 每号月租，开号前报具体价格。
3. 第 0 段里的两处 A 级改动，合并前在对话里问。

## 复审意见

### 子牙（架构）

**结论：方向对，但分段要调整；必改 7 条，建议 4 条。** 风险级：整体是 A 级（碰凭据、验签、库结构、对外发送）；第 2 段 IG 私信的代码本身是 B 级，但加 Meta 权限那一步是 A 级。
基线：`docs/crm-omnichannel-plan` @ `a3074b23`，本地快照，没刷新远端；约束只核了迁移文件，没查生产库。

#### 一、事实抽查（7 条）

| # | 方案说法 | 核实到的代码 | 判定 |
|---|---|---|---|
| 1 | `channels.ts` 注册表生产代码零调用 | `registerChannel`/`sendOnChannel` 只在 `src/lib/messaging/__tests__/channels.test.ts` 被调用 | ✅ 属实。**但漏了第二套**：`src/lib/messenger-agent/channel-dispatch.ts` 已经在生产用（`CHANNEL_SEND` 查表，被 `conversation-inbound-draft` / `conversation-inbound-autoack` 两个 Inngest 函数调用），文件头 :18-29 写明刻意不接 `channels.ts` |
| 2 | `route.ts:361/384` 把所有 `from` 当客人 | :361 `const waId = msg.from`，:384 `direction: 'inbound'` 写死 | ⚠️ 行号对，**后果写错了**。POST 只读 `value.messages`（:525），`smb_message_echoes` 推的是另一个字段（据 Meta 文档是 `value.message_echoes`，开发前拿官方样例核实）。现有代码会在 :528 `messages.length === 0 → continue` 把它**整条丢掉**，而不是记成客人说的。真实后果：员工在手机上回的话系统完全看不见，照样报「没人跟进」。修法不变，验收要改成「echo 不丢 + 方向对」两条，也要防止有人顺手把 echo 塞进 `storeMessage`，真造出方案里说的那种错记 |
| 3 | `conversations.channel` 不允许 sms/instagram/phone | 约束在 `supabase/migrations/20260726000004_unified_contacts.sql:118`，取值 `('messenger','email','voice','whatsapp')`，之后没有迁移改过 | ✅ 属实 |
| 4 | `send.ts:213` 用全局凭据 | :213-214 读环境变量 `WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`；:238 要求「客户绑的号 == 环境变量里的号」才发 | ✅ 属实：全系统同一时间只有一个客户能发 |
| 5 | 渠道取值「三处」对不上 | 实际是**四处**：还要加上 `src/lib/conversations/events.ts:35` 的 `ConversationChannelSchema`（Inngest 事件校验用，`messenger/whatsapp/email/voice`）；触点表约束在 `20260726000005_contact_touchpoints.sql:26-27` | ⚠️ 少算一处。而且 `conversations` 叫 `voice`、触点表叫 `phone`，同一个东西有两个名字 |
| 6 | Twilio「变量在、无代码用」 | `src/lib/voice/config.ts:36-37,89` 读这两个变量来决定语音走真线路还是假线路；`docs/ENV.md:179` 标「🔴 在用，别清理」 | ⚠️ 「没有发短信/外呼的代码」属实，「没代码用」不对。**方案漏掉了整个现成的语音模块**（见必改 4） |
| 7 | Instagram 私信是零 | 渠道取值里没有 instagram，也没有相关代码 | ✅ |

#### 二、必改

**必改 1（最关键）· 第 0 段必须先把进来的 WhatsApp 消息分成「客人新消息 / 员工手机回复 / 历史同步」三类，再决定怎么落库。**
并存开通后 Meta 会推三样东西：客人新消息（`messages`）、员工手机回复（`message_echoes`）、最近 6 个月的历史（`history`）。现在 `storeMessage` 对每条消息都会做三件事：发 `conversation/message.received` 事件（:479，触发 F1 自动安抚和 F2 AI 起草）、跑退订关键词判断（:413）、把「客人最后说话时间」往后推。员工回复和历史如果也走这条路，会出三种事故：AI 对半年前的聊天自动回一句；员工刚用手机回完、AI 又补一句（客人收到两次回复）；员工自己打的「stop」被当成客人退订。要求：
- 抽一个和供应商无关的 `ingestWhatsAppChange(clientId, change)`，按字段分 `messages` / `smb_message_echoes` / `history` / `statuses` 四路处理；
- 只有**实时的客人消息**才发 received 事件、跑退订判断、推进客人触点。员工回复记为「我方已回」触点；历史只落库，不发事件，也不能让它出现在今日待办；
- 并存号默认把 `messenger_agent_enabled_whatsapp` 设为 false。F1 自动安抚发出前，先查最近 N 分钟有没有员工回复记录；
- 测试：三类消息各准备一条测试样例，断言「历史消息不产生任何 Inngest 事件」。

**必改 2 · 「署名到人」做不到，验收要改。** Meta 推来的员工回复里没有「是哪个员工按的发送」，手机 App 是大家共用一个号码。只能署名为「经手机 App 发出（号码 X）」。第 1 段试跑验收里的「署名对」改成「标记为经手机 App 发出，号码对」。在 ME 里发出的消息照旧记 `sent_by_email`。

**必改 3 · 两套渠道分发要收成一套，别让 `channels.ts` 变成第三套。** 现在生产上是 `channel-dispatch.ts`（AI 自动发）加三个回复路由直接调 `sendReply` / `sendWhatsApp` / `sendMailReply`（人工发）。方案说「都走 `channels.ts`」，如果只改人工这一半，就会两套分发并存，以后每接一个渠道都要改两处。定为：`channels.ts` 是唯一的注册表，`channel-dispatch.ts` 的 `CHANNEL_SEND` / `CHANNEL_WINDOW` 改成从注册表取；开关和消息 id 归一化留在 messenger-agent 那一层。`channels.ts` 自己也要改三处才撑得住：
- a. `SendInput` 只收 `contactId`，但三个真实发送函数都按 `conversationId` 发，审计表 `conversation_outbound_log` 也按会话记。改成 `{ conversationId } | { contactId, toAddress }`。后一种给「第一次主动发短信 / 模板」用，没有会话时由适配器建会话；
- b. `sendOnChannel` 遇到 `template` 窗口照样发纯文本（:113 只拦 `closed`，`channels.test.ts:72` 还把这当成正确行为）。要加消息体的联合类型 `{ kind: 'text' } | { kind: 'template', templateRef, params }`，处于 template 窗口时只接受模板；
- c. `connectedChannels()` 是全局的，不看是哪个客户。页面要「按客人有哪些渠道给选项」，就必须改成按客户判断（`isConnected(clientId)`，再加上客人在该渠道有没有地址）。

**必改 4 · 电话不进 send 接口，也不进 `conversations`，复用现成的语音模块。** 电话是实时通话：没有消息正文，没有 24 小时窗口，结果靠供应商事后回调（接通 / 未接 / 时长 / 录音）。硬塞进 `send()` 会让「已拨出」看起来像「已送达」，是假成功。做法：
- 在 `channels.ts` 旁边另开一个窄接口 `CallAdapter.placeCall({ clientId, contactId, staffPhone }) → { callId }`，结果走供应商回调；
- 通话记录落 `voice_calls`（已有 `recording_url`，转写有 `voice_call_transcript_segments` 表）。外呼必须过 `src/lib/voice/outbound-gate.ts`（安静时段、频次上限都有了，勿扰名单 `voice_outbound_suppression` 也有）。写 CRM 走 `src/lib/voice/crm-bridge.ts`（已经写 `contact_touchpoints`，`channel='phone'`）。号码路由用 `voice_phone_routes`（已有供应商、号码、方向三列）；
- 所以 `conversations` **不加 phone**：已经有 `voice` 且没人写，别再加一个同义词。短信是消息，走 send 接口没问题；
- 抽屉里「点一下拨号」和 AI 外呼共用同一道闸，不能新开一条绕过 `outbound-gate` 的路。

**必改 5 · 凭据改造挪到第 1 段，第 0 段只改「发送号按客户取」。** 走 Meta 直连时，一把系统用户授权就能用 ME 名下所有号发消息，**多客户本来就不需要按客户存凭据**。真正卡住多客户的是 `send.ts:238`，它要求「客户的号 == 环境变量里的那一个号」。第 0 段把它改成「用客户自己绑的号发」就够了（仍是 A 级，但改动小）。按号存密钥只有 360dialog 才需要（它每个号一把密钥），存成什么样取决于第 1 段选哪家供应商，提前做等于猜。

**必改 6 · 凭据和号码不塞进 `platform_oauth_connections`，新建一张窄表，复用现有的加密和数据库权限模板。** 理由：
- ① 这张表的唯一键是 `(client_id, provider, account_id)`，但收消息时要按号码找客户，需要「一个号全局只属于一个客户」，得另加全局唯一；
- ② `refresh_token_enc` 和 `token_expiry` 都不许为空，而 API 密钥两样都没有。要么放宽限制（有 40 处代码读这张表，13 个文件碰这两列），要么塞假值；
- ③ Messenger 和 IG 继续用它（`provider='meta'`），不动。

新表建议：`messaging_channel_accounts(client_id, channel, provider, external_id /* phone_number_id · IG id · E.164 号码 */, display_name, credential_enc NULL, agent_enabled, status, unique(provider, external_id))`。`credential_enc` 用现成的 `src/lib/cms/crypto.ts` 里的 `encryptToken`（`platform_oauth_connections` 也用这一把钥匙）；数据库权限必须写 `FOR ALL TO service_role USING (true)`。`clients.whatsapp_phone_number_id` 迁进新表后，先保留一个版本当只读兜底，再退役。如果同一个 Twilio 号同时做短信、外呼和 AI 接听，号码归属只能有一个来源：要么给 `voice_phone_routes` 加一列指向新表，要么新表只登记短信和 WhatsApp、电话号码仍归 `voice_phone_routes`。二选一，写进第 3 段设计，禁止两处各存一份号码。

**必改 7 · 模板消息和员工回复都要有真号码才能当场试跑，第 0 段不能说「做完了」。** 模板要在已接号的 WhatsApp 账户下提交审核并通过；员工回复只有并存模式下 Meta 才会推。第 0 段可以写代码、用测试样例测，但按 PM 9-26「当场试跑」的规定，这两项验收挂到第 1 段。第 0 段 PR 里要写明「未试跑，原因：没有号码」，并开台账卡。

#### 三、分段顺序（回答问题 1）

「地基先于花钱」这个大顺序是对的：不花钱；而且不先把进来的消息分好类就开并存号，数据会立刻被污染。顺序反了的只有两处：凭据改造（依赖第 1 段选哪家供应商）、模板和员工回复的验收（依赖真号码）。调整后：
- **0a（不花钱，含 A 级）**：渠道取值对齐迁移（A）+ 统一注册表（必改 3）+ 进来的消息分类处理（必改 1）+ 发送号按客户取（必改 5）；
- **0b（B 级，界面）**：抽屉里合成一个回复框。它依赖 0a 里「按客户判断连了哪些渠道」，所以排在 0a 之后；
- **1（花钱，A 级）**：360dialog 收消息入口（只管验签，再转交给 0a 的分类处理）+ 渠道账号表（必改 6）+ 模板 + 当场试跑员工回复、历史同步和模板；
- **2（IG 私信）**：可以和第 1 段并行。⚠️ 需要给 Meta 应用加 `instagram_manage_messages` 权限并过 App Review，加完客户要重新授权。记忆里有事故「改授权范围会静默断掉现有连接」，必须先确认新权限是追加授权、不会顶掉现有的 Messenger 和广告连接，这一步算 A 级。另外应用现在的审核状态受限（9-28 台账：`pages_messaging` 还在审，商业验证没过），IG 很可能卡在这里，排期前先查；
- **3（花钱）**：短信可以先单独上线（它就是 send 接口下的一个适配器）。外呼和录音后上（复用语音模块），主要工作量在「先呼员工、再接通客人」和合规提示音；
- **4**：见下面平台化第 3 条。

#### 四、渠道取值迁移的最小改法（回答问题 4）

一个 A 级迁移，只放宽、不收紧：

```sql
-- 先在生产读出真实约束名，别猜：
-- select conrelid::regclass, conname, pg_get_constraintdef(oid) from pg_constraint
--  where conrelid in ('conversations'::regclass, 'contact_touchpoints'::regclass) and contype = 'c';
ALTER TABLE conversations DROP CONSTRAINT <读到的名字>;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('messenger','email','voice','whatsapp','sms','instagram'));
ALTER TABLE contact_touchpoints DROP CONSTRAINT <读到的名字>;
ALTER TABLE contact_touchpoints ADD CONSTRAINT contact_touchpoints_channel_check
  CHECK (channel IN ('meta_lead_form','phone','email','messenger','web_form','whatsapp','sms','instagram'));
```

- `conversations` 不加 phone（见必改 4）；
- 代码：`channels.ts` 的 `CHANNELS` 作为会话渠道的唯一来源；`events.ts:35` 改成 `z.enum(CHANNELS)`；`channel-dispatch.ts` 的 `MessengerAgentChannel` 改成 `CHANNELS` 的子集类型。触点渠道单独定义一个 `TOUCHPOINT_CHANNELS`，它的范围更大（含表单和电话），不要和会话渠道合并；
- 加一个测试，把迁移里的取值列表和代码常量逐项比对，防止下次又是四处各写各的；
- 在本机数据库沙盘里重放一遍迁移。

#### 五、平台化：换客户时会写死的地方（回答问题 5）

1. **每接一个渠道，就要给 `clients` 表加一列自动回复开关**（`messenger_agent_enabled_messenger/whatsapp/email`）。再加 sms 和 instagram 又是两次改表。挪到 `messaging_channel_accounts.agent_enabled`。
2. **一个客户只能有一个 WhatsApp 号**（`clients.whatsapp_phone_number_id` 是单列，还有唯一约束）。NAL 分销售号和客服号、地产客户按楼盘分号都会撞上。新表天然支持多号，但还要记「这条对话属于哪个号」：`conversations` 加 `channel_account_id`，回复时从原来那个号发出，不能用客户的默认号。
3. **第 4 段打算复用的 `segmentContact`**（`src/lib/crm/segments.ts:31`）引用了 `resolveTravelDate`，旅游的出行日期逻辑写在共享 CRM 里。NAL 物流看询价和货期，地产看看房和预算，套上去会被按「出行日期」分组。第 4 段开工前先把行业字段抽到行业配置（Industry Profile）里，做不到就别复用。
4. **模板名、录音提示语、外呼安静时段**：模板属于客户配置（CTS 是行程提醒，NAL 是报价跟进），存在客户配置里、按引用取，代码里不写模板名。录音提示语和外呼时段按国家做成规则（NZ、AU 各一份），`voice_tenants` 已有时区和语言字段可以接上，别在代码里写 `if NZ`。
5. 第 1 段写的「CTS、NAL 各接一个号」：号码和客户的绑定走设置页录入（铁律 8：FDE 要填的字段必须连设置页一起做），不要写进迁移或初始数据。

#### 六、建议（不阻塞）

- 360dialog 的回调带不带签名，开发前先核实。不带就给每个号一个独立、不可猜的回调地址，再加来源校验，不要沿用 `META_APP_SECRET`。
- 送达状态回调顺便处理发送失败（比如对方号码不在 WhatsApp 上），把它变成「换个渠道联系」的人工待办，符合铁律 3 下半。
- 找不到归属客户的号码，消息现在只进日志（`route.ts:544` TODO #1331）。并存开通后这条路会更常走到，第 1 段顺手接进人工待办。
- NZ/AU 发短信要处理退订关键词（STOP），复用 `lib/messenger-agent/optout.ts` 的跨渠道写入，不另写一套。

**复用清单**：该复用但方案没写到的是 `channel-dispatch.ts`、语音模块（`outbound-gate` / `crm-bridge` / `voice_calls` / `voice_phone_routes`）、`cms/crypto` 加密、`optout.ts`。真正新增的平台共享层只有三样：消息分类处理入口、渠道账号表、`CallAdapter` 窄接口。

### 魏征（挑刺）

> 2026-09-29 · 只读复审，基于本工作区当前代码（分支 `docs/crm-omnichannel-plan`，HEAD `a3074b23`，未刷新远端）。没跑任何命令去碰生产库或外部服务；标「待核」的外部事实是我没有当场查到原文的。
> **结论：方案方向对，但第 0 段不能按现在写的开工。** 有 3 条会在切并存当天直接伤客人的坑没写进去（下面 🔴1–🔴3），还有 5 处 A 级漏标。

#### 🔴1 切并存当天：历史同步 + 员工手机回复会把现有自动化全部点着（方案只写了「员工回复被记成客人」这一条）

先纠正一个事实：现在的 webhook 其实**根本收不到**员工回复和历史消息——它只读 `value.messages`（`route.ts:525–528`），而并存的员工回复在 `message_echoes`、历史在 `history`、手机通讯录在 `smb_app_state_sync`，全都会走到 `continue` 然后回 200。所以不改代码就切并存，当天的真实后果是：

1. **6 个月历史一次性丢光且拿不回来。** 历史同步是开户时推一次的，我们回了 200，Meta 就不会再发。→ 处理历史的代码必须**先上线、先订阅 `history` / `smb_message_echoes` 两个字段，再开户**，顺序写进第 1 段。
2. **员工在手机上回过的客人，系统里全显示「客人最后说话、没人理」。** 待回复名单、「今天该联系谁」（`day-list.ts:354` 看的是「我们最后一次出手之后客人又说话」）全部失真。
3. **正在手机上聊天的客人，每说一句都会收到一条「我们的顾问稍后回复您」。** F1 自动安抚（`conversation-inbound-autoack.ts:233`）只按 30 秒合并，不看「员工刚在手机上回过」。客人跟 PM 正聊着，系统每隔一会儿插一句套话。（前提：该客户 `messenger_agent_enabled_whatsapp` 开着——`channel-dispatch.ts:71`。）
4. **AI 草稿审批 4 小时后才发出去，员工早在手机上答过了。** F2 发送前只复查退订 / 开关 / 窗口（`conversation-inbound-draft.ts:592–642`），不查「触发消息之后有没有我方回复」。并存后必须加这一道：触发消息之后出现过任何我方消息（含手机回的），草稿作废。

等补上「处理回声和历史」之后，**照现有写法直接接进 `storeMessage` 会再坏一批**：

5. **历史消息每条都发一次「客人来消息了」事件**（`route.ts:479`），F2 会对每个老会话调一次 Claude 起草——F2 是先起草、到发送那步才看 24 小时窗口（`draft.ts:460` 在 `:618` 之前）。几百个半年前的会话 = 几百次白花的 AI 调用 + 审批队列里堆满半年前的草稿。→ 历史消息**绝不能发这个事件**。
6. **联系人的「最近出现时间」会被往回改。** `resolveContact` 无条件写 `last_seen_at: seenAt`（`identity.ts:253`），历史消息带的是半年前的时间 → 昨天刚留过资的老客人，最近出现时间被改成 5 个月前。会话的 `last_message_at` 也一样（`route.ts:277` 自己注释里承认的已知问题，历史同步会把它从偶发变成批量）。
7. **几百个老号码批量建成联系人。** CTS 那个号在 PM 个人手机上（记忆 `project-crm-whatsapp-path-360dialog-2026-09-26`），半年聊天里有供应商、导游、家人、别的客户——全会进 CTS 的客户名单，进待联系名单。`smb_app_state_sync` 还会把手机通讯录推过来，接了就是整本通讯录进 CRM。
8. **半年前一句「stop」会把人永久标成别再联系。** 退订判定对每条消息都跑（`route.ts:413`），历史里某个客人当时回过 STOP、后来又正常下单，同步一跑就被全渠道拉黑，没人知道为什么。员工回声如果也走这段，员工手打一句「stop」会把客人拉黑。

**建议（技术上我拍，不用问 PM）**：历史和回声各走一条独立处理，不复用 `storeMessage`——
- 历史：只写消息表、**不建联系人、不写触点、不判退订、不发事件、不动 `last_*` 时间**；先落一个「待认领」区，由人按会话挑哪些是真客人再挂人（跟 Messenger 现有 `messenger/unclaimed/claim` 同一个思路）。
- 回声：以 `to`（客人号）为会话键、方向记 outbound、写我方出站触点（这样待回复才会清掉）、不判退订、不发 inbound 事件。
- 时间字段一律「只往前走」（`.lt(...)` 条件，跟 `recordInboundTouch` 同写法）。
- 历史批量大，webhook 收到先落原始包、回 200，再交给 Inngest 慢慢拆；现在的「一条失败整包 503」（`route.ts:576`）会让整块历史反复重投。
- 并存号默认关 F1。

**方案里还有一句做不到：「员工回复记成我方发出、署名到人」。** 回声只知道「这个号发的」，不知道是手机前的哪个人；而且 360dialog 书面说过「伴随设备（WhatsApp 网页版 / 电脑版）发的可能推不到」。→ 署名只能写「手机 App 发出」；第 1 段的当场试跑要加一步「用 WhatsApp 网页版回一条，看系统收不收得到」，收不到就要在抽屉里明示「电脑版回复不会同步」，否则第 2、3 条的失真会长期存在。另外并存有「手机端要定期打开，否则连接断开」的要求（间隔待核原文），断了是静默的，要有断线监控。

#### 🔴2 发送侧：手动回复这条路一道「别再联系」的闸都没有，统一回复框会把它扩大到短信和电话

- 查过了：`isConversationOptedOut` 只有 F1/F2 两个自动发送在用。员工手点的三条回复路由（`whatsapp/.../reply/route.ts`、`messenger/.../reply/route.ts`、`email/.../reply/route.ts`）和底层发送（`whatsapp/send.ts`、`messenger/send.ts`、`microsoft/mail-send.ts`）**一行都没查 DNC**。统一出口 `channels.ts:98 sendOnChannel` 也没有。→ 今天就能给说过 STOP 的人手动发 WhatsApp。
- 方案第 0 段要让所有发送走 `channels.ts`：**DNC 闸必须焊在 `sendOnChannel` 里、调适配器之前**，用 `lib/crm/dnc.ts` 的 `isDoNotContact`，查不出来按拦（跟 optout.ts 同方向）。页面上的渠道按钮也要据此置灰，不是点了才报错。
- **电话已经有第二套「别打」判据，跟 CRM 不通。** `voice/outbound-gate.ts:58–68` 看的是 `voice_contacts.do_not_call` 和 `voice_outbound_suppression`，按 `tenant_id`，不读 `contacts` / 触点。第 3 段如果直接复用它：客人在 WhatsApp 说了 STOP，照样会被点拨号打过去。→ 外呼闸必须同时过 CRM 的 `isDoNotContact`，两套只能留一个真相源。
- **短信的 STOP 会写不进去。** `contact_touchpoints.channel` 的约束（`20260726000005_contact_touchpoints.sql:26`）没有 `sms` / `instagram`；退订写入函数的类型也只收 `messenger | whatsapp`（`optout.ts:239`）。短信客人回 STOP → 触点插入被库拒 → 退订没记上，还会继续发。→ 方案说的「渠道取值三处对不上」其实至少六处：`channels.ts:27`、`conversations.channel`、`contact_touchpoints.channel`、`conversations/events.ts:35` 的事件校验、`optout.ts:239`、`channel-dispatch.ts:71` 的开关列。要一个 PR 一起对齐，漏一处就是一条静默丢数据的路。
- 供应商侧的退订也要回写：短信供应商通常会自己拦截 STOP 之后的发送（Twilio 是 21610 错误），我们不记，抽屉里就一直给「发短信」按钮，员工点一次失败一次。
- 合规底线（待法务核）：新西兰《非邀约电子信息法》、澳洲《反垃圾信息法》都要求营销类短信 / 邮件带退订方式并按时处理；澳洲还有「谢绝来电登记册」，营销外呼前要核对。「按客人有哪些渠道就给哪些选项」不等于「这个渠道他同意过」——WhatsApp 超 24 小时发模板同样要求客人事先同意，否则被举报会拉低号码质量。

#### 🔴3 并存号就是客户的主号，系统乱发一次，赔上的是他们用了多年的电话号码

方案把 F1 套话、模板群发、AI 草稿都会走到这个号上。被客人举报多了，Meta 会限流乃至封号——封的是 CTS/NAL 日常接客的那个号，手机端一起停。→ 并存号要比纯系统号保守：默认关自动安抚；模板只允许人手动逐条发，不接任何定时任务 / 批量；抽屉显示号码质量评级，掉到黄灯自动停所有自动发送。

#### 4 同一条消息多渠道重复、错序：幂等键怎么定

- **幂等键**：进来的消息用渠道自己的消息 id（WhatsApp `wamid`、Messenger `mid`、邮件 `Internet-Message-ID`、短信供应商的消息 SID），唯一约束保持 `(conversation_id, message_id)`。我们自己发的，**点发送那一刻先生成一个请求 id 落库**，再调供应商，拿到供应商 id 后补上；状态回调 / 回声都按供应商 id 对回这一行。现在 `whatsapp/send.ts:305` 的写法是发成功之后才插消息、拿不到 id 就用 `me-${auditId}`，状态回调对不回去。
- **错序**：我方消息的时间用的是服务器当前时间（`whatsapp/send.ts:302`），客人和回声用的是 Meta 的秒级时间戳，同一分钟里的来回会排反。统一用供应商回执里的时间，排序加第二键（入库顺序）。
- **一个人两个渠道**：客人在 Messenger（只有 PSID）和 WhatsApp（电话）各来一次，身份合不上 = 两个联系人。后果不只是时间线分成两份：在 Messenger 说的 STOP 挡不住 WhatsApp，两个人各自进待回复名单。方案要写明「身份合不上时，抽屉提示可能是同一人，人工合并」，不能假设已合并。
- **员工手机和系统各回一次**：这是两条真消息，不该去重；该做的是抽屉实时显示「手机刚回过」，发送前提示「X 分钟前已有我方回复，确认还要发？」。

#### 5 电话录音合规（我查到的是方向，具体条款请法务 / PM 找人核）

- 告知：新西兰一方同意即可录，但隐私法要求说明收集目的；澳洲跨州规定不一，联邦层面默认要让双方知情。**按对方号码所在地最严的来**：接通客人那一刻先播提示，再开始录；客人说「别录」要能当场关。
- **信用卡号 / 护照号**：旅游客户电话订团时常念卡号。录下来 + 转文字 + 进 AI，等于把卡号写进我们的库和第三方模型，这是支付卡数据安全标准（PCI）的范围，ME 扛不起。→ 要么在「报卡号」时能一键暂停录音，要么转文字后先脱敏再入库、再进 AI；原始录音保留期要短。
- 存哪 / 谁能听：供应商默认把录音存在美国，且部分账户的录音链接不带鉴权就能直接打开（Twilio 有个「媒体链接强制鉴权」开关要手动打开，待核当前账户状态）。→ 录音转存到我们自己的私有存储、按客户隔离、只经服务端代理播放、每次播放留日志。现在回复类接口用的 `requirePaidClientAccess`（`client-access.ts:135`）连客户端只读账号都放行，录音不能沿用这个档。
- 保存多久：现有语音模块没有任何保留期 / 删除逻辑（`src/lib/voice/` 里查不到）。要定一个数（例如录音 90 天、文字稿脱敏后长期），到期自动删，并能响应客人「把我的录音给我 / 删掉」的请求。
- AI 分析：通话文字送第三方模型 = 个人信息出境（NZ 隐私法第 12 原则、澳洲隐私原则第 8 条）。第 4 段开工前要确认客户合同 / 隐私政策覆盖了这件事，否则只在本地规则打标签、不送外部模型。

#### 6 花钱失控

- **谁能按**：现在所有回复接口都是 `requirePaidClientAccess`，客户端只读账号也能发。短信 / 外呼要单独一档权限，并且在调供应商**之前**过三道硬闸：每客户每月上限（到了直接拒，不是报警）、每个操作人每天上限、每个客人每天次数（外呼已有 3 次 / 24 小时，`outbound-gate.ts:92`，短信没有）。
- **不许自动重试任何「发出去就收不回」的动作。** F1 的写法是供应商 502 就抛错让 Inngest 重跑（`autoack.ts:324`）；网络超时时供应商其实可能已经发出，重跑 = 客人收两条短信、接两个电话。短信 / 外呼一律：先落「待发」行 → 调一次 → 超时只去供应商那边**查状态**，不重发。
- **余额用光 / 账户被停这类账户级错误当场熄火**，整条发送链路停下并进今日待办，别逐条失败逐条重试（记忆 `feedback-provider-quota-error-amplified-by-sdk-retries` 那次就是这样拖死的）。方案要写明这一条，别等出事再补。
- **防盗打 / 短信轰炸**：供应商后台只开新西兰、澳洲（和确实要打的国家）；任何不登录就能触发发短信 / 回拨的入口（网页表单自动回短信、语音模块已有的 `voice_callback_requests` 回拨请求）都不许直接触发真实发送。
- **点一下拨号的两个费钱坑**：①先呼员工手机，员工没接、语音信箱接了，系统会把客人接进语音信箱，两条腿都计费还录了一段空录音——员工那条腿要「按 1 接通」确认。②按钮连点两次打两个电话——同一客人同一时刻只允许一通在途。
- **中文短信贵 3 倍左右**：中文按 70 字一段计费，CTS 的中文长消息一条可能拆成 4–5 段；发给中国号码单价也高得多。发送框要显示「这条约 N 段」。
- 回拨号码冲突：外呼显示的号如果和「AI 接听来电」是同一个号，客人回拨会被 AI 接走而不是找到刚才那个员工。方案要定：外呼号和 AI 接听号分开，或回拨先转最近通话的员工。

#### 7 A 级漏标（按 `ENGINEERING_QUALITY_GATES.md` 的判法）

方案只标了 3 处 A。下面这些也应是 A，合并前都要 PM 在对话里回「合」：
1. **统一回复框换发送出口**——替换三条已上线的对客发送路径，外发副作用 + DNC 闸落在这里。
2. **回声 / 历史处理**——批量写客户数据、会触发自动回复链，且历史只来一次、做错不可重来。
3. **超 24 小时模板消息**——每条都花钱、对客外发、影响主号质量。
4. **Instagram 私信**——要往 Meta 授权里加新权限。记忆 `feedback-changing-oauth-scope-silently-kills-live-connections`：加权限会让现有连接在下次刷新时静默断掉，CTS/NAL 的 Messenger 同步会一起停；可能还要过 Meta 应用审核。必须同时下发重连任务 + 断线监控。
5. **第 3 段整段**（短信、外呼、录音存储与播放权限）——钱 + 外发 + 个人信息存储 + 客户隔离。
6. `contact_touchpoints.channel` 约束也要改（方案只写了 `conversations.channel`），同属改库结构。
7. 第 4 段通话文字送外部 AI——个人信息出境，至少过一次隐私审，建议按 A。

另：360dialog 接过来后，webhook 不再带我们自己应用的签名（`route.ts:505` 会把它全部 401 掉），新的验真方式要先跟 360dialog 书面确认，不能退化成「URL 里带个密码」就算完。

#### 我要求改进方案再开工的最小清单

1. 第 0 段加：回声 / 历史分开处理（见 🔴1 建议）、F2 发送前查「之后有没有我方回复」、DNC 闸焊进 `sendOnChannel`、六处渠道取值一次对齐。
2. 第 1 段顺序写死：代码上线 → 订阅字段 → 用测试号走一遍（含网页版回复、含历史同步）→ 才给 CTS/NAL 开户。
3. 第 3 段开工前补一页「花钱闸 + 录音合规」小设计，过子牙 + 魏征 + 狄仁杰（录音存储是隔离核心）。
