# CRM 邮件「按团追踪点击」设计稿 v0（刀 B2）

- 状态：v0.1，子牙（架构）+ 魏征（挑刺）已审，必改项已改进稿内（标注了出处）；**还没写任何代码**，等 PM 点头
- 写的人：127 号窗口，2026-11-10（PM 回「开始 B2」）
- 级别：**A 级**（改发信流程 + 新的公开接口 + 加表）。加表 → 留给 Ray 亲手合
- 分支：`feat/crm-email-click-tracking-b2`（从 origin/main `039414fe6` 开）
- 上游：76 号流程稿「刀 B」第二项；B0 设计稿 `docs/specs/2026-11-09-crm-catalogue-send-b0-b3-design-v0.md`（已上线 #3697）
- 下游：76（第 2 天「这位看了目录，打个电话」待办、每周统计 刀 E/F）、129（写跟进信时读「他点过哪个团」刀 C）

---

## 0. 给 PM 的一页纸（大白话）

**做完你会看到什么变化**
1. 员工从 ME 发出的信里，指向 CTS 官网的链接后面会多一小段编号，例如
   `https://www.ctstours.co.nz/brochures/CTS-Tours-2026-2027-Brochure.pdf?me=k3Hq9xT2Lm`。
   域名仍然是 ctstours.co.nz，点开的页面、文件和现在一模一样；点开后地址栏里的编号会自动去掉。
2. 客人一点，客人卡片的往来记录里就多一行：「点了 2027 手册 · 11/11 20:03」或「点了 Best of China（3 月 11 日团）」。
3. 后台「最近发送」表多一栏「点了什么」。
4. 76 号的「第 2 天：这位看了目录，打个电话」就是从这里来的。

**看得准的和看不准的**
- 准：哪位客人、点了哪一个链接、哪一天几点。
- 不准的地方会标出来、不算数：有的公司邮箱会在信送达时自动把链接「试点」一遍查病毒。系统按「几秒内、不像真人浏览器」把这种点击标成「疑似邮箱自动检查」，不算客人点的。
- 看不到：客人有没有**打开**信（纯文字信做不到，而且现在各大邮箱都会干扰这个数）；客人打开手册之后翻到第几页。

**上线前要你定的另一件事**：CTS 官网隐私政策要不要加一句「邮件里的链接会记录点击」（新西兰隐私法要求合理告知；魏征提醒，算不算必须由你或 CTS 定）。

**这次不做**：Mailchimp 群发信的点击（那边有自己的统计，而且同步进来的时间不准，126 已确认）；客人在官网上之后又看了哪些页面（要放跟踪 cookie，另议）；非 CTS 客户。

**上线前要你一句话的事**：在 CTS 的发信设置里打开「追踪点击」（§6）。

---

## 1. 现状（2026-11-10 读代码核实）

| 事实 | 出处 |
|---|---|
| 员工一对一发的信是**纯文字**（Graph `contentType: 'Text'`），客人看到的链接就是网址原文 | `src/lib/microsoft/mail-send-new-prod.ts:273` |
| CTS 官网是我们自己的 Next.js 14 仓库（`bigbigraydeng-maker/chinatravel`），手册 PDF 就在它的 `public/brochures/` 下，中间层 `src/middleware.ts` 对所有路径（除 `_next/static`、图片、favicon）都会跑 | chinatravel 仓库 |
| 官网已经有「公开、无鉴权、回传给 ME」的先例：表单线索 webhook | `src/lib/crm/web-form-lead.ts` |
| ME 里没有现成的邮件点击追踪；Mailchimp 同步的打开/点击写进触点，但时间都是群发时间，不是点击时间 | `src/lib/mailchimp/sync.ts`（126 号 11-09 指出） |
| 发信闸在锁前已经对**最终文字**算了指纹、查了链接；回执在锁内写（B0） | `send-gates.ts`、`mail-send-new.ts` |
| 「客人回来了」第一版只认回信 / 填表 / 来电（`contact_touchpoints` 里 `direction='inbound'`）——**点击不能写成 inbound 触点**，否则会被误判成「客人回来了」 | B0 设计稿 §4.4 |

---

## 2. 平台层级判定（Inline）

> [跟班 · Tier] 两部分：①ME 侧「发信链接打编号 + 收点击 + 归到哪个团」是既有 CRM 外发能力的 Measure/Check 扩展（平台共享，不新增能力线）；②官网侧「看到编号就回传一次」是**挂在客户网站上的小连接器**（L3，CTS 网站仓库里），换客户要各自接。不登记候选。
> [跟班 · 红线] 红线 2：共享代码里不写 ctstours、团名；要追踪哪些域名、哪个参数名都在客户发信设置里。归到哪个团复用 `published_tours` 已有的网址规则，不另写 CTS 规则。
> [跟班 · 判据] 换客户：Roman 的网站不是我们做的 → 没有回传，点击就记不到（设置里不开即可，发信不受影响）；以后要做可以换成「ME 自己的跳转网址」那条路（§9 已知边界）。

---

## 3. 整体流程

```
员工点发送
  └ sendMailNew 锁内：闸都过了 → 给信里「可追踪域名」的链接逐个发编号（写编号表）→ 用带编号的正文建草稿、发出
客人点链接（打开的是官网原网址 + ?me=编号）
  └ 官网中间层：看到 me=… → 后台悄悄 POST 给 ME（不等结果、不改页面）→ 照常返回页面/PDF
ME 公开接口 /api/public/crm/email-link-click
  └ 编号查得到 → 记一行点击（判断是不是邮箱自动检查）→ 发事件 crm.email_link.clicked
客人卡片往来记录 / 最近发送表 / 76 的第 2 天待办 读点击表
```

---

## 4. ME 侧

### 4.1 客户配置（进发信设置，和 B0 的 catalogue 同一处）

```jsonc
"providers": {
  "link_tracking": {               // 新增，可选；没有 = 这个客户不追踪，链接原样发
    "hosts": ["www.ctstours.co.nz", "ctstours.co.nz"]   // 只给这些域名的链接打编号
  }
}
```

- `hosts` 必须是同一版设置 `guardrails.allowed_link_hosts` 的子集（跨字段校验，和 B0 同样写法）；1–10 个；参数名写死 `me`（不让配，免得撞上客户网站已有参数）。
- 回滚注意同 B0 §3.8：旧代码读不懂这个键 → 回滚代码前先存一版不带它的设置。
- 设置面板加一组框（域名，一行一个），沿用 B0「不认识的键原样带回」。

### 4.2 发信时打编号（锁内、闸后、建草稿前）

- 位置：`sendUnderLock` 里 `inLock` 闸通过之后、`claimAndSend` 之前，新依赖 `deps.tagLinks?(input, body) → { body, tagged: number, failed: boolean }`。和 B0 的 `recordUnderLock` 同样做法：`sendMailNew` 不认识 CRM，只调注入的函数。
- **`tagLinks` 永不抛错**（和 `recordUnderLock` 同一约定）：这一步还在 `sendStarted=false` 区间，一旦抛错会被当成「拒发」（`mail-send-new.ts:361`），正好和「追踪失败不挡发信」相反。所以函数内部吃掉所有错误，返回原文 + `failed: true`。（子牙 must-fix 2）
- **认链接用发信闸同一套**：`extractLinks(normalizeForLinks(...))`（`gates/content-gates.ts`），保证打编号的程序和链接检查认出的是同一段网址；网址后面紧跟句号、括号、中文时不会把 `?me=` 加错位置。（子牙 should-fix 4）
- **先去掉旧编号**：链接上已经有 `me=` 参数（员工从往来记录里复制了旧链接、或 129 照抄旧信）→ 先删掉再发新编号，免得点击算到旧信头上。（子牙 should-fix 5）
- **一封信里同一网址只用一个编号。**
- **打完再核一遍**：对打完编号的正文重新找一遍链接，每个链接必须只比原来多了 `me=`，其它一字不差；数量也要对上。任何一处对不上 → 整封用原文发出 + 回执警告 `link_tracking_mismatch`。不带 `https://`、直接写 `www.` 的链接也照同样规则处理，不悄悄漏掉。（魏征 P1-4）
- 只处理**正文**（页脚不打，页脚里可能有退订链接）；只处理 `https://` 且域名在 `hosts` 里的链接；同一个网址在一封信里出现两次，各发各的编号也行，统一给同一个编号更好（一封信一个网址一个编号）。
- 编号：12 位随机字母数字（约 71 比特，猜不到），和客人、请求号、原网址、链接种类、团信息一起写进 `crm_email_link_tokens`。
- 在网址上加参数：原来有 `?` 就接 `&me=…`，有 `#` 放在 `#` 前面。只改网址本身，不碰旁边的字。
- **闸和指纹不受影响**：链接检查、手册过期闸、「改没改过字」的指纹都在打编号**之前**算完，用的是员工确认的那版文字；手册过期闸比网址时本来就忽略 `?` 后面的部分。
- 写进 `conversation_outbound_log`（审计）的正文是**真正发出去的、带编号的**那版。
- **打编号失败不挡发信**：写编号表失败 → 用原文发出，回执的 `warnings` 记 `link_tracking_failed`。追踪不是安全闸，不能为了它不发信；但失败要看得见。

### 4.3 链接种类（发编号时就判好，存进表里）

| 种类 | 怎么判 | 往来记录里怎么写 |
|---|---|---|
| `catalogue` | 和设置里 `catalogue.url` 同一个地址（复用 B0 的 `catalogueKey`） | 点了 2027 手册（v10） |
| `tour` | 符合 `published_tours.url_pattern`（复用 `published-tours.ts` 的网址规则）；带 `?date=` 的记下班期 | 点了 Best of China（3 月 11 日团） |
| `all_tours` | 等于 `published_tours.all_tours_url`，或配置里的「全部团」页 | 点了「全部中国团」页 |
| `other` | 其它可追踪域名下的页面 | 点了官网 /contact |

团名、班期在发编号那一刻存下来，之后团下架了记录也看得懂。**数据来源**：锁里不再读数据库——preLock 已经读到的上架数据（`linkFactsStage` / `templateStage` 的 facts）放进 `GateState` 带进锁内；`published-tours.ts` 新导出一个纯函数 `classifyTourLink(url, facts)`（现在 `parsePathPattern`、`checkOneUrl` 没导出）。没读到上架数据的客户，团链接一律记成 `other`。（子牙 should-fix 6）

**指纹说明**：回执的 `finalSha256` 是员工确认的那版（没带编号）；审计里存的是带编号、真正发出去的那版。两者本来就不同，不是被改过。回执另加一项「打了几个编号」，对账时据此知道差在哪。（子牙 should-fix 7）

### 4.4 收点击的公开接口

`POST /api/public/crm/email-link-click`，请求体 `{ token, path, method, ua, fetchSite?, fetchMode? }`，≤1KB。
- **不收对方传来的时间**：「离发出多久」一律用编号表的 `created_at` 和 ME 收到的时间算（公开接口上谁都能填时间）。（子牙 must-fix 3）
- `path` 只保留路径和 `date` 参数，其它参数丢掉。

- **不要密钥**：编号本身猜不到，只有收到信的人有。最坏情况是收信人自己伪造几次点击，只影响他自己的统计。这样官网那边不用配任何密钥（PM 不用去 Render 粘变量）。
- 编号查不到 → 照样回 204，不告诉对方编号是否存在。
- **编号对应的那封信必须真的发出去了**（审计状态是「已发出」）才记；没发出去、发送状态不明的，不记。（魏征 P0）
- 每个编号最多记 50 次点击，超过不再记。**不按来源 IP 限流**：回传都从官网服务器那一个 IP 来，按 IP 限要么卡住真点击、要么等于没限。改为：编号格式不对直接 400（不查库）；编号只按主键查一次；接口设一个全局总量上限（每分钟 N 次，超了回 429、官网那边不重试）。（子牙 must-fix 1）
- 不存 IP、不存完整浏览器标识，只存分类（`browser` / `scanner` / `unknown`）。
- 写 `crm_email_link_clicks` 一行；**不写** `contact_touchpoints` 的 inbound 行（见 §1 最后一条）。
- 发 Inngest 事件 `crm.email_link.clicked`，**只在某个编号第一次出现真人点击时发一次**（疑似自动检查不发），事件 id = `email-link-click:<token>`，下游天然去重。固定字段：`clientId, contactId, requestId, token, kind, tour{name,departOn}|null, clickedAt`。给 76 的第 2 天待办和每周统计、129 写跟进信时读。（子牙 should-fix 10）

### 4.5 「疑似邮箱自动检查」怎么判（不删，只标）

任一条成立就标 `suspected_scan = true`，不算客人点击：
1. 请求方法是 `HEAD`；
2. 浏览器标识是空的，或含已知检查程序的特征（Microsoft 安全链接、Barracuda、Mimecast、Proofpoint、Google 图片代理等，名单放代码常量）；或官网转来的 `sec-fetch-site/mode` 显示不是用户点开的导航；
3. 离发出不到 60 秒。

同一个编号后来又来一次像真人的点击，那一次照常算。同一编号 5 分钟内的多次请求只记一行（PDF 分段下载、刷新）。

**「真人点击」再加一道门槛**（给第 2 天待办和「最近发送」用）：不是疑似自动检查 + 离发出超过 10 分钟 + 官网转来的请求头像用户点开的整页导航。微软等公司邮箱的扫描有时在送达几分钟后、用正常浏览器身份去点，60 秒判断抓不住；宁可少算，不让员工给没点的客人打电话。（魏征 P1-2）

### 4.6 在哪里看到

- 客人卡片往来记录：读点击表，按时间插进去，只显示真人点击（疑似自动检查折叠成一行灰字）。
- 「最近发送」表：加一栏「点了什么」（这封信的真人点击，最多列 3 个）。
- 顺手：「最近发送」表的原因一栏补上 B0 的 `catalogue_expired` / `catalogue_unavailable` 中文（现在显示英文代码）。

---

## 5. 官网侧（chinatravel 仓库，另一张改动单）

- `src/middleware.ts` 开头加一段：网址带 `me` 参数且是 12 位字母数字 → 用 `event.waitUntil(fetch(ME 接口, { signal: AbortSignal.timeout(2000) }))` 在后台回传，**不等结果、出错不管、2 秒超时**（免得 ME 卡住时请求在官网服务器上越积越多），然后照常往下走。现在的 `middleware(request)` 要加第二个参数 `event`。（子牙 should-fix 9；已核 Next 14.2.35 `next start` 下 `waitUntil` 能在后台跑，中间层对 `public/` 下的 PDF 也会跑）
- **只回传「用户打开」那一下**：只在整页导航（`sec-fetch-dest=document`）或从文件开头下载（没有 `Range`，或 `Range: bytes=0-`）时回传；手机看大 PDF 的分段请求不回传。（子牙 should-fix 8、魏征 P1-2）
- **回传后转到去掉编号的同一网址**（302），编号不留在客人地址栏里，不会被页面上的统计代码带走，客人转发、分享网址也不带编号。（魏征 P1-6）
- **只在正式域名上回传**（`www.ctstours.co.nz` 写成常量），预览站、本地开发都不回传，不只看 `NEXT_PUBLIC_ENV`。（魏征 P2-7）
- 把 `sec-fetch-site`、`sec-fetch-mode` 一起转过来，帮着判断是不是自动检查。
- 回传地址写成代码常量（不是密钥，不用改 Render 变量）。
- 不种 cookie。
- 只在正式站跑；预览站（staging）不回传。

---

## 6. 上线顺序（每步完成才下一步）

0. **先单独上线「设置能认识 `link_tracking`」**（只改解析器和面板透传，没有任何行为变化）。跑稳之后，以后就算要退回追踪代码，也不会连带让设置读不出来。（魏征 P1-3）
1. ME 改动单合并（加两张表 → **Ray 亲手合**）；此时设置里没开，发信行为完全不变。
2. 官网改动单合并（B 级）；没有带编号的链接时它什么也不做。
3. **PM 回一句「开追踪」** → 我在发信设置加 `link_tracking`（新一版，读回核对其它项不变）。
4. 当场试跑（§10）。

**回滚**：先在发信设置里存一版不带 `link_tracking` 的设置，再回退代码（旧代码遇到不认识的设置项会拒绝整份设置，CTS 全部 CRM 发信会停）。官网那张单子单独回退，不影响发信。

---

### 6.1 追踪坏了要有人知道（魏征 P1-5）

每天核对一次：开了追踪的客户，近 7 天发出过带编号的信 ≥5 封、但收到 0 次点击，或回执里 `link_tracking_failed / mismatch` 超过 3 次 → 下发到今日待办的「开发欠账」栏（实现时定：这是开发去修的事，PM 邮件里照样有一行计数和链接）：what（追踪可能坏了，影响：第 2 天提醒全停）、how（先看官网是否在回传、再看 ME 接口日志）、href（最近发送表直达链接）。走 `src/lib/pm-todo/manual-items.ts` 现有做法，不另建。

## 7. 加的两张表（Ray 亲手合）

```sql
create table public.crm_email_link_tokens (
  token text primary key check (token ~ '^[A-Za-z0-9]{12}$'),
  client_id uuid not null references public.clients(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  request_id uuid not null,
  url text not null check (char_length(url) <= 600),
  kind text not null check (kind in ('catalogue','tour','all_tours','other')),
  tour jsonb,                       -- {name, destination, tier, slug, departOn} 发编号时的快照
  created_at timestamptz not null default now()
);
create index on public.crm_email_link_tokens (client_id, request_id);

create table public.crm_email_link_clicks (
  id uuid primary key default gen_random_uuid(),
  token text not null references public.crm_email_link_tokens(token) on delete cascade,
  client_id uuid not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  path text check (char_length(path) <= 300),
  method text not null check (method in ('GET','HEAD')),
  ua_class text not null check (ua_class in ('browser','scanner','unknown')),
  suspected_scan boolean not null,
  counts_as_human boolean not null      -- 实现时加：「真人点击」在记录那一刻判好，读的地方不再各自猜
);
create index on public.crm_email_link_clicks (client_id, contact_id, occurred_at desc);
alter table public.crm_email_link_tokens enable row level security;
alter table public.crm_email_link_clicks enable row level security;
create policy service_role_all on public.crm_email_link_tokens for all to service_role using (true) with check (true);
create policy service_role_all on public.crm_email_link_clicks for all to service_role using (true) with check (true);
-- 客人被删时编号和点击随之删除（子牙 should-fix 11）
```

---

## 8. 「故意破坏」测试清单

| # | 规则 | 删掉哪段时该变红 |
|---|---|---|
| 1 | 没开追踪的客户，信一字不改 | 「没配置就跳过」 |
| 2 | 只给 `hosts` 里的域名打编号；别的域名、`mailto:`、电话不动 | 域名判断 |
| 3 | 原网址有 `?date=…` / `#…` 时参数加对位置，打开的还是同一页 | 拼网址 |
| 4 | 页脚里的链接不打编号 | 「只处理正文」 |
| 5 | 打编号发生在闸之后：带编号的网址不影响手册过期闸、指纹、改没改字 | 顺序 |
| 6 | 写编号失败 → 原文照发 + 回执有 `link_tracking_failed` | 失败分支 |
| 7 | 审计里存的是带编号的正文 | 审计写入 |
| 8 | 接口：编号不存在 → 204 且不写；格式不对 → 400；超 50 次不再写 | 校验 |
| 9 | 疑似自动检查：HEAD / 已知检查程序 / 60 秒内 各一条 | 三条判断 |
| 10 | 点击**不**写成 inbound 触点（不会被当成「客人回来了」） | 写入目标 |
| 11 | 种类：手册 / 团（含班期）/ 全部团 / 其它 各一条 | 归类 |
| 12 | 设置：`hosts` 不在白名单里 → 拒存；旧版设置无此键照常读 | 跨字段校验 |
| 13 | 官网中间层：没有 `me` 参数不回传；有参数时回传失败页面照常 | 中间层分支 |
| 14 | 旧编号被抄进新信：先删旧 `me=` 再发新编号 | 去旧编号 |
| 15 | 编号对应的信没发出 / 状态不明 → 点击不记 | 发出核对 |
| 16 | 打编号后再核：故意制造一处对不上 → 整封原文发出 + `link_tracking_mismatch` | 复核 |
| 17 | 中间层：PDF 分段请求不回传；预览站不回传；回传后 302 到干净网址 | 三个分支 |
| 18 | 每日核对：开了追踪、7 天 5 封、0 点击 → 出现待办 | 核对规则 |
| 19 | `tagLinks` 内部抛错 → 信照发（原文），不变成拒发 | 吃错约定 |

---

## 9. 已知边界（写进卡，不修）

- 只追踪我们能改的网站（目前只有 CTS 官网）。别的客户网站要追踪，得另做「ME 跳转网址」（客人会看到 ME 的域名，要 PM 另行同意）。
- 看不到「打开了信」；看不到 PDF 翻到哪一页。
- 客人把链接转发给家人，家人点了也算在这位客人头上。
- 疑似自动检查的判断会有漏判和误判；第一周拿真数据看一次再调。
- 编号表一直留着（链接永远能打开）；编号和点击记录跟客人一起删（客人要求删除时）。
- CTS 官网上的统计代码（GA4 等）会看到带编号的网址；编号不含客人信息，泄漏风险低。
- 官网页面被缓存时，中间层可能看不到重复点击（第一次点击照样记到）。

## 10. 当场试跑（上线后，只发 hello@）

1. 给测试客人发一封 ④ 目录信 → hello@ 收件箱里看到链接带 `?me=`，点开是手册 PDF。
2. 1 分钟后往来记录出现「点了 2027 手册」，「最近发送」表的「点了什么」一栏有它。
3. 用 `curl -I`（HEAD）请求一次同一个链接 → 记成疑似自动检查，不显示为客人点击。
4. 看 Inngest 收到 `crm.email_link.clicked`。

## 11. 藏经阁 / 十问：不适用（不是 agent，没有模型判断）。

## 12. Reuse Statement（预填）

- 复用：`sendMailNew` 锁内注入的做法（同 B0 `recordUnderLock`）、`catalogueKey`、`published_tours` 网址规则、发信设置的严格解析和跨字段校验、「最近发送」表、往来记录、官网表单回传的公开接口先例、Inngest 事件。
- 新增平台共享：链接打编号、点击接口、点击表、疑似自动检查判断。
- 行业专属：无。客户专属：只在数据里（CTS 的域名清单）和 CTS 官网仓库的回传代码里。
- 共享代码里没有客户名、域名、团名。
