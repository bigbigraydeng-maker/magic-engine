# CRM「通话后选模板发邮件」+ 邮件模板管理 — 设计稿 v0.2（2026-10-28）

窗口 127 起草。状态：**设计稿 v0.2，已吸收子牙、魏征各一轮审查**（子牙 2 个必须先改 / 9 个重要 / 3 个小问题；魏征 4 个必须先改 / 7 个重要 / 若干小问题；逐条处理对照见 §19）。**未写代码、未建表、未打开任何开关。**
风险级：**A**（对客外发、撤不回；新增 3 张数据库表）。PR 保持草稿 + 正文写「风险级别：A」；PM 回「合 N」才合；含数据库迁移的那一份留给 PM 亲手合，并等 PM 回「go apply」才在生产库执行。
PM 2026-10-28 原话：「这个发送邮件的功能，我希望做到 CRM 内，在电话之后，可以点击选取 email 模板发送，所以我们需要在系统里建立好发信的通道，以及模板管理」。
所属闭环环节：**Act**（CRM 里的人工外联）。**Check** 的接口先留好（回执里记会话号和发出时间，以后可以算「发了多久有回信」），本稿不做报表。
前置设计：[`2026-10-21-crm-send-first-email-design-v0.md`](./2026-10-21-crm-send-first-email-design-v0.md)（发信通道，已合并；CTS 的开关关着）。本稿扩展它，**不削弱它已有的任何一道闸**。

## 0. 一句话

通话结束（系统记录到接通的通话，或销售自己点「刚和他通过电话」）后，客人抽屉顶部出现「发跟进邮件」→ 选模板 → 价格、出发日、行程亮点、链接**自动从团目录「已上架」数据填好** → 看预览、可改 → 人点发送 → 走已有的 `sendMailNew`。
发信前**新增几道闸**：配置有效与灰度名单、模板和目录版本新鲜、文字红线、7 天最多 2 封、防重复跟进；**每次尝试（发出、被拦、失败、状态不明）都当场写一行回执，并发一条 Inngest 事件**，写明谁发的、发给谁、哪个模板、为什么被拦。

## 1. 层级判定（me-platform-tier-gate · Inline）

- 渲染器、变量引擎、各道闸、回执与事件、模板仓库与管理界面 = **平台通用机制**，归现有「CRM 发信」能力的延伸（不新增能力线，不登记候选）。
- 团目录取数 = ME 旅游版（L2）已有的「已发布快照」；本稿在**团目录侧新增一个只读读取函数**（§6.3，R2a），不另建事实源。
- CTS 的模板正文、7 天 / 2 封、链接白名单、禁用词、团页链接格式 = **L4 客户数据与配置**（表行），不进共享代码。
- 换客户测试：换成 NAL（物流）——没有团目录，模板用 `pick_mode='none'` 照样能发，渲染器和闸不用改；换成悉尼地产客户——另需一个房源事实提供者，本稿只留接口位置（`fact_source`），不预建抽象。
- 换行业测试：旅游词（`tour_*` 变量、团页链接格式、单人附加费）**只许出现在 `facts/published-tours` 这一个提供者模块**，共享的闸通过提供者的钩子（`checkLinks`、`knownAmounts`、`sellable`）取这些信息；有边界测试钉住（§15）。

## 2. 现状（只读核对，2026-10-28；每条带出处）

| 项 | 现状 | 出处 |
|---|---|---|
| 发信通道 | `sendMailNew` 已写完并合并：开关 → 收件人 → 只发给咨询过的人 → 别再联系 → 选邮箱 → 去重 → 对账 → 配额 → 抢锁 → 先写会话与审计 → 建草稿 → 发送 → 补记录 | `src/lib/microsoft/mail-send-new.ts` |
| 预览 | `previewCompose` **只跑** `resolveSend`（开关 → 收件人 → 咨询过 → 别再联系 → 邮箱），传入的正文是空的，**不跑**去重 / 对账 / 配额 | `mail-send-new.ts:364-387` |
| 路由与界面 | `POST …/contacts/[cid]/email/compose`；`ComposeEmail` 只在「没有可回复的邮件线」时渲染，开关关着时静默什么都不显示 | `…/email/compose/route.ts`；`ComposeEmail.tsx:66`；`PersonDrawer.tsx:759-777` |
| CTS 的开关 | **关着**。生产库实查：`leads_config.email_compose` 为 null（该 JSON 现有 9 个键：booking_schedule、email_briefs、mailchimp_audience_id、mailchimp_enabled、meta_leads、own_email_domains、paid_tagging、payment_email_detect、trade_domains） | 生产库只读，2026-10-28 |
| 配置读取与保存 | 读取器遇到坏值**回落默认**（对闸门来说等于「配错 = 关闸」）；`leads-config` 保存路径是「读整块 → 合并 → 写回整块」，付费员工就能调用，两人同时保存会静默覆盖 | `email-compose/config.ts:64-75`；`leads-config/route.ts:229-243` |
| 邮件模板 | **没有**。迁移里没有名含 templ / snippet / canned / macro 的表，也没有界面 | `supabase/migrations` 检索 |
| 团目录 | 已上线并发布：CTS 已发布 2 版（最新 2026-10-26），34 个团、30 个在售。**对外渠道唯一读取口 `loadPublishedProducts` 输出的是官网契约的精简形状：没有亮点（highlights）、没有整团「售罄」标记，班期只有展示用日期字符串**；亮点只在官网那份投影里有。边界测试按**模块名**拦截（任何以 `/tour-catalog` 结尾的导入路径都会命中），目录以外的代码不许出现 `tour_catalog_` 开头的表名 | `store-publish.ts:153`；`output.ts:53-83`；`website-output.ts:143`；`__tests__/boundary.test.ts:48,84-121` |
| 官网团页链接格式 | `/tours/{destination}/{tier}/{slug}`，选了班期则带 `?date=YYYY-MM-DD`（官网首页 2026-10-28 抓取 + 广告配置印证）。官网主机用 `www.` 还是不带，未核实 | `ads-tracking-preflight/client-config.ts:27` |
| 通话记录 | 两条路径都落到 `contact_touchpoints`（channel=phone）。①系统通话：元数据含 `reached / answered / talk_seconds / logged_by`，可信。②销售手打笔记：**每一条都被写成电话**，解析不出规则时**兜底判成 `spoke`**；批量登记「群发了一封邮件」也走这条路。所以**手记里的 `spoke` 不算打通**，仓库早有明文判据 | `crm/touchpoints.ts:140`；`note-parser.ts:324`；`segments.ts:526-533`（`isPhoneVerdict`）；`touchpoints/batch/route.ts` |
| 员工拨号 | 10-25 审计时 CTS 7 个员工账号拨号全部失败；其后 PR 3299 加了就地登记手机号入口，是否已有员工登记**未核实**。所以**销售自己点「刚通过电话」是现实主路径**，系统通话是锦上添花 | `docs/audits/2026-10-25-crm-pages-user-view-audit.md` §5.3；`CallButton.tsx` |
| 「咨询过我们」闸 | 入站来源清单里电话只认 `phone/twilio`，**VoIPLine 来电（source=voipline）和手记都不算**——只靠来电咨询的人会被拦成「没咨询过」 | `email-compose/enquiry-record.ts:7-16` |
| 群发邮件的记录 | Mailchimp 同步只写**入站**的打开 / 点击触点，没有「发给了谁」；`listSentCampaigns` 只取状态为 sent 的群发（campaign），**欢迎旅程等自动流程发出的信不在其中**。Mailchimp key 全账号共用，名单按客户分。员工 Outlook 里的 BCC 群发会被登记成「电话」触点 | `mailchimp/sync.ts:152-170`；`client.ts:211-225` |
| 邮箱同步 | 同步同时读收件箱和已发送箱（方向由文件夹决定） | `mail-ingest.ts:647-` |
| 「7 天 2 封」 | 台账 2026-10-08 PM 原话「每个客户一周内严格不超过两次」，当时范围写「凡是对客人群发都算」；PM 2026-10-28 的口径是「含群发与销售一对一」。**全仓没有任何代码在拦** | `docs/ledger/2026-10-08-cts-email-two-per-week-cap.md` |
| 员工署名 | `client_portal_users.display_name` 存在，CTS 7 个账号全有值（只数了个数，没读名字） | 生产库只读 |
| 测试联系人 | CTS 里有 1 个 hello@magicengine.cloud 联系人，名下 12 条入站邮件触点（满足「咨询过我们」）、4 条出站邮件触点。`sendMailNew` 调 `classifySender` 时没传自己人域名，不会因此拒发 | `mail-send-new.ts:162`；生产库只读 |
| 范例信 | Lisa 的跟进信润色版在 hello@ 草稿箱：感谢通话 → 7 条卖点 → 价格与包含 → 行程 PDF → 只让客人回信；信里有 2 处「Lisa to confirm」。**信里的 12 月 22 日圣诞团已下架**：已发布目录 30 个在售团里没有圣诞团、没有 2026-12-22 班期 | Gmail 草稿；生产库只读 |

## 3. 范围

**做**：A 模板管理（列表 / 新建 / 编辑 / 停用 / 历史版本）；B 通话后入口 + 选模板 + 预览可改 + 发送；C 发信前新增各道闸；D 回执 + Inngest 事件；E 发信设置面板（仅全局管理员）；F 两份种子模板（默认停用）；G 团目录侧新增一个只读读取函数（R2a）。
**不做（本轮）**：群发；AI 起草（试跑里 AI 曾编出「价格有有效期」，见 `2026-10-26-crm-email-briefs`）；HTML / 富文本；**附件**（§10）；WhatsApp / 短信模板；给 Mailchimp 群发加「反向检查 1 对 1 已发」，以及补上欢迎旅程的发送记录（交 newsletter 的 126 号窗口另立卡）；回信率报表（只留接口）。

## 4. 总体流程

```
系统记录到接通的通话 ──► 抽屉出现提示条「发跟进邮件」
销售点「刚和他通过电话」/「用模板写邮件」 ──► 同一个选模板面板
   ▼
选模板 ─► 模板要选团时：选团 + 出发日（只列「已上架且有可售班期、未售罄」的）
   ▼
服务端渲染预览  POST …/email/templates/[key]/preview
   返回：主题 / 正文 / 缺值清单 / 警告 / 能不能发 / 模板版本 + 目录版本 / 7 天已收明细
   ▼
人可改主题和正文（改后可再点「检查」）─► 点发送  POST …/email/compose
   请求带 template{key, version, catalogVersion, picks, inputs, callBasis}
   ▼
sendMailNew 内部顺序：
  校验 → 配置有效（严格）→ 开关 → 收件人（含灰度名单）→ 咨询过 → 别再联系 → 选邮箱
  → 去重（findPriorSend）→ 【新】模板与目录版本新鲜 → 【新】文字检查（最终主题+正文+页脚）
  → 对账 → 配额 → 抢锁 → 【新】防重复跟进 → 【新】7 天频次闸（锁内）
  → 先写会话与审计 → 建草稿 → 发送 → 补记录
   ▼
不论结果：同步写一行回执 ─► 再发 Inngest 事件 crm.email_send.attempted（驱动「状态不明」的延迟对账）
```

## 5. 数据模型

### 5.1 不加表、存 `leads_config` JSON 行不行？——评估：**不行；模板、设置、回执都进表**

| 考察点 | 放 `clients.leads_config` JSON | 放新表 |
|---|---|---|
| 并发保存 | 9 个键共用一块，保存是「读整块 → 合并 → 写回整块」；两人同时保存，后写的静默覆盖先写的——**模板会丢，更糟的是「总开关关了」「灰度名单」这类刹车会被旧值悄悄改回去** | 一版一行，冲突由唯一键拦下并提示刷新；设置有自己的表，`leads-config` 的保存碰不到它 |
| 对外文案与开关的留痕 | 没有历史；回执写不了「用的是哪一版」 | 版本只增不改，回执记版本号；谁在何时改了开关有记录 |
| 体积 | 一份正文最长 1 万字，十几份就上百 KB，塞进被到处读取的 `clients` 行 | 不影响 `clients` |
| 迁移成本 | 无 | 一份迁移（只新增 3 张表和追加触发器，不动旧表），走 A 级流程 |

结论：`leads_config.email_compose` 降级为**旧值只读兜底**（没有设置行的客户沿用今天的读法，行为不变）；一旦某客户有了 `crm_email_settings` 行，就只认新表。

### 5.2 `crm_email_templates`（一版一行）— DDL 草案（以迁移文件为准）

```sql
create table public.crm_email_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),          -- 不加 on delete cascade：追加型表
  template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  version integer not null check (version >= 1),
  name text not null check (char_length(name) between 1 and 120),
  subject text not null check (char_length(subject) between 1 and 400),   -- 含占位符的模板文本；渲染后另限 200
  body text not null check (char_length(body) between 1 and 10000),
  fact_source text not null default 'none',          -- 'none' | 'published_tours'；应用层白名单校验，换行业不用改表
  pick_mode text not null default 'none' check (pick_mode in ('none', 'one', 'many')),
  pick_filter jsonb not null default '{}'::jsonb,    -- {destinations?, tiers?, departure_months?}
  status text not null check (status in ('active', 'disabled')),
  change_note text check (change_note is null or char_length(change_note) <= 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (client_id, template_key, version)
);
```
- 「当前版」= 同一 `template_key` 的最大 `version`；**停用 / 启用也是写一个新版本**。
- **发送只认当前版**：请求里的 `version` 必须等于当前最大版本，且该版 `status='active'`；否则 409（旧版本那一行永远是 `active`，所以不能只查「请求的版本是否启用」）。
- 编辑提交 `baseVersion`，服务端写 `baseVersion + 1`；唯一键冲突或 `baseVersion` 不是当前最大版 → 409「别人刚改过，请刷新」。
- **追加型由数据库强制**：`before update or delete` 触发器直接 `raise exception`（仓库先例 `20260808000003_me2_execution_kernel_v1.sql` 的 `authorization_decisions_append_only`）。service_role 能绕过 RLS，所以不能只靠「代码不改」。
- RLS：`enable row level security` + `create policy … for all to service_role using (true) with check (true)` + `revoke all … from anon, authenticated`（**必须带 `to service_role`**，见 CLAUDE.md §7）。

### 5.3 `crm_email_settings`（发信设置，同样一版一行）

```sql
create table public.crm_email_settings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  version integer not null check (version >= 1),
  settings jsonb not null,                            -- 严格解析，见 §5.5
  change_note text check (change_note is null or char_length(change_note) <= 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (client_id, version)
);
```
当前设置 = 最大 `version`。写入同样走 `baseVersion` 乐观并发；同样的追加触发器与 RLS。

### 5.4 `crm_email_send_receipts`（回执）

```sql
create table public.crm_email_send_receipts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  contact_id uuid not null,                    -- 软引用，不加外键：回执是审计日志，不能因联系人 / 会话被删而写不进
  request_id uuid not null,
  actor_email text not null,                   -- 谁发的（登录邮箱）
  template_key text, template_version integer, catalog_version integer,   -- 哪个模板、哪版目录；自由写信时为空
  call_basis text not null default 'none' check (call_basis in ('none', 'system_call', 'staff_attested')),
  outcome text not null check (outcome in ('sent', 'blocked', 'failed', 'unknown')),
  block_reason text, block_detail text,        -- 被拦原因代码，如 frequency_cap；detail 放规则号 / 计数
  mailbox text,
  conversation_id uuid,                        -- 软引用：audit_failed 路径会把会话删掉，外键会让回执永远写不进
  provider_message_id text,
  edited_after_render boolean,                 -- 销售是否改过系统渲染的文字
  warnings text[] not null default '{}',       -- 当时提示过的警告代码
  rendered_sha256 text, final_sha256 text,     -- 只存指纹，不存正文
  auth_basis text not null default 'human_click' check (auth_basis = 'human_click'),   -- 注意：authorization 是 PostgreSQL 保留字，不能当列名
  created_at timestamptz not null default now()
);
create unique index crm_email_send_receipts_attempt_key
  on public.crm_email_send_receipts (client_id, contact_id, request_id, outcome, coalesce(block_reason, ''));
create index crm_email_send_receipts_recent_idx on public.crm_email_send_receipts (client_id, created_at desc);
```
- **写法是普通 `insert`，遇到唯一冲突（`23505`）就当已写过**。`upsert(onConflict)` 用不上这个表达式索引（实测会报错）。
- 唯一键含 `contact_id`：同一个 `requestId` 被误用到另一个客人身上，不会并进别人的回执。
- **不存收件人邮箱和正文**（正文本来就在 `conversation_outbound_log`，收件人通过 `contact_id` 查）。「发给谁」= `contact_id`。
- 同样的追加触发器与 RLS。`unknown` 之后若对账结案，**再追加一行** `sent / failed` 回执，不改旧行。

### 5.5 设置内容（`crm_email_settings.settings`，**严格解析**）

坏值或缺键 = 解析失败 = 拒发（`config_invalid`），**绝不回落成默认**（回落默认 = 把闸门悄悄关掉）。界面保存时同一份解析器先校验。

| 键 | 含义 | CTS 初始值（L4，属配置不属代码） |
|---|---|---|
| `enabled` | 总开关（布尔，必填） | 试跑期 true，上线前由 PM 一句话 |
| `send_mailbox`、`allow_unsolicited`、`footer`、`limits` | 沿用 10-21 稿的含义 | 沿用 |
| `frequency_cap` | **必填键**：`null` = 明确不设上限；对象 `{max, window_days}` = 滚动窗口内最多几封 | `{max: 2, window_days: 7}` |
| `recipient_allowlist` | **必填键**：`null` = 不限制；字符串数组 = 只能发给名单内地址（灰度 / 试运行）。写成字符串或别的类型 = 解析失败，不是「空名单」 | 试跑期 = PM 自己的测试地址 |
| `same_template_cooldown_hours`、`call_prompt_hours` | 同一模板对同一客人的冷却；通话后提示时长 | 24、24 |
| `guardrails.allowed_link_hosts` | 正文里链接允许的**精确主机名**，只允许 https | ctstours.co.nz 与其 www 形式（以试跑核实的最终主机为准） |
| `guardrails.rules[]` `{id, phrases[], message, severity}` | 禁用语句；`phrases` 是**字面短语**，不接受正则（防 ReDoS）；`severity` = `block` / `warn` | 见 §8.3 |
| `providers.published_tours` `{url_pattern, all_tours_url}` | 团页链接格式、「全部团」页；**归提供者命名空间**，共享代码不认识它 | 试跑核实后写入 |

没有设置行的客户沿用旧读取器，且两个新必填键（频次上限、灰度名单）视为「未设置 = 旧行为」——这只发生在从没采用过新设置的客户身上；CTS 在打开开关**之前**必须先有设置行。

## 6. 模板与渲染

### 6.1 占位符

写法 `{{name}}`（容忍花括号内空格），列表类可带数量 `{{tour_highlights:7}}`。**保存模板时**未知变量名、与 `pick_mode` 不匹配的变量一律拒绝（`{{frist_name}}` 这种错字进不了库）；保存时也跑一遍 §8.3 的文字检查。

| 变量 | 来源 | 缺值时 |
|---|---|---|
| `first_name` | 专用解析函数（`cleanDisplayName` 不管下面这些）：NFKC 归一 → 去首尾符号 / emoji → 按空白切词 → 丢掉开头的称谓（mr、mrs、ms、miss、dr、prof、sir）→ 取第一个词；以下情形算缺：为空、纯数字、含 `@` / 数字 / 下划线、占位词（guest、customer、unknown、test…）、超 40 字；全大写则转首字母大写 | 拒发，预览里该处高亮，要求销售手填 |
| `sender_name` | 登录员工 `display_name` 的第一个词 | 同上 |
| `call_when` | **只认两种依据**：①系统通话证据（§7.1）→ 按客户时区是今天 / 昨天 / 更早 → `today` / `yesterday` / `recently`；②销售点了「刚和他通过电话」→ `today`。**两者都没有 → 缺值，拒发** | 拒发（手记里的 `spoke` 不是依据） |
| `tour_name` `tour_duration` `tour_price` `departure_date` `tour_url` `tour_highlights[:N]` `tour_inclusions` | `pick_mode='one'`：所选团 / 班期，见 §6.3 | 没选团或目录里这项为空 → 拒发 |
| `tour_cards` | `pick_mode='many'`：每个所选团渲染成固定四行小卡（名称与天数 / 出发日 / 价格 / 链接） | 一个都没选 → 拒发 |
| `all_tours_url` | 提供者配置 | 没配置 → 拒发 |
| `input.<name>` | 模板里声明的临时填写项 | 空 → 拒发 |

渲染规则：
- **替换必须用函数式替换**，不能把变量值当替换串——价格里的 `$1,999`、`$&` 会被正则替换吃掉（实测 `$1,999` 会变成 `tour_price,999`）。测试值里放 `$1 $& $'`。
- 变量值里出现的 `{{` 先转义，**不二次展开**；输出纯文本；换行规范化；主题渲染后超 200 字 → 拒发并提示。
- 价格：`tour_price` = 官网价格文案**原样**（如「From NZD $4,080 per person」）；所选班期有班期价且文案里不含这个金额时，附一句「this departure: NZD $4,380」。**不替官网文案补「per person」「twin share」**。
- 日期：`D Month YYYY`（英文月份全称，日不补零，与官网一致）。

### 6.2 渲染是纯函数

`renderTemplate(template, context) → { subject, body, missing[], usedVariables[] }`。`context` 由服务端装配（联系人、员工、所选团、通话依据），**浏览器不传事实，只传「选了哪个团哪天」「手填项」「是否刚通过电话」**。

### 6.3 团目录取数：新增一个只读读取函数（R2a）

- 现有 `loadPublishedProducts` 输出里没有亮点、没有整团售罄标记，班期状态也被抹平——**Lisa 那类信的「亮点」填不出来**，官网标了售罄的团也照样能选。不能靠它。
- 方案：在 `store-publish.ts` 里**新增**一个只读函数（暂名 `loadPublishedTourFacts(db, clientId, today)`）：读同一份已发布快照，返回邮件需要的字段——`id、slug、destination、tier、name、title、durationText、displayPriceText、highlights、inclusions、exclusions、singleSupplement、soldOut、isActive`，以及班期 `[{departOn, status(open|limited), priceTextOverride}]`，外加**已发布版本号**（`catalogVersion`）。过滤规则与现有输出一致：过期班期、`sold_out / closed / cancelled` 班期不出；整团不可售则 `isActive=false`。
- **不改现有函数的输出**（官网契约不动，避免给官网消费者带来未知字段）；把新函数名加进边界测试的允许名单（`PUBLISHED_READER_NAMES`），并给它加测试。这是目录文件夹内的改动，**动手前先看目录窗口在飞的 PR**，避免撞车。
- CRM 侧的提供者模块命名为 `facts/published-tours`（**不能叫 `tour-catalog`**：边界测试按路径末段判，会把每个导入它的文件都报违规）；`fact_source` 取值也用 `published_tours`，避免出现 `tour_catalog_` 字样。
- 选团列表：`isActive` 且未售罄且有可售班期（或该团不管班期）的团，再按模板的 `pick_filter` 过滤（档位 / 目的地 / 出发月份）。`today` = 客户时区（CTS 为 Pacific/Auckland）的今天，沿用 CRM 已有取法。
- 提供者钩子（共享的闸只通过它们取旅游语义）：`listPicks`、`renderPicks`、`sellable(picks)`、`checkLinks(urls, picks)`（团页链接必须符合 `url_pattern`、对应在售团、`?date=` 必须是在售班期）、`knownAmounts(picks)`（价格文案 / 班期价 / 单人附加费里的金额）。

### 6.4 渲染示例（Lisa 的结构 + 目录数据；示例，以上架数据为准）

```
Subject: {{tour_name}}: your itinerary and price
Kia ora {{first_name}},

Thank you for talking with me {{call_when}}. It was a real pleasure.
As promised, here are the details of the {{tour_name}} ({{tour_duration}}), departing {{departure_date}}.

Why you will love this tour
{{tour_highlights:7}}

What is included
{{tour_price}}
{{tour_inclusions}}

You can see the full day-by-day itinerary here: {{tour_url}}

If you have any questions, or would like to go ahead, just reply to this email and I will take care of the rest.

Warm regards,
{{sender_name}}
CTS Tours
```
用 2026-10-28 的上架数据渲染「Best of China · 2027-03-11」得到：团名 China Discovery — Best of China、15 Days、「From NZD $4,080 per person」、链接 `…/tours/china/discovery/essentials?date=2027-03-11`。Lisa 信里写死的「per person, twin share」「guaranteed departure」目录里没有这两个事实，**模板不写**。

## 7. 通话后入口（B）

### 7.1 什么算「刚通过电话」——只认两种依据

1. **系统通话证据**（自动弹提示条）：近 `call_prompt_hours`（缺省 24）小时内，该联系人有一条 channel=phone、**来源不是手记（`me_manual`）**的触点，且接通：`metadata.reached === true`，或 `answered && talk_seconds > 0`，或 `outcome === 'spoke'`（来源非手记）。判据**复用 `isPhoneVerdict` 的同一条道理**。
2. **销售亲手点的「刚和他通过电话」**（人按下去的，记入回执 `call_basis = 'staff_attested'`）。

**手记里的 `spoke` 一律不算**：它是解析器的兜底值，任何没命中规则的备注（含批量登记的「群发了一封邮件」）都会变成它；按它弹「谢谢通话」，登记一次群发就会让一批人冒出提示。通话之后若已有发给他的邮件（出站邮件触点，或本功能的 `sent` 回执），不再弹。来电与外呼都算；谁打的不限，显示「刚和他通过电话（时间，谁）」。

### 7.2 界面

- 新组件 `PostCallEmailBar`，放在抽屉回复区顶部（`PersonDrawer.tsx` 的 `drawer-replies` 容器内、`EmailReply` 之前）：
  - 有系统通话证据 → 醒目提示条「📞 刚和他通过电话（今天 10:42，Lisa）· 发跟进邮件？[选模板]」；
  - 没有 → 一行两个小按钮「刚和他通过电话 · 发跟进邮件」「用模板写邮件」（前者进入面板时 `callBasis=staff_attested`，后者不带通话依据，用了 `{{call_when}}` 的模板会提示缺值）。
- 系统通话路径：挂断约 2 分钟触点落库，`dialedAt` 后 10 分钟内每 30 秒轻量重读一次。手动登记路径**不再依赖**解析手记。
- 选模板面板在抽屉内联展开（不弹窗）：模板列表 → 选团 / 班期（需要时）→ 预览（主题输入框 + 正文文本框，可改，改后可点「检查」重跑文字检查）→ 提示区（缺值红字 / 警告黄字 / 被拦原因与明细）→ 确认行「将用 {邮箱} 发给 {地址}（最近 7 天已收 N 封，上限 2，点开看明细）」→ [发送]。
- **收到 409「模板 / 目录已更新」**：面板重新生成预览，把销售改过的旧稿放进可折叠的「旧稿」里，方便复制。
- 与现有两块的关系：`ComposeEmail`（自由写第一封）原样保留；已有邮件线的人也能用模板，但这是**一封新邮件、新主题，不是回复**，面板里写明。
- 功能没开通 / 配置无效时：普通员工什么都不显示；**全局管理员**看到一行灰字「邮件功能未开通 / 配置无效」+ 设置入口（10-25 审计批评过「装了没开且不告诉人」）。

## 8. 发信前新增各道闸（C、E）

### 8.0 共用函数与调用位置（更正：不是「预览跑同一份 resolveSend」）

`previewCompose` 只跑 `resolveSend`，且正文为空；把新闸塞进 `resolveSend` 会让预览的文字检查永远通过、频次闸跑到锁外面。所以：

- 各道闸写成**独立的共用函数**：`parseSettingsStrict`、`evaluateFreshness`、`evaluateContentGates`、`evaluateFollowUp`、`evaluateFrequency`。
- **预览**调用：配置、版本、文字检查（对渲染后或销售改过的文字）、频次（只读，面板打开时算一次并缓存 60 秒，只用于显示）。
- **发送**调用：全部，顺序见 §4，频次与防重复在联系人锁内重算。去重 / 对账 / 配额仍只在发送时跑。
- 预览与发送必须调用**同一个函数对象**，有测试断言（spy）。

### 8.1 配置有效与灰度名单

设置解析失败 → `config_invalid`；收件人不在 `recipient_allowlist` → `recipient_not_allowed`（在选邮箱、碰 Graph 之前就拦）。作用：试跑期开着功能也**物理上发不到真客人**；上线 = PM 一句话清空名单（写入 `null`）。

### 8.2 版本新鲜（B2）

请求带 `template.version` 与 `template.catalogVersion`（预览时返回的当前值）。发送时任何一个不等于当前值 → 409（`template_outdated` / `catalog_outdated`）。覆盖：模板刚被停用或改版、目录刚改价或下架班期——**面板早就开着的销售不会发出旧文旧价**。所选团 / 班期在最新快照里不再在售 → `tour_unavailable`。

### 8.3 文字检查 `evaluateContentGates`（纯函数，无网络）

检查对象是**最终要发出去的全文**：主题 + 正文 + 页脚（页脚在 `mail-send-new.ts:253` 才拼上，必须在拼好之后检查）。先**归一化**：NFKC、去零宽字符、各种连字符 / 破折号统一成 `-`、折叠空白（含换行拆词）、解码常见 HTML 实体与 URL 编码，再检查。

1. **链接**：识别带 `https://` 和**裸域名 / `www.`** 的所有链接；只允许 https；主机必须**精确等于** `allowed_link_hosts` 之一（防 `ctstours.co.nz.evil.com`、`user@host`、punycode）；其余交给提供者 `checkLinks`：团页路径必须符合 `url_pattern`、对应在售团、`?date=` 必须是在售班期——挡住「下架团页仍返回 200 但内容是通用列表页」（CTS 官网的下架团页就是这样，欢迎信里踩过；只看 HTTP 200 验不出来）。**对所有发送都跑（含自由写信），不依赖请求里有没有 template 字段**。
2. **残留标记**：`{{…}}`、`{name}`、Mailchimp 合并标签 `*|FNAME|*`、方括号 / 圆括号里的 `confirm` / `TBC` / `to be confirmed` / `待确认` 类标记（Lisa 草稿里就有）→ 拦（`placeholder_left`）。
3. **禁用语句**：配置规则，`block` 拦、`warn` 在预览里黄字提示但不拦。**短语要具体，不能用单个常见词**（"hurry" 会误拦 "no hurry"）；规则上线前先对近 90 天已发出的真实邮件**本地干跑**，只统计命中数与误拦数，看过再定严重度。CTS 初始规则（**属 L4 配置，随配置落库，不写进代码；严重度由 PM 审**）：
   - `block`：销售截止 / 倒计时类（hurry up、last chance、limited time、limited seats、seats left、book before、countdown…）；免签类（visa-free、visa free、no visa required——PM 规定只写「以 CTS 确认为准」）。
   - `warn`：约电话 / 会议类，只匹配**邀请**说法（give me a call、call me、schedule a call、book a call、zoom…），**不**匹配「phone call」本身，否则「Thank you for the phone call」会误拦。
4. **金额漂移（warn）**：最终文字里的金额若不在提供者 `knownAmounts(picks)` 里，黄字提示「这个金额不在官网上架数据里，请确认是销售确认过的价格」；不硬拦（销售确认的特价是合法来源），警告代码进回执。

### 8.4 频次闸 `evaluateFrequency`（E：「7 天 2 封」怎么做进发信闸）

**规则**：该客人**名下全部邮箱地址**（主邮箱 + 身份邮箱）在滚动 `window_days × 24 小时`内收到我们的邮件封数 `n`（一封信发给多个地址，每个地址各算一封）；`n >= max` 即拒发（409，`frequency_cap`），文案带明细与「最早 {时间} 可再发」。含这一封**总数不超过 `max`**。`nextAllowedAt` = 按时间升序第 `n - max` 条（从 0 数）的时间 + 窗口。

**数什么——四个来源取并集，宁多勿少**（更正：不能只靠发信邮箱的已发送箱 + 5 分钟审计行）：

| 来源 | 取法 | 覆盖 / 盲区 |
|---|---|---|
| S1 已发送箱（Graph，实时，**所有已连接的 active 邮箱**） | `GET …/mailFolders/sentitems/messages?$filter=sentDateTime ge {窗口起点}&$orderby=sentDateTime desc&$select=id,sentDateTime,subject,toRecipients,ccRecipients,bccRecipients&$top=100`，**翻页翻到窗口起点**；本地按 to / cc / **bcc** 任一命中该客人地址计一封；排除自动回复（`isAutoReply`）。不用 `toRecipients/any()` 过滤（文档没给例子，且会漏抄送密送） | 本系统发的、销售在 Outlook 里发的、**BCC 群发**；盲区：员工删掉的信、其他人私人邮箱发的 |
| S2 本系统审计行 | `conversation_outbound_log` 窗口内**全部** pending / sent 的邮件行（不只最近 5 分钟） | 补 S1 里被删或尚未出现的 |
| S3 邮件出站触点 | 窗口内该联系人 `channel='email' AND direction='outbound'` 且非自动的触点（邮箱同步写入） | 补 S1 看不到但已同步的；**BCC 群发登记成的是「电话」触点，这里看不到，所以 S1 必不可少** |
| S4 Mailchimp 群发 | 取窗口内已发出的 campaign，逐个查该地址是不是收件人（文档确认有 `GET /reports/{campaign_id}/sent-to/{subscriber_hash}`，hash = 小写邮箱的 MD5，返回 `status`：`sent` / `hard` / `soft`；`hard`=硬退信不计） | 群发；**盲区：欢迎旅程等自动流程发出的信不在 campaign 里**（已知缺口，§18-9） |

- **去重**：同一封 = Graph `id` 相同，或（同一地址、发送时间相差 ≤ 120 秒、规范化主题相同）。去重失败只会**多数**（保守方向、会误拦），所以面板里要把明细（来源、时间、主题）摆给销售看，误拦能当场看懂。
- **fail-closed**：任一来源查询失败、**翻页翻不完**（页数上限 30、整次计数总时限 25 秒）→ 拒发（`frequency_unverifiable`，「暂时数不清他这周收了几封，先别发，稍后再试」）。客户**没有 Mailchimp 名单**（没有 audience id 或同步未开）→ S4 视为「不适用」；有名单但查询失败 → 拒发。
- **在联系人锁内计数**（`acquireContactLock` 之后、`claimAndSend` 之前）。锁只让两次发送排队，**不能**防「两个销售各发一封都合规」——那由 §8.5 管。
- **回信**：`sendMailReply`（回客人来信）本身**不受**这道闸，但回信发出后会出现在 S1 / S2 / S3 里被计入。「回信要不要算进那 2 封」是 PM 的业务口径，**默认算**（与「合计」一致、不会违规），见 §18-7。
- 配置 `frequency_cap=null` 即不设限（其他客户不受影响）；CTS 设 `{2, 7}`。**无例外通道**：PM 原话是「严格不超过」。
- **诚实的局限**：只数得到 ME 看得见的东西——已连接的邮箱和 Mailchimp 群发；员工私人邮箱发的、欢迎旅程发的数不到。
- **未核实、必须靠试跑回答**（§14）：①Graph 已发送箱按 `sentDateTime` 分页读取与 `$orderby` 组合是否按文档工作（文档确认 `$orderby` 的字段必须先出现在 `$filter` 里）；②Mailchimp 单人端点在非收件人时的返回码（文档没写）；③发送后消息 id 是否不变（决定去重是否精确）。

### 8.5 防重复跟进 `evaluateFollowUp`（魏征：两个销售可能各发一封）

锁只是排队，上限 2 封照样放第二封进去。所以另加两条（均在锁内）：
- `already_followed_up`：有系统通话证据时，该通话之后本客人已有 `sent` 的模板回执 → 拦；
- `duplicate_template`：同一模板、同一客人，`same_template_cooldown_hours`（缺省 24）内已有 `sent` 回执 → 拦。

### 8.6 补一个现有闸的洞：「咨询过我们」

`ENQUIRY_INBOUND_SOURCES` 里把 `phone/voipline` 加进去（入站来电），并加测试。**不扩大**到手记、外呼：销售主动打给营销名单里的人、对方在电话里说“发邮件给我”能不能发，是合规 / 业务口径，默认不允许（沿用 10-21 稿），见 §18-8。

## 9. 回执与 Inngest 事件（D）

- **回执同步写**：`sendMailNew` 返回的结果带一份 `meta`（模板键 / 版本、目录版本、通话依据、警告代码、渲染与最终文字的指纹、是否改过）；compose 路由在拿到结果后**立即插一行回执**（普通 `insert`，`23505` 当已写过），**不论结果、不依赖 Inngest**。路由整体 `try/catch`：抛异常也写 `outcome='failed'`、`block_reason='internal_error'`。回执写失败：信已发出的以审计行为准，写错误日志；被拦的尝试回执写失败只剩日志（已知缺口，PR 写明）。
- **事件**：回执写完后发 `crm.email_send.attempted`（仓库惯例 `<域>.<对象>.<动词>`），常量放 `src/lib/inngest/crm-email-events.ts`，契约测试锁名字与消费者。事件 id（幂等）：`crm_email_send:{client_id}:{contact_id}:{request_id}:{outcome}:{block_reason|-}`。发送用带 **2 秒超时**的 fetcher（现有 `sendInngestEvent` 没有超时），失败重试 1 次后只记日志——**信已经发出，事件丢失不得影响返回**。
- payload：`request_id、client_id、contact_id、actor_email、template_key|null、template_version|null、catalog_version|null、call_basis、outcome、block_reason|null、mailbox|null、conversation_id|null、provider_message_id|null、edited_after_render|null、warnings[]、rendered_sha256|null、final_sha256、auth_basis:'human_click'、created_at`。**不含邮箱地址、不含正文。**
- **事件的用处**：驱动「状态不明」的收口——新 Inngest 函数 `cloud-crm-email-send-receipt`（事件触发，重试 3 次，登记进 `cloudFunctions`；新事件名不在 `WORKER_OWNED_EVENTS` 里，不会和本机 worker 抢）对 `outcome='unknown'` 延迟 10 分钟调一次已有的对账，结案则**追加**一行 `sent / failed` 回执。其余结果函数直接结束。
- 授权语义：销售点「发送」= 授权事件（`auth_basis: 'human_click'`）；没有合法 `requestId` 的请求不发；**没有人点击就没有发送**。本流程无「发布 / 排期」，`no_publish` 不适用。
- 仍未结案的 `unknown`（对账后还是不明）进今日待办「需要你动手」的接口不在本稿，记为后续台账卡（管道不许断头）。
- 管理页底部「最近发送」读回执：时间 / 谁 / 模板 / 结果 / 被拦原因 / 客人（链接到抽屉），PM 不用问也能看到。

## 10. 附件与链接（决定：第一版**不做附件**）

1. 手册 PDF 里的价格会过期：目录里上海周边仍是旧价 NZ$3,399，官网是 NZ$2,699。附件会变成**第二个价格来源**，正是红线要避免的。
2. 官网团页就是最新逐日行程（目录里有逐日行程数据）；**链接永远是最新的，附件不是**。
3. 附件走 Graph 超过 3 MB 要用上传会话，还有大小、被拦、病毒扫描等一串另外的事。

若 PM 仍要 PDF：阶段二从**团目录的行程生成**（同一事实源），版本钉在模板版本上，存 Supabase 私有桶，不使用 Dropbox 里手工做的手册。

## 11. 模板管理与发信设置界面（A、E）

- 页面 `/dashboard/clients/[id]/crm/templates`，入口放进 CRM 导航（导航位置实现时核对，目前「客户跟进」入口在 `dashboard-shell.tsx:243`）。
- 列表：名称 / 状态 / 当前版本 / 最近修改 / 近 30 天发出与被拦次数。编辑：名称、选团方式（不选 / 选一个 / 选多个）、适用团过滤、主题、正文、变更说明；右侧用一个当前在售团的真实目录数据 + 测试姓名实时预览；保存时校验未知变量、超长、残留标记、链接、禁用词；保存 = 新版本；停用 / 启用 = 新版本；历史版本可「以这一版内容写新版本」。
- 发信设置面板（开关、发信邮箱、频次上限、灰度名单、链接白名单、禁用词、团页链接格式、冷却与提示时长）：FDE / PM 要填的字段**必须连界面一起做完**（CLAUDE.md §8）。
- **权限分三档**：
  - **使用**（看模板、预览、发送）= `requirePaidClientAccess`（付费客户员工）；
  - **新建 / 编辑 / 停用模板** = `requireOperatorAccess`（Magic Lab 内部账号与该客户的受限管理员）；
  - **设置（总开关、灰度名单、频次上限、禁用词、链接白名单）** = **仅全局管理员**，判据照 `auto-publish/revoke` 的先例：`isGlobalAdminEmail(email) && access.allowedClientId === null`。理由：`requireOperatorAccess` 也放行受限管理员，而这是「放宽对客外发刹车」的全局决定。
- **默认 CTS 员工不能改模板文字**（改动对外、有红线）；要不要开给 CTS 负责人是 PM 的业务决定，另说。
- 界面上线前必须跑 Impeccable 检查（`.claude/skills/impeccable`），PR 里写前后数字。

## 12. 种子模板（F）

两份，**写入时就是停用状态**，PM / Lisa 确认后才启用（启用 = 新版本）。内容只来自上架快照和 Lisa 原信；PR 里附逐句来源表（官网可溯 / 目录可溯 / Lisa 原信 / 未证实）。种子脚本默认干跑；**在生产库真跑 = 写生产数据，需要 PM 单独点头**。

1. `post-call-single-tour`（通话后跟进信 · 单团详情）：§6.4 的结构。Lisa 信里写死的事实全部换成变量；「guaranteed departure」「twin share」目录里没有，**删，不写**。
2. `spring-2027-follow-up`（春季团通用跟进信 · 3 / 5 月）：`pick_mode='many'`，`pick_filter.departure_months = [3, 5]`，正文 = 感谢通话 → `{{tour_cards}}` → 「全部团见 `{{all_tours_url}}`」→ 只让客人回信。2026-10-28 的上架数据里 3 月、5 月有班期的团包括：Best of China（3/11、5/13）、A Tale of Two Cities（3/18）、China Unveiled（3/22、5/15）、Shanghai & Surroundings（3/25、5/25）、Japan Cherry Blossoms（3/27）、几条 Signature 和 Vietnam Highlights（5 月）——**以种子写入那天的快照为准**。

## 13. 风险与护栏（A 级）

| 风险 | 护栏 |
|---|---|
| 发给错的人 | 收件人只取这个人名下已有邮箱（原有）；确认行显示完整地址；`expectedRecipient` 比对（原有） |
| 给没通过电话的人写「谢谢通话」 | 只认系统通话证据或销售亲手点击；手记 `spoke` 不算；`call_when` 缺依据即缺值拒发 |
| 发出过期 / 不存在的团、价格、日期 | 事实只读已发布快照；请求带模板版本 + 目录版本，不一致 409；发送时重验所选团仍在售且未售罄；团页链接与 `?date=` 静态校验；缺值拒发；金额漂移警告 |
| 写出红线内容（倒计时、免签、约电话） | 归一化后的文字检查，覆盖主题 + 正文 + 页脚；模板保存时同一份检查；模板只有内部账号能改 |
| 一周发超 2 封 | 频次闸：四个来源取并集、翻页到窗口起点、锁内、fail-closed；防重复跟进两条 |
| 配错 = 闸门被悄悄关掉 | 设置严格解析，坏值 / 缺键 = 拒发；设置在独立版本表，`leads-config` 保存碰不到；仅全局管理员可改 |
| 试跑发到真客人 | 灰度名单（必填键，类型错 = 拒发）；试跑第一步先对名单外联系人**干跑**，必须得到 `recipient_not_allowed` |
| 停用 / 改版后旧模板仍能发 | 发送只认当前最大版本且为启用 |
| 双击 / 重试发两封 | `requestId` + 联系人锁 + 对账（原有）；`findPriorSend` 加联系人条件（R3 加固） |
| 销售改预览后留下占位符 | `placeholder_left` 拦截（含单花括号、Mailchimp 合并标签、括号确认标记） |
| 越权读写别的客户的模板 / 联系人 | 所有查询带 `client_id`；模板 key、联系人 id 校验归属；有跨客户测试 |
| 变量值含 `{{` 或 `$&` | 先转义；函数式替换，渲染一遍完事 |
| 回执 / 事件泄露个人信息 | 只放 `contact_id`，不放邮箱与正文；试跑结果贴 PR 时也不贴收件人与正文 |
| 回执 / 事件丢失 | 回执同步写，不依赖 Inngest；事件只驱动对账 |
| 紧急刹车 | 全局管理员写一版 `enabled=false`（每次请求现读，无缓存）；或停用单个模板 |

## 14. 当场试跑计划（上线前；禁止借试跑发给真客人）

前置：PM 回「试跑」；迁移已由 PM 亲手合并并回「go apply」；部署完成。
0. **干跑（不建会话、不写审计、不建草稿、不碰 Graph 发送）**：只做渲染 + 各道闸判断，打印判断结果与四个来源的计数明细（只含数量、来源、时间；不含地址与正文）。先取 CTS 里**任一已有联系人**干跑，必须得到 `recipient_not_allowed`，**确认刹车有效后才继续**。
1. 全局管理员在设置面板写入 CTS 设置：`enabled=true`、`recipient_allowlist=[hello@magicengine.cloud]`、`frequency_cap {2,7}`、`guardrails`；启用两份种子。
2. 用 hello@ 测试联系人（经 `?contact=` 打开抽屉）：点「刚和他通过电话」→ 选单团模板、选 2027-03-11 班期 → 逐句对照目录与官网 → 发送 → 收到信 → 等同步 → **线程里只有这一封**（验证会话号一致，10-21 稿遗留项）→ Inngest 云端看到事件、函数运行成功、回执行存在。
3. 同一窗口再发第 2 封（允许）；第 3 封 → 被频次闸拦下，回执 `blocked / frequency_cap`。（hello@ 窗口里已有的旧邮件会占名额：先看干跑明细，选窗口干净的日子试。第 3 封之后 hello@ 在 7 天内再发会被拦，这是预期。）
4. 手改正文加入 `visa-free`、换成非白名单链接、故意留一个 `{{x}}`、用 `www.` 裸域名 → 各被拦，回执各一行；停用模板后发送 → `template_outdated`。
5. 7 天窗口的**边界**（6 天 23 小时放行 / 7 天 1 分钟放行）靠**真实时钟的单元测试**证明，试跑不负责；另在试跑后第 8 天安排一次复查（进日历）。
6. 目录改价后旧面板被拦（`catalog_outdated`）靠测试替身证明，**不改生产目录**。
7. 全部结果贴进 PR「## 当场试跑」：只贴状态、数量、请求号、回执行 id、指纹——**不贴收件人和正文**。**没跑通不说做好了**。
8. 试跑结束保持灰度名单不动；清空名单（真正上线）等 PM 说「开」。

## 15. 测试计划

- 纯逻辑：渲染器（未知变量 / 缺值 / 转义 / 不二次展开 / `$1 $& $'` 价格 / 多团小卡 / 价格与日期规则）；`first_name` 解析（称谓、纯数字、昵称、全大写、emoji、CJK）；通话依据（系统通话各 outcome、手记 `spoke` 不算、批量登记不触发、时间窗、之后已发邮件则不再提示）；文字检查（归一化后的绕过：U+2011 连字符、换行拆词、零宽字符、裸域名、`ctstours.co.nz.evil.com`、`user@host`、`?date=` 非在售、残留标记各形态、"no hurry" 不误拦）；版本新鲜（模板 / 目录各自过期 → 409；旧版本一行仍是 active 也被拦）；频次闸（n=0/1/2/3、四来源并集与去重、抄送密送、分页、任一来源失败 / 翻页翻不完 fail-closed、无 Mailchimp 名单的客户、配置 `null`=不设限）；防重复跟进；模板仓库（版本只增、`baseVersion` 冲突、跨客户隔离、追加触发器）；设置严格解析（字符串当名单 → 失败，缺键 → 失败）。
- **时间窗测试用真实时钟**（样本时间 = 真实 `Date.now()` 减 6 天 23 小时 / 7 天 1 分钟），**不手拨假时钟**；**编排层拿到来源结果后自己再按时间戳过滤一遍**，并单测拼出的查询串（否则假件自己带上过滤，测试照样全绿）；补「进锁之后才计数」的调用顺序测试；每个 guard 做**突变检验**（`>=` 改 `>`、窗口放宽，测试必须红）。DeepSeek 生成的测试尤其爱用假时钟，审 diff 时专查。
- 路由：三档权限（付费员工可用不可改；内部账号可改模板不可改设置；仅全局管理员可改设置）、跨客户 403 / 404、`requestId` 重放与跨联系人误用、compose 抛异常也写回执、Inngest 不可用时回执仍在、事件 payload 无个人信息、预览与发送调用同一个闸函数（spy）。
- 边界测试：新增共享文件里不得出现 `ctstours` / `CTS`；旅游词只许出现在 `facts/published-tours`；目录以外代码只引已允许的读取函数名，且不出现 `tour_catalog_` 字样。
- 加固项测试：发送锁释放时校验持有者；所有 Graph / Mailchimp 调用带超时。
- 全仓类型检查带 `NODE_OPTIONS=--max-old-space-size=10240` 并核对退出码；相关 vitest；本机 `npm run build`（带 CI 同款占位环境变量）；界面做 Impeccable + 375px / 桌面截图。

## 16. 分轮实施计划（DeepSeek 写，Claude Code 出指令、审 diff、跑检查；推送攒到阶段末一次推）

| 轮 | 内容 | 级 |
|---|---|---|
| R1 | 迁移（3 张表 + 追加触发器 + RLS）+ 类型 + 三个仓库（模板、设置、回执）+ 测试 | A（含迁移：PM 手合 + go apply） |
| R2a | 团目录侧：新增只读读取函数 + 更新边界测试允许名单 + 测试（不改现有输出） | A（对外数据边界） |
| R2b | 渲染器 + 变量 + `first_name` 解析 + `facts/published-tours` 提供者 + 测试 | B |
| R3 | 严格设置解析 + 各道闸共用函数 + 频次闸四来源 + `phone/voipline` 咨询依据 + 灰度名单 + 防重复跟进 + 接线 `sendMailNew` / `previewCompose` + `findPriorSend` 加联系人条件 + 发送锁持有者校验 + 调用超时 + 突变测试 | A |
| R4 | 路由（模板增删改查、预览 / 检查、compose 扩展、**设置读写（仅全局管理员）**）+ 回执写入 + 事件发送 + Inngest 函数与注册 + 契约测试 | A |
| R5 | 界面（`PostCallEmailBar`、选模板面板、管理页、设置面板）+ Impeccable | C |
| R6 | 种子脚本（默认干跑）+ 逐句来源表；**生产真跑需 PM 单独点头** | B |

每轮：本地测试绿 → 子牙 + 魏征各审一轮（A 级：设计、实现各一轮；设计一轮已在本稿完成）→ 再进下一轮。PR 提交信息带 `[cts.crm.email-tpl]`。

## 17. Reuse Statement（预填）

- **复用**：`sendMailNew` 全部既有闸 / 审计 / 对账；`previewCompose`；团目录**已发布快照**（新增一个只读读取函数，不改旧函数）；`isPhoneVerdict`（通话判据）；`isAutoReply`；`requirePaidClientAccess` / `requireOperatorAccess` / 全局管理员判据；Inngest 客户端、`cloudFunctions` 注册表；通话触点（只读）；Mailchimp 客户端 `listSentCampaigns` 与单人收件端点；追加型触发器的仓库先例。
- **platform-shared**：渲染器、变量引擎、各道闸、回执与事件及函数、三个版本化 / 追加型仓库、管理界面。
- **industry-specific（旅游版）**：团目录侧新读取函数、`facts/published-tours` 提供者（含团页链接与金额判定）。其他行业需要自己的事实提供者，本稿不预建抽象。
- **client-specific（CTS）**：模板正文、2/7 上限、白名单主机、禁用词、团页链接格式、`all_tours_url`、灰度名单——全在表行里。
- 共享运行时里没有客户名 / ID / 行业判断；由 §15 的边界测试钉住。
- 学习：回执是客户私有记忆；「哪个模板回信率高」要升到行业层需要多客户证据，现在没有。
- 与层级门决策时一致：一致（无新能力线）。

## 18. 未核实 / 开放项

1. Graph 已发送箱分页读取（`$filter` + `$orderby` 组合）按文档应可用，需试跑实测页数与耗时；2. Mailchimp 单人收件端点在非收件人时的返回码（文档只写了 200）；3. 发送后消息 id / `conversationId` 是否不变（沿用 10-21 稿遗留项）；4. 官网主机 `www.` 与否、`?date=` 参数行为、「全部团」页地址；5. CTS 员工署名 `display_name` 的内容质量（只数了个数）；6. CTS 员工里是否已有人登记了拨号手机；7. **「回信要不要算进那 2 封」**——PM 业务口径，默认算；「7 天 2 封」覆盖销售一对一按 PM 2026-10-28 口径执行，旧台账原文只写群发；8. **销售主动打给营销名单里的人、对方电话里说“发邮件给我”能不能发**——合规 / 业务口径，默认不允许，沿用 10-21 稿；9. **Mailchimp 欢迎旅程等自动流程发出的信数不到**——规则无法 100% 执行，由 126 号窗口决定怎么补发送记录；10. 谁能改模板：默认仅内部账号；11. 仍未结案的 `unknown` 进今日待办：后续卡；12. Mailchimp 群发前反向检查 1 对 1：交 126 号窗口另立卡；13. 团目录侧改动（R2a）要和目录窗口协调，动手前先看在飞的 PR。

## 19. 审查记录（设计一轮：子牙、魏征；2026-10-28）

| 来源 | 级 | 要点 | 处理位置 |
|---|---|---|---|
| 子牙 | BLOCK | 停用模板拦不住（旧版本行仍是 active） | §5.2「发送只认当前版」、§8.2 |
| 子牙 | BLOCK | 唯一读取口缺亮点 / 售罄 / 班期状态 | §6.3、§16 R2a |
| 子牙 | MAJOR | 提供者模块名会被边界测试拦 | §6.3（改名 `facts/published-tours`） |
| 子牙 | MAJOR | 旅游语义渗进共享闸与配置；团页链接未连 `?date=` 验；不带 template 可绕过 | §1、§5.5、§6.3 提供者钩子、§8.3-1 |
| 子牙 | MAJOR | 「预览跑同一份判断」做不到 | §2、§8.0 |
| 子牙 | MAJOR | 设置权限偏宽（受限管理员） | §11 三档权限 |
| 子牙 | MAJOR | 刹车会被 `leads-config` 整块写回悄悄改回去 | §5.1、§5.3 |
| 子牙 | MAJOR | 回执只靠事件；事件无超时；外键让 `audit_failed` 路径回执写不进；「只增不改」无强制 | §5.2、§5.4、§9 |
| 子牙 | MAJOR | 频次闸口径缺口（回信路径、自动流程、无 Mailchimp 客户） | §8.4 |
| 子牙 | MAJOR | 设置写入接口没落在任何一轮；R6 真跑要 PM 点头 | §16 R4 / R6 |
| 子牙 | MINOR | `authorization` 保留字；表达式唯一索引不能 upsert；指纹比对要先清洗；请求号不区分联系人 | §5.4、§8.3、§16 R3 |
| 魏征 | BLOCK | 手记 `spoke` 是兜底值，会给没通话的人写「谢谢通话」 | §2、§7.1、§6.1 `call_when` |
| 魏征 | BLOCK | 停用 / 改版 / 改价拦不住旧面板 | §8.2（模板版本 + 目录版本） |
| 魏征 | BLOCK | 频次闸静默少数（5 分钟、单邮箱、campaign 只含 sent、BCC、截断 100） | §8.4 四来源 + 翻页 + fail-closed |
| 魏征 | BLOCK | 配置写错 = 闸被关；allowlist 类型错被当空名单 | §5.5 严格解析、§8.1、§14-0 |
| 魏征 | MAJOR | 只靠来电咨询的人被判「没咨询过」（voipline） | §8.6 |
| 魏征 | MAJOR | 文字检查可绕过（归一化、页脚、裸域名、主机精确、`?date=`、合并标签、"no hurry"） | §8.3 |
| 魏征 | MAJOR | 价格里的 `$` 被正则替换吃掉 | §6.1 渲染规则、§15 |
| 魏征 | MAJOR | 两个销售各发一封 | §8.5 |
| 魏征 | MAJOR | 试跑方案：干跑会留草稿、第 4 步当天验不了窗口、备用地址过不了闸、PR 里贴了收件人与正文 | §14 |
| 魏征 | MAJOR | 测试可能假绿（来源自己带过滤） | §15 |
| 魏征 | MINOR | 锁释放不验持有者；Graph 无超时；compose 无 try/catch；`cleanDisplayName` 放过 "123"/"Guest"/"Mr John" | §16 R3、§9、§6.1 `first_name` |
| 魏征 | 事实更正 | 「手记 spoke = 聊上了」「每团有亮点」「预览跑同一份判断」「纯数字昵称当缺值」均不属实 | §2 已更正 |

**没有再让两位复核第二轮**：A 级规矩是设计、实现各一轮，设计这一轮已完成；实现阶段每轮再审。
