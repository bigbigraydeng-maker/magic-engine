# CRM 里给客人发「第一封」邮件 — 设计稿 v0（2026-10-21）

窗口 76 起草。状态：**设计稿，待子牙 + 魏征审；未写代码。**
风险级：**A**（客户可见的外发、撤不回）。PR 保持草稿 + 风险级别：A + 二审 + PM「合 N」。
PM 2026-10-21 原话：「我们其实已经给客户在 Outlook 里面做了应用，所以能读取到他的邮件信息……在这个页面里，我们是要具备能对外打电话、对外发邮件、对外发短信、对外回 WhatsApp 的种种功能，否则这个 CRM 就是一个摆设。」并回复「先邮件」。
所属闭环环节：**Act**（CRM 里的人工外联）；顺序：邮件 → WhatsApp 模板 → 短信（各自另立设计稿）。

## 1. 现状（只读核对，2026-10-21）

| 渠道 | 现在能做 | 缺口 |
|---|---|---|
| 电话 | `CallButton`（Twilio，NZ 境内） | 无 |
| 邮件 | `sendMailReply`：**只能回已有邮件往来的人**（Graph `createReply` + `send`，审计 `conversation_outbound_log`，DNC 闸，令牌按邮箱取） | **给没有邮件往来的人发第一封：没有** |
| 短信 | 没有任何发送代码 | 整块（另立稿） |
| WhatsApp | 24 小时内可回 | 超窗需模板，ME 一个模板都没接（另立稿） |

**为什么 PM 看到「点邮箱没反应」**：`PersonDrawer.tsx:339` 的邮箱是 `mailto:` 链接，靠电脑里设置好的邮件程序；
`EmailReply` 在这个人没有邮件线程时什么都不渲染（`email/route.ts:52` 返回 `conversationId: null`）。
所以只有电话/邮箱、没邮件往来的人（表单、广告表单、Mailchimp 来的）在 ME 里发不了邮件。

**授权已就绪（读生产库 `platform_oauth_connections`，CTS）**：`info@ctstours.co.nz` 状态 active，
范围含 `Mail.Read` `Mail.ReadWrite` `Mail.Send` `User.Read`；`bdm@ctstours.co.nz` 已 revoked。
所以「建新草稿」（需要 `Mail.ReadWrite`）和「发出」（`Mail.Send`）两个权限都有，不需要重新授权。

## 2. 范围（不过度开发）

**做**：在人物抽屉里，对「有邮箱、没有邮件线程、没被标别再联系」的人，出现「写邮件」框（主题 + 正文纯文本），
销售点发送后，用客户已连接的 Outlook 邮箱发出，落审计、落时间线、落触点。
**不做**：群发、附件、抄送/密送、HTML/富文本、模板库、AI 起草（后续）、签名（Outlook 账户自己的签名不会经 API 附上，见 §7）、
给任意手填地址发信（只能发给这个人名下已有的邮箱）。

## 3. 设计

### 3.1 后端：`sendMailNew`（`src/lib/microsoft/mail-send-new.ts`，新文件；`mail-send.ts` 不动）

入参：`{ clientId, contactId, subject, body, sentByEmail, requestId }`。顺序（**任何一步失败都不发**）：

1. **校验**：`subject`/`body` 非空（trim 后）、长度上限（主题 200、正文 10000）、`requestId` 是 UUID。
2. **人和收件人**：按 `contactId + clientId` 取联系人（跨客户取不到）。**收件人 = 联系人的 `primary_email`**，
   没有则退到 `contact_identities` 里 kind=email 的那一个（多于一个且无主邮箱 → 拒发，不猜）。不接受外部传入的地址。
3. **别再联系闸（fail-closed）**：复用 `lib/crm/dnc.ts` 的判据（联系人列 + 触点判词 + 人工纠正），
   查询失败一律拒发。（现有 `checkManualSendDnc` 按「会话」查，这里会话还不存在，所以按联系人查，判据仍是同一份。）
4. **选邮箱**：该客户 `status=active` 的 `microsoft_mail` 连接。**恰好一个** → 用它；多个 → 读
   `clients.leads_config.send_mailbox`，没配或对不上 → 拒发并提示「请先在设置里指定发信邮箱」（不猜）；零个 → 拒发。
5. **防重复**：同一联系人 60 秒内已有 `conversation_outbound_log(messaging_type='email', status in pending/sent)` → 409；
   `requestId` 已出现过 → 直接返回上次结果（双击/网络重试不会发两封）。
6. **建草稿**（Graph `POST /me/messages`，`Prefer: IdType="ImmutableId"`，`toRecipients` 仅一个，`body.contentType=Text`）：
   拿到真实 `id` 和 `conversationId`。**这一步只是草稿，不是发送。**
7. **挂会话 + 审计先于发送**：`upsert conversations`（`channel='email'`，`conversation_id=mail:<Graph conversationId>`，
   `page_id=邮箱地址`，`contact_id`，`subject`——与 `mail-ingest` 同一个键 `(client_id, conversation_id)`，
   下次每小时同步读到这封信会落进同一条线程、同一个 `message_id`，不会重复）；
   然后插 `conversation_outbound_log(status='pending', messaging_type='email', used_ai_draft=false, sent_by_email)`。
   **审计插不进去 → 删掉草稿并拒发**（与 `sendMailReply` 同一原则）。
8. **发送**（Graph `POST /me/messages/{id}/send`，401 时强刷令牌重试一次，复用 `callWithRetry` 的做法）。失败 → 审计回填 failed + 尽力删草稿。
9. **发出之后**（任何一步失败只记日志，**不能**把结果判失败，否则会让人重发）：审计回填 sent + `meta_message_id`、
   写 `conversation_messages`、更新会话 `last_message_*`、写 `contact_touchpoints`（`channel=email, direction=outbound, source=microsoft_mail, source_ref=消息 id`，`metadata.automated=false`）。

> 复用 vs 新增：`callWithRetry`、`findConnectionForMailbox`、`writeTouchpoint`、审计表、令牌管理都是现有私有函数——
> 实现时先把它们从 `mail-send.ts` 原样导出（只加 `export`，不改行为），不复制第二份。

### 3.2 路由
`POST /api/clients/[id]/crm/contacts/[cid]/email/compose`，Body `{ subject, body, requestId }`。
`requirePaidClientAccess`；`sentByEmail` 取登录用户邮箱；开关 `leads_config.email_compose.enabled` 默认 **false**
（关着返回 403「未开通」，打开由 PM 一句话）。

### 3.3 界面
`PersonDrawer` 里，`EmailReply` 没有线程时，改为渲染 `ComposeEmail`：主题 + 正文 + 一行确认文字
「将用 info@ctstours.co.nz 发给 xxx@yyy」+ 「发送」按钮；成功提示「✓ 邮件已发出」并刷新时间线。
原来那个 `mailto:` 邮箱保留，旁边加「复制」按钮（点了有「已复制」反馈，不再是点了没反应）。
已被标别再联系的人：框不出现，显示原因。

## 4. 风险与护栏（A 级）

| 风险 | 护栏 |
|---|---|
| 发给错的人 | 收件人只能是这个人名下已有邮箱；确认文字写出完整地址；不开放手填 |
| 发给说过别联系的人 | 联系人级别别再联系闸，fail-closed，判据同一份 |
| 双击 / 重试发两封 | `requestId` 幂等 + 60 秒同人拒发 |
| 发了没记录 | 审计先于发送，插不进去不发；发出后的写库失败不影响「已发」结论 |
| 误群发 | 只有单人、人工点击；没有批量接口 |
| 误开 | 开关默认关，PM 一句话才开；上线前只在 hello@magicengine.cloud 这类 PM 自己的地址上试 |
| 新西兰《未经请求的电子信息法》 | 一对一的人工邮件，给的是客人自己通过表单/咨询留下的邮箱，属回应咨询。**待 PM 确认**：是否允许对「只在 Mailchimp 名单里、从没咨询过」的人发第一封？默认实现**不区分**来源，只在框里显示这个人的来源（来源字段现有）供销售判断 |

## 5. 当场试跑（上线前，不许借试跑真发给客人）

1. **干跑**：脚本走完 1–7 步，**建草稿后立即删除、不发送**，打印：选中的邮箱、收件人、Graph 返回的 `id`/`conversationId`、会话键、将写入的审计行（不落库的模式）。
2. **真发一封给 PM 自己的地址**（`hello@magicengine.cloud`，PM 此前定的收信地址）——**需 PM 当面点头**；
   发完等下一次每小时同步（或手动触发同步），读回：线程里这封信**只出现一次**（证明 `message_id`/线程键对得上，没有重复行）。
3. 把输出贴进 PR 的「## 当场试跑」。

## 6. 测试
- 纯逻辑：校验、选收件人（主邮箱 / 回退 / 多个拒发）、选邮箱（0/1/多个）、幂等、60 秒闸。
- Graph 全部注入替身：建草稿失败 / 审计失败（必须删草稿且不发）/ 发送失败（审计 failed）/ 发出后写库失败（仍返回成功）/ 401 重试一次。
- 别再联系、跨客户联系人、开关关闭、`requestId` 重放。
- 每个 guard 做突变测试；全仓 `tsc --noEmit`。

## 7. 待核实 / 开放项
- **签名**：Graph 建草稿不会自动附 Outlook 账户签名。要不要在正文末尾加一段固定落款（客户配置 `leads_config.email_compose.signature`）——先不做，PM 看过试发效果再定。
- **发件人名字**：显示名取该邮箱账户自己的（info@ 对应的显示名），未核实具体是什么。
- 多邮箱客户的 `send_mailbox` 配置入口：本稿只读配置，不做设置页。
- 邮件投递失败（退信）会作为一封入站「Undeliverable」被同步进来，已有 `isAutoReply` 识别；不在本稿处理。
