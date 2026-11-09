# SOP：CTS 营销邮件发送前必查（2026-09-20 立，PM 拍板）

适用：CTS Tours NZ 的任何一封对外营销邮件（newsletter / 唤回信 / 团期推广 / 欢迎序列）。
不适用：一对一人工回信、系统通知。

---

## 🔴 第 1 条（硬闸，不满足不许发）：信里必须有能点的团页链接

**规则**：正文里**至少有一个**指向 CTS 官网（`ctstours.co.nz`）具体团页的链接（`https://www.ctstours.co.nz/tours/china/...` 或 `/christmas-new-year-china` 这类落地页），
且草稿里提到的**每一个具体团**，团名文字和配图都要各自包成对应团页的链接，不能只挂一个团、其他团裸文字带过。退订链接、条款页、电话、邮箱、外站链接**都不算数**。

**发前怎么查**（在 Mailchimp 里存好草稿之后跑）：

**第一步：把草稿 URL 里的数字转成 API 要的 campaign id。**
草稿编辑页 URL（`.../campaigns/edit?id=12345`）里的 `id` 是 Mailchimp 网页端用的 `web_id`，
**不能**直接拿去调 `/3.0/campaigns/{id}/content`——那样会 404，且下一步脚本会把这个错误响应当成空正文，误判成"团页 0 个"。
先用这一步把 `web_id` 换成真正的 API campaign id：

```bash
node --env-file=.env.local -e 'const k=process.env.MAILCHIMP_API_KEY,dc=k.split("-").pop();const webId=process.argv[1];fetch(`https://${dc}.api.mailchimp.com/3.0/campaigns?fields=campaigns.id,campaigns.web_id,campaigns.settings.subject_line&count=1000`,{headers:{Authorization:"Basic "+Buffer.from("x:"+k).toString("base64")}}).then(r=>r.json()).then(d=>{const c=(d.campaigns||[]).find(c=>String(c.web_id)===String(webId));if(!c){console.error("找不到 web_id="+webId+" 对应的 campaign，检查草稿 URL 是否正确");process.exit(1)}console.log("campaign id =",c.id,"主题:",c.settings.subject_line)})' <web_id_from_url>
```

**第二步：用上一步拿到的 campaign id（不是 web_id）查正文链接**，并且先检查响应状态，请求失败不能当空正文处理。
这一步**要保留每个链接的锚点内容**（是包着团名文字，还是包着一张 `<img>`），不能只拿 href 列表——
否则分不清同一团是"图能点、团名裸露"还是反过来，两种情况都违反第 10–11 行"团名文字和配图各自成链接"的要求：

```bash
node --env-file=.env.local -e 'const k=process.env.MAILCHIMP_API_KEY,dc=k.split("-").pop();const id=process.argv[1];fetch(`https://${dc}.api.mailchimp.com/3.0/campaigns/${id}/content?fields=html`,{headers:{Authorization:"Basic "+Buffer.from("x:"+k).toString("base64")}}).then(async r=>{if(!r.ok){console.error("content API 返回",r.status,"—— 不是空正文，是请求本身失败，先确认 campaign id 对不对");process.exit(1)}return r.json()}).then(d=>{const anchors=[...(d.html||"").matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({href:m[1],inner:m[2]})).filter(a=>!/UNSUB|UPDATE_PROFILE|ARCHIVE|mailto:|tel:/i.test(a.href));const T=anchors.filter(a=>/^https:\/\/(www\.)?ctstours\.co\.nz\/(tours?\/|christmas-new-year-china)/i.test(a.href)).map(a=>({href:a.href,kind:/<img/i.test(a.inner)?"图片":"文字",text:a.inner.replace(/<[^>]+>/g,"").trim()}));console.log("可点链接",anchors.length,"其中 CTS 官网团页",T.length);T.forEach(a=>console.log(`[${a.kind}] ${a.href}  锚点内容="${a.text}"`))})' <campaign_id>
```

**第三步：手工核对，不能只看数量。**
把打印出来的每一行按 `[文字]` / `[图片]` 分开看，草稿里提到的每一个团名逐个对一遍——
每个团**必须同时有一条 `[文字]` 记录（锚点内容就是那个团名，不是别的团或泛泛的"了解更多"）和一条 `[图片]`
记录**，链接域名都必须是 `ctstours.co.nz`，缺任何一种都算没做到"团名文字和配图各自成链接"。
**只统计 `T.length > 0` 不算通过**：如果草稿提了三个团、`T` 里只有一个团凑齐了 `[文字]`+`[图片]`
两条（或者 `T` 里全是别的旅行社官网的 `/tours/` 页面），照样是没做到"每个具体团都有链接"，必须退回改稿。

**团页数 = 0，或有任何一个提到的团缺链接 → 不许发**，退回改稿。
每个链接再用 `curl -sL -o /dev/null -w "%{http_code}"` 验证返回 200（官网改版后旧地址会 404）。

### 为什么立这条（真实代价，2026-09-20 查 Mailchimp 全量历史得出）

| 日期 | 收件人 | 打开率 | 点击率 | 正文里的可点链接 |
|---|---|---|---|---|
| 2026-07-29 | 25 | 80.0% | **0%** | **0 个**（只有退订链接） |
| 2026-07-31 | 317 | 63.2% | **0%** | **0 个**（只有退订链接） |
| 2026-07-16 | 53 | 54.7% | **0%** | 1 个，但指向**条款页**，没有团页 |

这三封是名单史上打开率最高的几封。免签那两封（7/29 + 7/31）共触达 342 人，
按各自打开率算约 220 人打开了信（25×80.0%≈20 + 317×63.2%≈200），**其中没有一个人能点到任何一个团**——
不是文案不好，是根本没给出口。CTS 名单平均打开率 47.5%（行业约 26%），**瓶颈从来不是打开，是点击**。

对照组：同期有团页链接的信，点击率 5.9%–26.8%。

---

## 第 2 条：同一封内容不许原样重发

2026-08-30 Golden China 发 450 人，打开 44.4%、点击 4.5%（24 人点进团页）。
2026-09-02 **同样内容**重发 155 人：打开掉到 20.1%、点击 **0%**、退订 3 人。

要再次触达没反应的人，**必须换角度重写**（换主题行 + 换主图 + 换讲法），不能复制一份再发。

---

## 第 3 条：收件人先排除四类人

Send to 选目标标签；Do not send to 必须包含：
`suppressed_do_not_email`（明确说过别再联系）· `sales_active`（销售正在人工跟进）·
`paid_customer`（已付款客户）· `nurture_2027`（明年再说）。

Mailchimp 里已存的 `Safe to Market` 筛选条件**只排除了前两类里的 paid_customer 和 suppressed**，
`sales_active` 和 `nurture_2027` 要另外手工加进排除栏。

⚠️ 已知缺口：目前**没有「已报名某个团」的标签**，所以推某个团时 Mailchimp 无法自动避开已报名该团的客人。
长期修复是把 CTS 报名状态自动同步成 Mailchimp 标签/merge field；这个能力还没做，做出来之前不能只在这里留一句「记得核对」。

**每次要推某个具体团**，发信前必须走人工任务管道，而不是自己记着去问：在
`src/lib/pm-todo/client-doc-manual-tasks.ts` 里给 `CLIENT_DOC_MANUAL_TASKS` 加一条（写法照抄文件里 CTS
那条现成的例子，**但 `expiresAt` 不能照抄**——那条例子的 `expiresAt` 是过去的时间点，照抄会导致任务一加进去就已经
过期，`pushClientDocManualTaskItems` 直接跳过不下发；必须把 `expiresAt` 改成**这次计划发送时间之后**的一个时间点），
三件套缺一不可：
- **what**：这次要发哪个团的推广信、发给多少人，缺「已报名」名单排除，不排除会怎样（已报名客人收到同团促销）
- **how**：具体找谁核对（CTS 团期负责人）+ 要问的原话（"这个团目前已报名的客人名单，帮我核对一下 send list 里有没有重复"）
- **href**：直达联系方式，**必须是 `https://` 开头的绝对网址**（比如 WhatsApp 网页版链接
  `https://wa.me/<号码>`，或一个可访问的联系页）——**不能用 `mailto:`**：`assertAbsoluteHref` 只认
  `http(s)://`，`mailto:` 会被判成坏链接，而 `client_doc_manual_task` 不在 `NEVER_DROP_KINDS` 里，
  整条任务会被 `dropBrokenLinks` 静默丢掉，看板和日报上都看不到

拿到 CTS 回复的名单前不许发；拿到后把重复的人从 Mailchimp 目标标签里手工剔除，再进第 1 条硬闸检查。

---

## 第 4 条：内容事实必须可溯源

每条运营事实（团期 / 价格 / 行程 / 含项 / 城市）以**官网当下页面**为准，master_brief 和记忆都只作方向。
交稿时附逐句溯源表：官网可溯（带 URL）/ brief 可溯 / 未证实。**未证实的一律改写或删掉**。
（依据 CLAUDE.md 铁律 8 客户数据红线。）

---

## 第 5 条：图片

- 素材从 CTS 的 Dropbox 素材库取：`~/Library/CloudStorage/Dropbox/MagicLab_Studio/CTS/footage`，不去外网现抓。
- **每张图必须自己打开看过**，确认画面就是文案里说的那个地方（`stock/` 里约一半文件名跟内容对不上）。
- CC BY / CC BY-SA 授权的图，页脚必须署摄影者名字。
- 图片要包一层链接指向对应团页（图片加载失败时，下面还要有一条 "View full itinerary →" 文字链接兜底）。
