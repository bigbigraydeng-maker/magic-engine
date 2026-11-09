# CRM「发送目录」与「员工放行跟进信」设计稿 v0（刀 B0 + B3 骨架）

- 状态：子牙（架构）+ 魏征（挑刺）已审、9 处已改；**B0 代码已写（2026-11-09，分支 `feat/crm-catalogue-send-b0`）**，B3 未开始
- 写的人：127 号窗口（Opus），2026-11-09
- 级别：**A 级**（碰对外发信的闸）。B0 不加表；B3 加表 → 留给 Ray 亲手合
- 分支：`feat/crm-catalogue-send-b0`（从 origin/main `3c061cf29` 开，本地快照，未 fetch）
- 上游：76 号流程稿 `docs/specs/2026-11-09-crm-catalogue-followup-workflow-v0.1.md`（在 focused-yalow 工作区，未推）的「刀 B」
- 下游：76（刀 A 按钮调 B0）、129（刀 C 写信，往 B3 队列里放草稿）、128（给真链接和手册版本）

---

## 0. 给 PM 的一页纸（大白话）

**做完你会看到什么变化**
1. 客人页上 76 号做的「发送 2027 目录」按钮，点一下，系统用一封固定的 Baker 署名信把**真的手册链接**发给客人。发不出去时，按钮会直接说原因（例如「他这周已收 2 封」「他是已付定金的客人」「手册已过期」）。
2. 手册有「到期日」。到期那天一过，**任何一封信里都发不出这个手册链接**——按钮发不了，员工手打这个链接也发不了，直到你点头换上新版。
3. 这封目录信**算进**「每人每周最多 2 封」。只有客人自己来要目录、员工用「客人要目录」那封模板原样回，才不算（这条是你 11-03 定的，不变）。
4. （B3）AI 写的跟进信先进一个「待放行」队列：员工看到草稿、AI 读了客人哪些资料、机器检查过哪几项，点「放行」才发；不点就永远不发。每次放行、退回、作废都留记录。

**这次不做**：自动发（第二阶段要你回「放开」）、按团追踪点击（B2，另出设计稿）、改任何线上模板或发信设置（都要你点头）。

**上线给真实客人前必须三件都做完，每件都要你一句话**：①每周上限从临时的 20 改回 2；②发信范围从「只发 hello@」放开；③128 号的新版手册（4–5 星写法）上线。

---

## 1. 现状（2026-11-09 读代码核实，HEAD `3c061cf29`）

| 环节 | 现在怎么做 | 文件 |
|---|---|---|
| 发信入口 | 员工在 CRM 抽屉点发送 → compose 接口 → `sendMailNew` | `src/app/api/clients/[id]/crm/contacts/[cid]/email/compose/route.ts` |
| 闸的顺序 | 开关 → 找客人 → 选收件地址 → 地址没变 → 试跑名单 → 只发给咨询过的人 → 别再联系 → 选邮箱 →（锁前）模板版本/官网数据/文字检查 → 对账 → 配额 → 客人锁 + 地址锁 →（锁内）同一请求防重 → 同模板冷却 / 通话后只跟进一次 → 7 天频次 → 发送 → 回执 | `src/lib/microsoft/mail-send-new.ts`、`src/lib/crm/email-templates/send-gates.ts` |
| 回执 | 路由拿到结果后立刻记 `crm_email_send_receipts`（不含地址和正文），`auth_basis` 只允许 `human_click` | `send-record-prod.ts`、migration `20261028130000` |
| 发信设置 | 按版本追加、严格解析（不认识的键直接拒）；`providers` 目前只认 `published_tours` | `settings.ts` `parseProviders` |
| 模板变量 | 通用变量 `first_name / sender_name / call_when`，`input.*`（员工手填），加上官网数据变量 | `placeholders.ts`、`render.ts` |
| 链接检查 | 所有链接必须 https、无用户名、host 在 `guardrails.allowed_link_hosts` 里；有官网数据时还查团页是否在售 | `gates/content-gates.ts` |
| 「不占名额」 | `cap_exempt_template_keys` 里的模板、**且原样发出**（没改字、没用手填框）才不算 | `send-gates.ts` `isCapExempt` |
| 阶段 | `client_pipeline_stages.marketing_action ∈ nurture/defer/suppress/postsale/won` + `is_terminal`；`stageSuppressesWorklist` 判「不该再催」 | `src/lib/crm/pipeline.ts` |

**两个会咬人的事实**
- `loadSuppressedStages` 读不到配置时**返回空集合**（对「今天该联系谁」名单是合理的放行）。目录线不能照搬：读不到 = 拒发。所以 B0 只复用判据函数 `stageSuppressesWorklist`，不复用这个加载函数。
- 设置解析器拒绝不认识的键。新增 `providers.catalogue` 之后，**旧代码读不了带它的设置版本** → 整个 CRM 发信会因「设置无效」全部停发（是安全的失败，但等于停摆）。回滚代码前必须先存一版不带 `catalogue` 的设置（§3.8）。

---

## 2. 平台层级判定（Inline）

> [跟班 · Tier] 这是既有「CRM 对外发信闸」（平台基础设施：Governance / 外发授权）的扩展 + 一个复用它的「目录线」调用方；不新增能力线、不新增支柱，不登记候选。
> [跟班 · 红线] 红线 2：共享代码里不出现 CTS、2027、Baker、团名；这些只在客户配置（发信设置、模板正文）里。阶段只按 `marketing_action` 判，不认任何客户的阶段名。
> [跟班 · 判据] 换客户：Roman（地产）把 `catalogue` 配成楼盘资料册、模板写自己的话，代码不改；换行业：同上。

---

## 3. B0：一键发目录

### 3.1 目录配置（客户配置，进发信设置）

```jsonc
"providers": {
  "published_tours": { ... },          // 原样
  "catalogue": {                        // 新增，可选；没有 = 这个客户没开目录线
    "template_key": "catalogue-send",   // 发目录用哪个模板
    "version_label": "v9",              // 给人看的版本号，进回执给 76
    "url": "https://www.ctstours.co.nz/brochures/CTS-Tours-2026-2027-Brochure.pdf",
    "valid_until": "2026-12-31"         // 含当天；按客户时区算
  }
}
```

解析规则（全部不过 = 整版设置拒存，和现在一样严格）：
- 四个键都必填，不许多键；`template_key` 用模板代号同一套正则 `^[a-z0-9][a-z0-9-]{1,62}$`。
- `url`：https；无用户名、无 `%` 编码的 host、无空白；≤500 字；**host 必须在同一版设置的 `guardrails.allowed_link_hosts` 里**（跨字段校验：配进去就一定过得了链接检查，不会出现「配好了却永远发不出」）。
- `valid_until`：真实存在的 `YYYY-MM-DD`。
- `version_label`：1–20 字，只许字母数字和 `. -` 空格。
- **`template_key` 不得出现在 `cap_exempt_template_keys`**（代码级保护：目录信永远占名额；想改要改代码，不是改设置）。
- 序列化：只有配了才写出 `catalogue`；没配的版本旧代码仍读得懂。

`EmailSettings.providers` 加 `catalogue?: CatalogueSettings`；`effective-config.ts` 原样透传（`providers` 已整体透传，无需改）。

### 3.2 新模板变量 `{{catalogue_url}}`

- 加进 `COMMON_VARIABLES`，模板编辑器会列出它。
- `RenderContext` 加 `catalogue: { url: string; validUntil: string } | null` 和 `today: string`（客户时区的今天，`todayInZone` 已有）。
- 解析：没配，或 `todayInZone(clientTimezone) > validUntil`（字符串比较 `'2026-11-10' > '2026-11-09'`，含当天有效）→ 记成缺失（`missing: ['catalogue_url']`）。预览会显示缺失，按钮不会发。
- 三处调用 `renderTemplate` 的地方都要填这两个字段：`template-preview.ts`、`send-gates.ts attachRenderHash`、B0 自己。漏填 = 缺失 = 发不出（失败方向安全），单测覆盖三处。

### 3.3 新闸：手册过期 / 没配，任何信都发不出这个链接

在 `runPreLock` 的文字检查**前**加一步 `catalogueStage`（锁前；放在前面是为了过期时报「手册已过期」，而不是被「还有没填的占位符」抢先）：

1. 从最终要发的主题+正文+页脚里抽出所有链接（复用 `extractLinks(normalizeForLinks(...))`，不另写抽链接）。
2. 和配置的 `url` 比：协议+host 小写、**路径大小写敏感**（HTTP 路径本身区分大小写）、忽略 query 和 #（`?v=2` 换不掉身份）。命中且已过期 → 拒，`catalogue_expired`。
3. 这封信来自模板、模板用了 `{{catalogue_url}}`，但目录没配或已过期 → 拒，`catalogue_unavailable`。
4. 自由手写的信同样过第 2 步（员工把旧链接粘进去也发不出）。

新拒绝原因（加进 `GateReason` + `GATE_MESSAGES`，回执里记代码，不记链接）：
- `catalogue_expired`：「手册已过期（有效期到 {date}），这封没有发出。请等新版手册换上后再发。」
- `catalogue_unavailable`：「这个客户还没配目录，或目录已过期，这封没有发出。」

已知边界（写进卡，不修）：只认「完全是这个网址」的链接；把 PDF 另存到别的网址再贴 → 只受 host 白名单管。目录配置删掉之后，旧链接就只是普通官网链接。

### 3.4 进线检查 `checkCatalogueEligibility`（目录线专用，按钮预检和真发共用）

| 检查 | 不过时 | 读不到数据时 |
|---|---|---|
| 别再联系 `do_not_contact` | 拒 `do_not_contact` | 拒 |
| 阶段的 `marketing_action ∈ suppress/postsale/won` 或 `is_terminal` | 拒 `stage_suppressed` | 拒 |
| 阶段的 `marketing_action = defer`（短期内不考虑） | 拒 `stage_deferred` | 拒 |
| 客人有阶段值，但配置里查不到这个阶段 | 拒 `stage_unknown` | — |
| `snooze_until` 在未来（过阵子再提醒） | 拒 `snoozed` | 拒 |
| 有可用邮箱 / 7 天名额 / 只发咨询过的人 / 试跑名单 | 交给 `previewCompose` 和 `sendMailNew`，不重写 | 按原闸 |

- 只复用 `stageSuppressesWorklist` + `isMarketingAction`，不复用 `loadSuppressedStages`（§1）。
- 为什么不放进 `sendMailNew`：员工手动给已付定金的客人发信是正常业务；这是「目录线」的规矩，不是发信闸的规矩。代价：查完到真发之间有毫秒级空窗（阶段刚好被改），写进已知边界。

### 3.5 服务端函数 `sendCatalogueEmail`

位置 `src/lib/crm/catalogue-line/send-catalogue.ts`（新目录，只放目录线的编排；不含渠道代码）。

```ts
interface SendCatalogueArgs {
  clientId: string
  contactId: string
  actorEmail: string          // 已鉴权的员工；**只从 requirePaidClientAccess 拿，禁止从请求体读**；由 76 的路由传入
  requestId: string           // 76 的按钮每次点击生成一次的 UUID；双击/重试同一个 → 不重复发
  expectedRecipient: string   // 按钮上显示的地址；变了就拒（沿用原闸）
}
type SendCatalogueResult =
  | { ok: true; messageId: string; conversationId: string; duplicate: boolean
      templateKey: string; templateVersion: number; versionLabel: string; settingsVersion: number }
  | { ok: false; status: number; reason: CatalogueRefusal | SendMailNewReason; message: string }
```

步骤（任何一步不过就停，返回中文原因）：
1. 读生效设置；不是版本化设置、没配 `catalogue`、已过期 → 拒（不碰模板）。
2. `checkCatalogueEligibility`。
3. 读模板 `template_key` 的当前版本；**必须** `factSource='none'`、`pickMode='none'`、不含任何 `input.*`、启用中，否则拒 `catalogue_template_invalid`（保证同一位客人渲出来的字是确定的，「原样发出」可证明）。
4. 服务端渲染（复用 `previewTemplate`，同一批函数）：有缺失、有问题、有拦截 → 拒，不发。
5. 调共用的 `sendTemplateEmail`（§3.6），模板请求 `{ key, version, catalogVersion: 预览给的, picks: [], inputs: {}, callBasis: 'none' }`，正文就是第 4 步渲出来的字。真发时所有原有闸 + §3.3 新闸再跑一遍。
6. 成功返回版本号和设置版本，76 用它写「AI 接管」记录。

目录信不在豁免名单（§3.1 代码保护）→ 占名额。

### 3.6 把「发 + 记回执」抽成共用函数（不另起一条发信管道）

compose 路由里「调 `sendMailNew` → 异常时判断发没发出 → 立刻记回执」这段（`crashResult` + `recordSendAttemptProd`）原样搬到 `src/lib/crm/email-templates/send-template-email.ts`：

```ts
sendTemplateEmail({ clientId, contactId, actorEmail, requestId, subject, body, expectedRecipient, template })
  → SendMailNewResult   // 已经记好回执
```

**关键：回执写在锁内**（实现：`MailNewDeps.recordUnderLock`，只在发到那一步时调；会撞的是「同模板冷却 / 通话后只跟进一次」这两道读回执的闸，7 天频次数的是审计行、本来就在锁内）。现在 compose 路由的 `recordSendAttemptProd` 在 `sendMailNew` 返回之后才调——这时锁已经释放。两个不同 `requestId` 对同一位客人几乎同时发，都能通过频次闸（第一封的回执还没写进去），结果同一个人同一秒收两封。抽出来时把回执写进 `sendUnderLock` 的最后一步（发成功后、释放锁之前），消除这个并发窗口。伪代码：

```
sendUnderLock:
  twin check → inLock gates → claimAndSend → recordSendAttempt → 释放锁
                                              ^^^^^^^^^^^^^^^^^
                                              现在在锁外，搬进来
```

compose 路由改成只做鉴权 + 解析 + 调它 + 翻译成 HTTP；B0 和 B3 放行都调它。路由现有测试一条不改、全部要过（行为不变的证据）。

### 3.7 设置面板

`EmailSettingsPanel.tsx` 保存时调 `buildSettings` 重建 `providers`——只识别 `published_tours`，**别的键全丢**。B0 要同时修两处：

1. **`buildSettings`**（实际只在面板里，没有后端同名函数）：对 `providers` 里不认识的键做**透传**（当前值原样塞回），不 validate 也不丢。这样以后加新 provider 只改解析器，不用同时改面板。加单测「传入 `{ catalogue: {...}, published_tours: {...} }` → 输出里 `catalogue` 原样在」。
2. **前端面板**：加四个输入框（模板代号、版本号、网址、有效期），读写 `providers.catalogue`。加测试「读进来一个带 catalogue 的设置，什么都不改直接保存，catalogue 原样还在」。

### 3.8 回滚 SOP（紧急恢复）

| 步骤 | 做什么 | 为什么 |
|---|---|---|
| 1 | 存一版**不带** `catalogue` 的发信设置（面板清空四个框 → 保存） | 旧代码不认识 `catalogue` 键 → 解析拒绝 → 全部发信停摆 |
| 2 | 回滚代码（还原到上一版本） | 这时最新设置版本已不含 `catalogue`，旧代码能读 |

顺序反了（先滚代码再删设置）= 旧代码读到新设置 = 全部发信停。安全（不会乱发），但等于停摆。

**数据库级恢复**（万一面板也坏了、存不了新版设置）：直接在 `crm_email_settings.versions` JSONB 数组尾部追加一条不含 `catalogue` 的版本条目，使旧代码能解析。SQL 模板放在 PR 正文的回滚段里，只有 Ray 能执行。写进台账卡。

### 3.9 发信渠道（12/2 起换成 ME 自己的发信）

B0/B3 新代码只调 `sendTemplateEmail` → `sendMailNew(…, createMailNewDeps(...))`；不 import 任何 Graph / Mailchimp / Resend。换渠道只动依赖那一层，B0/B3 不用改。

### 3.10 B0 改动清单（预计）

| 文件 | 改什么 |
|---|---|
| `email-templates/types.ts` | `CatalogueSettings`；`providers.catalogue?` |
| `email-templates/settings.ts` | 解析/序列化 `catalogue`；跨字段校验；豁免冲突校验 |
| `email-templates/placeholders.ts`、`render.ts` | `catalogue_url` |
| `email-templates/template-preview.ts`、`send-gates.ts` | 渲染上下文；`catalogueStage`；两个新原因 |
| `email-templates/send-template-email.ts`（新） | 从路由抽出 |
| `compose/route.ts` | 改调共用函数 |
| `catalogue-line/eligibility.ts`、`send-catalogue.ts`（新） | 进线检查 + 编排 |
| `EmailSettingsPanel.tsx` | 四个框 + 不丢字段 |
| 测试 | 见 §5 |

不改数据库。新模板「catalogue-send」的内容和线上设置 `catalogue` 块都是**数据**，上线时要 PM 点头才写（§6）。

---

## 4. B3 骨架：员工点放行的跟进信队列（详细设计 B0 合并后另出 v1）

### 4.1 形状
- 表 `crm_followup_drafts`（一行一封草稿）+ `crm_followup_draft_events`（只追加的事件，放行回执就在这里）。RLS 用 service-role 模板 `FOR ALL TO service_role USING (true)`。**加表 → Ray 亲手合。**
- 草稿字段：`client_id, contact_id, step_key`（同一客人同一步只一行，重放回原行）、`status`、`template_key/version`（129 的框架模板）、`inputs`（`ai_subject`/`ai_body`）、渲染后主题/正文 + 指纹、`read_summary`/`checks`/`source_ref`（jsonb，契约见 4.3）、`created_at`、`expires_at`、`release_request_id`（建草稿时生成，放行时当 `requestId` 用 → 点两次也只发一封）。
- 状态：`pending → released | rejected | revoked | expired | failed`；`released` 之后不可再改。

### 4.2 放行（员工点一下）时重新检查，不信草稿当时的结论
1. 草稿还是 `pending`、没过期；
2. `checkCatalogueEligibility` 同一套（别再联系、阶段、短期不考虑、过阵子提醒）；
3. 草稿建好之后客人有没有回信/填表/来电（有 = 客人回来了 → 作废，交员工）；
4. 用**当前**模板重新渲染，指纹对不上 → 拒，请重新生成（UX 代价：模板改一个字，所有 pending 草稿都作废；接受，因为改模板后不重检 = 信走样）；
5. 调 `sendTemplateEmail`，`auth_basis` 仍是 `human_click`（第一阶段只有人点才发；表上的 CHECK 不放宽 = 自动发的第二把锁）。
员工放行前改过字 → `edited_after_render=true`，照常占名额。框架模板用了 `input.*` → 永远不豁免。

### 4.3 129 的入队契约（已和 129 对齐的草案）
`enqueueFollowUpDraft({ clientId, contactId, stepKey, purpose, templateKey, templateVersion, inputs, readSummary, checks, sourceRef })`；`readSummary: {text, kind:'fact'|'unverified'|'internal_note', at, source}[]`；`checks: {id, ok, detail, by:'script'|'human'}[]`；`sourceRef: {kind:'web_page'|'touchpoint'|'call_analysis'|'catalogue'|'other', ref, at}[]`；数组 ≤30、text ≤500、detail ≤300。另有 `revokePendingDraftsForContact(contactId, reason)` 给 76 的「客人回来了 / 收回人工」用。B0 PR 里先放这些类型的空壳（不落库），让 129 能对着写。

### 4.4 待 B3 v1 定的
- 事件走 Inngest：草稿建好 / 放行 / 退回 / 作废 / 过期各发一个业务可读事件（例 `crm.followup_draft.released`），供 76 的每周统计读；**发信本身仍在员工点击的同一请求里同步完成**（理由：沿用现有 compose 的同步路径和锁；替代回执 = 事件表 + 发信回执）。
- AI 正文里的**金额**：现有金额检查只在选了团时跑，AI 正文写价钱会漏检 → B3 要加「金额必须能在官网上架数据里找到，否则拒发」。
- 草稿正文保存 180 天后清正文、留检查记录；客人要求删除时随客人一起删。
- 草稿过期时长（建议 3 天）、队列放在哪个页面（跟 76 的设计稿走）。
- **「客人回来了」数据源**：B3 v1 必须定义「客人有没有回来」读哪张表/哪个字段。76 的流程稿列了回信、填表、打电话、发私信四种。第一版只认 CRM 触点表里 `direction='inbound'` 且 `occurred_at > draft.created_at` 的记录（Mailchimp 同步的打开/点击时间不准，126 号已确认，§0.1 提到过）。

---

## 5. 「故意破坏」测试清单（76 要求；每条 = 把那道检查删掉，这条测试必须变红）

| # | 规则 | 测试怎么构造 | 删掉哪段代码时它该红 |
|---|---|---|---|
| 1 | 别再联系 | 客人 `do_not_contact=true` 点目录 | 进线检查的 DNC 行（另：`sendMailNew` 原 DNC 闸仍在，单独删它也红） |
| 2 | 已有结论的阶段 | 阶段动作 `suppress`/`postsale`/`won`、`is_terminal` 各一 | `stageSuppressesWorklist` 调用 |
| 3 | 短期内不考虑 | 阶段动作 `defer` | defer 判断 |
| 4 | 未知阶段 | 客人阶段值在配置里不存在 | 未知阶段判断（防止「读不到当放行」） |
| 5 | 过阵子提醒 | `snooze_until` = 明天 | snooze 判断 |
| 6 | 阶段读不出来 | 读阶段配置抛错 | 读失败转拒发 |
| 7 | 手册过期 | `valid_until` = 昨天（客户时区）；当天 = 能发 | `catalogueStage` 过期比较；边界用奥克兰/悉尼跨日各一条 |
| 8 | 手打旧链接 | 自由手写信粘配置的网址、改大小写、加 `?v=2`，已过期；**含 HTML `<a href="...">`** 不只看裸 URL | 链接比对的归一化（`extractLinks` 需同时抓 `href` 属性和裸 URL） |
| 9 | 没配目录却用了变量 | 模板含 `{{catalogue_url}}`，设置无 `catalogue` | `catalogue_unavailable` 分支 |
| 10 | 目录信占名额 | 本周已 2 封 → 目录信被挡 | 频次闸 |
| 11 | 不能把目录信设成豁免 | 设置里把目录信的 `template_key` 放进 `cap_exempt_template_keys` 名单 → 保存设置时报错、拒绝写入这个新版本 | 解析器冲突校验（`parseProviders` 里检查交集） |
| 12 | 配置网址不在白名单 | `url` host 不在 `allowed_link_hosts` → 拒存 | 跨字段校验 |
| 13 | 网址必须 https、无用户名 | `http://`、`https://a@b` → 拒存 | 解析器 url 校验 |
| 14 | 目录模板必须是死的 | 模板含 `input.x` 或选团 → 拒 | 第 3 步模板形状检查 |
| 15 | 渲染有缺口不发 | 客人没名字、模板要 `first_name` | 第 4 步缺失检查 |
| 16 | 双击只发一封 | 同一 `requestId` 连调两次 | 原有防重（第二次返回 `duplicate:true`） |
| 17 | 地址变了不发 | `expectedRecipient` 与实际不同 | 原有比对 |
| 18 | 发送中崩了不说成功 | 依赖在发送开始后抛错 | 共用函数的 `crashResult`（记「状态不明」） |
| 19 | 面板保存不丢目录 | 带 `catalogue` 的设置原样保存 | 面板 providers 重建 |
| 20 | 旧版本设置仍可读 | 不带 `catalogue` 的设置 → 序列化后没有 `catalogue` 键 | 序列化「只在配了才写」 |
| 21 | 抽函数后 compose 行为不变 | 现有 compose 路由测试全量 | （回归，不是破坏测试） |
| 22 | 并发双发只成功一封 | 同一秒两个不同 `requestId` 对同一客人调 `sendTemplateEmail` | 锁内回执（§3.6）；第二个应被频次闸或联系人锁挡住 |

上线后机器之外的保险：前两周员工放行（B3）；76 的每周抽查拿真发出的信对规则（刀 F）。

---

## 6. 要 PM 一句话的事（按时间顺序，到时候一件件问，不一次问完）

1. 在线上建「目录信」模板（Baker 署名、用 `{{catalogue_url}}`、不豁免）——建之前给你看全文。
2. 在线上发信设置里加 `catalogue` 块（网址、v9、有效期）。
3. 128 号新版手册换上后，把版本号改成 v10。
4. 上线给真实客人前的三件事（§0）。
5. B3 的框架模板「（系统用）AI 跟进框架，请勿手选」进生产。
6. B0 的改动单合并（A 级，回「合 N」）；B3 加表的由 Ray 亲手合。

## 7. 当场试跑计划（B0 合并上线后，只发 hello@）

1. 在测试联系人（hello@）身上：预览目录信 → 用新函数真发一封 → 读回执（模板代号、版本、`human_click`、回执里无地址无正文）→ 邮箱里看到这封信、链接能打开 PDF。
2. 同一个 `requestId` 再调一次 → `duplicate:true`，邮箱里没有第二封。
3. 用一份「`valid_until`=昨天」的设置跑预览（只读，不存线上）→ 显示手册已过期。
4. 真实客人：只跑**只读预览**，确认都是「不在试跑名单里」，一封不发。

## 8. Reuse Statement（预填，交付时对账）

- 复用：`sendMailNew` 全部闸、回执、`previewTemplate`/`renderTemplate`、`extractLinks`、`isCapExempt`、`stageSuppressesWorklist`、`todayInZone`/客户时区、设置版本化存储。
- 新增且平台共用：目录配置块、`{{catalogue_url}}`、手册过期闸、目录线进线检查、`sendTemplateEmail` 抽取、B3 队列。
- 行业专属：无（「目录」对旅游是手册，对地产是楼盘资料册）。
- 客户专属：只在数据里——CTS 的网址、版本号、有效期、模板正文、阶段配置。
- 共享代码里没有客户名、客户 ID、行业判断。
- 学到的东西：无新增记忆层写入。
