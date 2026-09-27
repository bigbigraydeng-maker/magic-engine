---
id: 2026-09-28-cts-whatsapp-onboarding-design-review
title: CTS WhatsApp 接入——设计阶段架构复审查出 6 条必改；号码用全新号不动现役号；操作顺序必须先绑号再订阅
status: decided
owner: pm
decided_on: 2026-09-28
source: session:5b9407a2
verify_by: 2026-10-05
verify_how: ① 实现 PR 里逐条对账这 6 条（改了 / 没改 + 原因），不能只写「已复审」；② 生产 apply 迁移后回读 `select pg_get_indexdef('clients_whatsapp_phone_number_id_key'::regclass)`，确认带 `WHERE (whatsapp_phone_number_id IS NOT NULL)` —— `CREATE UNIQUE INDEX IF NOT EXISTS` 只按名字判存在、不比对定义；③ `select count(*) from conversations where channel='whatsapp'` 在 PM 自测发消息后应 ≥1
---

## 方案（PM 2026-09-28 拍板过程）

CTS Tours NZ（`c0000000-0000-0000-0000-000000000000`）接 WhatsApp。

**号码：买一个全新 NZ 号，不动现役号 `027 752 0888`。**

PM 先答「在用」并给了现役号，我按迁移方案给了步骤；PM 随后指出「客户有现成的手机，不能为了接我们这个功能冒这么大的风险」。查证后我**撤回**迁移方案：

- 号码接进 Cloud API 后，手机上的 WhatsApp Business App 就不能再用那个号，App 上的聊天记录消失；
- 撤回不干净：最近 30 天发过付费消息的号 Meta 不许删（要等满 30 天）；绑回 App 只能靠迁走前的备份还原；手机通讯录里的联系人不受影响（那些不在 WhatsApp 上）。
- Meta 的**共存模式**（同一号码同时在 App 和 API 上跑、消息双向镜像、同步最近 6 个月历史和联系人）正好解决这个顾虑，但**必须由 Meta 认证的 Solution Partner / Tech Provider 通过 Embedded Signup 接入，官方文档没有「后台手动开」的替代路子**。我们的应用现在 App Review 提交不了（有一份 pages_messaging 的提交在审中）、`business_verification_passes: false`，所以拿不到，要几周。
- → **现在用新号跑起来，以后拿到资格再用共存模式把现役号接进来。两件不冲突。**

CTS 这条线代价特别低：WhatsApp 对 CTS 是**全新渠道**（现在走 Meta 表单），不存在「老客人那条对话线被切断」。

## 现状事实（查生产库 / 真实接口得到，不是读注释）

| | |
|---|---|
| 代码 | 已写完有测试（webhook 573 行 + send + adapter + 设置面板） |
| **生产库** | **缺 4 个列** —— 迁移 `20260902000002_whatsapp_phone_number_id.sql` 在仓库里但从未 apply |
| 环境钥匙 | 5 个一个都没配 |
| Meta 应用 `1752513682785923` | 系统用户令牌、永不过期，但**没有任何 whatsapp 权限**；App Review 提交不了；企业验证未过 |
| 先例 | `pages_messaging` 同样「在审未批」却在生产正常工作 → Standard Access + 应用管理员的系统用户令牌这条路有生产先例 |
| CTS 现有数据 | 1024 客人 / 邮件 2378 / Messenger 1307 / 表单 774 / 通话 642；**WhatsApp 0 条** |
| 沙盘 | 本机重放全部 287 个迁移 + 4 条数据库安全不变量，全绿；4 个列和那条 partial unique index 都如期建出 |

## 子牙（架构）6 条必改 —— 实现 PR 必须逐条对账

1. **发件号改成从会话所属客户的行推导**，`WHATSAPP_PHONE_NUMBER_ID` 不再当发件身份。`send.ts:238` 那道 `ownedNumberId !== phoneNumberId` 删掉、保留 `!ownedNumberId` 那半；`:291`/`:307` 改用 `ownedNumberId`。**改完闸更强**：不再依赖运维把 env 和库配一致，而是靠 partial unique index + `send.ts:186` 的客户隔离闸。同 PR 连带改 `whatsapp-number/route.ts:79,143` 和 `WhatsAppNumberPanel.tsx:43-67`（否则第二个客户永远显示红灯故障）+ `send.test.ts:340,265-271`。
2. **号码没绑时客人消息只进 `console.error`**（`route.ts:536-544`，代码里自带 `TODO(#1331)` 承认违反铁律 3）。接号顺序必然是「Meta 先订阅 → 人再去绑」，这个窗口里每条消息静默丢弃。且 `health-heartbeat.ts:93-97` 按 `(client_id, channel)` 分组，unmapped 消息定义上没有 client_id，永远进不了告警。→ 需要一张不依赖 client_id 的小台账（照 `optout-failures.ts` 的样板）。
   **🔴 并发的操作纪律（不用等代码）：先在 ME 里填好号码，再让 Meta 订阅 / 再让广告指向它。**
3. **发件号这条客户事实被写成了部署级全局** —— 该落在 client configuration 层（`clients.whatsapp_phone_number_id` 就是），凭据留在 Connector 层 env（正确）。PR 要写明「哪天客户不肯把 WABA 共享给 ME，就走 `resolveMetaTokenForClient`」，否则下个人会在 `lib/whatsapp/` 里再造一套 Meta 凭据解析。另：客户能单方面撤掉 ME 的伙伴权限，而 `meta-token-health-items.ts:44` 探的是 `/me`，探不到单个 WABA 掉权限 —— 要一个对应的 check_type。
4. **迁移不会锁表拖垮线上**（三处 ADD COLUMN 无 DEFAULT 无 NOT NULL，PG 11+ 纯元数据；唯一索引虽无 CONCURRENTLY，但 `clients` 只十几行）。但要加 `SET lock_timeout = '3s'`（防长事务排队把热表堵死），且 **`CREATE UNIQUE INDEX IF NOT EXISTS` 只按索引名判存在、不比对定义** → apply 后必须回读 `pg_get_indexdef` 贴进 PR。
5. **Meta 的 `statuses` 回调被整段丢掉**（`route.ts:515-517`，测试还把跳过断言成了预期）。后果：`conversation_outbound_log.status='sent'` 长期显示成功，「Meta 接受了但客人没收到」（号码不在 WhatsApp 上 / 窗口算错 / 模板未批）没人知道，按 conversation 计费的账也对不上。出站回执现在只到「已提交」，没到「已投递」。
6. **入站 Inngest 已经接上了**（`route.ts:467-483` emit → 两个消费者均已注册，事件名用共享契约常量）。缺的是三处「存了但没人会看见」：建人失败 `route.ts:242-247`、落触点失败 `:390-395`、出站审计行收尾失败 `send.ts:279-289`（注释说「a reaper can find it」，但**仓库里没有任何 reaper**，这行永远停在 `pending`）。

**顺手（不阻塞）**：`route.ts:27` 和 `send.ts` 把迁移号写成 `...000001`（实际是 `...000002`）；`entry_referral` 列注释要写明「读前先判 `channel='whatsapp'`」；`send.ts:41` 的 Graph 版本 v20.0 与 `meta/graph-base.ts:9` 自称唯一真相源的 v21.0 不一致 —— 既有欠账，不在这个 PR 里顺手统一。

## 板桥（客户视角）——查出最要紧的一条：**顾问没法在 ME 里回 WhatsApp**

这不是界面问题，是整个方案的前提不成立。我逐条核实过：

| | 状态 | 依据 |
|---|---|---|
| 客人消息进 CRM | ✅ | webhook 完整 |
| 自动问候回一句（还能点名客人看的是哪条广告） | ✅ | `conversation-inbound-autoack.ts:143` 认 `whatsapp`；广告入口存在 `entry_referral` |
| **顾问自己回** | ❌ **没有接口也没有按钮** | `find src/app/api -path '*reply*'` 只有 `messenger/` 和 `email/` 两条；`drawer-actions.ts` 和 `segments.ts` **grep 不到 `whatsapp`** |
| 客人发的图片 | ❌ 只存编号，显示成一行 `[image message]` | `route.ts:156-158` 自己写着「下载是以后的 PR」 |
| 新消息实时提醒 | ❌ 只进第二天那封待办邮件 | |

`sendWhatsApp` 的生产调用方只有 `channel-dispatch.ts:59`（自动回复那条）和 `messaging/adapters/whatsapp.ts:73`（子牙查明该总线无生产调用方）。

**后果（板桥的判断，我认同）**：顾问回不了就会用自己手机回 → 那条线 ME 看不见 → 系统天天误报「这个客人没人跟进」→ 假警报一出现，「今天该联系谁」这一页就没人信了。客人那侧更糟：问一句 → 收到一句自动问候 → 然后没人理；旅游是大额消费，这比不上线还差。

**照抄 Messenger 的 ReplyBox 会当场出洋相**（板桥挑出，都在 `messenger/_components/ReplyBox.tsx`）：`:53-78` 的错误翻译没有 WhatsApp 分支，WhatsApp 失败会显示「**Facebook** 已经不让回这条了」；`:30` 的确认框写死「这条会以 CTS 的 **Facebook 主页**发出去」；`:98` 判「窗口关了」只认 `'closed'`，而 WhatsApp 的关闭值是 `'template_only'`（`send.ts:59`）→ 按钮不会置灰，顾问打完一整段才被拒。

**六句报错文案全是黑话**，板桥逐句改写了（例：`send.ts:208`「WhatsApp 免费回复窗口已关闭…只能发送已审核的模板消息」→「他超过 24 小时没说话了，WhatsApp 不让我们主动发。请打电话或发邮件找他。」）。另外 `send.ts:294` 的「Meta 拒绝了这条消息」**把供应商真名露给客户员工了**，违反 CLAUDE.md 的第三方封装名规矩。

**ME 现在是在主动教顾问别回 WhatsApp**：客人从 WhatsApp 进来时 ME 拿 `wa_id` 当电话号建联系人（`route.ts:236`），于是卡片直接给拨号按钮、抽屉给「打通了／没打通」两个按钮（`drawer-actions.ts:70-86`）—— 根子是那两份渠道清单里没有 `whatsapp`。

**上线第一天必备三件**：当场试跑给顾问看（私人手机发一条 → 落进「今天该联系谁」→ 在 ME 里回 → 手机收到）；一张带真实截图的一页纸；指定第一周随时能问的人，且上线前先把自动问候打开。

## 子牙第二轮追加（我把设计改成「新号」之后重审）

7. **共存模式一开就撞线程键。** `conversations` 唯一键是 `(client_id, conversation_id)`，而 WhatsApp 把 `conversation_id` 写成客人的 `wa_id` —— CTS 同时跑新号 + 现役号时，同一个客人发给两个号会并进同一行，回复可能从客人没联系过的那个号发出去。**现在花一行就能避掉**：webhook 手上已经有 `phoneNumberId`（`route.ts:513`）却丢了，写进本来就是「我们哪个端点收到的」那一列 `conversations.page_id` 即可 —— 不加列、不改唯一键、不改任何读取方。不写的话历史行以后补不回来。
8. **共存会把员工在手机 App 上发的消息镜像进 webhook**，而全仓没有「这个 `from` 是我们自己的号」的判断：`route.ts:350` 无条件取 `msg.from`、`:372` 硬编码 `direction:'inbound'`、`:267` 写 `last_message_from:'customer'` → 会给自家号码建一个 contact、记一条入站触点、并让 CRM 认为「客人最后说话、我们欠回复」。切共存前必补。
9. **共存的 6 个月回灌会被当成 6 个月的实时新消息**：每条历史消息都 emit 一次 `conversation/message.received`，而自动问候和 AI 起草两个消费者**都没有消息年龄判断**（>24h 现在是靠 `whatsappWindow` 返 `template_only` 意外挡住的，那是巧合不是设计）。落在最近 24h 的那批会真给客人发「我们的顾问会联系您」，而员工在手机上早就回过了。另：`last_message_at`（`route.ts:266`）无方向保护，回灌会把它写回旧时间，收件箱排序全乱。回灌不该走这个 handler（POST 里所有消息串行 await，大批量会撞超时 → 返 503 → Meta 整批重投）。

## 反驳子牙一条（核实后不成立）

子牙提醒「`src/lib/voice/config.ts:43` 也声明了 `WHATSAPP_PHONE_NUMBER_ID`，且 `:90-98` 生产缺值 fail fast，动这个 env 前先确认语音不受影响」。

**实测：这条不成立，而且牵连方向是反的。** `config.ts:43` 把它声明成 `.optional()`，`:90` 的就绪判断只看 `WHATSAPP_ACCESS_TOKEN && META_APP_SECRET`，**不看号码 ID**。所以第 1 条改发件号取值方式不影响语音。

真正牵连的是另外两把钥匙：配上 `WHATSAPP_ACCESS_TOKEN` + `META_APP_SECRET` 之后，语音那条线的 whatsapp provider 会从「模拟」翻成「真实」—— 但只在 `MOCK_EXTERNAL_SERVICES` 为假时才有差别，而若它今天为假，生产早就该抛错了（那两把钥匙现在一个都没配）。**结论：上线前确认 `MOCK_EXTERNAL_SERVICES` 的实际取值，在 PR 里写一句，不需要改代码。**

## 还在跑 / 待定

- 魏征（挑刺）、板桥（客户视角）两审在跑，回来一并对账。
- PM 待回：① 买不买新号；② 生产库加那 4 个列（纯加列，已沙盘验证）。
- 未来：ME 自己的企业验证停在 `pending_submission`，共存模式和更高发送量都要它，建议提交。
