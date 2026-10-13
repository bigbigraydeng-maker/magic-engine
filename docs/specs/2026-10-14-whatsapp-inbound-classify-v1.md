---
title: WhatsApp 收信三分类 + 送达状态 + 无人认领号码待办 + 当场试跑方案 v1（93 号，A 级，设计稿，待两审）
status: draft-for-review
owner: session:12233466（93 号窗口）
decided_on: 2026-10-14
source: 18 号统筹转 PM 需求 a/b/c；上位设计稿 2026-10-10-whatsapp-business-connect-plan-v1.md §4.2 第 4 条、2026-09-29-crm-omnichannel-plan-v1.md 第 0a 段与「必改 1」
---

**层级判定（tier-gate）**：L3 Connector，挂在既有 Leads/CRM 下；不新增能力线，不登记候选。
**范围（刻意小）**：a 收信入口三分类 + 送达状态；b 号码没人认领时下发待办（还 #1331）；c 当场试跑方案。
**不做**：模板、连接页、群组接口、`smb_app_state_sync`（联系人同步）、媒体下载、历史正文落库（PM 10-10 红线：默认只存元数据）、任何自动发送开关、动 NAL 的绑定与 176 号。

## 0. 事实核对（读代码 + 官方文档 + 查库结构，逐条可核）

### 0.1 Meta 推送结构（56 号取自 Meta 官方文档，我另用第三方文档交叉核对）
| 类 | `changes[].field` | `value` 下的数据 | 客人号在哪 | 方向怎么判 |
|---|---|---|---|---|
| 客人新消息 | `messages` | `messages[]`（现有） | `messages[].from` | 客人发来 |
| 员工手机回声 | `smb_message_echoes`（字段名带 smb_） | `message_echoes[]`（数组名不带 smb_） | `to` | `from` = 我方号 = 我方发出 |
| 历史同步 | `history` | `history[]` → `{metadata:{phase,chunk_order,progress}, threads:[{id:客人号, messages:[{from,id,timestamp,type,history_context:{status}}]}]}` | `threads[].id` | `from` == 我方号 → 我方发出，否则客人发来 |
| 送达状态 | `messages`（同一个 field，但 value 里是 `statuses[]` 而非 `messages[]`，通常各自独立一个 value） | `statuses[]:{id,status:sent|delivered|read|failed,timestamp,recipient_id,errors?}` | `recipient_id` | — |
- 【待用真实样例核对】`history` 的外层包装：第三方文档里是 `{id,event,data}`（360dialog 包装），Meta 原生应是 `entry[].changes[]{field:'history', value:{…}}`。代码对**两种外层都容忍**（取 `value.history` 或 `data.history`），解析不出就计入「未识别」并写固定文案日志，不丢也不崩。
- 历史一次可能数千条；phase 0/1/2 = 接入当天~1 天 / 1~90 天 / 90~180 天；`chunk_order` 同 phase 内乱序到达；不含群聊；媒体先是 `type:"media_placeholder"`，后补另一条 history。
- 测试号只能触发 `messages` 与 `statuses`；回声和历史只发生在「经技术提供方 onboard 的手机 App 号」上（56 号、官方文档）。

### 0.2 现有代码（`src/app/api/webhooks/whatsapp/route.ts`，基线 50624b693）
- POST 只读 `value.messages`；`messages.length===0 → continue`（所以回声/历史/状态现在**整条被丢**，不会被误记成客人说的）。
- `storeMessage` 对每条消息：写会话（`upsertConversation` 强制 `last_message_from='customer'`、`last_message_at=sentAt`）、写 `conversation_messages(direction:'inbound')`、写客人触点、跑退订关键词、发 `conversation/message.received` 事件（触发自动安抚和 AI 起草）。**回声/历史绝不能走这条。**
- 号码无人认领：`resolveClientId` 返回 `unmapped` 只 `console.error`（#1331 欠账）。

### 0.3 库里真实结构（读迁移文件；上线前再用只读查询复核）
- `conversations`：唯一键 `(client_id, conversation_id)`；`last_message_from` CHECK ∈ {customer, page}；`channel` CHECK 含 whatsapp；**无触发器**。`conversation_messages`：唯一键 `(conversation_id, message_id)`；`direction` CHECK ∈ {inbound, outbound}；`sender_id/sender_name` 可空。
- `conversation_outbound_log`：`status` CHECK ∈ {pending, sent, failed}；`meta_message_id` 可空、**无索引无唯一**；本表只有「我们经 API 发出」的行（回声不进这张表）。
- 待办：新增一种待办要改 `manual-item-types.ts`（`ManualItemKind`）、`five-kinds.ts`（`LANE_OF_KIND` 穷举表）、新建 pusher 文件、`manual-items.ts` 的 `infraPushers()` 加一行；`pm-daily-todo` 已在 render.yaml 调度，**不用动调度**。

**线上只读复核（2026-10-14，查线上库 pg_constraint / pg_trigger / pg_indexes）**：上述三张表的约束与唯一键与迁移文件一致（`conversation_messages.direction` ∈ {inbound,outbound}、唯一 `(conversation_id,message_id)`；`conversations` 唯一 `(client_id,conversation_id)`、`last_message_from` ∈ {customer,page}、`channel` 含 whatsapp；`conversation_outbound_log.status` ∈ {pending,sent,failed}）；三张表都**没有触发器**；`conversation_outbound_log` 只有主键与 `(conversation_id,created_at)`、`(client_id,created_at)` 两个索引，**`meta_message_id` 无索引**。`whatsapp_app_credentials` 表已在线上（56 号登记时建）。

### 0.4 谁读 `last_message_from` / `direction`（评估「回声记成我方发出」的影响）
- 判「客人在等回复」的读取处（`email-reply-due`、messenger 会话列表与简报）**都带 `channel='email'/'messenger'` 过滤**，WhatsApp 会话不会被它们读到。
- 不分渠道、会受回声影响的读取处：`crm/stage-infer.ts:239`、`stage-from-conversation.ts:260`（「无下文」判定用最近一条我方发出）、`messenger/reply-metrics.ts`（首次回复时间）、`crm/facts/io.ts:155`、`knowledge/mining.ts:141`、AI 上下文（`messenger-agent/tools.ts`、`conversation-inbound-draft-store.ts`、`brief-cycle.ts`）。
- 判断：员工手机回的话**本来就是我方真实回复**，把它记成我方发出会让「无下文」「回复时间」更准，不是污染；唯一要防的是被当成「机器发的」——回声行的 `sender_name` 固定为 `WhatsApp 手机 App 员工`，`sender_id` 为我方号码，和 ME 发出的行（`sender_name`=员工邮箱）可区分。这一点写进 PR 的「已知影响」。

## 1. a：收信三分类（PR1，不含新表）

### 1.1 结构
新文件 `src/lib/whatsapp/inbound-classify.ts`（纯函数，无 IO，易测）：
```ts
export type InboundChange =
  | { kind: 'customer_messages'; phoneNumberId: string; displayNumber?: string; messages: WhatsAppInboundMessage[]; contactName?: string }
  | { kind: 'echoes'; phoneNumberId: string; echoes: WhatsAppEcho[] }
  | { kind: 'history'; phoneNumberId: string; displayNumber?: string; chunks: HistoryChunk[] }   // PR1 只识别、不落库
  | { kind: 'statuses'; phoneNumberId: string; statuses: WhatsAppStatus[] }
  | { kind: 'ignored'; field: string }                      // 如 smb_app_state_sync
  | { kind: 'malformed'; field: string }
export function classifyInboundChanges(payload: unknown): InboundChange[]
```
分类只看 `field` + value 里实际有的数组；任何一类的 `phone_number_id` 必须是纯数字字符串（沿用 §验签那套口径），否则 `malformed`（计入失败，POST 回 503 让 Meta 重投？——**不**：格式异常重投也不会变好，只写固定文案日志并计数，其余照常处理，回 200；理由同现有「Retrying will not help」）。

### 1.2 route.ts 改动（只改 POST 循环与新增处理函数，不动验签）
循环改为 `for change of classifyInboundChanges(payload)`，按 kind 分发：
- `customer_messages`：**原逻辑一行不改**（`resolveClientId` → `storeMessage`）。
- `echoes`：`resolveClientId` → `storeEcho`（见 1.3）。
- `statuses`：`resolveClientId` → `applyStatus`（见 1.4）。
- `history`：PR1 里只计数并写固定文案日志（与现状等价：现状是整条丢弃）；PR2 才落「待认领」。
- 无人认领（`unmapped`）：沿用现有日志，PR2 才下发待办。

### 1.3 员工手机回声 `storeEcho`（新函数，**不得复用 storeMessage**）
1. 客人号 = `echo.to`（须纯数字，否则跳过并计数）；`echo.id` 必填。
2. 会话：先 `select` 现有（`client_id, channel='whatsapp', conversation_id=客人号`）。没有 → `upsert(..., {onConflict:'client_id,conversation_id', ignoreDuplicates:true})` 建一条 `last_message_from:'page'`、`last_message_at=sentAt`，再 select id（并发安全）；建联系人沿用 `resolveContact`（`overwriteDisplayName:false`，不传昵称）。
3. 写 `conversation_messages`：`direction:'outbound'`，`sender_id=我方号码编号`，`sender_name='WhatsApp 手机 App 员工'`，`body=messageBody`，`sent_at`，`onConflict (conversation_id,message_id)`（幂等，和我们自己 API 发出的同 wamid 行互不冲突）。
4. 会话时间字段**只往前走**：`update ... set last_message_at=sentAt, last_message_from='page' where id=? and last_message_at < sentAt`（数据库端比较，抗乱序）。已存在会话**不**走 upsert，所以不会把 `last_message_from` 改回 customer，也不会改「客人最后说话时间」（那个时间来自 inbound 行）。
5. 有 `contactId` → 写 outbound 触点（与 `send.ts` 的 `markContactFollowedUp` 同一套 `${conversationId}:out` 幂等键，只往前推）= 「我方已回」。
6. **不做**：退订判断、`conversation/message.received` 事件、inbound 触点、任何自动回复。

### 1.4 送达状态 `applyStatus`
- 只处理 `status==='failed'`：`update conversation_outbound_log set status='failed', error_message=<code+title，不含号码> where client_id=? and meta_message_id=? and status='sent'`（只从 sent 往 failed 走；`client_id` 过滤防串台）。其余状态（sent/delivered/read）本轮不存（outbound_log 的 CHECK 只允许 pending/sent/failed，加 delivered/read 要改约束，不是这一轮的事）。
- 找不到对应行（例如不是我们 API 发的）→ 静默跳过，不报错。
- PR2 迁移里给 `meta_message_id` 加部分索引（现在无索引，状态回调量大时会全表扫）。

## 2. b：无人认领号码 + 历史「待认领」（PR2，A 级，含新表）

### 2.1 新表（迁移只写不应用，RLS 一律 `FOR ALL TO service_role USING (true) WITH CHECK (true)`）
`whatsapp_unclaimed_numbers`：`phone_number_id text PK`、`first_seen_at`、`last_seen_at`、`last_kind text`（customer_messages/echoes/history/statuses）、`resolved_at timestamptz null`。不存任何客人号码与正文。
`whatsapp_history_inbox`（待认领，**只存元数据，不存正文**）：`id uuid PK`、`client_id uuid FK clients`、`phone_number_id`、`customer_wa_id`（threads[].id）、`message_id`、`direction ('customer'|'business')`、`msg_type`、`sent_at`、`history_status`、`phase`、`chunk_order`、`received_at`；唯一键 `(client_id, message_id)`（幂等，重投不重复）。客人号是个人信息，只在这张表；日志里不打印。
同一迁移文件：`conversation_outbound_log(meta_message_id)` 部分索引。

### 2.2 历史落「待认领」
`history` 分类 → `resolveClientId` → 逐块逐线程逐消息写 `whatsapp_history_inbox`：分批（每批 500）upsert `ignoreDuplicates`；**不建人、不写会话/触点、不跑退订、不发事件、不改任何时间**。任一批失败 → 整个 POST 回 503（Meta 重投；幂等键保证不重复）。拒绝分享形态（`errors[]`，代码 2593109）→ 固定文案日志，不入表。方向：`from` 数字 == 我方 `display_phone_number` 数字 或 == 我方 phone_number_id → business，否则 customer。

### 2.3 号码无人认领 → 待办三件套
- `unmapped` 时 `upsert whatsapp_unclaimed_numbers`（`last_seen_at/last_kind` 更新、`resolved_at` 置空）；失败只记固定文案日志，不影响对 Meta 的应答。
- 新待办 kind `whatsapp_number_unclaimed`（车道 `one_click`：系统不知道该绑哪个客户，要人在设置页点一次；加入 `NEVER_DROP_KINDS`，链接坏了也不许静默丢）：what =「有一个 WhatsApp 号码（编号 …）在收客人消息，但 ME 里没有客户绑定它，这些消息没存下来」；how =「在对应客户的设置页「WhatsApp 号码」里绑定这个编号；绑好后下一条消息就会进来」；href = 客户列表页。pusher 读 `whatsapp_unclaimed_numbers where resolved_at is null`；绑定成功（`clients.whatsapp_phone_number_id` 命中）后下一次 pusher 运行自动把对应行 `resolved_at` 置为现在（不另建后台）。接在 `infraPushers()`。
- 历史待认领条数先不进待办（本轮不做认领流程）；只在 PR 里写明「待认领」的消费方是下一轮。

## 3. c：当场试跑方案（设计阶段先定好；不拿未来时间当验收）
1. **解析与落库（本机，真跑）**：把 Meta 官方样例（回声、历史、状态、客人消息、`smb_app_state_sync`）做成 fixture，用真实的 `classifyInboundChanges` 与真实的 POST 处理函数跑；数据库用「按表建模的假库」（遵循记忆：假库按表建模不按调用次序），断言最终各表状态：回声→会话 `last_message_from='page'`、时间只往前、无 inbound 行、无事件、无退订触点；历史→只进 inbox、会话/触点/事件为零；状态 failed→发送记录翻 failed；未认领→登记一行。
2. **迁移（本机沙盘，真跑）**：`scripts/db-replay-and-verify.sh` 在本机 Postgres 重放全部迁移（含新两份）并跑安全不变量；再对新表跑几条 SQL 断言（RLS 只放 service_role、唯一键幂等、`meta_message_id` 索引存在）。该脚本会 `dropdb` 本机的 `me_ci_verify`，只动本机库。
3. **线上只读**：用真实库做只读查询复核 0.3 的结构假设（表/列/约束是否与迁移文件一致）。
4. **Meta 测试号（真推送，只覆盖 `messages` 与 `statuses`）**：需要 PM 先在 Meta 页面「认领测试号码」（56 号去请）。我只准备好：一个**临时测试客户**的登记步骤（在生产库建一个名字含「测试」的临时客户并用 `register-whatsapp-number` 登记测试号，**写生产库，PM 点头后才做**；做完停用并记回执）。回声与历史**无法用测试号真测**，台账开卡 `verify_by` 定在并存接入后，PR 里如实写「回声/历史仅样例验证」。
5. 不碰 176 号；不开任何自动发送；不给任何真实客人发消息。
PR 正文「## 当场试跑」逐项写：触发方式、时间、退出码、输出摘要、哪些没能真测及原因。

## 4. 范围与 PR 切分
- **PR1（A）**：`inbound-classify.ts`、`route.ts`（POST 循环 + `storeEcho` + `applyStatus`；history/unmapped 保持现状行为）、测试与官方样例 fixture。**无迁移。**
- **PR2（A，含迁移）**：两张新表 + 索引迁移（只写不应用）、history 落「待认领」、unmapped 登记、待办 kind 与 pusher、测试。依赖 PR1 的分类器。
- **PR3（B，可并入 PR2）**：试跑脚本（本机沙盘 + 假库驱动 + 测试号登记说明）。
- 上线顺序：PR1 可独立上线（行为对现有客户零变化：现状下回声/历史/状态本就被丢，PR1 只是把回声和 failed 状态接上）；PR2 先应用迁移（PM 点头）再上代码；订阅 `smb_message_echoes` / `history` 字段要**等** PR1/PR2 都上线后才由 56 号在 Meta 后台打开（历史只推一次）。

## 5. 风险与回滚
- 主要风险：①回声误走 `storeMessage` → 退订误判/AI 补发（用测试锁死：回声不产生 Inngest 事件、不写 inbound 触点、不改 customer 字段）；②历史大批量写入拖垮单次请求 → 分批 + 幂等 + 失败回 503；③新待办 kind 漏注册穷举表 → 类型检查与 `five-kinds` 守卫测试会拦。
- 回滚：整体可回退到上一版；两张新表是新增，空表时行为 = 现状。

## 6. Reuse Statement（草稿）
复用：现有 webhook 骨架（验签、`resolveClientId`、`upsertConversation` 的联系人解析、`storeMessage` 原样不动）、`conversation_messages`/`conversations`/`contact_touchpoints`、`send.ts` 的触点幂等键约定、今日待办 `infraPushers` 机制、`db-replay-and-verify.sh`。新增且平台共享：分类器、回声/状态处理、待认领表与未认领登记、待办 kind。行业专属：无。客户专属：只有表里的行（号码、客人号元数据），共享代码无任何客户名/ID。换客户测试：NAL 换成 CTS 或地产客户，共享代码不用改。落点与 tier-gate 决策（L3，挂 CRM）一致。
