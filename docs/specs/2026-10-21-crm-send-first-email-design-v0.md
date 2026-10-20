# CRM 里给客人发「第一封」邮件 — 设计稿 v0（2026-10-21）

窗口 76 起草。状态：**设计稿，待子牙 + 魏征审；未写代码。**
风险级：**A**（客户可见的外发、撤不回）。PR 保持草稿 + 风险级别：A + 二审（子牙 + 魏征，设计稿已审两轮）+ PM「合 N」。本稿 v0.2 吸收了两轮审查：6 个 BLOCK 全部处理，且**不需要数据库迁移**。
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

### 3.1 后端：`sendMailNew`（`src/lib/microsoft/mail-send-new.ts`，新文件）

入参：`{ clientId, contactId, subject, body, sentByEmail, requestId, expectedRecipient }`。**不加表、不加列、不做迁移**（魏征 B1 要求的唯一约束，改用现有 `conversations` 的唯一键 `(client_id, conversation_id)` 做原子「抢占」，见第 7 步）。顺序与 `sendMailReply` 一致：先会话 + 审计，再碰 Graph。**任何一步失败都不发**：

1. **校验**：主题/正文 trim 后非空，长度上限（主题 200、正文 10000）；主题剥掉 CR/LF 和控制字符；`requestId` 是 UUID（前端每个「写邮件」框生成一次，双击/重试用同一个）。
2. **开关**：`readEmailComposeConfig(leadsConfig: unknown)`（`src/lib/crm/` 纯函数，宽容读取，**读失败或不是 `true` 一律当关**）。
3. **人和收件人**：按 `contactId + clientId` 取联系人。**收件人 = `primary_email`**，没有则退到 `contact_identities` 里 kind=email 的**唯一**一个（多于一个且无主邮箱 → 拒发）。严格校验：单个邮箱、≤254 字符、不含逗号/分号/空白/尖括号；复用 `classifySender` 拒掉 noreply/自己域名/同事地址。**请求里带 `expectedRecipient`（抽屉上显示的那个地址），和服务端最终取的不一致 → 拒发**（合并联系人发生在页面渲染之后）。
4. **只发给「咨询过我们」的人（合规默认，魏征 B5；PM 可改）**：这个人名下至少有一条**入站咨询记录**（Facebook/网站表单、私信、WhatsApp、来信、来电打进来）才允许；**只在 Mailchimp 名单里、或只有旧表格导入记录的人 → 拒发**并提示「他没咨询过我们，系统不允许发第一封」。配置 `email_compose.allow_unsolicited=true` 才放开（默认没有，放开须 PM 一句话）。可选落款/退订句：`email_compose.footer`（客户配置，默认空；是否需要由 PM/客户按新西兰《未经请求的电子信息法》定，我不是律师，**未核实具体条款**）。
5. **别再联系闸（fail-closed，按联系人，魏征 B4 / 子牙 B3）**：把 `optout.ts` 里「按联系人判」的那段抽成共用函数（现有会话版改为调它，行为不变），新函数 `checkManualSendDncForContact` 放进 `manual-send-dnc-gate.ts`：`contacts.do_not_contact` 列 + 触点判词（含人工纠正）**+ 这个联系人名下任何会话 `optout_unlinked=true`**。查询失败一律拒发。号码不通 / 先放着 / 阶段已推进不拦。
6. **选邮箱并核对**：该客户 `status=active` 的 `microsoft_mail` 连接；恰好一个 → 用它；多个 → 读 `email_compose.send_mailbox`，没配或对不上 → 拒发；零个 → 拒发。发送前用 Graph `/me` 读一次令牌实际对应的地址，和连接的 `account_id` 不一致 → 拒发（别名/共享邮箱）。
7. **原子抢占 + 先写审计（魏征 B1）**：`INSERT conversations`（`channel='email'`，`page_id=邮箱`，`contact_id`，`subject`，**临时键 `mail-pending:<requestId>`**，**不写 `last_message_at`**——不推高同步水位线，魏征 N5）。**唯一键冲突 = 同一个 `requestId` 已被处理 → 读出上次结果返回，不再往下走**。同一联系人另设一把锁行 `mail-lock:<contactId>`（同样 INSERT 抢占，发完删除，超过 5 分钟的旧锁可被清掉）：抢不到 → 409「正在发送」。然后插 `conversation_outbound_log(status='pending', messaging_type='email', used_ai_draft=false, sent_by_email)`。**审计插不进去 → 释放锁并拒发**（此时还没有草稿）。
8. **配额（魏征 B3）**：按审计表数 `messaging_type='email'` 的行——每用户每小时 ≤30、每天 ≤100，每邮箱每天 ≤200（默认值，`email_compose` 可调）；超限 → 429，并在日志里打告警。（被盗账号也只能发这么多。）
9. **建草稿**（Graph `POST /me/messages`，`Prefer: IdType="ImmutableId"`，`toRecipients` 仅一个，`body.contentType=Text`）。拿到真实 `id` 和 `conversationId`，**立刻把草稿 id 写进审计行 `meta_message_id='draft:<id>'`**（以便崩溃后对账），会话临时键改成 `mail:<conversationId>`（与 `mail-ingest` 的 `threadKey` 同格式；键已被占用 → 删草稿并拒发）。
10. **发送**（`POST /me/messages/{id}/send`；建草稿和发送各自一次 `callWithRetry`）。**结果有三种**（魏征 B2）：
    - 202 → 成功；
    - Graph 明确拒绝（4xx/5xx 带响应）→ `failed` + 尽力删草稿；
    - **超时/网络错误（status 0，信可能已经发出）→ 不记 failed**：审计保持 `pending`（带草稿 id），响应给销售「发送状态不明，请稍等 1 分钟再看时间线，**先别重发**」。表的 `status` 约束只有三个值，不改约束，用「pending + 带 draft 前缀的 id + 超过 2 分钟」表示「结果不明」。
11. **对账（不明态的出口）**：同一联系人下一次发送前、以及每次打开该联系人的发送框时，先对账所有带 `draft:` 的 pending 行：Graph `GET /me/messages/{id}` → `isDraft=false` 说明已发出 → 回填 `sent`；仍是草稿 → 删草稿、回填 `failed`；查不到 → 保持 pending 并继续拒绝重发。**对账期间同一联系人一律拒发。**
12. **发出之后**（任何一步失败只记日志，**不能**判失败）：审计回填 sent 并把 `meta_message_id` 换成真实消息 id；写 `conversation_messages`；写 `contact_touchpoints`（`channel=email, direction=outbound, source=microsoft_mail, source_ref=消息 id, metadata.automated=false`）；释放锁。
13. **失败遗留的会话**：第 7–10 步失败会留下「只有出站、没有任何消息」的会话。**`/crm/contacts/[cid]/email` 路由改成只把「至少有一条入站消息」的会话当可回复线程**（否则抽屉会误显示回复框，而 `sendMailReply` 对这种会话会 409，销售再也重发不了）。同时 `ComposeEmail` 显式区分「确认没有可回复线程」和「读取失败」，读取失败时不渲染（网络抖动不能把有线程的人当成没往来）。

> **未核实、必须靠试跑回答**：Graph 对「新建草稿」返回的 `conversationId`，与发送后在已发送文件夹里被同步读到的 `conversationId` 是否一致；发送后消息 id 是否保持不变（仓库里没有佐证；`createReply` 继承父线程，不能类比）。若不一致，同步会为同一封信新建第二条线程，现有「方向 + 秒」指纹兜底也不可靠（发送时我们写 `new Date()`，和 Graph 的 `receivedDateTime` 通常差几秒）。**所以试跑里「真发 PM 自己邮箱 → 等同步 → 线程里只有这一封」是打开开关的硬条件，不是可选项**；不一致就加「发送成功后重读已发送邮件的 conversationId 再改会话键」。干跑（建草稿后删除）验不出这件事。

> **复用 vs 新增**：`callWithRetry`、`findConnectionForMailbox`、`writeTouchpoint`、`sendDraft` 从 `mail-send.ts` **只加 `export`、不改行为**；新增 `createNewDraft`、`deleteDraft`、`getMessageIsDraft`。`sendMailReply` 本身不动。

### 3.2 路由
`POST /api/clients/[id]/crm/contacts/[cid]/email/compose`，Body `{ subject, body, requestId }`。
`requirePaidClientAccess`；`sentByEmail` 取登录用户邮箱；开关 `leads_config.email_compose.enabled`（`readEmailComposeConfig`）默认 **false**
（关着返回 403「未开通」，打开由 PM 一句话）。

### 3.3 界面
`ComposeEmail` 是**新的独立组件**，放在 `EmailReply` 之后，**不改 `EmailReply`**：它读同一个 `/crm/contacts/[cid]/email` 接口，只有「没有可回复线程」时渲染（两者互斥，不会同时出现）；`PersonDrawer` 把这次读取的结果提升成 prop 给两者共用，免得各 fetch 一次。
内容：主题 + 正文 + 一行确认「将用 info@ctstours.co.nz 发给 xxx@yyy」+ 「发送」按钮（发送中置灰）；成功提示「✓ 邮件已发出」，**并让时间线和线程状态都重新加载**（否则抽屉仍显示撰写框）。
原来那个 `mailto:` 邮箱保留，旁边加「复制」按钮（点了有「已复制」反馈）。已被标别再联系的人：框不出现，显示原因。

## 4. 风险与护栏（A 级）

| 风险 | 护栏 |
|---|---|
| 发给错的人 | 收件人只能是这个人名下已有邮箱；确认文字写出完整地址；不开放手填 |
| 发给说过别联系的人 | 联系人级别别再联系闸，fail-closed，判据同一份 |
| 双击 / 重试发两封 | `requestId` 写进审计行去重 + 60 秒同人拒发 + 发送中按钮置灰；**尽力而为，不是数据库强保证**（见 §3.1 第 6 步） |
| 发了没记录 | 审计先于发送，插不进去不发；发出后的写库失败不影响「已发」结论 |
| 误群发 | 只有单人、人工点击；没有批量接口 |
| 误开 | 开关默认关，PM 一句话才开；上线前只在 hello@magicengine.cloud 这类 PM 自己的地址上试 |
| 被盗账号群发垃圾邮件 | 每用户/每邮箱/每小时/每天配额（§3.1 第 8 步）；开关谁能改：`leads_config` 的编辑权限**未核实**，实现前先查，paid_client 若能改则开关形同虚设 |
| 新西兰《未经请求的电子信息法》（澳洲适用 Spam Act 2003，稿未涉及） | 一对一的人工邮件，给的是客人自己通过表单/咨询留下的邮箱，属回应咨询。**待 PM 确认**：是否允许对「只在 Mailchimp 名单里、从没咨询过」的人发第一封？**默认只允许发给咨询过我们的人**（§3.1 第 4 步）；框里显示「最近 7 天已发给他几封」（不拦，仅提示）；「同一客人 7 天内不超过 2 封」目前只是规矩、代码里没找到执行点，是否覆盖人工一对一待 PM 定 |

## 5. 当场试跑（上线前，不许借试跑真发给客人）

1. **干跑**：脚本走完 1–7 步，**建草稿后立即删除、不发送**，打印：选中的邮箱、收件人、Graph 返回的 `id`/`conversationId`、会话键、将写入的审计行（不落库的模式）。
2. **真发一封给 PM 自己的地址**（`hello@magicengine.cloud`，PM 此前定的收信地址）——**需 PM 当面点头**；
   发完等下一次每小时同步（或手动触发同步），读回：线程里这封信**只出现一次**（证明 `message_id`/线程键对得上，没有重复行）。
3. 把输出贴进 PR 的「## 当场试跑」。

## 5.1 Inngest 与回执说明
这是**同步的、人点一次发一封**的动作，没有跨步骤异步接力，按 CLAUDE.md 例外不上 Inngest；PR 里写明。机器可读回执 = 审计表那一行（请求 id、客户 id、会话/联系人、状态、发送者、时间；`no_publish` 不适用——这是人工单次发送）。

## 6. 测试
- 纯逻辑：校验、选收件人（主邮箱 / 回退 / 多个拒发）、选邮箱（0/1/多个）、幂等、60 秒闸。
- Graph 全部注入替身：建草稿失败 / 审计失败（必须删草稿且不发）/ 发送失败（审计 failed）/ 发出后写库失败（仍返回成功）/ 401 重试一次。
- 别再联系（联系人列 / 触点判词 / `dnc_cleared` 纠正 / 别的会话 `optout_unlinked`）、跨客户联系人、开关关闭或读失败、`requestId` 重放、收件人含逗号分号换行、主题含换行。
- 失败遗留会话不让 `/email` 路由误判有线程（只有出站的会话不算）。
- 每个 guard 做突变测试；全仓 `tsc --noEmit`。

## 7. 待核实 / 开放项
- **签名**：Graph 建草稿不会自动附 Outlook 账户签名。要不要在正文末尾加一段固定落款（客户配置 `leads_config.email_compose.signature`）——先不做，PM 看过试发效果再定。
- **发件人名字**：显示名取该邮箱账户自己的（info@ 对应的显示名），未核实具体是什么。
- 多邮箱客户的 `send_mailbox` 配置入口：本稿只读配置，不做设置页。
- 邮件投递失败（退信）会作为一封入站「Undeliverable」被同步进来，已有 `isAutoReply` 识别；不在本稿处理。
