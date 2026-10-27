# CRM「通话后选模板发邮件」+ 邮件模板管理 — 设计稿 v0（2026-10-28）

窗口 127 起草。状态：**设计稿，待子牙 + 魏征审；未写代码、未建表、未打开任何开关。**
风险级：**A**（对客外发、撤不回；新增 2 张数据库表）。PR 保持草稿 + 正文写「风险级别：A」；PM 回「合 N」才合；含数据库迁移的那一份留给 PM 亲手合，并等 PM 回「go apply」才在生产库执行。
PM 2026-10-28 原话：「这个发送邮件的功能，我希望做到 CRM 内，在电话之后，可以点击选取 email 模板发送，所以我们需要在系统里建立好发信的通道，以及模板管理」。
所属闭环环节：**Act**（CRM 里的人工外联）。**Check** 的接口先留好（回执里记会话号和发出时间，以后可以算「发了多久有回信」），本稿不做报表。
前置设计：[`2026-10-21-crm-send-first-email-design-v0.md`](./2026-10-21-crm-send-first-email-design-v0.md)（发信通道，已合并；CTS 的开关关着）。本稿只扩展它、不改它已有的任何一道闸。

## 0. 一句话

通话结束（或销售手动登记「聊上了」）后，客人抽屉顶部出现「发跟进邮件」→ 选模板 → 价格、出发日、行程亮点、链接**自动从团目录「已上架」数据填好** → 看预览、可改 → 人点发送 → 走已有的 `sendMailNew`。
发信前**新增三道闸**（7 天最多 2 封 / 文字红线 / 模板来源），并且**每次尝试（发出、被拦、失败、状态不明）都出一条 Inngest 事件 + 一行回执**，写明谁发的、发给谁、哪个模板、为什么被拦。

## 1. 层级判定（me-platform-tier-gate · Inline）

- 渲染器、变量引擎、频次闸、文字检查、回执事件、模板仓库与管理界面 = **平台通用机制**，归现有「CRM 发信」能力的延伸（不新增能力线，不登记候选）。
- 团目录取数 = ME 旅游版（L2）**已有**的 `loadPublishedProducts`；本稿不另建事实源。
- CTS 的模板正文、上限数字（7 天 / 2 封）、链接白名单、禁用词、团页链接格式 = **L4 客户数据与配置**（表行 + `leads_config.email_compose`），不进共享代码。
- 换客户测试：换成 NAL（物流）——没有团目录，模板用 `pick_mode='none'` 照样能发，渲染器和闸不用改，只换模板和上限；换成悉尼地产客户——同上，另需一个房源事实提供者（本稿只留接口位置，不建抽象，见 §6.3）。
- 换行业测试：共享代码里出现的旅游词（`tour_*` 变量）**只许出现在 `facts/tour-catalog` 这一个提供者模块里**，其余共享文件不得出现；有边界测试钉住（§15）。

## 2. 现状（只读核对，2026-10-28；每条带出处）

| 项 | 现状 | 出处 |
|---|---|---|
| 发信通道 | `sendMailNew` 已写完并合并：开关 → 收件人 → 只发给咨询过的人 → 别再联系 → 选邮箱 → 去重 → 对账 → 配额 → 抢锁 → 先写会话与审计 → 建草稿 → 发送 → 补记录；`previewCompose` 给界面用同一套判断 | `src/lib/microsoft/mail-send-new.ts` |
| 路由与界面 | `POST …/contacts/[cid]/email/compose`；`ComposeEmail` 只在「这个人没有可回复的邮件线」时渲染，开关关着时静默什么都不显示 | `…/email/compose/route.ts`；`ComposeEmail.tsx:66`；`PersonDrawer.tsx:759-777` |
| CTS 的开关 | **关着**。生产库实查：`leads_config.email_compose` 为 null（该 JSON 现有键：booking_schedule、email_briefs、mailchimp_audience_id、mailchimp_enabled、meta_leads、own_email_domains、paid_tagging、payment_email_detect、trade_domains） | 生产库只读，2026-10-28 |
| 邮件模板 | **没有**。全仓迁移里没有任何名含 templ / snippet / canned / macro 的表，也没有界面 | `supabase/migrations` 检索 |
| 团目录 | 已上线并发布：CTS 已发布 2 版（最新 2026-10-26），34 个团、30 个在售。每团有名称、天数、官网价格文案、亮点、含什么、班期（日期 / 状态 / 班期价）。**对外渠道只许用 `loadPublishedProducts` 读**，边界测试强制：目录以外的代码不许出现 `tour_catalog_*` 表名，只许引这一个读取函数和类型模块 | `src/lib/tour-catalog/store-publish.ts:153`；`__tests__/boundary.test.ts`；生产库只读 |
| 官网团页链接格式 | `/tours/{destination}/{tier}/{slug}`，选了班期则带 `?date=YYYY-MM-DD`（官网首页 2026-10-28 抓取 + 广告配置两处印证）。官网主机用 `www.` 还是不带，未核实 | `ads-tracking-preflight/client-config.ts:27` |
| 通话记录 | 两条路径都落到 `contact_touchpoints`（channel=phone）：①系统通话：元数据含 `reached / answered / talk_seconds / logged_by`；②销售手动登记：source=`me_manual`，元数据含 `outcome`（`spoke` = 聊上了）、`logged_by` | `voipline/store.ts:330-348`；`crm/touchpoints.ts:158` |
| 员工拨号 | 10-25 审计时 CTS 7 个员工账号拨号全部失败（登记表只有 PM 一个号）；其后 PR 3299 加了就地登记手机号入口，是否已有员工登记**未核实**。所以**手动登记是现实主路径**，两条都要支持 | `docs/audits/2026-10-25-crm-pages-user-view-audit.md` §5.3；`CallButton.tsx` |
| 群发邮件的记录 | Mailchimp 同步只写**入站**的打开 / 点击触点；**没有「发给了谁」的出站记录**。Mailchimp 的 key 是整个账号共用的一把，名单按客户分 | `src/lib/mailchimp/sync.ts:152-170` |
| 「7 天 2 封」 | 台账 2026-10-08 PM 原话「每个客户一周内严格不超过两次」，当时范围写「凡是对客人群发都算」；PM 2026-10-28 的口径是「含群发与销售一对一」。**全仓没有任何代码在拦** | `docs/ledger/2026-10-08-cts-email-two-per-week-cap.md` |
| 员工署名 | `client_portal_users.display_name` 列存在，CTS 7 个账号全有值（只数了个数，没读名字） | 生产库只读 |
| 测试联系人 | CTS 里有 1 个 hello@magicengine.cloud 联系人，名下 12 条入站邮件触点（满足「咨询过我们」）。`own_email_domains` 含 magicengine.cloud，但 `sendMailNew` 调 `classifySender` 时没传自己人域名，所以不会因此拒发 | `mail-send-new.ts:162`；生产库只读 |
| 范例信 | Lisa 写给客人的跟进信，润色版在 hello@ 草稿箱：感谢通话 → 7 条卖点 → 价格与包含 → 行程 PDF → 只让客人回信；信里有 2 处「Lisa to confirm」（保证出发 / 每人还是双人间）。**信里的 12 月 22 日圣诞团已下架**：已发布目录 30 个在售团里没有圣诞团、没有 2026-12-22 班期 | Gmail 草稿；生产库只读 |

## 3. 范围

**做**：A 模板管理（列表 / 新建 / 编辑 / 停用 / 历史版本）；B 通话后入口 + 选模板 + 预览可改 + 发送；C 发信前新增三道闸；D Inngest 事件与回执；E 发信设置面板（仅内部账号）；F 两份种子模板（默认停用）。
**不做（本轮）**：群发；AI 起草（试跑里 AI 曾编出「价格有有效期」，见 `2026-10-26-crm-email-briefs`）；HTML / 富文本；**附件**（原因见 §10）；WhatsApp / 短信模板；给 Mailchimp 群发加「反向检查 1 对 1 已发」（交 newsletter 的 126 号窗口另立卡）；回信率报表（只留接口）。

## 4. 总体流程

```
通话结束（系统记录）/ 销售登记「聊上了」 ──► 抽屉出现提示条「发跟进邮件」
   │（没有通话也能手动点「用模板写邮件」）
   ▼
选模板 ─► 模板要选团时：选团 + 出发日（只列「已上架且有可售班期」的）
   ▼
服务端渲染预览  POST …/email/templates/[key]/preview
   返回：主题 / 正文 / 缺值清单 / 警告 / 能不能发（被拦原因）/ 7 天已发 N 封
   ▼
人可改主题和正文 ─► 点发送  POST …/email/compose（新增可选 template 字段）
   ▼
sendMailNew：校验 → 开关 → 收件人（含试运行名单）→ 咨询过 → 别再联系 → 选邮箱
   → 去重 → 【新】模板来源 → 【新】文字检查 → 对账 → 配额 → 抢锁
   → 【新】7 天频次闸（锁内）→ 先写会话与审计 → 建草稿 → 发送 → 补记录
   ▼
不论结果：发 Inngest 事件 crm.email_send.attempted ─► 函数写一行回执
```

## 5. 数据模型

### 5.1 不加表、存 `leads_config` JSON 行不行？——评估：**配置继续放 JSON，内容必须放表**

| 考察点 | 放 `clients.leads_config` JSON | 放新表 |
|---|---|---|
| 并发保存 | `leads_config` 是 9 个键共用的一块，保存路径是「读整块 → 合并 → 写回整块」（`leads-config/route.ts:229-239`）；两人同时保存，后写的静默覆盖先写的，模板改动或别的设置都可能丢 | 一版一行，冲突由唯一键拦下并提示刷新 |
| 对外文案的留痕 | 没有历史；回执写不了「用的是哪一版」 | 版本只增不改，回执记 key + 版本号 |
| 体积 | 一份正文最长 1 万字，十几份就是上百 KB，塞进被到处读取的 `clients` 行 | 不影响 `clients` |
| 迁移成本 | 无 | 一份迁移（只新增 2 张表，不动旧表），走 A 级流程 |

结论：**小而稳的配置**（开关、邮箱、上限、白名单）继续用已有的 `leads_config.email_compose` 和已有读取器；**会被多人编辑、需要留痕的内容**（模板）与**回执**进新表。

### 5.2 `crm_email_templates`（只增不改，一版一行）— DDL 草案（以迁移文件为准）

```sql
create table public.crm_email_templates (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  template_key text not null check (template_key ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  version integer not null check (version >= 1),
  name text not null check (char_length(name) between 1 and 120),
  subject text not null check (char_length(subject) between 1 and 400),   -- 含占位符的模板文本；渲染后另限 200
  body text not null check (char_length(body) between 1 and 10000),
  fact_source text not null default 'none',          -- 'none' | 'tour_catalog'；应用层白名单校验，换行业不用改表
  pick_mode text not null default 'none' check (pick_mode in ('none', 'one', 'many')),
  pick_filter jsonb not null default '{}'::jsonb,    -- {destinations?, tiers?, departure_months?}
  status text not null check (status in ('active', 'disabled')),
  change_note text check (change_note is null or char_length(change_note) <= 300),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (client_id, template_key, version)
);
```
- 「当前版」= 同一 `template_key` 的最大 `version`；**停用 / 启用也是写一个新版本**。任何一行写入后不改、不删。
- 编辑提交 `baseVersion`，服务端写 `baseVersion + 1`；唯一键冲突或 `baseVersion` 不是当前最大版 → 409「别人刚改过，请刷新」。
- RLS：`enable row level security` + `create policy … for all to service_role using (true) with check (true)` + `revoke all … from anon, authenticated`（**必须带 `to service_role`**，见 CLAUDE.md §7）。

### 5.3 `crm_email_send_receipts`（回执，幂等）

```sql
create table public.crm_email_send_receipts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  request_id uuid not null,
  contact_id uuid references public.contacts(id) on delete set null,
  actor_email text not null,                   -- 谁发的（登录邮箱）
  template_key text, template_version integer, -- 哪个模板；自由写信时为空
  outcome text not null check (outcome in ('sent', 'blocked', 'failed', 'unknown')),
  block_reason text,                           -- 被拦原因代码，如 frequency_cap
  mailbox text,
  conversation_id uuid references public.conversations(id) on delete set null,
  provider_message_id text,
  edited_after_render boolean,                 -- 销售是否改过系统渲染的文字
  warnings text[] not null default '{}',       -- 当时提示过的警告代码
  rendered_sha256 text, final_sha256 text,     -- 只存指纹，不存正文
  authorization text not null default 'human_click' check (authorization = 'human_click'),
  created_at timestamptz not null default now()
);
create unique index crm_email_send_receipts_attempt_key
  on public.crm_email_send_receipts (client_id, request_id, outcome, coalesce(block_reason, ''));
create index crm_email_send_receipts_recent_idx on public.crm_email_send_receipts (client_id, created_at desc);
```
- **不存收件人邮箱和正文**（正文本来就在 `conversation_outbound_log`，收件人通过 `contact_id` 查）。「发给谁」= `contact_id`。
- 幂等键让 Inngest 重投同一事件不会写出重复行。

### 5.4 配置键（`leads_config.email_compose` 内新增；已有 5 个键不变）

| 键 | 含义 | CTS 初始值（L4，属配置不属代码） |
|---|---|---|
| `frequency_cap` `{max, window_days}` | 同一客人滚动窗口内最多几封；**缺省 = 不设上限**，不影响别的客户 | `{max: 2, window_days: 7}` |
| `guardrails.allowed_link_hosts` | 正文里链接允许的主机 | ctstours.co.nz 与其 www 形式（以试跑核实的最终主机为准） |
| `guardrails.rules[]` `{id, phrases[], message, severity}` | 禁用语句；`phrases` 是**字面短语**（不区分大小写、整词匹配），**不接受正则**（防 ReDoS）；`severity` = `block` 或 `warn` | 见 §8.2 |
| `tour_url_pattern`、`all_tours_url` | 团页链接格式、「全部团」页 | 试跑核实后写入 |
| `recipient_allowlist` | **非空时只能发给名单内地址**（灰度 / 试运行用） | 试跑期 = 测试地址；上线由 PM 一句话清空 |
| `call_prompt_hours` | 通话后多久内显示提示条 | 缺省 24 |

## 6. 模板与渲染

### 6.1 占位符

写法 `{{name}}`（容忍花括号内空格），列表类可带数量 `{{tour_highlights:7}}`。**保存模板时**未知变量名、与 `pick_mode` 不匹配的变量一律拒绝（`{{frist_name}}` 这种错字进不了库）。

| 变量 | 来源 | 缺值时 |
|---|---|---|
| `first_name` | 客人姓名经 `cleanDisplayName` 清洗后的第一个词；像邮箱 / 昵称 / 纯数字 / 占位名 → 当缺 | 拒发，预览里该处高亮，要求销售手填 |
| `sender_name` | 登录员工 `display_name` 的第一个词 | 同上 |
| `call_when` | 最近一次接通通话在客户时区是今天 / 昨天 / 更早 → `today` / `yesterday` / `recently` | **有兜底**（`recently`），不拦 |
| `tour_name` `tour_duration` `tour_price` `departure_date` `tour_url` `tour_highlights[:N]` `tour_inclusions` | `pick_mode='one'`：所选团 / 班期，见 §6.3 | 没选团或目录里这项为空 → 拒发 |
| `tour_cards` | `pick_mode='many'`：每个所选团渲染成固定四行小卡（名称与天数 / 出发日 / 价格 / 链接） | 一个都没选 → 拒发 |
| `all_tours_url` | 客户配置 | 没配置 → 拒发 |
| `input.<name>` | 模板里声明的临时填写项（销售手填一句话） | 空 → 拒发 |

渲染规则：
- 变量值里出现的 `{{` 先转义，**不二次展开**；输出纯文本；换行规范化；主题经已有 `sanitizeSubject`，渲染后超 200 字 → 拒发并提示。
- 渲染结果里**残留** `{{`、`}}`，或形如 `[… confirm …]`、`[TBC]`、`[待确认]` 的方括号标记（Lisa 草稿里就有）→ 发送被拦（`placeholder_left`）。
- 价格：`tour_price` = 官网价格文案**原样**（如「From NZD $4,080 per person」）；所选班期有班期价且文案里不含这个金额时，附一句「this departure: NZD $4,380」。**不替官网文案补「per person」「twin share」**——目录写什么就引什么。
- 日期：`D Month YYYY`（英文月份全称，日不补零，与官网 `departureDates` 一致）。

### 6.2 渲染是纯函数

`renderTemplate(template, context) → { subject, body, missing[], usedVariables[] }`。`context` 由服务端装配（联系人、员工、所选团、通话），**浏览器不传事实，只传「选了哪个团哪天」和手填项**。

### 6.3 团目录取数（唯一读取口）

- `loadPublishedProducts(db, clientId, today)`：官网同款的**已发布快照**，已按规格 §5 过滤——过期班期、`sold_out / closed / cancelled` 班期不输出；整团不可售则 `is_active=false`。`today` = 客户时区（CTS 为 Pacific/Auckland）的今天，沿用 CRM 已有取法。
- 选团列表只列 `is_active` 且有可售班期（或该团不管班期）的团，再按模板的 `pick_filter` 过滤（档位 / 目的地 / 出发月份）。
- **发送时重验**：请求带的 `picks`（`tourId` + 班期日期）要在**最新**已发布快照里仍然在售，否则拒发（`tour_unavailable`）——预览之后团被下架，这一道会拦住。
- 只做一个事实提供者（`tour_catalog`）。为别的行业留的位置只是 `fact_source` 这一列和提供者模块边界，**不预建抽象**。

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

### 7.1 触发规则（纯函数 `findRecentConnectedCall`）

近 `call_prompt_hours`（缺省 24）小时内，该联系人有一条 channel=phone 的触点，且**接通**：`metadata.reached === true`，或 `answered && talk_seconds > 0`，或 `outcome === 'spoke'`。**该通话之后**若已有发给他的出站邮件（出站邮件触点或本功能的 `sent` 回执），不再提示。来电与外呼都算；谁打的不限，显示「刚和他通过电话（时间，谁）」。

### 7.2 界面

- 新组件 `PostCallEmailBar`，放在抽屉回复区顶部（`PersonDrawer.tsx` 的 `drawer-replies` 容器内、`EmailReply` 之前）：
  - 近期有接通通话 → 醒目提示条「📞 刚和他通过电话（今天 10:42，Lisa）· 发跟进邮件？[选模板]」；
  - 没有 → 折叠成一个小按钮「用模板写邮件」（**不打电话也能用**）。
- 手动登记路径：销售点现有「打通了，记一笔」/ 写笔记保存后，抽屉本来就会重读触点（`setTimelineKey`），提示条自然出现，**不加新按钮**。系统通话路径：挂断约 2 分钟触点落库，`dialedAt` 后 10 分钟内每 30 秒轻量重读一次。
- 选模板面板在抽屉内联展开（不弹窗）：模板列表（只列启用的、过滤后可用的）→ 选团 / 班期（需要时）→ 预览（主题输入框 + 正文文本框，可改）→ 提示区（缺值红字 / 警告黄字 / 被拦原因）→ 确认行「将用 {邮箱} 发给 {地址}（最近 7 天已收 N 封，上限 2）」→ [发送]。
- 与现有两块的关系：`ComposeEmail`（自由写第一封）原样保留；已有邮件线的人（`EmailReply` 显示）也能用模板，但这是**一封新邮件、新主题，不是回复**，面板里写明。
- 功能没开通时：普通员工什么都不显示（与 `ComposeEmail` 一致）；**内部账号**看到一行灰字「邮件功能未开通」+ 设置入口（10-25 审计批评过「装了没开且不告诉人」）。

## 8. 发信前新增三道闸（C、E）

三道闸都在 `sendMailNew` 里，预览（`previewCompose`）跑同一份判断，所以「界面说能发」和「真发那一刻」不会各说各话。

### 8.1 频次闸 `frequency_cap`（E：「7 天 2 封」怎么做进发信闸）

**规则**：该客人**名下全部邮箱地址**（主邮箱 + 身份邮箱）在滚动 `window_days × 24 小时`内收到我们的邮件封数 `n`；`n >= max` 即拒发（409，`frequency_cap`），文案带明细与「最早 {时间} 可再发」。允许发的条件是 `n <= max - 1`，即含这一封**总数不超过 `max`**。`nextAllowedAt` = 按时间升序第 `n - max` 条（从 0 数）的时间 + 窗口。

**数什么（三个来源合并去重）**：

| 来源 | 取法 | 覆盖 |
|---|---|---|
| ① 发信邮箱的「已发送」（Graph，实时） | `GET /me/mailFolders/sentitems/messages`，按 `sentDateTime` 与收件人过滤，排除自动回复（沿用 `isAutoReply`） | 本系统发的 + 销售直接在 Outlook 里发的 + 之前同步没跟上的 |
| ② 本系统审计行 | `conversation_outbound_log`：近 5 分钟内创建、状态 pending / sent、且 id 不在①里的 | 补①的延迟，保证刚发的那封立刻算数 |
| ③ Mailchimp 群发 | `listSentCampaigns` 取窗口内已发出的 campaign（按该客户名单过滤），逐个查该地址是不是收件人（`/reports/{id}/sent-to/{subscriber_hash}`）；数量通常 0–3 个 | 群发 |

- **在联系人锁内数**（`acquireContactLock` 之后、`claimAndSend` 之前），防两个人同时发都通过。
- **fail-closed**：任何来源查询失败 → 拒发（`frequency_unverifiable`，「暂时数不清他这周收了几封，先别发，稍后再试」）。预览时查失败只显示「未能核对」，不置灰，最终以发送时为准。
- `max` / `window_days` 来自配置，**缺省不设上限**；CTS 设 `{2, 7}`。**无例外通道**：PM 原话是「严格不超过」；以后若要给「客人在电话里要求发的」开例外，是 PM 的业务决定，另立卡。
- 窗口边界按**真实时间**算，不按日历周。
- **诚实的局限**：只数得到 ME 看得见的东西——已连接的 info@ 邮箱和 Mailchimp；员工用私人邮箱发的数不到。反方向（群发前数 1 对 1）不在本稿。
- **未核实、必须靠试跑回答**（见 §14）：①Graph 对「收件人 + 发送时间」组合过滤是否可用（备选：拉近 7 天已发送前 100 封本地过滤）；②Mailchimp `sent-to/{hash}` 单人端点（备选：同步时补记「已发给」触点，另立卡）；③发送后消息 id 是否不变（决定①②去重是否精确；不精确则只会**多数**，方向是保守的，但会误拦——试跑要量）；④Mailchimp 现有客户端读不出 campaign 的名单 id，需要在 `normaliseCampaign` 里多读 `recipients.list_id`（共享文件小改 + 测试）。

### 8.2 文字检查 `guardrails`（纯函数，无网络，预览与发送跑同一份）

1. **链接**：正文里每个 URL 的主机必须在 `allowed_link_hosts`；匹配 `tour_url_pattern` 的团页链接，其 `{destination}/{tier}/{slug}` 必须在**最新已发布快照里是在售团**——挡住「下架团页仍返回 200 但内容是通用列表页」这类链接（CTS 官网的下架团页就是这样，欢迎信里踩过；只看 HTTP 200 验不出来）。违反 → 拦。
2. **残留标记**：见 §6.1，拦。
3. **禁用语句**：配置里的规则，`block` 拦、`warn` 在预览里黄字提示但不拦。CTS 初始规则（**属 L4 配置，随配置落库，不写进代码；严重度由 PM 审**）：
   - `block`：销售截止 / 倒计时类（countdown、last chance、limited time、hurry、book before、seats left）；免签类（visa-free、visa free、no visa required——PM 规定只写「以 CTS 确认为准」）。
   - `warn`：约电话 / 会议类（只匹配**邀请**说法：give me a call、call me、schedule a call、book a call、zoom 等；**不**匹配「phone call」本身，否则「Thank you for the phone call」会误拦）。严重度先设 warn，PM 要拦再改配置。
4. **金额漂移（warn）**：最终正文里的金额若不在所选团的价格文案 / 班期价 / 单人附加费里，黄字提示「这个金额不在官网上架数据里，请确认是销售确认过的价格」——对应 PM 的「价格只引官网或销售确认」，不硬拦（销售确认的特价是合法来源），但警告代码进回执。

### 8.3 模板来源闸

请求带 `template` 时：模板必须属于该客户、请求的版本存在且 `status='active'`（模板在编辑过程中被停用 → `template_unavailable`）；服务端用 `key + version + picks + inputs` **自己重新渲染**，与最终文字比对得出 `edited_after_render`，**不信任浏览器传来的指纹**。

### 8.4 `recipient_allowlist`（灰度）

配置非空时，`resolveSend` 只放行名单内地址（`recipient_not_allowed`）。作用：试跑期开着功能也**物理上发不到真客人**；上线 = PM 一句话清空名单。

## 9. Inngest 事件与回执（D）

- 事件名 `crm.email_send.attempted`（仓库惯例 `<域>.<对象>.<动词>`），常量放 `src/lib/inngest/crm-email-events.ts`，契约测试锁名字与消费者。一个事件覆盖四种结果，`outcome` ∈ `sent | blocked | failed | unknown`。
- 事件 id（幂等）：`crm_email_send:{client_id}:{request_id}:{outcome}:{block_reason|-}`。
- payload：`request_id、client_id、contact_id、actor_email、template_key|null、template_version|null、outcome、block_reason|null、mailbox|null、conversation_id|null、provider_message_id|null、edited_after_render|null、warnings[]、rendered_sha256|null、final_sha256、authorization:'human_click'、created_at`。**不含邮箱地址、不含正文。**
- 发出点：compose 路由在 `sendMailNew` 返回后**不论结果**发一次（requestId 不是合法 UUID 的 400 除外）。发事件失败**不影响已发出的信**：重试 1 次，仍失败写错误日志；`sent / failed / unknown` 另有审计行兜底，**被拦的尝试在事件丢失时只剩日志**——这是已知缺口，PR 里写明。
- 消费者：新 Inngest 函数 `cloud-crm-email-send-receipt`（事件触发，重试 3 次）→ 幂等写 `crm_email_send_receipts`；`outcome='unknown'` 的再延迟 10 分钟调一次已有的对账，结案则补写 `sent / failed` 回执。登记进 `cloudFunctions`；新事件名不在 `WORKER_OWNED_EVENTS` 里，不会和本机 worker 抢。
- 授权语义：销售点「发送」= 授权事件（`authorization: 'human_click'`）；没有合法 `requestId` 的请求不发；**没有人点击就没有发送**。本流程无「发布 / 排期」，`no_publish` 不适用。
- 仍未结案的 `unknown`（对账后还是不明）进今日待办「需要你动手」的接口不在本稿，记为后续台账卡（管道不许断头）。
- 管理页底部「最近发送」读回执：时间 / 谁 / 模板 / 结果 / 被拦原因 / 客人（链接到抽屉），PM 不用问也能看到。

## 10. 附件与链接（决定：第一版**不做附件**）

1. 手册 PDF 里的价格会过期：目录里上海周边仍是旧价 NZ$3,399，官网是 NZ$2,699。附件会变成**第二个价格来源**，正是红线要避免的。
2. 官网团页就是最新逐日行程（目录里有逐日行程数据）；**链接永远是最新的，附件不是**。
3. 附件走 Graph 超过 3 MB 要用上传会话，还有大小、被拦、病毒扫描等一串另外的事。

若 PM 仍要 PDF：阶段二从**团目录的行程生成**（同一事实源），版本钉在模板版本上，存 Supabase 私有桶，不使用 Dropbox 里手工做的手册。

## 11. 模板管理与发信设置界面（A、E）

- 页面 `/dashboard/clients/[id]/crm/templates`，入口放进 CRM 导航（导航位置实现时核对，目前「客户跟进」入口在 `dashboard-shell.tsx:243`）。
- 列表：名称 / 状态 / 当前版本 / 最近修改 / 近 30 天发出与被拦次数。编辑：名称、选团方式（不选 / 选一个 / 选多个）、适用团过滤、主题、正文、变更说明；右侧用一个当前在售团的真实目录数据 + 测试姓名实时预览；保存时校验未知变量、超长、残留标记、链接白名单、禁用词；保存 = 新版本；停用 / 启用 = 新版本；历史版本可「以这一版内容写新版本」。
- 发信设置面板（开关、发信邮箱、频次上限、链接白名单、禁用词、团页链接格式、灰度名单、提示时长）：FDE / PM 要填的字段**必须连界面一起做完**（CLAUDE.md §8）。
- 权限：**查看 / 使用** = `requirePaidClientAccess`；**新建 / 编辑 / 停用 / 设置** = `requireOperatorAccess`（Magic Lab 内部账号与该客户的受限管理员）。开关由员工自己能改就形同虚设，所以设置只给内部账号。**默认 CTS 员工不能改模板文字**（改动对外、有红线）；要不要开给 CTS 负责人是 PM 的业务决定，另说。
- 界面上线前必须跑 Impeccable 检查（`.claude/skills/impeccable`），PR 里写前后数字。

## 12. 种子模板（F）

两份，**写入时就是停用状态**，PM / Lisa 确认后才启用。内容只来自上架快照和 Lisa 原信；PR 里附逐句来源表（官网可溯 / 目录可溯 / Lisa 原信 / 未证实）。种子脚本默认干跑。

1. `post-call-single-tour`（通话后跟进信 · 单团详情）：§6.4 的结构。Lisa 信里写死的事实全部换成变量；「guaranteed departure」「twin share」目录里没有，**删，不写**。
2. `spring-2027-follow-up`（春季团通用跟进信 · 3 / 5 月）：`pick_mode='many'`，`pick_filter.departure_months = [3, 5]`，正文 = 感谢通话 → `{{tour_cards}}` → 「全部团见 `{{all_tours_url}}`」→ 只让客人回信。2026-10-28 的上架数据里 3 月、5 月有班期的团包括：Best of China（3/11、5/13）、A Tale of Two Cities（3/18）、China Unveiled（3/22、5/15）、Shanghai & Surroundings（3/25、5/25）、Japan Cherry Blossoms（3/27）、几条 Signature 和 Vietnam Highlights（5 月）——**以种子写入那天的快照为准**。

## 13. 风险与护栏（A 级）

| 风险 | 护栏 |
|---|---|
| 发给错的人 | 收件人只取这个人名下已有邮箱（原有）；确认行显示完整地址；`expectedRecipient` 比对（原有） |
| 发出过期 / 不存在的团、价格、日期 | 事实只读已上架快照；发送时重验所选团仍在售；团页链接静态校验；缺值拒发；金额漂移警告 |
| 写出红线内容（倒计时、免签、约电话） | 文字检查；模板只有内部账号能改；保存模板时同一份检查 |
| 一周发超 2 封 | 频次闸：锁内、fail-closed、三来源；预览同判 |
| 双击 / 重试发两封 | `requestId` + 联系人锁 + 对账（原有，不改） |
| 销售改预览后留下占位符 | `placeholder_left` 拦截 |
| 模板被悄悄改 | 版本只增不改 + 操作者记录 + 回执记版本号 + 仅内部账号可改 |
| 误开 | `enabled` 默认 false；灰度名单；设置仅内部账号 |
| 越权读写别的客户的模板 / 联系人 | 所有查询带 `client_id`；模板 key、联系人 id 校验归属；有跨客户测试 |
| 变量值含 `{{` 被二次展开 | 先转义，渲染一遍完事 |
| 回执 / 事件泄露个人信息 | 只放 `contact_id`，不放邮箱与正文 |
| 事件丢失 | 已发的信以审计行为准；被拦的尝试丢失只剩日志——已知缺口，PR 写明 |
| 紧急刹车 | 把 `enabled` 设为 false（每次请求现读配置，无缓存）；或停用单个模板 |

## 14. 当场试跑计划（上线前；禁止借试跑发给真客人）

前置：PM 回「试跑」；迁移已由 PM 亲手合并并回「go apply」；部署完成。
1. 干跑（不发）：走完发信判断，打印选中的邮箱、收件人、渲染文字、三道闸的计数明细；**建草稿后立即删除**。
2. 配置 CTS：`enabled=true` + `recipient_allowlist` = 两个 PM 自己的地址（hello@ 与一个备用）+ `frequency_cap {2,7}` + `guardrails`。启用两份种子。
3. 用 hello@ 测试联系人（经 `?contact=` 打开抽屉）：手动登记「打通了」→ 提示条出现 → 选单团模板、选 2027-03-11 班期 → 逐句对照目录与官网 → 发送 → 收到信 → 等同步 → **线程里只有这一封**（验证会话号一致，10-21 稿遗留的未核实项）→ Inngest 云端看到事件、函数运行成功、回执行存在。
4. 同一天再发第 2 封（允许）；第 3 封 → 被频次闸拦下，回执 `blocked / frequency_cap`；用备用地址验证窗口边界。
5. 手改正文加入 `visa-free`、换成非白名单链接、故意留一个 `{{x}}` → 各被拦，回执各一行；停用模板后发送 → `template_unavailable`。
6. 量化未核实项：Graph 过滤、Mailchimp 单人端点、id 稳定性是否成立；不成立走备选。
7. 全部输出贴进 PR「## 当场试跑」（触发方式、时间、运行状态、输出摘要）。**没跑通不说做好了**。
8. 试跑结束保持灰度名单不动；清空名单（真正上线）等 PM 说「开」。

## 15. 测试计划

- 纯逻辑：渲染器（未知变量 / 缺值 / 转义 / 不二次展开 / 多团小卡 / 价格与日期规则）；触发规则（各 outcome、时间窗、之后已发邮件则不再提示）；频次闸（n=0/1/2/3、窗口边界、三来源任一失败 fail-closed、去重、配置缺省不设限）；文字检查（块 / 警 / 主机 / 团页链接 / 残留标记 / 整词匹配不误伤）；模板仓库（版本只增、`baseVersion` 冲突、跨客户隔离）。
- **频次闸与时间窗的测试用真实时钟**（样本时间 = 真实 `Date.now()` 减 6 天 23 小时 / 7 天 1 分钟），**不手拨假时钟**，并做**突变检验**（`>=` 改 `>`、窗口放宽，测试必须红）——假时钟会让核心逻辑删掉测试照样全绿，DeepSeek 生成的测试尤其爱这么写。
- 路由：鉴权（付费员工可用、不可改；内部账号可改）、跨客户 403/404、`requestId` 重放、事件 payload 无个人信息。
- 边界测试：新增共享文件里不得出现 `ctstours` / `CTS`；`tour_*` 变量名只许出现在 `facts/tour-catalog`；目录以外代码仍只引 `loadPublishedProducts`。
- 每个 guard 做突变检验；全仓类型检查带 `NODE_OPTIONS=--max-old-space-size=10240` 并核对退出码；相关 vitest；本机 `npm run build`（带 CI 同款占位环境变量）；界面做 Impeccable + 375px / 桌面截图。

## 16. 分轮实施计划（DeepSeek 写，Claude Code 出指令、审 diff、跑检查；推送攒到阶段末一次推）

| 轮 | 内容 | 级 |
|---|---|---|
| R1 | 迁移（2 张表）+ 类型 + 模板仓库（版本、冲突、隔离）+ 测试 | A（含迁移：PM 手合 + go apply） |
| R2 | 渲染器 + 变量 + `facts/tour-catalog` 提供者（`loadPublishedProducts` 适配、日期 / 价格规则）+ 测试 | B |
| R3 | 三道闸 + 配置扩展 + `recipient_allowlist` + 接线 `sendMailNew` + Mailchimp 客户端多读 `list_id` + 突变测试 | A |
| R4 | 路由（模板增删改查、预览、compose 扩展）+ 事件发送 + Inngest 函数与注册 + 契约测试 | A |
| R5 | 界面（`PostCallEmailBar`、选模板面板、管理页、设置面板）+ Impeccable | C |
| R6 | 种子脚本（默认干跑）+ 逐句来源表 | B |

每轮：本地测试绿 → 子牙 + 魏征各审一轮（A 级：设计、实现各一轮）→ 再进下一轮。PR 提交信息带 `[cts.crm.email-tpl]`。

## 17. Reuse Statement（预填）

- **复用**：`sendMailNew` 全部既有闸 / 审计 / 对账；`readEmailComposeConfig`（扩展）；`previewCompose`；`loadPublishedProducts`（团目录唯一对外读取口）；`cleanDisplayName`；`isAutoReply`；`requirePaidClientAccess` / `requireOperatorAccess`；Inngest 客户端、`cloudFunctions` 注册表、`sendInngestEvent`；通话触点（只读）；Mailchimp 客户端 `listSentCampaigns`（多读一个字段）。
- **platform-shared**：渲染器、变量引擎、频次闸、文字检查、回执事件与函数、模板仓库与管理界面。
- **industry-specific（旅游版）**：`facts/tour-catalog` 提供者。其他行业需要自己的事实提供者，本稿不预建抽象。
- **client-specific（CTS）**：模板正文、2/7 上限、白名单主机、禁用词、团页链接格式、`all_tours_url`、灰度名单——全在表行与 `leads_config`。
- 共享运行时里没有客户名 / ID / 行业判断；由 §15 的边界测试钉住。
- 学习：回执是客户私有记忆；「哪个模板回信率高」要升到行业层需要多客户证据，现在没有。
- 与层级门决策时一致：一致（无新能力线）。

## 18. 未核实 / 开放项

1. Graph 已发送箱按收件人 + 时间过滤是否可用；2. Mailchimp 单人收件端点；3. 发送后消息 id / `conversationId` 是否不变（沿用 10-21 稿遗留项）；4. 官网主机 `www.` 与否、`?date=` 参数行为、「全部团」页地址；5. CTS 员工署名 `display_name` 的内容质量（只数了个数）；6. CTS 员工里是否已有人登记了拨号手机；7. 「7 天 2 封」覆盖销售一对一：按 PM 2026-10-28 口径执行，旧台账原文只写群发；8. 谁能改模板：默认仅内部账号；9. 仍未结案的 `unknown` 进今日待办：后续卡；10. Mailchimp 群发前反向检查 1 对 1：交 126 号窗口另立卡。
