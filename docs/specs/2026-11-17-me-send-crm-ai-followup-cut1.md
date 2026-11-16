# ME 自己发信 · 第一刀：发信底座接 76 号点名的「AI 跟进信」（不发信）

- 状态：设计稿 v0.2（2026-11-17，142 号窗口；子牙 + 魏征复审后定稿，§7 覆盖前文冲突处）
- 风险级：A（新增授权类型、改发信账本的数据库守卫与认领函数）。改数据库那部分按规矩留给 Ray 亲手合。
- 台账：`docs/ledger/2026-11-17-me-send-crm-ai-followup-via-resend.md`
- 底座设计：`docs/specs/2026-11-02-me-send-gate-p2-design-v0.md`（下称 P2）。本稿只写差异。

## 0. 一句话

现在的发信底座只认一种信：欢迎信，一位客人一辈子一封。第一刀让它再认一种信：**AI 跟进信**——一位客人可以收好几封**不同**的信（2027 目录、第 7 / 14 / 21 天跟进、3 个月后再跟一次），每封一辈子最多一次；**谁收哪封、什么时候收**由 76 号决定，底座只管「这封现在能不能安全发、发了记回执」。

第一刀结束时**一封真信都发不出去**：`checkArmed` 的 `formal_sending_not_enabled`（授权里没有试发名单就停）原样保留；Render 真发开关不动。

## 1. 不做（本刀）

正式名单发信、打开/点击回写（第三刀）、对账/退信待办/刹车线/退订同步 Mailchimp（第二刀）、76 号的排期与「僵尸」标签、改 76 现有的 info@ 发目录那条线、欢迎信本身的任何行为（除 §4.4 把「投诉/硬退信/ME 退订」从只看欢迎信改成看本客户全部 ME 信，这只会更严）。

## 2. 和 76 号的接口（L3 Connector 不变：Resend 仍在 `adapters/resend-email` 里）

76 号在它自己的每日任务里，到了该发的那天，对每位客人调一次：

```ts
sendNamedLetter({ clientId, contactId, letterKey, requestRef }): Promise<NamedLetterResult>
// letterKey: 授权规则里列出的信代号，如 'catalogue_2027' | 'followup_d7' | 'followup_d14' | 'followup_d21' | 'followup_m3'
// requestRef: 76 号自己的记录编号（≤120 字，不含个人信息），只进账本备注，便于对账
// NamedLetterResult = SendOneResult（outcome / reason / sendId / providerImpact / stopRun）
```

- 「什么时候」= 76 号调用的时刻。底座不另建排队表、不另起 Inngest 事件（Inngest 额度快满）。
- 不在发信时段（`outside_send_window`）、读库失败、锁被占 → 76 号下次再调；同一封信对同一位客人**底座保证一辈子最多认领一次**（数据库唯一键），76 号重复调用是安全的。
- 返回 `skipped`（别再联系、退订、投诉、硬退信、7 天已满 2 封等）是**这封信的最终结论**；76 号据此决定后续（例如不再排下一封）。
- 底座**不**判断 76 号的业务规则（订没订团、员工聊没聊上）——那是 76 号停线的事。

## 3. 数据库（新迁移，只加不删，旧数据 0 行受影响）

生产库 11-17 只读核对：`triggered_sends` 277 行全是影子行（真发行 0），授权 1 行、生效中 0 行。

1. 两张表的 `trigger_key` 检查加 `'crm_ai_followup'`。
2. `triggered_sends.dedupe_scope` 允许 `'letter:<代号>'`（`^letter:[a-z][a-z0-9_]{1,40}$`）；`scope_status` 约束改为「`shadow` 行只能是 shadow/blocked/skipped；其余（lifetime 与 letter:*）不能是 shadow」。
3. **两个守卫函数里所有 `dedupe_scope = 'lifetime'` 改成 `dedupe_scope <> 'shadow'`**——否则 letter 行可以绕过「真发行的 pending 只能由认领函数写入」，这是本刀最要紧的一条。
4. 新唯一索引：同一客户、同一 trigger、**同一封信**、同一收件地址只能有一行在途/已发（谓词照抄 lifetime 那条）。新日上限索引 `(client_id, trigger_key, local_day) where dedupe_scope like 'letter:%'`。
5. 新函数 `triggered_send_claim_letter(p_authorization_id, p_letter_key, …同 claim 的参数)`：逐行照抄 `triggered_send_claim`，差别只有：
   - 范围是 `'letter:' || p_letter_key`；
   - 模板核对改为：`p_template_key / version / sha256` 必须等于授权规则 `rule->send->letters` 里这封信登记的那一组（找不到这封信 = `letter_not_authorized`）；
   - 日上限数**这个 trigger 下所有信**当天的认领数（一位客人一天几封都算进总数）；
   - 只接受 `trigger_key = 'crm_ai_followup'` 的授权；原 `triggered_send_claim` 加一行：拒绝非 `welcome` 的授权（防串用）。
   - 加锁顺序不变（advisory → 账本行 → 授权行）。
6. 授权行的 `template_version / template_sha256`：多封信的授权填 `1` 和「信清单」的指纹（按代号排序的 `{letter_key, template_key, template_version, template_sha256}` 的 sha256）。清单本身写在 `rule.send.letters`，规则指纹已覆盖它；规则不可改，所以清单不可改。

## 4. 代码

### 4.1 规则（`rule.ts` / `send-rule.ts`）
- 规则加 `trigger: 'welcome' | 'crm_ai_followup'`？**不加**：trigger 已是授权行的列；规则解析按调用方传入的 trigger 选「关卡档案」。
- `send` 块：欢迎信仍是 `template: {key}`；AI 跟进信改为 `letters: [{letter_key, template_key, template_version, template_sha256}]`（1–8 封，代号唯一，模板都必须是 `auto-` 开头），二者互斥。
- AI 跟进信的 `audience` 不用（76 号点名）；写成 `sources: []` 时只对 `crm_ai_followup` 合法。

### 4.2 关卡档案（`shadow-gates.ts`）
同一套读取，按 trigger 选判哪几条：

| 关卡 | 欢迎信 | AI 跟进信 |
|---|---|---|
| 地址不对 / 系统地址 / 不在试发名单 | 判 | 判 |
| 别再联系 / ME 退订 / 投诉 / 硬退信 / Mailchimp 已退订 / 排除标签 | 判 | 判 |
| 「老批次已欢迎过」 | 判 | **不判** |
| 没有同意依据 | 判 | 判（依据清单由 PM 在授权里批） |
| 「员工已写过信」 | 判 | **不判**（员工写过信不挡跟进信；员工真聊上由 76 号停线处理） |
| 7 天最多 2 封（邮箱已发、审计行、客人记录、Mailchimp 群发） | 判，老欢迎批次不计 | 判，**老欢迎批次也计**（客人真收到了） |
| 线索太旧（stale） | 判 | **不判** |

### 4.3 发一封（`send-one.ts`）
`sendOne` 拆出共用骨架，欢迎信行为逐字不变（现有测试全过即证）。新入口 `sendNamedLetter` 走同一骨架，差别：
- 先核 `letterKey` 在授权的信清单里，取那一封的模板（`loadTemplate` 读到的当前版本必须和清单登记的版本 + 指纹一致，不一致 = 授权自撤 `TEMPLATE_CHANGED`）；
- 认领用 `triggered_send_claim_letter`；账本按 `(contact, letter:<代号>)` 找行；
- 客人记录写「ME 自动发出：AI 跟进信 · <代号>」，trigger_key `crm_ai_followup`；
- 渲染（76 号 11-17 回复确认）：解析 `first_name`、`today`、`catalogue_url`。`catalogue_url` 取客户发信设置 `providers.catalogue`（url + valid_until），过期或缺失 = 客人行写 `blocked`（不是 skipped，补上后可再认领）；其它占位符 = `render_failed` → `blocked`。团名、团页面链接等以后的占位符，等 76 号写出跟进信模板时再加。
- 链接追踪：认领之后、发信之前走现成的 `tagLinks`（`request_id` = 账本行 id），写 `crm_email_link_tokens`。令牌是随机的，而同一封信重发时请求必须一字不差，所以**重发时先读这一行已存的令牌，有就原样用**，不重新生成。追踪失败不挡发信（同 tagLinks 原则：发原文、回执记警告）。
- 回信地址：授权规则 `identity.reply_to` 必填；76 号要求 CTS 的写 info@ctstours.co.nz（客人回信要进 CRM 才能触发「客人开口→转员工」）。
- 发信时段：提议 07:30–20:00（客户时区），76 号每日任务 07:45 跑。

### 4.4 回执、退订、地址历史
- `receipt.ts` / `receipt-consumer.ts` / `unsubscribe-entry.ts` / `receipt-store-prod.ts`：`dedupeScope !== 'lifetime'` → `isLiveScope(scope)`（不是 shadow 就算真发行）。
- 投诉 / 硬退信 / ME 退订的读取：从「只看欢迎信」改成「看本客户全部 ME 信」。欢迎信因此只会更严（客人投诉过跟进信，就不再收欢迎信）。

### 4.5 授权（PM 本人）
- 提议 / 批准 / 撤销 / 状态四个接口加 `trigger` 参数（缺省 `welcome`，旧调用不变）；批准仍只认 PM 登录身份；`daily_cap` 1–50 不变；有效期最长 90 天不变；模板一改授权自撤不变（现在是清单里任一封变了就撤）。
- 「AI 跟进信」授权和欢迎信授权各自独立：撤一个不影响另一个。

## 5. 验证（本刀）

- 单元：规则解析（letters 与 template 互斥、代号唯一、auto- 前缀）、关卡档案表格逐行、`sendNamedLetter` 全路径（假库假 Resend），欢迎信现有测试零改动全过。
- 迁移：`migration-sql.test.ts` 同款静态检查——新守卫不再出现 `= 'lifetime'`、新函数 `security invoker`、只授 `service_role`、RLS 策略带 `TO service_role`。
- 不在生产库跑迁移（要 PM 回「go apply」）；能拿到本地 Postgres 就在本地跑一遍迁移 + 认领函数并发冒烟，拿不到就如实写「未跑」。
- 当场试跑：本刀没有新定时任务；真发要到试发 hello@ 那一步。

## 6. 复用说明（Reuse Statement 草稿）

复用：发信底座全部（授权、锁、认领、回执、退订、Resend 适配器）、127 号的模板与渲染、发信频率证据读取。新增的 platform-shared：多封信授权、信清单指纹、按 trigger 选关卡档案、点名发信入口。client-specific：无（CTS 的发件人、回信地址、信清单只在授权规则里）。换成悉尼地产客户：同一套代码，换一份授权规则即可。

## 7. v0.2 复审后定稿（子牙 Z#、魏征 W#；与前文冲突以本节为准）

### 7.1 数据库（Z1、Z9、W 结论）
- **两种范围并存，不写死信种名**：`trigger_key` 检查改成格式 `^[a-z][a-z0-9_]{1,40}$`（倒计时信 `countdown_…` 以后也能直接用，不必再动库）。
  - 一种信一个 trigger（欢迎信、倒计时信）→ 真发行 `dedupe_scope='lifetime'`，走原 `triggered_send_claim`。
  - 一个 trigger 下多封信（AI 跟进信）→ `letter:<代号>`，走 `triggered_send_claim_letter`。
  - **分界看授权规则里有没有信清单 `send.letters`**：`claim_letter` 只认有清单的授权；原 `claim` 重建，加一条「授权规则有 `send.letters` 就返回 `auth_inactive`」，其余逐字不变。删掉 v0.1 的 `scope_matches_trigger` 约束。
- 地址唯一索引列含 `dedupe_scope`（已是），`claim_letter` 第 11 步按范围过滤（已是）。
- 两个 trigger 的数据库串行锁不同；「7 天 2 封」的并发保护只靠程序层的客人锁 + 地址锁（W9），这一点如实写明，测试覆盖「欢迎信与跟进信同时发同一位客人」。

### 7.2 规则（Z9、W1、W3、W12）
- 规则加可选 `gates` 块（进规则指纹，PM 批的就是它）：`{ sales_email: bool, legacy_welcomed: bool, stale: bool, count_legacy_batch: bool }`。缺省 = 欢迎信现行为（老规则指纹不变）。跟进信规则写 `{false,false,false,true}`。
- `send.letters[i] = { letter_key, template_key, template_version, template_sha256, context }`，`context` 只允许 `{ catalogue_url, catalogue_valid_until }`（可空）。**目录链接冻结在授权里**，发信时只用它、不现读发信设置（W1）；过了 `catalogue_valid_until` → `blocked:catalogue_expired`。换链接 = 重新提议、PM 重批。
- `send.letters` 与 `send.template` 二选一；1–8 封，代号唯一，模板 `auto-` 开头。
- `count_legacy_batch=true` 时，证据读取不剔老批次群发；`stale=false` 时不读线索年龄；跟进信不扫老批次「已欢迎」（省时间）。

### 7.3 结论分类（Z5、Z7、W2、W8）——接口约定写给 76 号
| 返回 | 含义 | 76 号怎么办 |
|---|---|---|
| `sent` | 已交给 Resend | 按 `sent_at` 排下一封 |
| `skipped` + 原因（dnc / email_unsubscribed / complained / hard_bounced_address / mailchimp_suppressed / excluded_tag / no_consent_basis / bad_email / system_address / address_duplicate） | 这封信对这位客人的最终结论 | 不再排这封；后面的信自己决定 |
| `blocked` + 原因（frequency_full / catalogue_expired / render_failed / lock_busy / *_unverifiable / cap_reached） | 今天不发，行可再认领 | 下一个工作日再调 |
| `stopped`（`stopRun=true`） | 授权不在、不在时段、不在试发名单、供应商出问题、没钥匙 | **当天对任何客人都别再调** |
| `already_done` + `rowStatus` | 这封信以前处理过，带真实状态 | 按 `rowStatus` 判，不当成「已发」 |
| `in_flight` / `unknown_outcome` | 在途或结果不明 | 不重排、不跳过，等人核 |
- `frequency_full` 改为 `blocked`（不再是终态 skipped）；**员工信照样计入 7 天 2 封，只是不判「员工已写过」**（W4）。
- 不在试发名单 → `stopped:not_in_allowlist`，**不写行**（W2）：试发期间点到的真客人不会被永久标掉。
- 底座出只读 `letterStatuses(clientId, contactId)` → 每个代号的 `{status, sentAt, sendId}`，76 号不直接查表（Z8）。

### 7.4 在途与重发（Z3、Z4、W6、W11）
- 重发时 `today` 取这一行首次尝试那天（客户时区），内容不会因隔天而变（W6）。
- `sendNamedLetter` 进门先把这位客人超过 20 小时的 `letter:*` 在途行交给 `claim_letter` 判一次（触发 20 小时转「结果不明」）。
- 链接追踪：首次发送前把「加没加追踪、令牌、最终正文指纹」记进这一行 `annotations`；重发照抄，不重新生成（W11）。
- 「结果不明」的人工核对页、最近发送页扩到跟进信：**放第二刀**（第二刀本来就是安全件），第一刀只发 hello@ 试发，真客人发不出，风险可控；写进台账卡，正式发信前必补。

### 7.5 写死点清单（Z2、W5）——第一刀逐个改成按授权 / 范围取值
`send-store.ts:88-94,124` · `send-deps-prod.ts:38,66,68` · `send-one.ts:31,236` · `authorization-store.ts:111,141,188` · `authorization-core.ts:105` · `authorization-commands.ts:84` · `authorization-deps-prod.ts:48` · `src/lib/inngest/triggered-send-events.ts:20,54,146` · 回执 / 退订 `receipt.ts:115` `receipt-consumer.ts:121,155` `unsubscribe-entry.ts:155` `receipt-store-prod.ts:65,82`。
第二刀：`recent-sends.ts:96` · `resolve-store.ts:53-55,73` · `resolve-unknown.ts`。
欢迎信演练专用、不改：`shadow-store.ts` · `shadow-reads-prod.ts:153,172` · `rehearsal-evidence.ts`。
加一条静态测试：上面「第一刀」列表里的文件不再出现字面 `'welcome'` / `'lifetime'`（统一从一个取值函数来）。

### 7.6 76 号那边的约定（W7、Z6）
- 76 号只对**没经 info@ 发过 2027 目录**的客人调 `catalogue_2027`（判据由 76 号定，切线时写进它的台账卡）。
- 76 号在它现有的 Inngest 函数里、每几位客人一个 step 调用，不新增事件。不上新 Inngest 事件的三件套：原因 = 额度快满；替代回执 = 账本行（`annotations.request_ref`）；恢复条件 = 额度放开后改成 `crm.ai_followup.letter_due` 事件。

### 7.7 如实写明的行为变化与代价（W10、W12、W13、Z14）
- 欢迎信的 7 天证据会把跟进信算进去（正确，但欢迎信可能因此 `frequency_full`）；跟进信占着客人锁时欢迎信会 `lock_busy` 顺延。
- 投诉 / 硬退信本来就看全部 ME 信（Z10），不用改；回执把投诉写成退订那处（`receipt-consumer.ts:155`）扩到跟进信。
- 欢迎信与跟进信各有日上限，一天最多可发 = 两者之和；批准页面并排显示。
- 清单里任一封模板变了 → 整份授权自撤（照 PM 原话「模板一改授权作废」），代价是当天其它信也停，等 PM 重批。
- 跟进信没有影子演练，正式批准前的条件（试发 hello@ 收齐、第二刀上线）写进 §4.5，由 PM 批正式授权时看到。
