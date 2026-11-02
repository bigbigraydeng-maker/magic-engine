# ME 触发型发送 · 第二步（P2）实现设计 v1（2026-11-02，已吸收子牙 + 魏征一轮设计审查）

> **风险级别：A**（新表 + 授权 + 对外发信 + 新公共入口 + 写客户联系记录）。**本稿只出方案：不含代码、不开户、不发信、不改任何线上设置。**
> **来源**：PM 2026-11-02 回「开始第二步」，并亲口定了两件事（§2）。总设计：`docs/specs/2026-10-29-me-email-sms-sending-design-v0.md`（v0.4，§5 的 P2 一行）。第一步（P1：只收 Resend 回执）已上线并核验通过：`docs/specs/2026-11-01-me-provider-event-intake-p1-design-v0.md`。
> **状态**：v1。子牙、魏征各审一轮，两位都判「需改后再审」：P0 共 2 条（状态流转写矛盾；首个真发日会把影子期积压的旧线索当新线索补发）、P1 共 17 条，全部已改（§16 逐条）。二轮复核（可选）放在写迁移之前。
> **事实核对**：所有「现状」都是 2026-11-02 在主干 95f3b5bff 上逐个核过的（两位只读调研 + 两位审查员各自核实 + 我自己读源码），**不照抄总设计 §2/§4.4 的 10-29 旧说法**：#3349 已合并、`evaluateFrequency` 已在主干、`acquireContactLock` 是 store 方法、Mailchimp 按邮箱读标签的函数已存在等（§9）。
> **派活记录（PM 11-01 分层规则）**：L4（A 级新做）。方案 = 本窗口 Sonnet 5.5（窗口模型没擅自切换）；设计审 + 实现审 = Opus 子代理（子牙、魏征）；代码 = DeepSeek（aider，分轮）。

## 0. 给 PM 的一页话

**第二步要做成什么**：让 ME 自己决定、并通过 Resend 把「CTS 新线索欢迎信」发出去——发之前过一道固定的关口、先记账，再发；发出后 ME 看得到谁收到了、谁退信、谁投诉。**先影子运行（只记「本该发给谁」，不真发），你看完对照结果再授权，再切换。**

**你已经定的两件事（11-02）**
1. **常设授权**：你本人一次批准「一类信 + 发给谁 + 每天上限 + 有效期（缺省 90 天）」；任何一项变了（哪怕模板改一个字、或我们把关口逻辑改了）授权自动作废、系统停发并出一张待办；没有有效授权就不发；你随时可以一键撤销，下一封就停。
2. **新线索第一天**：销售当天（或欢迎信发出之前）已经给他发过邮件的，ME 就**不再**自动发欢迎信（销售那封算第一封）；没发过的，ME 才在第二天早上自动发。同一个人 7 天内最多 2 封的铁规照旧生效。

**审查后我加的几道保险（你不用懂细节，知道有就行）**
- 首个真发日**不会**把影子期攒下的旧线索补发：授权时才定「从哪一刻之后的新线索算」，并且只认最近 3 天内进来的人。
- 第一次真发只发给**内部白名单（hello@）**，用你们在 CRM 里手建的一个内部测试联系人；看过结果、你再点一次授权，才放给真实线索。
- 客人点「退订」只停**邮件**，不会让他从销售名单里消失、也不会影响打电话。
- 发信账号钥匙缺失时，**宁可不发**，绝不偷偷改用 ME 自己系统邮件的钥匙。

**分三小步，每步都等你点头才往下走**
| 步 | 做什么 | 会不会发信 | 要你做的 |
|---|---|---|---|
| P2-1 地基 + 影子 | 建两张表、关口与授权的判定逻辑、每天早上算一遍「本该给谁发欢迎信」并和现在 8:01 的批次对照、出待办 | **不发**，也不改任何联系人 | 亲手合并建表那条改动单（碰数据库表，机器不会替你合） |
| P2-2 发出 | Resend 发信、一键退订页、回执回写、你的授权页（授权/撤销按钮）| 只在你授权、且开关打开后才真发；第一次只发 hello@ | ①为客户发信开独立的 Resend 账号 ②问清 CTS 域名解析归谁管 ③填新密钥到 Render（只能你本人）④在授权页点「授权」 |
| P2-3 切换 | 连续 5 个有新线索的日子对照一致后，把表格脚本的触发器改到 2099 年（不删），ME 接手真发 | 真发 | 你本人改触发器；之后 7 天看有没有人收到 2 封 |

**钱**：P2-1 零成本。P2-2 起，客户发信用独立 Resend 账号（免费档每月 3,000 封、每天 100 封，够 CTS 欢迎信起步；超了才升 US$20/月）。写代码用 DeepSeek，预计每个改动单几美分。

**风险（要你知道，不是要你现在决定）**：①Facebook 表单留资用的是「勾选退出」式同意，Resend 条款要求「明确同意」，是否被认可只能在实际发信中看出来——所以用独立账号隔离，并盯退信/投诉（超线自动停）；②新增两个对外入口（一键退订页、Resend 回执接收口扩展），按 A 级审；③要改两处别的窗口（127 / 76 的 CRM 发信关口）的代码，各一小处且只加严（§6.4、§6.3），会写进改动单并通知它们；④现在的合并闸**看不住**这批新代码（会把它们判成「普通改动」自动合并），所以第一条改动单里要同时把它们加进「高风险名单」（§10 P2-1a）。

**你已答的两件事（11-02）**
1. ✅ **PM 回「只用info」**：CTS 销售发客人邮件只用 **info@** 这一个邮箱。所以规则快照里的「必须可读的销售邮箱清单」= `info@`；ME 里已断开的 bdm@ 连接不在清单内、被忽略（若以后 bdm@ 也开始用，必须先重新连接并**重新授权**）。
2. ✅ **PM 回「可以」**：欢迎信**第一版用短的纯文字信**（只带客人名字、不写团名和价格），内容由 CTS / 126 号窗口写、**你确认后**才进授权。原因：现在 8:01 批次那封是带图和团价的网页式邮件，要照搬就得先做「图文邮件 + 没名字时的兜底称呼 + 每天核对价格」，工作量大得多，放到第二版。

## 1. 范围与不做

**做（分批改动单，见 §10）**
1. 两张新表（A 级迁移）：`triggered_send_authorizations`（规则快照 + 授权）、`triggered_sends`（发送状态账本）；一个原子认领函数 `triggered_send_claim`。
2. 共享库 `src/lib/messaging/triggered-send/`：授权判定、发送关口（有序、fail-closed）、状态机、欢迎信触发定义、影子运行与对照。
3. Inngest：欢迎信扫描函数（每天按规则时刻 + 白天补扫）、回执消费函数、回调接收口补发 `crm.provider_event.received`、每日对账。
4. Resend 发信适配器、联系人级一键退订入口、触点写入、频次关口对「ME 自动发的信」的计数、销售手发关口对「已退订邮件」的拦截。
5. PM 的界面：授权页（授权/撤销/影子对照/标记未知结果）+ 今日待办的拉模式待办。
6. 把新代码加进合并闸的高风险名单（§10 P2-1a）。

**不做（本步明确排除）**：短信（P3）、官网订阅新人进 ME（P2b）、行前通知与感谢信（P4）、newsletter（P5）、改 Mailchimp 任何设置、动内核授权（`kernel/outward-authorization.ts`）、改 126 / 127 / 129 的卡与设计、把第 2/3 次跟进改成自动发、为本方案新建能力线或支柱、替客户开 Resend 账号或改域名解析、图文（HTML）邮件与团价事实（第二版，见 §0 问题 2）。

**与总设计 §5 P2 的差别（共 6 处，理由见各节）**
1. 状态表与授权表**拆成两张且授权表同时承载「规则快照」**（§3.1）：避免再开第三张「规则表」，也让「改一项就作废」落到数据库层面的不可变。
2. **回执不借道 127 的回执表**：它的 `auth_basis` 只许 `human_click`、`actor_email` 必填（`supabase/migrations/20261028130000_crm_email_templates.sql`），自动发送写不进。
3. **频次的「第五来源」不新增来源类型**：ME 自动发出的信写一条出站触点（带 `counts_toward_frequency` 标记），由现有第三来源（触点）计入（§6.4）——比总设计设想的「改 5 个文件加来源」改动小得多，且改动方向只会更严。
4. **欢迎信模板复用 127 的模板表与渲染器**（版本化、只增不改、`rendered_sha256`）（§6.2）；第一版只许「只含 `first_name`、`fact_source=none`」的纯文字模板。
5. **新线索触发用「每天扫描」不用「入库事件」**：现状没有入库事件（`ingestMetaLead` 不发 Inngest 事件，`src/lib/meta/leads-sync.ts:322`），且 PM 要的是「第二天早上发」，扫描是拉模式、丢事件也不丢人（§5.1）。
6. **授权形状与 126 手册 WP5 的「逐封授权」不同**：本步是「条件组 + 日上限 + 有效期」，PM 11-02 已亲口定（总设计 §4.5 本来就写明是有意放宽）；与 126 的对齐写进 §11，不是单纯「通知」。

## 2. 已定决定（PM 2026-11-02，在 33ebcd0b 窗口亲口定）

| # | 决定 | 落到设计的哪里 |
|---|---|---|
| D1 | 同意「常设授权」：PM 本人一次批准一组绑死条件，任何一项变了自动作废；真发之前先影子运行 | §3.1、§4 |
| D2 | 新线索第一天：销售已发过邮件的，ME 不再自动发欢迎信（销售那封算第一封）；没发过的才在第二天早上自动发 | §5.2 第 J 步、§5.3 |
| D3 | CTS 销售发客人邮件只用 info@ 一个邮箱（PM 回「只用info」，审查员问「销售用哪些邮箱」的答案）| §3.1 `human_mail.required_mailboxes`、§5.2 F 步、§9-8 |
| D4 | 欢迎信第一版用短的纯文字信（只带客人名字、不写团名价格），内容由 CTS / 126 号窗口写、PM 确认后才进授权；图文版 + 团价 + 兜底称呼放第二版（PM 回「可以」）| §6.2 |

## 3. 数据

### 3.1 `triggered_send_authorizations` —— 规则快照 + 授权（一行一份提案/授权）

先例（照它的形状做）：`supabase/migrations/20261010100000_daily_plan_auto_publish.sql`、判定函数 `judgeAuthorization`（`src/lib/campaign/daily-plan-auto-publish.ts:158`）。

**绑定列（插入后不可变）**

| 列 | 说明 |
|---|---|
| `id` uuid pk；`request_id` uuid unique | 命令幂等键 |
| `client_id`（外键 clients）；`trigger_key` text **check in ('welcome')**；`channel` text check in ('email')；`account` text | 触发名（P2 只有欢迎信，将来加触发靠迁移放开）、渠道、Resend 账号标签 |
| `rule` jsonb；`rule_sha256` char(64) | **规则快照**，规范化 JSON 的 SHA-256。字段见下表 |
| `template_version` int、`template_sha256` char(64)（提案时可空，**批准时必须非空**，CHECK 钉死；**模板留空的提案永远批不了——绑定列批准前后都不可改——须撤销后重新提案**） | 127 模板表里**当前版**的版本号与内容指纹（`subject｜body｜fact_source｜pick_*` 的 SHA-256） |
| `daily_cap` int check 1..50 | 每天最多真发几封（上限 50 是代码与数据库双重硬顶） |
| `proposed_by_email`、`proposed_at` | 谁提的案（可以是 agent/FDE；**提案不等于授权**） |
| `created_at` | |

**规则快照 `rule`（严格解析，缺键或坏值 = 提案无效，不回落默认）**

| 键 | 含义 |
|---|---|
| `gate_contract_version` | 关口逻辑的版本号（代码常量）。关口语义一改就 +1 → 已批准的授权判 `GATE_CHANGED`，必须重新授权 |
| `audience` | `sources`（联系人来路白名单，P2 只许 `meta_lead_form`；`crm_manual` 仅当 `recipient_allowlist` 非空时才许）、`max_age_days`（缺省 3）、`min_age`=`previous_local_day` |
| `schedule` | 扫描时刻（如 `08:01`）、时区、静默时段（缺省 08:00–20:00） |
| `template` | 模板 key |
| `identity` | From 署名与地址、Reply-To |
| `frequency_cap` | `{ max: 2, window_days: 7 }`（**只用快照值**，不读 127 的设置） |
| `consent` | `accepted_bases`（同意依据白名单，如 `form_disclosure_attested`；**每个客户自己填**，不写死在代码里） |
| `legacy` | `mailchimp_tag_prefix`（旧批次打的标签前缀，如 `auto_e1_batch_`；客户自己填） |
| `human_mail` | `required_mailboxes`（必须可读的销售邮箱清单；清单内任一邮箱连接非 `active` → 整批拦；清单外的断开邮箱忽略） |
| `recipient_allowlist` | `null` 或邮箱清单。非空 = **只许发给清单内地址**（受控试跑用，清单内地址免「来路/同意依据」检查） |
| `health_breaker` | 自家闸线阈值（见 §4.3） |

**生命周期列（每列只能「从空写一次」，且按下面的次序）**

| 列 | 说明 |
|---|---|
| `authorized_by_email`、`authorized_by_user_id`、`authorized_at` | PM 本人批准时写入（三者同空或同有） |
| `live_from` | 批准时写：只认**这一刻之后**进来的新线索（再往前最多回补 36 小时，用于切换当天批次与 ME 之间的空档）；`live_from ≤ authorized_at` 且 `≥ authorized_at − 36h` |
| `expires_at` | 批准时写；缺省批准后 90 天，**上限 90 天（CHECK）**；`expires_at > authorized_at` |
| `activated_at` | 授权事件发出后才写；发送方把 null 当作「未武装」 |
| `revoked_at`、`revoked_by`、`revoked_reason` | PM 撤销，或系统自动作废（`revoked_by = 'system:<代号>'`，代号如 `TEMPLATE_CHANGED`、`GATE_CHANGED`、`HEALTH_BREAKER`、`PROVIDER_FAILURE`） |

**时间由数据库定（v2）**：`authorized_at / activated_at / revoked_at` 由触发器覆盖成数据库的 `now()`，客户端传来的值一律被忽略（实测：客户端填 400 天后的批准时刻，曾能把有效期撑到 454 天）；**批准与武装必须分两条语句**（先批准，授权事件发出后再武装），同一条语句里两者都写会被拒。

**约束与触发器（数据库层强制，不只靠代码自觉）**
- **`BEFORE INSERT` 触发器**：新行的生命周期列必须全为空——**一条 INSERT 直接写成「已批准 + 已武装」会被拒**（魏征原型实测：没有这一条就能写进去）。
- **`BEFORE UPDATE` 触发器用「整行白名单比对」**：把新旧两行都去掉生命周期列后转成 jsonb，必须完全相等——所以**以后新加的列默认就是不可变的**，不用逐列维护黑名单；生命周期列只许「从空写一次」；**已撤销的行不许再批准**（判据与「时间由数据库定」一致：只要批准相关的任一列被写入就算批准，不能靠「不填 `authorized_at`」绕过——第二轮审查两位都发现过这条漏洞）。
- 部分唯一索引：同一 `(client_id, trigger_key, channel)` 至多一份**已批准且未撤销**、至多一份**待批提案**（未批准且未撤销）。已过期但没撤销的授权仍占着「生效」的位置，所以**续期命令的第一步是显式撤销过期的那份，再写新的**；中间没有授权是安全方向。新提案自动撤销旧提案（`SUPERSEDED`）。
- `BEFORE DELETE / TRUNCATE` 一律拒（与 P1、127 同做法）。
- RLS：`enable row level security` + `for all to service_role`（必须带 `TO service_role`）+ `revoke all … from anon, authenticated`；**另对 service_role 收回 `trigger / references / truncate` 权限**（魏征实测：有直连能力的人能建一个排在守卫之后的触发器，把终态改回去）。

### 3.2 `triggered_sends` —— 发送状态账本

| 列 | 说明 |
|---|---|
| `id` uuid pk | |
| `client_id`、`trigger_key`、`channel`、`contact_id`（软引用，不加外键，审计行不因联系人被删而写不进，同 127）、`dedupe_scope` | **唯一键 `(client_id, trigger_key, channel, contact_id, dedupe_scope)`**。`dedupe_scope` 只有两种：`lifetime`（真发，欢迎信终身一次）和 `shadow`（影子，每人只算一次） |
| `status` | `shadow` / `blocked` / `skipped` / `pending` / `unknown_outcome` / `sent` / `delivery_delayed` / `delivered` / `suppressed` / `failed` / `bounced` / `complained`（§4.2） |
| `reason_code`、`last_block_reason` | `reason_code`：被拦/跳过/失败的代号（§5.2 清单）；`last_block_reason`：`pending` 行在接管时被某道关口拦住，**只记原因、不改状态** |
| `bounce_kind` | `permanent` / `transient` / `undetermined` / 空（来自回执） |
| `authorization_id` | 产生这一行的授权/提案（影子行指向提案，真发行指向生效授权） |
| `template_key`、`template_version`、`template_sha256`、`rendered_sha256` | 渲染后内容指纹（认领时写入，之后不可变） |
| `to_address_sha256` char(64) | 收件地址小写后的 SHA-256；**不存邮箱明文、不存正文**。用于「同一地址硬退信过就别再发」「同一地址终身只欢迎一次」 |
| `provider_account`、`provider_message_id`、`idempotency_key` | 发信账号标签、Resend 邮件 id、传给 Resend 的幂等键（**写一次不可变**） |
| `provider_impact` | `NONE` / `PROVIDER_ACCEPTED` / `PROVIDER_UNKNOWN`（回执字段，CLAUDE.md §3） |
| `consent_basis`、`source_ref` | 同意依据（读自触点元数据，`src/lib/crm/meta-lead.ts:337`）、线索来源记录号（追溯用，不含个人信息） |
| `annotations` jsonb | 影子对照用的批注（`would_send`、`sales_email`、`legacy_welcomed` 等布尔），**不含个人信息** |
| `local_day` date | 认领当天的客户本地日（由函数用 `now()` 与规则时区算，日上限按它数） |
| `claimed_at`、`first_attempt_at`（**不可变**）、`lease_expires_at`、`attempts` | 认领与租约；**20 小时规则锚在 `first_attempt_at`**，接管不会重置它 |
| `sent_at`、`last_event_type`、`last_event_at`、`created_at`、`updated_at` | `updated_at` 由触发器维护 |

**唯一性与触发器**
- 部分唯一索引（**终身同址只欢迎一次**）：`(client_id, trigger_key, channel, to_address_sha256)`，条件 `dedupe_scope='lifetime'` 且状态为「已经或可能发出过」（`pending / unknown_outcome / sent / delivery_delayed / delivered / suppressed / bounced / complained`）。→ 同一邮箱挂在两条联系人记录上也只会收到一封（`mail-send-new.ts:116-121` 注释写明这种双发风险）。
- `(provider_account, provider_message_id)` 在非空时唯一。
- **已认领状态的 CHECK（v2）**：`pending` 及之后的状态，`idempotency_key / first_attempt_at / to_address_sha256 / rendered_sha256 / template_key / template_version / template_sha256 / authorization_id / local_day / claimed_at / lease_expires_at` 共 11 列必须齐全（实测：地址指纹传空，两个联系人都认领成功，「终身同址只欢迎一次」就失效）。
- **认领标记（v2）**：真发行的 `pending` 只能由认领函数写入——函数先设事务级标记 `app.triggered_send_claim='on'`、写完立刻复位，INSERT 守卫与 UPDATE 守卫都查它（实测：不加这条，绕过函数直接插 pending 能突破日上限、伪造 `first_attempt_at` 使 20 小时规则失效）。
- **普通 `failed`（供应商确定拒收）/ `skipped` 会释放同址**：同址唯一索引的状态集合不含它们（确定没发出去的信不该占着地址）；`suppressed` 不释放。**例外：`failed` 且 `reason_code='not_sent_confirmed'`（人标的「没发出」）不释放**——它之后仍可能被迟到的真实回执覆盖，若地址已被同址的另一个联系人认领，迟到的送达 / 投诉回执会撞唯一索引、写不进账本（第二轮魏征复现）。唯一索引与认领函数的同址计数用同一个谓词。**`failed` 状态下 `reason_code` 只许写一次**（防止先改成 `not_sent_confirmed` 再借例外把状态往前推）。代价（有意接受）：被人标了「没发出」的那个地址，以后不会再被自动欢迎——要补发由销售手发；这比「地址放出来、迟到的回执写不进账本」安全。回归测试钉死；改状态集合前必须先看。
- 状态转移触发器：只许按 §4.2 的规则前进；`idempotency_key`、`first_attempt_at`、`claimed_at`、`authorization_id`、`provider_message_id`、`provider_account`、`to_address_sha256`、`rendered_sha256`、`template_*`、`consent_basis`、`source_ref`、`local_day` 认领之后一旦写入不可改（「从空写一次」）。
- `BEFORE DELETE / TRUNCATE` 拒；RLS 同上。

### 3.3 `triggered_send_claim(...)` —— 原子认领函数

入参：`p_authorization_id、p_contact_id、p_to_address_sha256、p_idempotency_key、p_template_key、p_template_version、p_template_sha256、p_rendered_sha256、p_source_ref、p_consent_basis、p_lease_minutes(缺省 10)`。**日上限、授权是否有效、客户本地日一律在函数里自己读/自己算，不信调用方传的值**。返回 `(outcome, send_id, row_status, row_idempotency_key)`。步骤（v2，按这个顺序）：

1. 断言 `current_setting('transaction_isolation') = 'read committed'`（魏征原型实测：REPEATABLE READ 下两个并发认领都会成功；PostgREST 默认就是 READ COMMITTED，断言防的是以后有人换隔离级别）。
2. **入参校验**：除 `p_source_ref / p_consent_basis` 外任何一个为空、或租约不在 1–30 分钟，直接 `raise`（`invalid_parameter_value`），不写任何行。
3. 读授权行取 `client_id / trigger_key / channel`（不存在 → `auth_inactive`），然后 `pg_advisory_xact_lock(hashtextextended(client_id || ':' || trigger_key, 0))`。
4. 找已有真发行（`FOR UPDATE`）。**先判 20 小时**：`pending` 且 `now() − first_attempt_at > 20 小时` → 置 `unknown_outcome`，返回 `expired_unknown`（**授权已撤销也照样转**；绝不再发）。
5. 在锁内重读授权行（`FOR SHARE`）：`revoked_at is null and activated_at is not null and expires_at > now()`，否则 `auth_inactive`。
6. **规则缺时区、或时区不是 `pg_timezone_names` 里的 IANA 名字 → `rule_invalid`**（不回落默认、不再靠报错；`'+13'`、`'UTC+13'` 这类 POSIX 写法正负号是反的，曾实测把本地日算错一天）；`local_day := (now() at time zone rule.timezone)::date`。
7. **模板指纹必须与授权绑定的一致**：`p_template_version / p_template_sha256` 与授权行不一致 → `template_mismatch`（D1「模板改一个字授权就作废」在库里多一层）。
8. 已有行：`pending` 且租约未过 → `in_flight`；租约已过 → 先比对：**授权 id 或渲染指纹与这次传入的不一致 → `in_flight`（不接管、不重发；行留在 `pending`，20 小时后转 `unknown_outcome` 由人核对）**，一致才 `takeover`（**沿用原幂等键、不重置 `first_attempt_at`，并把原幂等键回传**）；其余终态 → `exists_terminal`；`blocked` → 往下重新认领。
9. 同址已有「发出过」的行（别的联系人）→ `address_duplicate`；当天（`local_day`）已占日上限的真发行数 ≥ 授权行里的 `daily_cap` → `cap_reached`（不改数据）。
10. 设认领标记 → 认领（`blocked` 行重新认领时**清掉陈旧字段**：`reason_code / last_block_reason / bounce_kind / sent_at / last_event_*`）→ 复位标记 → 返回 `claimed`（带传入的幂等键）。**测试必须断言「返回 claimed 时行确实落库」**（魏征原型踩到的 plpgsql `FOUND` 被 `count` 覆盖的坑）。
- 函数 `security invoker`、`set search_path = public`，`revoke execute … from public, anon, authenticated`，只授权 service_role。
- **影子行不走这个函数**：影子是 `dedupe_scope='shadow'` 的普通插入（`on conflict do nothing`），**不抢锁、不数日上限、不升级成真发行**（§5.4）。

先例：`supabase/migrations/20261011000000_conversation_facts*.sql` 的 claim 函数。

## 4. 常设授权（D1）

### 4.1 判定函数（纯函数，fail-closed，顺序固定）

`judgeStandingAuthorization(auth, current)`，`current = { now, gateContractVersion, templateVersion, templateSha256 }`（模板两项由发送方**每次现算**，用 127 的 `getCurrentTemplate` + `checkTemplateSendable`——127 的「停用」是追加一个 `disabled` 新版本，所以「当前版」= 同 key 最大 `version`，若它不是 `active` 就是不可发，**不是**去找最近一个 active 的旧版，`src/lib/crm/email-templates/template-store.ts:246-261`）。顺序与原因（先例 `judgeAuthorization`）：

`REVOKED` → `NOT_AUTHORIZED`（只有提案）→ `NOT_ACTIVATED` → `EXPIRED`（`expires_at` 解析失败按已过期）→ `GATE_CHANGED` → `TEMPLATE_CHANGED` → 通过。

- 「撞日上限」**不是**授权失效，是 `cap_reached`（当天不再发，次日继续；出一张提醒）。
- 判为 `TEMPLATE_CHANGED` / `GATE_CHANGED` 时，发送方**自动撤销**这份授权（`revoked_by='system:<代号>'`）并出拍板卡；**算不出指纹/读不到模板**则只拦这一封（`reason_code=template_unreadable`），**不**撤销（瞬时故障不该让授权白白作废）。

### 4.2 状态机（v1 重写：两组、单调、无「升级」）

- **决定组**（真发行才有 `blocked/skipped`；影子行只有 `shadow/blocked/skipped` 且**从不离开**）：`blocked`（可重试的拦截）↔ `blocked`；`blocked → skipped`；`blocked → pending`（只经认领函数）。`skipped` 终态。**影子行和真发行靠 `dedupe_scope` 分开，彼此不转换**。
- **发送组**，用**状态等级**（越大越「终」），触发器规则：`新等级 > 旧等级` 才允许，同级重复写入是无操作：

| 等级 | 状态 | 说明 |
|---|---|---|
| 1 | `pending` | 已认领，供应商调用未完成 |
| 2 | `unknown_outcome` | 调用结果不明（超时/409/超过 20 小时）。**出口**：①按 `provider_message_id` 或（客户账号下）`to_address_sha256` + 时间窗对上回执，自动前进；②PM 在授权页标「已发出」（→ `sent`）或「没发出」（→ `failed`，`reason_code=not_sent_confirmed`） |
| 3 | `sent` | 供应商已受理（记 `provider_message_id`） |
| 4 | `delivery_delayed` | |
| 5 | `delivered` | |
| 6 | `suppressed`、`failed` | 供应商抑制 / 失败（同级之间不互转） |
| 7 | `bounced` | 硬/软退信（`bounce_kind` 区分） |
| 8 | `complained` | 投诉，最高 |

- **例外**：PM 标「没发出」（`failed` + `reason_code='not_sent_confirmed'`）之后，如果后来真有送达/退信/投诉回执（等级 ≥ `sent`），允许覆盖——否则 PM 误标会让真实回执被拒、信息丢失。
- **倒退与非法用不同的提示**：状态倒退报 `hint='status_regress'`（回执消费方可据此忽略过期回执），非法转移报 `hint='status_illegal'`（真 bug）。**写 `provider_message_id` 与推进状态要用「取等级较大者」的单条 UPDATE**（否则回执先把行推进到 `delivered` 后，发送方「`sent` + message id」合写会被整条拒掉、message id 丢失）。
- 因此**回执乱序最终收敛**：先 `delivered` 后 `bounced` 能前进，先 `bounced` 后 `delivered` 被拒（保持 `bounced`）。
- **`pending` 行遇到被拦的关口**（接管时撞到静默时段、锁忙等）：**只写 `last_block_reason`，状态不动**（修掉「pending → blocked 被触发器拒」的毒行）。D2 判定**不在接管时重判**（决定在认领时已经做了，接管只重验频次）。

### 4.3 写入口（PM 本人）、紧急刹车与自家闸线

- 命令：`propose`（agent/FDE 可提，只写提案；**P2-1b 就要有**，影子运行靠它）、`authorize`（**仅 PM 本人**）、`revoke`、`resolve_unknown`（PM 标未知结果）。路由 `POST /api/clients/[id]/triggered-send/...`，模式照 `src/app/api/clients/[id]/campaign-daily-plan/auto-publish/authorize/route.ts`：仅全局 admin、**默认预览**（返回将要写入的内容与指纹，不落库）、授权事件发出后才写 `activated_at`；取登录用户 id 的写法照该路由第 64、72、143 行（`requireApprovalActor` 只返回 `{ email, tier, role, allowedClientId }`，`src/lib/kernel-approval/http.ts:131`，没有 user id）。**必须有专测**：客户门户用户（哪怕付费 owner）调用一律被拒。
- `authorize` 必须带 `authorization_id + rule_sha256 + template_sha256 + live_from`，服务端用**当前**模板指纹复核，不一致就拒（PM 批的就是他看到的那一版）；批准时同时**校验 127 的频次设置**（`frequency_cap`，销售手发那条路的口径）不比铁规 2/7 宽，更宽或为空就在授权页**红字提示**（不阻断：销售那条路归 127 管）。
- **紧急刹车 = 数据库里一条撤销**：每封信发送前都**直查数据库**判定授权（认领函数里再复核一次），不读缓存、不读环境变量 → 撤销在**下一封**生效（已进入发送的那一封不拦，写明）。
- **环境变量只是「武装」不是刹车**（PM 记忆：Render 改变量不会自动重新部署、不是紧急刹车）：`TRIGGERED_SEND_LIVE === 'true'`（严格等于）+ `TRIGGERED_SEND_CLIENTS` 白名单，两者都满足才允许**真发**，缺任何一个 = 只演练。**抽成共享小工具**（`src/lib/platform/live-switch.ts`，新代码用它；现有两份拷贝 `src/lib/campaign/daily-plan-auto-publish-decide.ts:105`、`src/lib/story-lite/types.ts:120` 留待另开清理，不在本步改）。
- **自家闸线**（阈值写在规则快照 `health_breaker`，批准时 PM 看得到；v1 把总设计 §4.9 的「≥20 封、退信 >3%、投诉 >0.04%」改成不会因小样本误停的口径）：①**退信**：滚动 30 天内 ≥50 封，且硬退信 ≥3 个、硬退信率 >4%（Resend 自己的线）→ 自动撤销（`HEALTH_BREAKER`）；②**投诉**：30 天内 ≥2 次 → 自动撤销；**任何一次投诉**都出当日待办并把该联系人记「别再联系」；③连续 3 封被供应商拒收（`failed:provider_rejected`）→ 自动撤销（`PROVIDER_FAILURE`）。（魏征算过：按 CTS 旧欢迎信 2.5% 的退信率，用 20 封样本的 3% 线会有约 40% 的概率误停。）

## 5. 欢迎信（第一个触发）

### 5.1 触发与受众

- **扫描时刻读规则快照**（`schedule.local_time`，缺省 `08:01`；影子阶段为了拿到当天批次打的标签，提案可设成 `08:15`），另在静默时段内每 30 分钟补扫（只处理**可重试的拦截**与 `pending` 接管；**不重算已定格的影子行**）。同一函数、幂等。
- **候选**（全部条件）：该客户联系人里，`created_at` 的客户本地日 < 今天（= 第二天早上才发）；`created_at ≥ live_from`（真发）或 `≥ 提案时间`（影子）——**历史存量一个都不会被欢迎**；**`created_at` 距今 ≤ `audience.max_age_days`（缺省 3 天），更早的写 `skipped:stale`**（魏征 P0：首个真发日不会把影子期积压的旧线索补发）；来路在 `audience.sources`；有主邮箱；真发尚无终态账本行。
- 入口：**cron 函数只负责按客户分发事件**（每个启用客户一条 `crm.triggered_send.sweep_requested`），处理函数 `cloud-triggered-send-welcome-sweep`（id 须 `cloud-` 开头，`src/lib/inngest/functions/index.ts:52,119-125`）**按事件里的 `clientId` 单飞**（`concurrency: { limit: 1, key: 'event.data.clientId' }`，cron 与手动事件走同一把键）；手动事件试跑缺省 `dry_run=true`。数据库认领是最后防线。

### 5.2 发送关口（顺序固定；任一步读不到数据 = 不通过；每步结果都写账本）

**共用前半段（影子与真发都走；影子在 G 之后定格就停）**

| # | 关口 | 不通过时 | 复用 / 出处 |
|---|---|---|---|
| A | **武装 + 授权**：真发要 `TRIGGERED_SEND_LIVE` + 客户在白名单，且生效授权通过 `judgeStandingAuthorization`；只有提案 → 影子 | `not_armed/auth_*/template_changed/gate_changed`（影子不是错误） | §4 |
| B | **候选窗口**（§5.1）：本地日、`live_from`、`max_age_days` | `skipped:stale` | |
| C | **收件人**：邮箱格式；不是系统/自动地址；**若 `recipient_allowlist` 非空，只许清单内地址**；同一地址（`to_address_sha256`）没有硬退信记录 | `bad_email/system_address/not_in_allowlist/hard_bounced_address` | `src/lib/crm/identity.ts:83` 只验格式 |
| D | **别再联系 / 已退订 / Mailchimp 侧抑制 / 旧批次**：①`checkManualSendDncForContact`（异常=拦，`src/lib/crm/manual-send-dnc-gate.ts:77`）；②本表 `complained`；③**`email_unsubscribed` 触点**（§6.3，与 DNC 分开记）；④Mailchimp `findMemberByEmail`（`src/lib/mailchimp/tags.ts:80`，返回 `found{status,tags}` / `not_in_audience` / `error{retryable}`）：`status` 为 `unsubscribed/cleaned/archived` → 终态跳过 `mailchimp_suppressed`；标签以 `legacy.mailchimp_tag_prefix` 开头 → **真发模式终态跳过 `legacy_welcomed`**，**影子模式只做批注、不拦**（影子要拿来和批次对照）；`error` → 拦（`legacy_unverifiable`，按 `retryable` 重试）| `dnc/dnc_unverifiable/complained/email_unsubscribed/mailchimp_suppressed/legacy_welcomed/legacy_unverifiable` | §9-1 已核实：函数存在 |
| E | **同意依据**：联系人带 `meta_lead_form` 触点且 `metadata.consent_basis ∈ consent.accepted_bases`；**白名单内的内部地址免此项** | `no_consent_basis` | `src/lib/crm/meta-lead.ts:337,360`（代码里的依据是 CTS 的实际情形，所以放进每客户规则，不写死） |
| F | **销售邮箱可读**：`human_mail.required_mailboxes` 里任一邮箱的连接不是 `active`（`platform_oauth_connections`，`mail-send-new-prod.ts:89-97`）→ **整批拦**（读不到 ≠ 没人发过）| `mailbox_unreadable` | 提案时校验清单非空且都是 `active` |
| G | **（仅真发）静默时段**：收件人当地 08:00–20:00 之外不发 | `quiet_hours`（可重试） | `src/lib/crm/email-templates/time-zone.ts:13` |

**影子到此定格**：写一行 `dedupe_scope='shadow'` 的账本（`shadow` / `blocked` / `skipped`），带批注 `would_send`、`legacy_welcomed`、`sales_email`（用 J 的同一套证据、**不抢锁**）。**每人只写一次，之后不再重算**（魏征：不定格的话，当天稍后销售发的信会把影子行翻成「销售已发」，对照就失真）。

**真发后半段**

| # | 关口 | 不通过时 | 复用 / 出处 |
|---|---|---|---|
| H | **渲染**：127 渲染器渲染当前版模板（只许 `first_name`）；先渲染、再认领，**渲染失败不占日上限** | `render_failed/template_unreadable` | `src/lib/crm/email-templates/render.ts` |
| I | **抢两把锁**：联系人锁 `acquireContactLock` **和** 收件地址锁 `acquireRecipientLock`（都是 try-lock，不会死锁；`mail-send-new.ts:408-424`），**加锁到释放必须在同一个 `step.run` 里**（Inngest 步骤可能换进程重放，锁不能跨步骤）| `lock_busy`（可重试） | `src/lib/microsoft/mail-send-new-prod.ts:172` |
| J | **锁内**：用同一次取回的证据（`sources` 的 items，自 `min(线索创建, now−7天)` 起）判 **D2** 与**频次**：①存在**非自动**的人工出站邮件（S1 已发送箱——已过滤自动回复主题 / S2 审计行 / S3 非 automated 触点），**且排除 `me_send` 触点** → **终态跳过 `sales_email_exists`**；②频次口径只用快照值（缺省 **7 天 168 小时滚动 ≤2 封**，来源并集，读不到按已满）超 → `frequency_full`；任一来源失败/25 秒超时 → 拦 | `skipped:sales_email_exists/frequency_full/frequency_unverifiable` | `evaluateFrequency`（`src/lib/crm/email-templates/gates/frequency.ts:169`，纯函数，来源可注入，25 秒超时 :187） |
| K | **认领**：`triggered_send_claim`（日上限、地址唯一、租约、20 小时、授权复核全在函数里）→ `pending`；写**出站触点**（§6.4）| `cap_reached/in_flight/address_duplicate/auth_inactive/expired_unknown` | §3.3 |
| L | **发送 → 补记**：Resend（§6.1，15 秒超时）→ `sent` + `provider_message_id`；**确定被拒（4xx 非 409/429）→ `failed:provider_rejected` 并把触点标 `cancelled`（`counts_toward_frequency:false`，我们自己的触点行，可更新，`contact_touchpoints` 没有不可变触发器）**；超时/网络/5xx/429/409 → 保持 `pending`（同日补扫用**同一幂等键 + 定格输入**重放）| `provider_rejected/unknown_outcome` | §6.1 |
| M | **释放两把锁** | | |

- **可重试的拦截**（`quiet_hours/lock_busy/legacy_unverifiable/frequency_unverifiable/dnc_unverifiable/template_unreadable/mailbox_unreadable/render_failed`）：真发行保持 `blocked`，下一轮补扫重算；**终态**只有 `skipped:*` 与 `sent` 及之后。
- **读不到 ≠ 零**：任何一个来源失败/超时一律拦，**绝不当作「0 封」**。127 自己的关口在 `cap` 为空时会「不查频次」（`send-gates.ts:411-412`）——**我们的关口不继承这个读法**：口径永远取规则快照，永不为空。
- **已知坑 · S1 的覆盖**：S1 只读「活跃」邮箱（`mail-send-new-prod.ts:89-97`）——这就是 F 步要求清单内邮箱全部可读的原因；清单之外的邮箱（如 bdm@ 若仍在用）ME 看不见，见 §0 问题 1。

### 5.3 新线索第一天的两条路径（D2 的落点）

- **销售先发了**（打完电话当天的第 1 封）：J 步 → `skipped:sales_email_exists`，**ME 永不自动发欢迎信**；那封销售邮件按 SOP 算「第 1 次」。
- **销售没发**：第二天按规则时刻 ME 发欢迎信（算第 1 封）；之后销售再发一封算第 2 封，7 天额度用完，下一封要等满 168 小时——与 SOP v1 的前提一致（`docs/clients/cts/2026-10-28-followup-sop-v1.md` 第 29 行）。
- **销售在 ME 扫描之后**当天才发：不冲突（≤2 封），由销售那条路的频次关口数——这里依赖 §6.4 把 ME 的信计入。
- 已知边界：频次去重把「不同来源、同地址、≤120 秒、**任一主题为空**」的两条算同一封（`gates/frequency.ts:48-52`；魏征原型实测相隔 90 秒数成 1 封、3 分钟数成 2 封）。对策：ME 自动信触点在 S3 里**带非空主题标签**（§6.4），这样与 S1 的销售邮件不会被折成一封。

### 5.4 影子运行与对照（P2-1 的核心）

- 影子模式：扫描照常算每个候选，**定格**写 `dedupe_scope='shadow'` 的行；**不调 Resend、不抢锁、不写触点、不改联系人**。
- **对照对象**：当天批次实际发的人。逐人：对每个影子行读 Mailchimp 标签（`findMemberByEmail` 已在 D 步取到，存进批注 `legacy_welcomed`），**比较**：批次发了 ⇔ ME「本该发」或 ME 因 `sales_email_exists` 跳过；总数：批次实发数 vs ME 影子总数（批次实发数能否取到：P2-1b 先核 `listSentCampaigns`，§9-1）。差异必须能归到已知原因（批次的「邮箱重复就跳过」、官网订阅新人 ME 看不到、同址两条联系人），**归不上的差异 = 当天不算一致 + 出待办**。
- **出口**（沿用总设计 §4.11）：连续 5 个「有新线索」的日子一致，才允许进授权。对照结果**按需计算**（授权页与待办都调同一个只读函数，从库现算），**不另建表存历史**。读不到 Mailchimp：当天写「对照不可用」，**不算一致，也不算不一致**。
- 只读待办（拉模式，参考 `src/lib/pm-todo/auto-publish-items.ts`）：`triggered_send_shadow_mismatch`、`triggered_send_unarmed`（**看门狗：已授权、到点有候选却没有账本行**——**没有候选的日子不报警**，扫描函数每次运行写一条运行记录 `candidates=N`）、`triggered_send_unknown_outcome`、`triggered_send_blocked_stuck`（可重试拦截连续多天没解）、`triggered_send_receipts_missing`（`sent` 超过 30 分钟却没有任何回执 = 回执通道可能坏了，包括签名密钥配错）、`triggered_send_unmatched_events`（客户账号下对不上账本的回执）、`triggered_send_health`、`triggered_send_complaint`。

## 6. 发出（P2-2）

### 6.1 Resend 适配器

- `src/lib/messaging/adapters/resend-email.ts`（新，仓库里目前**没有**共用 Resend 适配器，各处直读 `RESEND_API_KEY`）：入参 `{ account, from, to, replyTo, subject, text, html?, headers, idempotencyKey, tags }`；用已装的 `resend@6.12.4` 的 `emails.send(payload, { idempotencyKey })`。
- **钥匙**：`RESEND_API_KEY_<账号标签大写>`（如 `RESEND_API_KEY_CTS`）。**先严格校验再构造客户端**：缺失/空/不以 `re_` 开头 → 拒发并返回 `no_account_key`，**空值绝不传进 `new Resend(...)`**——魏征实测：`resend@6.12.4` 在传入空值时会**自动改用系统账号的 `RESEND_API_KEY`**（`dist/index.mjs:1060`），独立账号的隔离就形同虚设。SDK 客户端**在调用内部初始化**（CLAUDE.md §7）。
- **超时**：SDK 没有请求超时（魏征实测：对不响应的服务器 15 秒后仍未返回）。适配器自己套 15 秒（`Promise.race`），超时一律归「结果不明」（请求可能已到达 Resend），**不当失败**。联系人锁 5 分钟（`mail-send-new-prod.ts:26`）不续期，所以整段「认领 → 发送 → 补记」必须远小于它。
- **结果分类**：2xx → `sent` + 记 `provider_message_id`；**确定被拒**（4xx，不含 409、429）→ `failed:provider_rejected`、不重试；**429 / 5xx / 超时 / 网络错误 / 409（`concurrent_idempotent_requests` 或 `invalid_idempotent_request`）→ 一律「结果不明」保持 `pending`**，24 小时内用**同一幂等键 + 定格输入**重放（定格输入 = 同一模板版本、同一渲染结果、同一退订令牌签发时间；重放前核对 `rendered_sha256` 不变，变了就**不发**、标 `unknown_outcome` 并出待办）；**超过 20 小时（认领函数里按 `first_attempt_at` 强制）仍无结果 → `unknown_outcome`，绝不另发一封**。（魏征：409 说明信可能已发；退订令牌含签发时间，重放载荷若变就必然触发 409，所以要定格。）
- 请求头：`List-Unsubscribe`（指向 §6.3 的签名令牌入口）+ `List-Unsubscribe-Post: List-Unsubscribe=One-Click`；正文末尾另有一行可见的退订说明。`Reply-To` 指向 CTS 现有邮箱（回信由现有邮箱同步进 ME，P2 不开 Resend 收信）。
- `tags`：带 `triggered_send_id`（待核：Resend 回执载荷是否回带 `tags`，§9-5；不依赖它也能对上，见 §6.5）。

### 6.2 模板与渲染（复用 127，第一版纯文字）

- 欢迎信模板 = 127 模板表里的一份模板，**用 127 的渲染器**与「是否可发」检查（`checkTemplateSendable`）。
- **第一版只许**：占位符只有 `first_name`、`fact_source='none'`、`pick_mode='none'`、不含价格/团名/日期。校验在「提案」时和「发送前每一封」各做一次；不符 = 不进授权 / 拦这一封。
- **现状差距（魏征核实）**：现在 8:01 批次那封（v2）是图文邮件，含团名价格，并有「没名字时的兜底称呼」；127 渲染器**没有缺名兜底语法**（`src/lib/crm/email-templates/placeholders.ts:17`），也只发纯文字。所以第一版**不照搬 v2**，内容由 CTS / 126 写、PM 确认（PM 11-02 已回「可以」，决定 D4）；要图文版 + 团价 + 兜底称呼，需另做「图文渲染 + 每日事实对账」，放第二版。
- **模板内容谁写 / 谁录**：我不会自己往生产库写模板；由你们（或我起草、你们确认）把正文放进 ME 的模板管理。**对外内容先 grounding CTS 官网**（CLAUDE.md §8）。

### 6.3 联系人级一键退订入口（新公共入口，A 级）

- 现有 `src/app/api/unsubscribe/[id]/route.ts` 的 `[id]` 是 `outbound_prospects`，只改那张表、页面回显商家名——**不能复用**。
- 新入口 `GET/POST /api/u/[token]`：令牌 = `base64url(payload{ v, contactId, clientId, channel, issuedAt })` + `.` + `HMAC-SHA256(secret)`（`UNSUBSCRIBE_SIGNING_SECRET`，新环境变量，**只能 PM 本人填**；支持 `UNSUBSCRIBE_SIGNING_SECRET_PREV` 以便轮换）；常量时间比较；**不回显任何名字或邮箱**；**令牌不设过期**（几个月前的邮件里的退订链接必须还能用，这是业界做法，风险写明：令牌被转发 = 收到的人可以替原收件人退订）。POST 一键、免登录、幂等；**GET 只显示确认页、不执行**（防邮件扫描器预取）。
- **效果（v1 改）**：写一条 **`email_unsubscribed`** 触点（`source='me_unsubscribe'`，`channel='email'`，`source_ref = contactId`——唯一键保证幂等），**不写「别再联系」**。理由（子牙）：`dnc_cleared` 能解开别再联系（`src/lib/crm/dnc.ts:105-117`），而且「别再联系」会让人从销售名单里消失（`segments.ts:376`）；客人退订邮件不等于不能打电话。**系统绝不自动恢复订阅**（恢复必须客人重新同意）。
- **谁认它**：①我们的发送关口 D 步；②**销售手发邮件的关口也要加一道独立的「已退订邮件」检查**（127 的 `send-gates.ts` 链上加一步，不并进 `checkManualSendDncForContact`）——这是对 127 代码的第二处改动（§11）。
- 限长读体、限速、日志只记代号不记令牌。

### 6.4 频次关口怎样「看见」ME 自动发的信（对 127 代码的最小改动）

- 现状：127 的频次关口四个来源（已发送箱 S1、审计行 S2、**出站邮件触点 S3**、Mailchimp S4）数不到 Resend 发的信；S3 还会过滤掉 `metadata.automated === true` 的触点（`src/lib/crm/email-templates/frequency-sources-prod.ts:107`）。
- 做法：ME **认领成功时**（不是发出后）写一条出站触点（`source='me_send'`，`channel='email'`，`direction='outbound'`，`source_ref = triggered_sends.id`，`metadata = { automated: true, transport: 'resend', counts_toward_frequency: true, subject_label: 'me_send:welcome', triggered_send_id }`）——**这样「结果不明 / 还在 pending」的信也被销售那条路数到**（魏征：发出后才写会漏）；确定被拒时把它改成 `cancelled`（`counts_toward_frequency:false`）。S3 的过滤改成「`automated !== true` **或** `counts_toward_frequency === true`」，并让 `counts_toward_frequency` 的项带**非空主题**（`subject_label`），避免被 120 秒折叠规则折掉（§5.3）。
  - `automated:true` 保留 → 「最后人工联系」等逻辑仍把它当机器信（`src/lib/crm/automated-touch.ts:29` 的 `AUTOMATED_SOURCES` 加 `me_send`）；
  - 改动方向只会**多数**、不会少数（更严）；影响面：`frequency-sources-prod.ts` 一处过滤与映射 + `automated-touch.ts` 一行 + 对应测试（`gate-frequency.test.ts`、`frequency-sources-prod.test.ts`、`automated-touch.test.ts`）。**实现前必须 grep `isAutomatedTouch`、`touchpointSource` 的全部调用方**，确认没有消费者被误伤。
  - 触点唯一键 `(client_id, source, source_ref)` 保证重放不重复写。
- **每封信只写一条出站触点**；送达/退信/投诉只更新 `triggered_sends`，不写触点（否则一封被数成好几封，总设计 §4.4 同）。
- 已知残余：认领之后、触点写入之前崩溃的极短窗口，销售侧数不到；补扫 30 分钟内收口，且发送在联系人锁内。
- **这是别的窗口（127 / 76）的文件**：改动单正文要逐条写清并通知；只加严、不改它们的行为契约。

### 6.5 回执消费（P1 路由补事件）

- P1 的接收口现在**不发 Inngest 事件**（P1 设计稿 §3.7「暂时不上」条款）。P2-2 在 `handleResendWebhook` 入库成功**或遇重复**之后，**仅当账号是客户账号（非 `system`）**才发 `crm.provider_event.received`（事件 id = `provider_event_id`，Inngest 24 小时内按 id 去重；魏征：`system` 账号的事件会白白退避 5 次）；发事件失败 → 路由回 500，让 Resend 重试（重试到达时入库得 `duplicate`，**仍补发事件**，P1 设计稿 §3.7 已要求）。**部署次序**：先上线消费函数、再让路由开始发事件（反了会有事件无人接）。
- 事件载荷只放 `{ provider, account, providerEventId }`（**不放邮箱、不放正文**）；消费函数按它回读 `provider_webhook_events` 行。
- 消费函数 `cloud-triggered-send-provider-event`：按 `provider_message_id`（或 `tags.triggered_send_id`）找 `triggered_sends` 行；找不到 → 先**退避重试**（回执可能比「补记 message id」到得早，≤5 次共约 10 分钟）；仍找不到 → **改用 `sha256(小写 data.to[0])` + 近 2 天窗口兜底配对**（投诉要靠它：投诉不能丢）；再找不到 = 不是我们发的 → **不丢**，由待办 `triggered_send_unmatched_events`（拉模式：客户账号下对不上账本的回执）兜住。找到 → **只按状态等级单调前进**（§4.2）。
- **硬退信**：行置 `bounced` + `bounce_kind`（`permanent` 等，字段结构待核 §9-5）+ 地址指纹进「硬退信」集合（C 步用）+ 当日待办；**投诉** → `complained` + 写「别再联系」触点 + 当日待办 + 触发 §4.3 的闸线评估；`suppressed` → 记状态，不重发。
- **每日对账**（P1 §3.6 指望 P2 兜底）：每天一次，`sent` 超过 30 分钟却没有任何回执 → 待办 `triggered_send_receipts_missing`；Resend 侧发信数 vs 账本行数的对账：Resend 是否提供按账号列发信记录的接口，P2-2b 先核（§9-6），核不到就只做账本一侧的检查并如实写明。

### 6.6 受控试跑（把「没有收件人白名单」补上）

- 第一份授权的规则快照带 `recipient_allowlist = [内部地址]`：**只许发给清单内地址**，受众来路临时放宽到 `crm_manual`、清单内地址免来路/同意依据检查（它们是内部邮箱，没有被打扰的人）。
- 试跑联系人 = **你们在 CRM 里手建的一个内部测试联系人**（邮箱 hello@，来路 `crm_manual`，正常 CRM 操作；**不是往生产里伪造一条 Facebook 表单线索**——那会造假同意依据，违反 CLAUDE.md §8）。
- 试跑通过 → 你再点一次授权（新提案：去掉白名单、`sources` 回到 `meta_lead_form`、写 `live_from`），旧试跑授权随之作废（`SUPERSEDED`）。

### 6.7 账号与域名（人的事，P2-2 前）

- 独立 Resend 账号、CTS 发信域名的解析记录（SPF 只能一条要合并，不能覆盖——否则现在的发信会坏）、Resend 后台建回调并取签名密钥填 Render：见 §10 的「要人动手」。P1 的 `RESEND_ACCOUNTS` 白名单与 `RESEND_WEBHOOK_SECRET_<账号>` 约定同样适用于新账号；P2-2 要把 `cts` 加进白名单。

## 7. 保留期清理（P2-2b 一并做，真发前必须到位）

P1 设计稿 §3.8 与台账卡 `2026-11-01-provider-webhook-events-retention-job` 写明：**第二阶段发信前**要做保留期清理——一旦真发，`provider_webhook_events` 里就会有客人邮箱。方案（实现设计另出）：180 天保留；因表有「只增不改不删」触发器，清理走一个**所有者权限的专用函数**（函数内显式放行本次删除，不开放给 service_role 的普通路径），并有运行记录；P2-2c 点「授权」之前这条必须已上线。

## 8. Inngest 事件与回执（CLAUDE.md §3）

| 阶段 | 事件 / 函数 | 机器可读回执（落在哪） |
|---|---|---|
| 分发 | cron → 每客户一条 `crm.triggered_send.sweep_requested`（手动试跑同事件） | 运行记录（`startCronRun`，须登记，见下） |
| 扫描 | `cloud-triggered-send-welcome-sweep`（按 `clientId` 单飞） | 每个候选一行 `triggered_sends`：request id（`idempotency_key`）、client id、contact id、**`source_ref`（线索来源记录号）**、status、reason_code、authorization_id、template 指纹、**`provider_impact`**、`shadow` 标记（`dedupe_scope`）、created_at；运行记录 `candidates=N` |
| 发送 | 同一函数内逐联系人 `step.run`（加锁到释放同一步内） | `pending → sent` 的行 + 触点 `me_send` |
| 回执 | `crm.provider_event.received` → `cloud-triggered-send-provider-event` | 行的 `last_event_*` 与状态；原始事件在 `provider_webhook_events`（P1） |
| 授权 | 授权写入成功 → `crm.triggered_send.authorization_changed` | `triggered_send_authorizations.activated_at`（事件发出后才写） |

- 事件名业务可读（沿用 127 的 `crm.<对象>.<动词>`，如 `crm.email_send.attempted`）；事件只当「叫醒铃」，不含邮箱（先例 `src/lib/inngest/crm-email-events.ts`）。
- **登记**：函数若调用 `startCronRun`，须登记进 `CRON_REGISTRY`（`src/lib/cron/registry.ts:106`，`scheduler:'inngest'`，周期用导出常量）；只由事件触发的登记 `UNSCHEDULED_CRON_ROUTES`（:470）。改 `src/lib/cron/` 与 webhooks 机器判 A（`tools/ops-review-loop/src/risk.mjs:178,194`）。

## 9. 稿子与代码不一致 / 未核实

**与总设计（v0.4）不一致（已按代码为准，写进本稿）**：#3349 已合并（`c0ef6bcd2`），`evaluateFrequency` 在 `src/lib/crm/email-templates/gates/frequency.ts:169`；`acquireContactLock` 是 `MailNewStore` 的方法（另有 `acquireRecipientLock`）；`AUTOMATED_SOURCES` 未导出（`src/lib/crm/automated-touch.ts:29`）；F1 不是纯硬编码模板且不管邮件渠道（`src/lib/inngest/functions/conversation-inbound-autoack.ts:248`）；P1 实际只建一张表，状态表推迟到本步；**Mailchimp 按邮箱读标签/状态的函数已存在**（`src/lib/mailchimp/tags.ts:80` `findMemberByEmail`，总设计 §9 旧写法「仓库里没有」不对）；**`contact_touchpoints` 没有不可变触发器**（`supabase/migrations/20260726000005_contact_touchpoints.sql`，「不可变」只是约定），所以我们自己写的 `me_send` 触点行可以更新。

**未核实（开工前/试跑时逐条核，不拿它们当前提）**
1. 批次实发数能否取到（`listSentCampaigns` 是否给出 `emails_sent`）：逐人对照已能做（`findMemberByEmail` 读 `auto_e1_batch_*` 标签）；仓库里**没有**批次脚本代码（在 PM 的 Google 账号里）。取不到总数则只做逐人对照，并如实写进对照结果。
2. CTS 当前的 `frequency_cap` 设置值（`src/lib/crm/email-templates/settings.ts:182`）——生产只读核；本稿只在授权页提示，不依赖它。
3. 全局 admin 与「付费客户 owner」的区分：照 `auto-publish/authorize/route.ts` 的写法，实现一轮用专测钉死。
4. 127 的模板管理里，自动发送用的模板是否会混进销售的选择列表（需要 `template_key` 约定前缀或排除名单）：与 127 对齐（§11）。
5. Resend 回执载荷的 `tags`、`bounce` 字段（P1 存下的两条真实事件的 `data` 键是 `created_at,email_id,from,headers,message_id,to`，没有 `tags`——那封信没带 tag）：P2-2 试跑带 tag 发一封到 hello@，看存下来的载荷。
6. Resend 独立账号的档位、域名数、回调个数上限、是否提供「按账号列发信记录」的接口（对账用）；CTS 域名解析归谁管。
7. 频次关口的 S1（Graph 已发送箱）每个联系人各翻一遍（有 7 天窗口、最多 30 页，`gates/sent-items.ts:34,98`）：CTS 量级预计无碍，若扫描变慢再做「同一次扫描内共用一次翻页」。
8. ✅ **CTS 邮箱现状（已核实并已答）**：ME 里 `microsoft_mail` 连接 1 个 `active`（info@）、1 个 `revoked`（bdm@）（生产只读，2026-11-02）；**PM 11-02 回「只用info」**——销售只用 info@，所以必须可读邮箱清单 = `[info@]`，bdm@ 忽略。

## 10. 改动单拆分、顺序与要人动手的事

| 批 | 内容 | 风险级 | PM 要做 |
|---|---|---|---|
| P2-1a | 迁移（两张表 + 触发器 + 认领函数）+ 迁移结构测试 + 本机重放与行为试跑 + **把新代码加进合并闸高风险名单**（`tools/ops-review-loop/src/risk.mjs`：`src/lib/messaging/`、`src/app/api/u/`、授权路由、`frequency-sources-prod.ts`；魏征实测：不加的话这些全判 B 自动合并，连 P1 的 `resend-signature.ts` 改成直接放行也判 B）| A（碰迁移 + 合并规则） | **「go apply」**我才应用到生产库；**亲手合并**（机器不会替你合） |
| P2-1b | 共享库（授权判定/关口/状态机/欢迎信定义）+ `propose` 路由 + 扫描函数（**只影子**）+ 对照 + 待办 + 共享开关小工具 | A | 无。**必须等 P2-1a 的迁移已应用到生产库才能合**（代码引用新表） |
| P2-2a | Resend 适配器 + 触点写入 + 频次的最小改动（§6.4）+ 销售手发关口的「已退订邮件」检查 | A | ①独立 Resend 账号 + 钥匙 ②CTS 域名解析 |
| P2-2b | 回执消费 + 路由补事件（**先消费、后发事件**）+ 一键退订入口 + 每日对账 + **保留期清理** | A | 填 `UNSUBSCRIBE_SIGNING_SECRET`、新账号回调密钥（只能你本人） |
| P2-2c | 授权写入口 + 授权页（「标没发出」按钮旁必须写明后果：该地址以后不再自动收到欢迎信，补发由销售手发）+ 武装开关 + 受控试跑（§6.6） | A | 在 CRM 手建内部测试联系人；看影子对照 → 点「授权」（先试跑版、再正式版）→ 填 `TRIGGERED_SEND_LIVE` / `TRIGGERED_SEND_CLIENTS` 并手动部署 |
| P2-3 | 切换（人做）+ 7 天验证 | — | 改表格脚本触发器；7 天后看「没有人收到 2 封」 |

- P2-1a 的 DB 行为试跑脚本入库（`scripts/db-behavior/triggered-send-ledger.sh` + 环境桩），不进 CI（CI 只重放迁移与安全不变量），留作以后改表/函数时的回归与审查员复用。
- 每批：先本机验证（含 DB 行为、真 PostgREST 端到端、变异探针），**实现审各一轮（子牙+魏征）**，再开改动单；推送攒到批末一次；每批 PR 正文写「## 当场试跑」。
- **当场试跑**：P2-1b 的扫描函数在生产**手动触发一次影子**（不外发）；P2-2c 的试跑**只发白名单内的 hello@**（§6.6）。
- 回滚：撤销授权（一条记录）即停；表与函数留着无害；不复活旧批次（总设计 §4.11-5）。

## 11. 对其他窗口的影响与待对齐

| 窗口 | 影响 | 动作 |
|---|---|---|
| 127 / 76（CRM 通话后选模板发邮件） | 改它们的文件各一小处：①S3 过滤与映射 + `AUTOMATED_SOURCES`（§6.4）②销售手发关口加「已退订邮件」检查（§6.3）；模板表被只读复用；模板管理里可能混进自动信模板（§9-4）| 改动单逐条写清、通知；**不改它们的契约，只加严** |
| 126（newsletter 与欢迎信） | 欢迎信由它定内容/批次停用；授权形状与它手册 WP5 的「逐封授权」不同（本步是条件组 + 日上限 + 有效期，PM 11-02 已亲口定）；手册 NL-14 写「不设自动执行路径」，与本步的「常设授权」需要它显式记一笔例外 | 通知；请它在手册里记「本形状是 WP5 的一组条件特例」 |
| 129（CRM 跟进 SOP） | D2 把「销售发了就不自动发」做成关口 | 通知 |
| 前提 | 批次脚本停用由 PM 本人操作；126 手册里「欢迎信由它定」| 不动 |

## 12. 层级判定（Inline · 沿用总设计 §1 Full 判定）

- **共享（平台基础设施，不新增能力线）**：发送关口 + 授权判定 + 发送状态账本（治理/验证类机制）；`provider_webhook_events` 之上的回执消费。
- **L3 Connector**：Resend 发信适配器（provider-specific 逻辑留在适配器内，可换供应商）。
- **L4 客户配置**：CTS 的来路白名单、同意依据白名单、旧批次标签前缀、销售邮箱清单、发送时刻、From/Reply-To、模板内容、`max_age_days`——**全部是授权规则快照里的数据**，不写进共享代码；换成 NAL 或地产客户，共享代码一行不用改（换客户测试通过；子牙核实：之前稿子里「同意依据」「旧标签」曾隐含 CTS 语义，v1 已搬进规则）。
- **换行业测试**：欢迎信是「新线索第二天」触发，旅游/地产/物流都成立；行业差异只在模板与规则快照。

## 13. 威胁模型、并发与失败模型、接口契约（A 级必答）

**威胁与对策**
- 伪造授权：写入口只有 PM 本人（登录身份 + 全局 admin + 专测）；**数据库触发器使批准后的内容不可改，且 INSERT 不许预填生命周期列**；RLS 仅 service_role；没有公开写路径。
- 伪造回执：P1 已验签（`src/lib/messaging/provider-events/`）；消费者只读自己库里的行。
- 滥发：受众由快照里的 `sources + max_age_days + live_from` 限定，**日上限与授权有效性在数据库认领函数里原子强制**（≤50），不靠代码自觉；`recipient_allowlist` 限制试跑；撤销即停；关口逻辑改动（`gate_contract_version`）使授权作废。
- 供应商钥匙混用：分账号钥匙严格校验，空值不进 SDK 构造函数（SDK 会回落系统钥匙）。
- 退订入口滥用：签名令牌、常量时间比较、不回显个人信息、幂等；令牌被转发的风险与业界一致，写明；密钥可轮换。
- 数据最小化：账本不存邮箱/正文，只存哈希与代号；日志只记代号。
- 密钥：`RESEND_API_KEY_<账号>`、`UNSUBSCRIBE_SIGNING_SECRET`、回调密钥只在环境变量，不进聊天/仓库/日志。

**并发与失败**
- 两次扫描重叠：Inngest 按客户单飞 + 数据库认领（去重键唯一 + 咨询锁 + 地址唯一）→ 同一联系人/地址至多一次认领。
- 销售与自动同时发：共用联系人锁 + 收件地址锁；锁过期 5 分钟远大于一次调用时长（我们给供应商调用设 15 秒上限）；极端重叠最多多发 1 封（已知、量极小），最后防线是频次与日上限。
- 认领后崩溃 / 供应商超时：`pending` 保留，**补扫用同一幂等键 + 定格输入**重放（同一天内）；`first_attempt_at` 不可变，> 20 小时 → `unknown_outcome`，**绝不重发**；409 一律当结果不明。
- 回执乱序/早到：状态等级单调 + 退避重试 + 地址指纹兜底配对 + 待办兜底。
- 授权在扫描中途被撤销：下一封起生效；本次扫描里先撤销再继续者，后续全 `auth_revoked`。
- 供应商整体故障：连续 3 封被拒 → 自动撤销并出待办。
- 时区与夏令时：客户本地日由函数用 `now()` 与规则时区算；cron 带 `TZ=Pacific/Auckland`。
- 认领函数的隔离级别假设（READ COMMITTED）由函数开头断言兜住。

**接口契约（实现一轮前冻结）**
- `judgeStandingAuthorization(auth, current): { active: true } | { active: false; reason }`（纯函数）。
- `GatePorts`（依赖注入）：`loadAuthorization / currentTemplate / loadContact / dnc / unsubscribed / mailchimpMember / consent / mailboxes / humanMailEvidence / frequency / acquireLocks / claim / render / send / writeTouchpoint / now`。`runGate(ports, candidate, mode)` 返回 `{ status, reasonCode, annotations }`，**不抛业务异常**（读不到一律返回不通过）。
- `ResendEmailPort.send(...) → { kind: 'sent', messageId } | { kind: 'rejected', code } | { kind: 'unknown' }`。
- `triggered_send_claim(...) → { outcome, send_id, status }`（§3.3）。
- 回执消费：`applyProviderEvent(row, event) → 新状态 | 'ignore' | 'retry'`。

**写入方须遵守的契约（审查发现库里管不了、只能由 P2-1b / P2-2 的代码与专测钉住）**
- **联系人属于授权客户**：认领前由发送关口断言联系人确属授权所属客户（联系人是软引用，库里查不了）；专测：授权属 C1、传 C2 的联系人必须在关口被拦。
- **授权路由的时间用数据库时间**：同一请求里先取库的 `now()`，`live_from = now() − 5 秒`、`expires_at = min(请求值, now() + 90 天 − 5 秒)`；应用时钟比库快 1 秒就会撞 CHECK（授权失败）。
- **提案路由校验时区**：`rule.schedule.timezone` 必须是 IANA 名字，**区分大小写**（`pacific/auckland` 会被认领函数拒绝），校验名单必须与库里 `pg_timezone_names` 同源；认领函数在库里再拒一次（`rule_invalid`）。
- **渲染必须对同一联系人确定**（只用定格输入，不读当前时间 / 可变事实）：租约过期后重渲染的指纹变了，认领函数不会接管（返回 `in_flight`，20 小时后转 `unknown_outcome`）。
- **标 `sent` 时不要清 `lease_expires_at`**：已认领状态的 CHECK 要求它非空。
- **「取等级较大者」的单条 UPDATE**：PostgREST 写不出这种带比较的更新。P2-2b 的回执消费者走一个库函数（新迁移），或拆成两条并接受「message id 写入因回执先到而被拒 → 重读重试」；在 P2-2b 的设计里钉死，P2-1a 不做。
- **每日对账任务（P2-2b）把超过 20 小时的 `pending` 转成 `unknown_outcome`**，不依赖授权是否仍有效，也不依赖应用还会不会调认领函数（授权撤销后发送方在关口 A 就停了，不会再来认领）。
- **加锁顺序**：advisory lock → 账本行 → 授权行；以后在同一事务里同时改两张表的函数必须按此顺序。
- **写 `failed` 必须在同一条 UPDATE 里带 `reason_code`**：库里不许事后补写（`failed` 下原因不许改）；先改状态、后改原因，原因会冻成 `expired_20h`（或空）、地址被放出，且改不回；先写一个没有原因的 `failed` 同样用不上迟到回执的例外。专测钉住（P2-2b）。
- **`not_sent_confirmed` 只许在 `unknown_outcome → failed` 那一步写**；回执消费者**不得**把 `delivered` 及以上的行转成 `failed`。库里目前只靠状态等级单调挡，没有专门禁止「在非 failed 行先写 `reason_code='not_sent_confirmed'` 再转 failed 借例外退回 sent」这种有意构造的顺序（魏征第三轮实测，写入方是自家受信代码，列为 P2）；P2-2b 的专测钉住「消费者不会走这条路」，必要时再补库内约束。

## 14. 验证计划

**本机（每批改动单前必须做完并留证）**
1. 仓库自带的迁移全量重放 + 安全不变量（`scripts/db-replay-and-verify.sh`、`scripts/db-invariants.sql`、`node scripts/check-policy-to-clause.mjs`）。
2. **真数据库行为试跑**（沿用 P1 的本机 Postgres + 默认授权桩，做法见记忆 `reference-local-postgrest-e2e-trial-recipe-2026-11-01`；魏征已有原型在 scratchpad `p2-review-weizheng/`，可直接参考）：认领函数每种返回；**两个连接并发认领同一联系人/同一地址只有一个成功；日上限在并发下不被突破；READ COMMITTED 断言生效**；`INSERT` 预填生命周期列被拒；绑定列（含以后新加的列）不可变；生命周期列只能从空写一次；已撤销的不能再批准；状态等级回退被拒；`pending` 被拦只写 `last_block_reason`；`first_attempt_at` 不可变；DELETE/TRUNCATE 被拒；anon/authenticated 读写被拒；各 CHECK。再加 SQL 变异（删触发器、删 REVOKE、认领函数不加锁、不复核授权）对应用例必须变红。**每个返回 `claimed` 的用例都断言行确实落库。**
3. **真 PostgREST + 真 supabase-js 端到端**：用**真的存储层代码**走一遍：影子 → 授权 → 真发模式（Resend 换成假端口）→ 回执 → 状态收敛；并发与重放。
4. **单元/路由测试**：授权判定每个原因 + 顺序；关口每一步的「读不到=拦」；`unknown_outcome` 永不重发；LIVE 严格等于 `'true'`；分账号钥匙缺失不回落系统钥匙；适配器 15 秒超时归「不明」；退订令牌（篡改/重放/常量时间/GET 不执行）；回执乱序收敛；时间窗/日上限边界用**真实时钟**，不拨假时钟（PM 记忆：假时钟会让删掉核心逻辑的测试照样绿）。
5. **变异探针**（A 级关键判据，冻结 head 上一次）：判定忽略撤销/过期/模板指纹/关口版本；日上限差一；去重键/地址唯一；销售邮件跳过失效（含「`me_send` 被当成销售信」）；频次读不到当 0；LIVE 松成真值；`unknown_outcome` 重发；绑定列可改；退订令牌不验签；回执回退状态；S3 过滤改法（`counts_toward_frequency`）；每个必须被**断言失败**杀死（区分「断言失败」与「崩溃」）。
6. `tsc --noEmit`（`NODE_OPTIONS=--max-old-space-size=10240`，核对退出码与非 `.next` 错误数）对比基线；改动文件 eslint；`npm run build`（CI 同款三个占位变量）。

**当场试跑（CLAUDE.md §5）**：见 §10。P2-1b：生产手动触发一次影子扫描，记录处理几条、写了哪些行、对照结果；P2-2c：向白名单内 hello@ 发内部测试信，核对 Resend 页事件数 = 账本行数 = 触点数，再点两次 Replay 看仍是一行。**没跑通不说「做好了」。**

## 15. Reuse Statement（预填，交付时对账）

- **复用**：`evaluateFrequency` 与三个来源、`checkManualSendDncForContact`、`createMailNewStore()` 的联系人锁与收件地址锁、127 的模板表与渲染器与指纹与 `checkTemplateSendable`、`contact_touchpoints`（含唯一键）、`crm/dnc.ts` 的判据、`findMemberByEmail`、P1 的 `provider_webhook_events` 与验签接收口、`requireApprovalActor` 与 `auto-publish/authorize/route.ts` 的写法、`daily_plan_auto_publish_*` 的授权/尝试表形状与 `judgeAuthorization` 做法、`auto-publish-items.ts` 的拉模式待办、`resend@6.12.4`、仓库脚本 `db-replay-and-verify.sh`。
- **新增 platform-shared**：两张表 + 认领函数；`src/lib/messaging/triggered-send/`（授权判定、关口、状态机、影子对照）；`src/lib/platform/live-switch.ts`（共享开关小工具）；Resend 发信适配器；联系人级退订入口。
- **industry-specific**：无。**client-specific**：无——CTS 的来路、同意依据、旧标签、邮箱清单、时刻、From、模板、`max_age_days` 全在授权规则快照数据里；共享代码里没有客户名/客户 ID/行业判断。
- **换客户测试**：CTS → NAL → 悉尼地产客户，共享代码不用改（只换规则快照与模板）。
- **学习**：无；退信/投诉信号怎么用是后续的事。
- **落点与 tier-gate 决策时是否一致**：一致（总设计 §1：平台基础设施 + L3 适配器 + L4 配置）。

## 16. 审查记录（设计一轮：子牙、魏征；2026-11-02；两位都判「需改后再审」）

两位独立只读；魏征另在本机一次性 Postgres 17 里原型验证了认领函数（并发、隔离级别、预填绕过、毒行）、用仓库真代码跑了 `evaluateFrequency` 折叠、实测了 `resend@6.12.4` 的钥匙回落与无超时、跑了 `risk.mjs`。以下是发现与处理（Z = 子牙，W = 魏征）：

| # | 级别 | 发现（谁） | 处理 |
|---|---|---|---|
| 1 | P0 | 状态流转图与状态等级矛盾；`unknown_outcome` 无等级无出口；幂等键/消息号没规定只写一次（Z1、W5、W7） | **采纳**：§4.2 重写为「决定组 / 发送组 + 单调等级」，`unknown_outcome` 定等级 2 与出口，写一次列由触发器强制（§3.2） |
| 2 | P0 | 首个真发日会把影子期积压的旧线索补发；`created_after` 写在提案还是授权矛盾；影子行「升级成 pending」；没有最长时限（W1、Z5） | **采纳**：`live_from` 批准时写（生命周期列）；`max_age_days` + `skipped:stale`；影子与真发用 `dedupe_scope` 分开、**永不升级**；旧标签读不到时真发拦（§5.1、§3.1、§3.3） |
| 3 | P1 | 认领函数的日上限/授权由调用方传；不复核授权；INSERT 可预填「已批准+已武装」（Z2、W4） | **采纳**：函数里读授权行、复核有效性、自己算本地日与日上限；`BEFORE INSERT` 触发器禁预填；READ COMMITTED 断言（§3.1、§3.3） |
| 4 | P1 | D2 判定在锁外；S3 改法会把 `me_send` 当销售信；接管 `pending` 行判「销售已发」成毒行；S1 只读 active 邮箱（Z3、W2） | **采纳**：D2 与频次在锁内用同一次证据判；排除 `me_send`；接管不重判 D2、`pending` 被拦只写 `last_block_reason`；`required_mailboxes` 非 active 整批拦；§0 问题 1（销售用哪些邮箱） |
| 5 | P1 | 只拿联系人锁、只按联系人去重（W3） | **采纳**：加收件地址锁；`to_address_sha256` 终身唯一（部分唯一索引） |
| 6 | P1 | 防重发：20 小时锚点没定；409 被归为拒收；退订令牌签发时间使重放载荷必变；pending/unknown 不写触点（W5） | **采纳**：`first_attempt_at` 不可变并由函数强制；409 归结果不明；重放用定格输入并核对 `rendered_sha256`；认领时就写触点（确定被拒再标 `cancelled`） |
| 7 | P1 | SDK 无超时；空钥匙回落系统钥匙（W6） | **采纳**：适配器 15 秒超时；先校验分账号钥匙、空值不进构造函数（§6.1） |
| 8 | P1 | 回执：乱序丢退信；没有 `bounce_kind`；缺每日对账；找不到行重试后永久丢弃，投诉也丢；`system` 账号事件白退避（Z8、W7） | **采纳**：只按等级单调；加 `bounce_kind`；每日对账与「回执缺失」待办；地址指纹兜底配对 + 对不上由待办兜住；只对客户账号发事件（§6.5） |
| 9 | P1 | 合并闸看不住新代码（W8、Z9） | **采纳**：P2-1a 把新代码路径加进高风险名单；规则快照加 `gate_contract_version`，关口一改授权作废；授权写入口取用户 id 照先例（§10、§3.1、§4.3） |
| 10 | P1 | 影子模式有副作用且对照失真（W9） | **采纳**：影子在扫描时刻**定格一次**、不抢锁、不重算（§5.2、§5.4） |
| 11 | P1 | 频次口径两处矛盾；模板「active 的最大版」会取回旧版（W10、Z11） | **采纳**：口径只用快照值、批准时提示 127 设置；用 127 的 `getCurrentTemplate` + `checkTemplateSendable`（§4.1、§4.3） |
| 12 | P1 | 试跑没有收件人白名单；测试联系人要造假线索违反 §8；v2 内容与第一版纯文字有差距（W11） | **采纳**：`recipient_allowlist` + 内部手建测试联系人（§6.6）；内容取舍交 PM（§0 问题 2，建议第一版纯文字） |
| 13 | P1 | 同意依据 / 旧标签 / S1「没接 vs 接坏了」带 CTS 语义（Z6） | **采纳**：同意依据、旧标签前缀、必须可读邮箱清单进规则快照（§3.1、§5.2 E/F） |
| 14 | P1 | 退订写成「别再联系」：能被 `dnc_cleared` 解开、且让人从销售名单消失；也不查 Mailchimp 的 unsubscribed/cleaned（Z7） | **采纳**：独立的 `email_unsubscribed` 触点；销售手发关口也读它；D 步用 `findMemberByEmail` 拦 `unsubscribed/cleaned/archived`（§6.3、§5.2 D）；§9-1 的「读不到标签」疑问就此解决 |
| 15 | P2 | 数据模型细节：白名单比对触发器、过期未撤销占位、已撤销不可再批、CHECK 上限、唯一键带 `channel`、`trigger_key` 白名单（Z10、W12） | **采纳**：均写进 §3.1/§3.2 |
| 16 | P2 | 发送细节：渲染放认领之后会占日上限；加锁与释放要在同一 `step.run`；Resend 409；频次口径两份（Z11） | **采纳**：先渲染后认领；锁同一步；409 归不明；口径只用快照 |
| 17 | P2 | 平台与流程：`isLiveFor` 第三份拷贝；「与 126 对齐」被降成通知；保留期清理卡没接；回执缺 `provider_impact`/来源记录号；看门狗在没新线索日误报；定时触发不带客户键；P2-1b 须等迁移已应用（Z12） | **采纳**：共享开关小工具；§1 差别 6、§11；§7 保留期清理；§8 回执字段；看门狗按 `candidates=N`；cron 按客户分发事件；§10 写明次序 |
| 18 | P2 | 自家闸线按 CTS 2.5% 退信率会有约 40% 概率误停；1 次投诉就停；授权续期被「过期未撤销」挡住（W12） | **采纳**：闸线改为样本≥50 且硬退信≥3 个且率 >4%；投诉≥2 次才自动撤销、单次投诉出待办；续期先显式撤销过期的（§3.1、§4.3） |

### 16.2 实现审（P2-1a 迁移，2026-11-02；子牙、魏征对真迁移 SQL 各审一轮，都判「需改后再审」）

子牙用本机库逐条复现；魏征独立重跑 115 项行为检查与 35 个变异（全部被杀），并实测了 upsert / MERGE / COPY / TRUNCATE / 直连建触发器等绕过路径。发现与处理（Z = 子牙，W = 魏征）：

| # | 级别 | 发现（谁） | 处理 |
|---|---|---|---|
| 1 | P1 | 直接 INSERT `pending` 行、或把 `blocked` 直接 UPDATE 成 `pending`，能绕过认领函数：日上限设 1 实测出现 2 条 pending；`first_attempt_at` 填十年后使 20 小时规则失效（Z1） | **采纳**：认领标记 `app.triggered_send_claim`，INSERT / UPDATE 两个守卫都查；认领函数写完立刻复位（§3.2） |
| 2 | P1 | 认领函数接受空入参：地址指纹传空，两个联系人都认领成功，「终身同址只欢迎一次」失效；模板与渲染指纹全空也能认领（Z2、W-1、W-6） | **采纳**：入参校验（`invalid_parameter_value`）+ 已认领状态的 CHECK 扩到 11 列（§3.2、§3.3） |
| 3 | P1 | `authorization_id` 不在认领后写一次清单：已发出的行能改成空，查不到哪份授权放行（Z3） | **采纳**，另加 `claimed_at` |
| 4 | P1 | 认领函数不比对模板指纹：授权绑 `b…`，认领传 `e…` 照样成功（Z4） | **采纳**：`template_mismatch` |
| 5 | P1 | 规则缺时区时静默按 `Pacific/Auckland` 算，违背「缺键不回落默认」与平台化铁律（Z5） | **采纳**：`rule_invalid` |
| 6 | P1 | 合并闸漏 `src/lib/platform/live-switch.ts` 与 `src/lib/inngest/functions/` 下的扫描 / 回执函数（实测判 B）；send-gates / dnc / automated-touch 三个分支没有各自的测试（Z6） | **采纳**：`risk.mjs` 加两条规则 + 逐分支测试（424 项，逐条删规则必变红） |
| 7 | P2 | 状态倒退时整条 UPDATE 报同一个 23001，回执消费方分不清「过期回执可忽略」还是真 bug；回执先到时发送方「sent + message id」合写会被拒（Z7） | **采纳**：`hint = status_regress / status_illegal`；「取等级较大者」的单条 UPDATE 写法写进 §4.2 |
| 8 | P2 | 时间和租约没钉死：`authorized_at` 可填未来（实测有效期 454 天）；批准与武装可一条语句完成；租约空或负数使下一次认领立刻接管；授权撤销后超 20 小时的 pending 永远不转 unknown；接管不回传原幂等键（Z8、W-3） | **采纳**：三个时间戳由触发器覆盖成 `now()`；批准与武装分两条语句；租约夹在 1–30 分钟（越界直接报错）；20 小时判定先于授权检查；认领返回已存的幂等键 |
| 9 | P2 | 模板留空的提案永远批不了（绑定列不可变）；PM 误标「没发出」后真实送达回执被拒（Z9） | **采纳**：§3.1 写明「须重新提案」；`failed + not_sent_confirmed` 可被后来的真实回执覆盖 |
| 10 | P2 | 共享表写死第一个渠道 / 供应商（`to_email_sha256`、`RESEND_*` 取值）；两个状态辅助函数的执行权只靠默认授权；行为试跑不在仓库里（Z10） | **采纳**：改名 `to_address_sha256`、`provider_impact` 取 `NONE / PROVIDER_ACCEPTED / PROVIDER_UNKNOWN`；显式 `grant … to service_role`；行为脚本入库（`scripts/db-behavior/`） |
| 11 | P2 | 三张 `done` 台账卡验法只核设计稿文字，夜巡会把「写进设计稿」翻成已验（Z11） | **采纳**：验法改为 P2-1b 的测试覆盖，`verify_by` 改 11-20 |
| 12 | P2 | `service_role` 能 `CREATE TRIGGER`：直连时可建一个排在守卫之后的触发器，把终态 `skipped` 改回 `pending` 并伪造幂等键（W-2；经 PostgREST 走不到，仅直连） | **采纳**：`revoke trigger, references, truncate … from service_role` |
| 13 | P2 | 认领不校验联系人属于授权客户：授权属 C1、传 C2 的联系人也能认领，行记成 C1（W-4；联系人是软引用，库里查不了） | **不在库里做**：写成 P2-1b 发送关口的契约（认领前断言联系人归属授权客户）并加专测（§13） |
| 14 | P2 | `blocked` 行重新认领时陈旧 `bounce_kind / sent_at / last_event_*` 残留（W-5） | **采纳**：认领时一并清掉 |
| 15 | P2 | 证据可信度：作者日志里 M28 记「存活」（W-7） | **说明**：M28（删账本的 scope/status CHECK）起初确实存活——我的用例被另一道 CHECK 先拦；补「带齐认领列」的用例后杀掉。第二版重跑时 M28 与 N06 又各存活一次，查明仍是测试自身的缺陷（见 §16.3 末段），已修；变异检验最终扩到 75 个，以 §16.3 的实跑数字为准 |
| — | — | `failed` / `skipped` 会释放同址，须有回归测试钉死（W） | **采纳**：行为脚本里「failed 释放同址、suppressed 不释放」两条 |

**第二版验证**：见 §16.3（第二轮复核后又改了一版，以最后一版为准）。

### 16.3 第二轮复核（只看差异；2026-11-02；子牙、魏征各一次，都判「需改后再审」）

两位都确认上一轮的 P1 已堵住（各自新建库逐条复现）；各找到 1 条新的 P1 和若干 P2，处理如下（Z = 子牙，W = 魏征）：

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | P1 | 「已撤销的提案不许再批准」的判据只看 `authorized_at`：不填它、只写其它批准列，已撤销的提案也能被批准（批准时间晚于撤销时间；武装与认领仍被拒，发不了信，但审计上像撤销之后又批准）（Z、W-P2-1） | **采纳**：判据改成与「时间由数据库定」一致（任一批准列被写入即算批准）；专测 + 变异 |
| 2 | P1 | 「没发出」例外 × 「failed 释放同址」叠加：A 被标「没发出」→ 同址的 B 认领 → A 的真实送达 / 投诉回执写入撞同址唯一索引（23505），投诉写不进账本，地址实际收到两封；另可先把 `reason_code` 改成 `not_sent_confirmed`，再借例外把供应商拒收的 `failed` 推到 `suppressed`（W，Z-P2） | **采纳**：`failed + not_sent_confirmed` 不释放同址（唯一索引与认领函数的同址计数用同一个谓词）；`failed` 状态下 `reason_code` 只许写一次；专测（含「绕过函数直插仍撞唯一索引」）+ 3 个变异 |
| 3 | P2 | 接管不比对授权与渲染：换了授权或重渲染的结果变了，仍会用旧内容 + 原幂等键重发（Z、W-7） | **采纳**：授权 id 或渲染指纹与这次传入的不一致 → `in_flight`，不接管；专测 + 2 个变异 |
| 4 | P2 | 时区写成 `'+13'` / `'UTC+13'`（POSIX 写法，正负号反）→ 本地日算错一天（W-3） | **采纳**：只接受 `pg_timezone_names` 里的名字，否则 `rule_invalid`（原先非法名字是抛错，现统一返回结果）；专测 + 变异 |
| 5 | P2 | 应用时钟比库快 1 秒 → 批准撞 CHECK（Z、W-2） | **契约**：授权路由用库时间（§13） |
| 6 | P2 | 标 `sent` 时不能清租约；「取等级较大者」的单条 UPDATE 走 PostgREST 写不出；授权撤销后应用停在关口 A，超 20 小时的 `pending` 不会转 `unknown_outcome`（Z、W-4、W-5） | **契约**：§13（P2-2 写入方遵守）+ 每日对账任务 |
| 7 | P2 | 加锁顺序（先账本行后授权行）要告诉后来者；文件头应注明「只能经认领函数」挡不住直连 SQL（W-6、W-8） | **采纳**：写进认领函数那一节的标题注释 |
| 8 | P2 | 合并闸按文件名前缀判：函数文件放进子目录或改名会判 B（Z） | **采纳**：规则改为路径前缀（文件或 `triggered-send/` 子目录都算 A），加专测并验证删规则必变红 |
| 9 | P2 | §16.2 说 §3.1 已写「须重新提案」，实际没写（Z） | **采纳**：已补进 §3.1 |

**测试自身的缺陷（变异检验揪出，已修）**：第二版第一次全量变异时，M28 与 N06 又存活。查明是**测试写得不严**，不是建表文件的问题：①影子行用例引用了文件后面才定义的变量（空串），先触发「哈希格式」CHECK，等于没测 scope/status；②「每个认领列单独为空」用例生成的假哈希只有 61 位，十个列的用例都因哈希不合法而「报对了错」。修法：夹具前移并校验长度；新增同时断言**错误码与约束名**的 `expect_chk`；并发用例改成「闸门法」（用顾问锁把认领会话停在事务中间，再观察第二个会话是否停在锁上），不再靠固定等待（机器忙时固定等待曾让 M05 假存活）；逐个核对了全部 72 条「期望报错」用例实际报的是哪条错，都对得上；变异检验扩到 75 个（逐列 9 个、两条 TRUNCATE 触发器、本轮 7 个）。

**第 2.1 版验证**：见 PR 正文「验证」一节的实跑数字（行为试跑、变异、重放、PostgREST 端到端、结构测试、合并闸测试、台账测试）。

**第三轮（对 2.1 改动的窄确认，不是新一轮完整审查）**：子牙、魏征各自新建库应用 v2.1，逐条复现上面第 1–4 项：**都判「通过」，没有新的 P0 / P1**。各留的小项（P2）处理：
- 子牙：①「failed 下原因只写一次」实际是「failed 下原因不许改」，先写没有原因的 `failed` 会释放地址 → 写入方契约（§13：同一条 UPDATE 带原因，P2-2b 专测）；②被标「没发出」的地址以后不再自动收欢迎信 → 授权页必须写明后果（§10 P2-2c）。
- 魏征：①在非 `failed` 行先写 `not_sent_confirmed` 再转 `failed` 可借例外退回；`delivered` 转别的原因的 `failed` 仍放出同址 → 写入方契约（§13，消费者不得走这条路，P2-2b 专测；必要时再补库内约束）；②分两句写 `failed`（先状态后原因）原因会冻成 `expired_20h` → 同上契约；③时区名区分大小写 → 提案路由用同一份名单（§13）。
这些都不是 P2-1a 要在库里再改的东西；建表文件定稿为 v2.1（应用到生产之后不得再改）。

### 16.4 应用到生产（2026-11-02）
PM 读完 §16.3 的改动说明后回「go apply」。步骤与结果：
1. **只读预检**（目标库 CrazyContent，项目号 `glbdnayojixmexgofbsd`）：P1 的 `provider_webhook_events` 在、`clients.id` 是 uuid、`anon / authenticated / service_role` 三个角色在、没有任何同名表 / 函数 / 触发器 / 策略 / 索引、没有长事务、`clients` 上没有重锁、这条迁移还没被记录过。
2. **指纹预检（零副作用）**：把要应用的原文交给线上库算 SHA-256，等于本机文件与 PR 头提交里的文件：`5d1343d176882a131f07577975c37ce723f429df19a2baee7bb788aa689036a6`，41,526 字节。
3. **应用**：Supabase 账本记录 version `20261102015123`、name `triggered_send_ledger`（version 是应用时刻的 UTC 时间戳，与仓库文件名不同，同 P1）；记录里的语句指纹与仓库文件**逐字一致**。
4. **读回**：两表行级安全开启；触发器 4 + 4 全部启用；策略各 1 条且 `TO service_role`；索引 11；外键 3；两表 0 行；`anon / authenticated` 对两表与 9 个函数全无权限；`service_role` 对表只有读 / 写 / 改 / 删（没有 TRUNCATE / REFERENCES / TRIGGER）；用不存在的授权号现场调用认领函数 → `auth_inactive`，不写任何行；Supabase 安全扫描与应用前完全一致（没有新增告警）。
5. **从现在起，`supabase/migrations/20261102130000_triggered_send_ledger.sql` 不得再改**；要改表或函数，另开新迁移。P2-1b 现在可以开工（每一批仍要 PM 点头）。
