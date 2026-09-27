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

## 还在跑 / 待定

- 魏征（挑刺）、板桥（客户视角）两审在跑，回来一并对账。
- PM 待回：① 买不买新号；② 生产库加那 4 个列（纯加列，已沙盘验证）。
- 未来：ME 自己的企业验证停在 `pending_submission`，共存模式和更高发送量都要它，建议提交。
