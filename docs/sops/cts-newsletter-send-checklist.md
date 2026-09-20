# SOP：CTS 营销邮件发送前必查（2026-09-20 立，PM 拍板）

适用：CTS Tours NZ 的任何一封对外营销邮件（newsletter / 唤回信 / 团期推广 / 欢迎序列）。
不适用：一对一人工回信、系统通知。

---

## 🔴 第 1 条（硬闸，不满足不许发）：信里必须有能点的团页链接

**规则**：正文里**至少有一个**指向官网具体团页的链接（`https://www.ctstours.co.nz/tours/china/...` 或 `/christmas-new-year-china` 这类落地页），
且提到的**每个具体团**，团名文字和配图都要包成链接。退订链接、条款页、电话、邮箱**都不算数**。

**发前怎么查**（在 Mailchimp 里存好草稿之后跑，campaign id 从草稿 URL 里拿）：

```bash
node --env-file=.env.local -e 'const k=process.env.MAILCHIMP_API_KEY,dc=k.split("-").pop();const id=process.argv[1];fetch(`https://${dc}.api.mailchimp.com/3.0/campaigns/${id}/content?fields=html`,{headers:{Authorization:"Basic "+Buffer.from("x:"+k).toString("base64")}}).then(r=>r.json()).then(d=>{const L=[...(d.html||"").matchAll(/<a[^>]+href="([^"]+)"/gi)].map(m=>m[1]).filter(u=>!/UNSUB|UPDATE_PROFILE|ARCHIVE|mailto:|tel:/i.test(u));const T=L.filter(u=>/\/tours\/|\/tour\/|christmas-new-year/.test(u));console.log("可点链接",L.length,"其中团页",T.length);console.log(T.join("\n"))})' <campaign_id>
```

**团页数 = 0 → 不许发**，退回改稿。
每个链接再用 `curl -sL -o /dev/null -w "%{http_code}"` 验证返回 200（官网改版后旧地址会 404）。

### 为什么立这条（真实代价，2026-09-20 查 Mailchimp 全量历史得出）

| 日期 | 收件人 | 打开率 | 点击率 | 正文里的可点链接 |
|---|---|---|---|---|
| 2026-07-29 | 25 | 80.0% | **0%** | **0 个**（只有退订链接） |
| 2026-07-31 | 317 | 63.2% | **0%** | **0 个**（只有退订链接） |
| 2026-07-16 | 53 | 54.7% | **0%** | 1 个，但指向**条款页**，没有团页 |

这三封是名单史上打开率最高的几封。**342 个人打开了免签那封信，没有一个人能点到任何一个团**——
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

⚠️ 已知缺口：目前**没有「已报名某个团」的标签**，所以推某个团时无法自动避开已报名该团的客人。
发前需人工跟 CTS 核对一次已报名名单，或先补这个标签。

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
