# NAL：WhatsApp（及邮件）客人对话写回 ME CRM —— 可行性核实与方案

> **这一轮只回答「能不能、怎么做、代价多少」，不执行。**
> 本文档写作期间：没有打开任何客人对话、没有导出任何对话、没有记录任何客人姓名或电话号码、
> 没有改 WhatsApp 任何设置、没有发任何消息、没有写生产库（生产库只跑了 `select count(*)` 这类汇总查询）。
>
> - 来源：PM 2026-10-10 原话「我需要你安排开一个窗口，调用我本地电脑来查看 NAL whatsapp 的客户聊天记录，然后写回 ME 的 CRM，可以做到吗」
> - 同日 PM 追加两条（经统筹窗口转述）：①「有，他们是同意的」——NAL 已同意我们读他们客人的对话并存进 ME；②「我们迟早也要把他的这些信息 不光是 WhatsApp 还有邮件 都要存到 Magic Engine 的后台里面 用大模型去分析」
> - 开工读过：`CLAUDE.md`、`docs/STATE.md`、skill `me-platform-tier-gate`、记忆 `project-crm-whatsapp-path-360dialog-2026-09-26`、`reference-messenger-metrics-facts-20261005`、`feedback-one-window-one-client`、`project-nal-monthly-goal-300-conversations`、支柱手册 `playbook-ads-meta-general`

---

## 0. 一句话结论

**能做，但不是「从这台 Mac 上读」。** 这台 Mac 上登录的那个 WhatsApp 几乎肯定不是 NAL 的客服号（证据见 §1），
而 ME 代码里走官方接口收 WhatsApp 的那条路**已经建好并且 CTS 在用**——NAL 缺「把号接进来」，另有并存模式推送、多渠道 brief 等需补的代码（见 §4.5、§5）。
**邮件那条路对 NAL 也已经在跑了**（库里已有 38 段邮件对话）。所以真正要决定的只有一件事：
要不要现在去申请 Meta 的那两项高级权限，把 NAL 的号接上。

---

## 1. 这台电脑上登录的是谁的号

**结论：几乎肯定不是 NAL 的客服号；但「具体是哪个号」我没能在不打开 App 界面的前提下核实出来。**

### 查到的事实（全部只读、只看账号层面与汇总计数）

| 查的东西 | 结果 | 怎么查的 |
|---|---|---|
| App 装没装、在不在跑 | 装了，版本 26.40.20，进程在跑 | `ls /Applications/WhatsApp.app`、`defaults read` Info.plist、`ps` |
| App 身份 | `net.whatsapp.WhatsApp`（这是桌面端通用标识；WhatsApp Business 手机号同样可关联网页/桌面版，**不能据此判断主手机登录的是个人号还是商业号，账号归属保持未知，待 PM 核对号码**） | Info.plist `CFBundleIdentifier` |
| 统筹说的 `…WhatsAppSMB.shared` 容器 | **存在但是空的（4 KB，只有空目录）**——是系统占位，不能当「装了 WhatsApp Business」的证据 | `du -sh` + `find` 目录清单 |
| 真正放数据的容器 | `group.net.whatsapp.WhatsApp.shared`，69 MB，**只有一套账号的数据**（没有多账号分目录） | `du -sh`、目录清单 |
| 这台机器什么时候开始同步的 | 容器创建于 2026-09-25 | 目录时间戳 |
| 本地对话总量（只数行数，没看任何内容） | **47 个会话、1059 条消息，时间范围 2026-09-20 → 2026-10-09** | `ChatStorage.sqlite` 只读 `count(*)` / `min/max(date)` |
| 会话构成（只数类型，没看任何对方身份） | **群聊 32 个、一对一 13 个、普通手机号会话 1 个、广播 1 个** | 按 JID 后缀分组计数 |
| 商业账号自己的计数器 | `smbtotal_threads = 1`、`smbtotal_incoming_messages = 5` | `LocalKeyValue.sqlite` 只读取这几个键 |

### 为什么判「不是 NAL 的号」

1. **形状完全不对**：NAL 的点击进 WhatsApp 广告在 9/20–10/8 买到 219 次开聊。一个真正承接这些开聊的客服号，
   本地应该是**两百来个一对一会话、群聊极少**。这台机器是反过来的——**32 个群聊、只有 13 个一对一**。
   这是典型的个人号使用形态。
2. **商业会话计数器只有 1**：App 自己记的「商业线程总数 = 1、商业入站消息 = 5」。
   如果这是 NAL 的客服号，这两个数会是三位数。
3. 桌面 App 的 bundle 标识与空 SMB 容器**不作为判断依据**（Business 账号也可关联桌面版）；账号类型保持未知，待 PM 核对号码。

### 为什么「具体哪个号」核实不了

WhatsApp 不把「本机登录的是哪个号」写进任何我能只读访问的账号层文件——
我把偏好设置文件（1275 个键）、键值库、通讯录库的**列名**都扫了一遍，没有 own/self/myJID/phone 这类字段。
唯一能确定号码的办法是**打开 App 的「设置 → 个人资料」界面**，而打开 App 窗口就可能把聊天列表（含客人名字）显示出来，
**撞红线，所以我没做**。

**要补上这一条，最便宜的办法是 PM 自己在 App 里看一眼个人资料页上的号码，回我一句「是 NAL 的号 / 不是」。**
但从上面三条证据看，这一步大概率只是确认而已，不影响后面的方案选择。

---

## 2. 技术上有哪几条路

### a. 驱动桌面版 / 网页版把对话读出来（屏幕自动化）

| 维度 | 判断 |
|---|---|
| 能不能做到 | 技术上能 |
| 稳不稳 | **很不稳**：WhatsApp 每次界面改版就坏；没有增量机制，每次都要全量翻一遍；读不到的和「没有」长得一样 |
| 要多久 | 建一次 2–3 天，之后持续返修 |
| 风险 | **高**。① 违反服务条款（见 §3）；② 被判自动化会**封号，封的是 NAL 的客服号，不是我们的号**——客人直接联系不上 NAL；③ 前提是要把 NAL 的客服号登录到我们的机器上，等于把客户的客服身份搬到 ME 的电脑，安全和合规都更差 |
| 结论 | **不做。** |

### b. 直接读本地数据库文件

| 维度 | 判断 |
|---|---|
| 能不能做到 | 能——我这次就是这么数出 47 个会话的（只数了行数） |
| 稳不稳 | 一次性快照，没有实时；WhatsApp 换表结构就要重写 |
| 要多久 | 1–2 天 |
| 风险 | **高**。① 同样违反条款；② **拿不到全量**：电脑端是「配对设备」，只同步最近一段历史，本机只有 9/20 以后的 47 个会话，不是 219 个；③ 把客人对话落到一台 macOS 本地磁盘再搬进库，链路多一跳，泄露面更大 |
| 结论 | **只能当极端兜底的一次性历史回填，不能当通道。而且前提还是「这台机器上得是 NAL 的号」——现在不是。** |

### c. App 自带「导出聊天」

| 维度 | 判断 |
|---|---|
| 能不能做到 | 能，而且这是 WhatsApp 官方给用户的功能，**不违反条款** |
| 稳不稳 | 结果稳，但**是人工的**：一个对话点一次，219 个开聊 = 219 次手点；导出是纯文字 + 媒体文件，没有稳定的消息编号，判重只能靠「时间 + 文字」猜 |
| 要多久 | 写解析器 1–2 天；人工导出的工时按对话数线性增长 |
| 风险 | 中。违反 `CLAUDE.md` 铁律 3 上半（能自动化就必须自动化，禁止「请客户老板去点按钮」当长期 SOP）；只能当**历史回填**的合法一次性手段 |
| 结论 | **备选，仅用于「把接入之前的历史补进来」这一件事，且必须由 NAL 自己导出给我们。** |

### d. 官方 WhatsApp Cloud API（走 ME 自己的技术服务商资格 + 并存模式）—— **推荐**

| 维度 | 判断 |
|---|---|
| 能不能做到 | **能，而且 ME 的代码已经建好了**：`src/app/api/webhooks/whatsapp/route.ts` 实时收消息 → 认人 → 落 `conversations` / `conversation_messages`；路由靠 `clients.whatsapp_phone_number_id` 这一列按客户分流，没有硬编码客户。CTS 已经在这条路上跑（库里 14 段） |
| 稳不稳 | **最稳**：官方推送，实时，有消息编号可判重，不怕界面改版，不会被封 |
| 要多久 | 申请审核排期是主要耗时（要录两段演示视频提交 Meta）；代码侧见 §5 的阶段 2/3，真正要写的不多 |
| 风险 | 中。见下面「关键代价」 |

**关键代价①：号码接官方接口之后，NAL 的人还能不能用手机回客人？——能。**
走「并存模式」（Coexistence）时，号码不用删、**手机上的 WhatsApp Business App 照常用**，员工照常在手机上回客人，
近 6 个月的一对一历史还能同步过来。（2026-09-29 已照 Meta 官方文档核实过；
我方 9-29 曾对 PM 说错成「一申请手机就不能用」，那句是错的，这里纠正。）

**关键代价②：并存模式的硬限制**（同次核实）：
不能用官方的通话接口、群聊不同步也不能用官方群组接口、群发列表禁用、固定 20 条/秒。
→ NAL 要打电话/发短信得另找电信供应商，不在 Meta 这套里。

**关键代价③：接之前必须先修一个坑。**
员工在手机上发的消息，Meta 是用 `smb_message_echoes` 这种「回声」事件推给我们的。
我查了现在的收件代码：**完全没有处理这类事件**（grep `echo` 零命中）。
不修就接，会把员工自己的回复记成客人发的——`conversations.last_message_from` 跟着错，
「谁欠谁一条回复」整列翻转，所有基于它的待办和统计全反。**这是接入前必做项，不是可选优化。**

**关键代价④：往外发消息现在只支持一个号。**
`src/lib/whatsapp/send.ts` 的凭据取自两个全局环境变量（一个令牌、一个号），
而且设计上「号对不上就拒发」（防止拿 A 客户的号发给 B 客户，这是对的）。
→ **收** NAL 的消息不用改代码，**在 ME 里回** NAL 的客人要先把凭据改成按客户取。

### e. 其它发现的路

- **e1 · Meta 自己的 WhatsApp 对话统计**：只有聚合数字（开了几次聊），**没有正文**。
  能用来补「开聊数」这个口径，装不了对话内容。**这条不要钱、不要审核**，是阶段 1 的基础。
- **e2 · 走第三方服务商（360dialog）托管**：成立且不需要 ME 自己有资格，€250/月起。
  **PM 2026-09-29 已拍板「360dialog 完全忽略」**，这里只作记录，不重提。
- **e3 · 只接「开聊计数 + 入口广告」不接正文**：广告侧数据 ME 已经有了。
  好处是零成本马上能让 NAL 的 300/月目标看到进度；坏处是回答不了「这个客人是谁、现在到哪一步」。

---

## 3. 合规

### 3.1 WhatsApp 服务条款对「自动化读取 / 批量导出」怎么说

出处：WhatsApp 官方 Terms of Service（<https://www.whatsapp.com/legal/terms-of-service>，2026-10-10 抓取）

- 「Acceptable Use Of Our Services → Legal And Acceptable Use」节，原文：
  > "You must access and use our Services only for legal, authorized, and acceptable purposes."
  以及同节列举的禁止项之一：
  > "(f) involve any non-personal use of our Services unless otherwise authorized by us."
  —— 用个人版/商业版 App 做公司系统的数据源，属于 "non-personal use"，**需要 WhatsApp 另行授权**；
  那个「另行授权」在实践中就是官方 Business API（即 §2 的路 d）。
- 「Harm To WhatsApp Or Our Users」节，原文片段：
  > "directly, indirectly, through automated or other means, access, use, copy"
  > "(f) collect information of or about our users in any impermissible or unauthorized manner"
  > "(a) reverse engineer, alter, modify, create derivative works from, decompile, or extract code from our Services"
  同节还禁止 "bulk messaging, auto-messaging, auto-dialing, and the like"（在 Legal And Acceptable Use 节）。

**对我们的意思，一句话**：路 a（屏幕自动化）和路 b（直读数据库）踩的就是上面这几条；
路 c（App 自带导出）是官方给用户的功能、不踩；路 d（官方接口）就是官方说的 "otherwise authorized by us"。

### 3.2 新西兰隐私法：ME 要把 NAL 客人的对话存进 CRM，前提是什么

**谁是信息持有方 —— 这是最关键的一条。**
《Privacy Act 2020》第 11 条规定：A 为 B「持有或处理」个人信息时，**这些信息在法律上算 B 持有，不算 A 持有**；
并且 A 在境外或把数据放境外也不改变这一点（所以用境外云不算「跨境披露」）。
**但有一个例外：如果 A 把这些信息用于自己的目的，那就算 A 和 B 共同持有，A 要自己背全套义务。**
（出处：Privacy Act 2020 s 11；二手解读见 <https://minterellison.co.nz/insights/privacy-act-amendments-reinforce-an-organisation-s>、
官方文本 <https://www.legislation.govt.nz/act/public/2020/31/en/2026-05-01.pdf>。legislation.govt.nz 的网页版对我方抓取返回 403，
以上为二手解读 + 官方 PDF 链接，**条文原文我没有逐字抓到，要作法律依据时请以官方 PDF 为准**。）

**所以**：
- ME 以 NAL 的服务方身份代为保管 / 分析这些对话 → **持有方是 NAL，ME 的义务跟着 NAL 走**。这是我们要站的位置。
- 一旦 ME 把这些对话用于**自己的目的**（例如拿去喂跨客户的行业经验手册、改进 ME 自己的模型或产品），
  ME 就变成共同持有方，自己要全套合规。**这同时也撞 `me-platform-tier-gate` 红线 2（客户事实不许进共享层）。**
  → 结论：**客人对话只能留在该客户私域；要上升成行业经验，只能上升「不含任何个人信息的规律」。**

**告知义务（IPP 3A，2026 年 5 月 1 日起生效）**：
从**本人以外的来源**收集某人的个人信息时，要在合理可行的时间内让本人知道：
已经收集了、为什么收集、谁会拿到、收集方和持有方的名称地址、依据哪条法律（如有）、以及本人的查阅和更正权。
例外包括「本人已经知道这些事项」、「公开可得」、「告知不可行」等。
（出处：<https://www.privacy.org.nz/privacy-act-2020/privacy-principles/3a/>）
→ 在「ME 作为 NAL 的代理」这个定位下，**这条义务落在 NAL 身上**（它的隐私声明里要覆盖「会用第三方系统管理客户沟通」），
不落在 ME 头上。这也是为什么「ME 是代理、不是独立收集方」这个定位必须守住。

**关于 NAL 的同意**：PM 2026-10-10 口头转述「有，他们是同意的」。本文档按此记录。
**风险提示（建议，不是待办）**：涉及第三方（NAL 客人）的个人信息，实务上书面件比口头稳妥得多——
将来万一有客人投诉或 NAL 换人，书面件是唯一能证明授权存在的东西。建议在后续某个合同/续约节点顺手补一份，
内容只要覆盖「NAL 委托 Magic Lab 以服务方身份代为存储与分析其客户沟通记录」即可。

### 3.3 存进 CRM 应该存什么、不存什么

| 存 | 理由 |
|---|---|
| 人（显示名、电话作为认人的键）、`do_not_contact` 标记 | 没有「人」就没有 CRM；DNC 是合规必需 |
| 对话（渠道、开聊时间、入口是哪条广告、最后谁说话、结局 open/won/lost） | 这是 NAL 唯一真正要的东西：**1000 多块买来的开聊，到底成了几单** |
| 对话正文 | 没有正文，大模型分析和「客人问了什么」都无从谈起。CTS 已经这么做了（PM 2026-07-26 授权），同一套 |
| 媒体文件只存**编号**，不下载文件本身 | 现有代码已经是这样（`conversation_messages.media_id`，注释写明「文件不下载」）。客人发来的护照照片、身份证截图落到我们磁盘上，风险远大于收益 |

| **不存 / 要处理** | 理由 |
|---|---|
| 不把客人姓名电话写进任何共享层（共享代码、共享提示词、行业手册、日志、PR、本文档） | tier-gate 红线 2 + §3.2 的共同持有方风险 |
| 正文里出现的证件号、银行卡号，建议入库时打码 | 这类号码对 NAL 的业务没用，留着只是风险 |
| 群聊不要接 | 并存模式本来就不同步群聊；而且群里有与 NAL 业务无关的第三方 |

---

## 4. ME 这边的落点（只读了代码，一个字没改）

### 4.1 现有表够不够装「多渠道 + 大模型分析」——**够，不用扩**

- `conversations.channel` 的取值范围建表时就写成了
  `CHECK (channel IN ('messenger', 'email', 'voice', 'whatsapp'))`
  （`supabase/migrations/20260726000004_unified_contacts.sql`）。**WhatsApp 和邮件本来就在里面。**
- 认人的那层也是现成的：`contacts` + `contact_identities`（`kind` 支持 `phone` / `email` / `fb_psid`，
  同一客户下同一标识只能属于一个人）。电话和邮箱**在同一次识别同时带上两者时**才能合成一个人（现有两条入口各只传一种，见 §4.5）。
- `conversation_briefs` 就是**大模型分析的落点**：一段对话一张 AI 卡片，有 `model` 列、
  摘要 / 意向等级 / 客人需求 / 顾虑 / 我们许过的承诺。表和 Messenger 渠道的生成流程已在 CTS 跑着；**WhatsApp / 邮件渠道的生成流程目前没有**（见 §5 阶段 4）。
- `conversations.entry_referral` 存「这段对话是点哪条广告来的」，`contact_touchpoints` 存每一次接触。
  广告花钱 → 开聊 → 成单，这条链 ME 已经打通过。

### 4.2 CTS 那套是怎么接的（只读）

| 环节 | 代码位置 | 机制 |
|---|---|---|
| WhatsApp 收消息 | `src/app/api/webhooks/whatsapp/route.ts` | Meta 实时推送 → 验签 → 按 `clients.whatsapp_phone_number_id` 找到是哪个客户 → 落库 → 发 Inngest 事件 |
| WhatsApp 回消息 | `src/lib/whatsapp/send.ts`、`src/app/api/clients/[id]/whatsapp/conversations/[cid]/reply/route.ts` | 单号全局凭据，号对不上就拒发 |
| 填号的界面 | `src/app/dashboard/clients/[id]/_components/WhatsAppNumberPanel.tsx` | **已有 UI，不需要进 Supabase Studio 手填** |
| 邮件收信 | `src/lib/microsoft/mail-ingest.ts` | 按客户的邮箱逐个拉，每小时一轮，写进同一张 `conversations`（`channel='email'`） |
| AI 卡片 | `src/lib/messenger/brief.ts`、`brief-cycle.ts` | 对话更新后重写该对话的 brief |

### 4.3 NAL 现在到哪了（2026-10-10 在生产库只跑汇总计数核实，没读任何正文）

| | NAL（New Asian Logistics） | CTS（对照） |
|---|---|---|
| `whatsapp_phone_number_id` 填了没 | **没填** | 填了 |
| WhatsApp 对话 | **0 段** | 14 段 |
| Messenger 对话 | 188 段 | 922 段 |
| **邮件对话** | **38 段（已经在跑）** | 497 段 |
| 认出来的人 | 200 个 | 1162 个 |

**要修正统筹的一个说法**：NAL 的 CRM 不是空的——Messenger 和邮件两条通道都已经在给 NAL 收数据。
**缺的只有 WhatsApp 这一条**，而那正好是广告花钱买来的那一条（9/20–10/8 花 NZD 839.60 / 219 次开聊、
9/3–9/30 花 194 / 60 次开聊，这些开聊 ME 一条都看不到）。

### 4.5 三个已核实的缺口（评审补记，均需列入实现范围）

1. **WhatsApp 与邮件不会自动合成同一个人。** 身份表只有在**同一次** `resolveContact` 调用同时带电话和邮箱时才把两种身份挂到同一联系人；
   现有 WhatsApp webhook 只传电话，`mail-ingest.ts:704-720` 只传邮箱。同一客人先 WhatsApp 后邮件、库里又没有同时含两者的表单记录时，会建成**两个联系人**，
   对话、归因、成交状态被拆开。方案：加可靠的关联依据（例如表单/报价单里同时出现两种标识时触发合并）或人工合并入口；在做之前，对外只能说「有共同标识时可合并」，不能说自动跨渠道合并。
2. **邮件正文目前只存约 255 字摘要。** `src/lib/microsoft/mail-graph.ts:18-20,123-126` 刻意只取 Graph 的 `bodyPreview`，`mail-ingest.ts:459-465` 把它写进消息正文；
   完整正文只由 `fetchMessageText` 给个别按需流程读，不入 CRM。长邮件 255 字之后的报价、条件、需求既不在后台，也到不了大模型分析。
   要么把「全文安全获取 + 存储 + 脱敏」列入范围，要么明确产品只保存并分析摘要。
3. **多渠道 brief 与 Coexistence 推送**见 §5 阶段 4 和阶段 2。

### 4.4 「CTS 邮箱付款自动识别成交」能不能复用到 NAL

**能，但不是现在。** PR 2212 **已经合并**（不是草稿），分支 `feat/cts-payment-email-detection`，
代码在 `src/lib/conversions/`，双车道设计、**默认关**。它不是「邮件入口零件」——邮件入口是上面的 `mail-ingest.ts`，
NAL 已经在用；PR 2212 是**在已入库的邮件上判「这单成了」**。
对 NAL 的适配点：CTS 认的是旅游定金邮件的措辞，NAL 是物流，成交信号完全不同（报价确认、提货单、运费到账），
所以复用的是**机制**（在邮件里找成交信号 → 创建成交 outcome，并把 `contacts.stage` 推到 `deposit_paid` / `paid_full`；见 `src/lib/conversions/payment-email-detect-run.ts:664-747`），**规则要按 NAL 重写一份**。
**注意：PR 2212 并不回写 `conversations.status`**，而本文的「开聊→成单」统计依赖该字段。所以阶段 5 必须**新增明确的会话状态回写**（成交 outcome 产生后把对应 `conversations.status` 置为 `won`，含幂等与回滚规则），否则这些对话会一直停在 `open`。
这属于按客户配的东西，不改共享代码。**优先级排在 WhatsApp 接入之后**——现在 NAL 连开聊都看不见，先谈成交判定是本末倒置。

---

## 5. 分阶段方案

| 阶段 | 做什么 | 花钱 | 只读? | 风险级 | 前置 |
|---|---|---|---|---|---|
| **0 · 现在** | 本文档 + 核实 NAL 那个号的现状（在哪个 App、谁是 Meta 管理员、有没有商务组合）。**纯问话和只读核查，不碰设置** | 不花 | 是 | C | 无 |
| **1 · 零成本先把分母立起来** | 把 Meta 广告侧已有的「开聊次数」接进 ME 的目标进度，让 NAL 300/月的目标能看见进度条。**不接正文** | 不花 | 写自己的库 | C | 阶段 0 |
| **2 · 真正接通 WhatsApp** | ① 先补并存模式专用推送：订阅 webhook 字段 `smb_message_echoes`（员工手机回复；载荷数组路径为 `value.message_echoes`）和 `history`（最多 180 天历史聊天）。现有 `src/app/api/webhooks/whatsapp/route.ts` 只读 `value.messages`，这两类目前会被**静默忽略**——员工已回复的客人仍显示「待回复」，要导入的既有聊天也不会入库。必做项：解析、方向判定（我们发 / 客人发）、幂等去重、试跑验收；② ME 自己申请 Meta 两项高级权限（录两段演示提审）；③ **先在 UI 填好号码映射（`clients.whatsapp_phone_number_id`）并订阅 webhook**，再让 NAL 号走并存接入——或由 Embedded Signup 回调原子写入映射；因为 `route.ts:530-557` 未映射的号会被直接跳过并返回成功，`history` 又只在开户后推送一次，**映射和订阅没完成就不得触发/同意历史同步，否则历史会被永久吞掉**；④ 收消息进 `conversations`；⑤ **历史回灌走独立回填路径**：`history` 不得复用实时路径 `route.ts:368-493` 的副作用——不更新会话最后时间/当前状态、不建入站触点、不判退订、不发 `conversation/message.received`（否则两个 Inngest 消费者会制造过期待办和草稿，近 24 小时的历史甚至可能触发自动回复）。验收测试必须断言：回灌后无事件发出、无触点新增、会话当前状态不变、无自动回复 | Meta 消息费按量（并存模式下客人主动找我们的对话有免费窗口），**无平台月费** | 否 | **A**（碰 `src/app/api/webhooks/` 自动判 A 级） | PM 拍板 + 阶段 1 |
| **3 · 在 ME 里回客人** | 出站凭据从「单号全局」改成按客户取；打开 ME 里的 WhatsApp 回复 | 同上 | 否 | **A** | 阶段 2 跑稳两周 |
| **4 · 打开大模型分析** | **不是现成开关，要写代码**：现有候选加载器 `src/lib/messenger/brief-cycle.ts:244-258` 以 `.eq('channel', 'messenger')` 把 WhatsApp / 邮件排除在外，仓库里也没有别的流程为这两个渠道写 `conversation_briefs`。要做：多渠道候选、按渠道区分的提示词、调度、验证；另需邮件全文获取策略（见 §4.5）；按 §3.3 定好打码策略再开 | 模型调用费 | 否 | B | 阶段 2 + 脱敏策略拍板 |
| **5 · 邮件侧成交判定** | 按 NAL 的物流成交信号写一份规则，复用 PR 2212 的机制，并**新增 `conversations.status='won'` 回写**（PR 2212 本身只写 outcome 和 `contacts.stage`） | 不花 | 否 | B | 阶段 4 |

**阶段 2 的试跑要求**（CLAUDE.md「当场试跑」+ 记忆 `feedback-immediate-trial-run-before-done`）：
接通当天必须**当场**用一个我们自己的号给 NAL 的号发一条测试消息，看它真的落进 `conversations`，
并且员工在手机上回一句、确认那一句被记成「我们发的」而不是「客人发的」。**拿不到这两个真实输出就不算接通。**

---

## 6. 要 PM 拍板的点（一句话能回）

1. **要不要现在就去申请 Meta 那两项高级权限？**（不花钱，但要录两段演示视频提交审核、要排期）
   → 回 `申请` 或 `先等`。
2. **NAL 那个客服号归谁管——NAL 自己的 Meta 商务组合，还是我们代建的？**
   → 一句话说清就行（这决定阶段 2 要不要先找 NAL 拿管理员权限）。
3. **大模型分析客人对话，要不要先把姓名电话去掉再送给模型？**
   → 回 `脱敏` 或 `原文`。（供应商这一侧是干净的：Anthropic 商用条款原文
   "Anthropic may not train models on Customer Content from Services"、
   且 "Customer Content is Customer's Confidential Information" —— 出处
   <https://www.anthropic.com/legal/commercial-terms>，2026-10-10 抓取。
   所以这题是我们自己要不要更保守，不是条款逼的。）
4. **这台 Mac 上登录的那个号，你看一眼个人资料页，是不是 NAL 的？**
   → 回 `是` 或 `不是`。（只是补齐 §1 那一格，不影响方案。）

---

## 7. 终局形态：多渠道 + 大模型分析

PM 原话「不光是 WhatsApp 还有邮件 都要存到 Magic Engine 的后台里面 用大模型去分析」。

**表结构已经够用，CTS 的 Messenger 也在上面跑；但 WhatsApp / 邮件的 brief、跨渠道认人、邮件全文这三块还没建好（见 §4.5），不是现成开关。**

```
客人从哪来                   收进来                     认成一个人              分析
点广告→Messenger    →  messenger 同步（每小时）  ┐
点广告→WhatsApp     →  webhook（实时）           ├→ contacts            →  conversation_briefs
发邮件              →  mail-ingest（每小时）     ┘   + contact_identities    （大模型写的卡片：
                                                      （同时带电话+邮箱时合并）   摘要·意向·需求·顾虑·承诺）
                        全部落同一张 conversations（channel 列区分）
                                      ↓
                        status: open / won / lost / not_a_lead
                        entry_referral: 是点哪条广告来的
                                      ↓
                        广告花了多少 → 开了几次聊 → 成了几单
```

- **够不够装？够。** `channel` 列建表时就留了 `messenger / email / voice / whatsapp` 四档，
  `contact_identities` 本来就是为「跨渠道认同一个人」设计的，`conversation_briefs` 本来就是大模型分析的落点。
  **不需要加表、不需要改共享结构。**
- **缺的东西**（已排进 §5 阶段）：WhatsApp 这一路对 NAL 没接，含并存模式的 `message_echoes` / `history`（阶段 2）、
  出站只支持一个号（阶段 3）、多渠道 brief 要写代码（阶段 4）；另有跨渠道认人与邮件全文两个缺口（§4.5）。
- **电话这条通道**（`channel='voice'`）：取值留着，但并存模式下官方通话接口用不了，要走电信供应商，不在这一轮。

**合规上必须守住的那条线（§3.2 的落点）**：
客人对话 = 客户私域。大模型分析的产出（brief）也是客户私域。
**只有「不含任何个人信息的规律」才允许上升成跨客户的行业经验手册**——
一旦把客人对话用于 ME 自己的目的，ME 从「代为保管」变成「共同持有」，法律义务和技术红线同时触发。

---

## 8. Platform Tier Classification（Full）

升 Full 的理由：阶段 3 会动共享运行时（`src/lib/whatsapp/send.ts`），按 skill 规则不能走 Inline。

**被判定对象**：把 NAL 的 WhatsApp（以及后续邮件）客人对话收进 ME 的 CRM 并交给大模型分析。

**建议层级**：**整体 L4（客户配置）+ 已有 L3（WhatsApp Cloud API Connector）+ 已有 L1（CRM / conversations / brief）**。
**不新增任何能力线。** 阶段 3 的「出站凭据按客户取」是**既有 L3 Connector 内部的参数化修正**，不是新能力。

**归属**（不声明新 L1，故此项为既有归属）：6 支柱中的「社媒 / 口碑」承接端 + 平台基础设施里已有的
Measurement Contract / Attribution（广告 → 开聊 → 成单）。

**换客户测试**：✓
- 反例客户 1（CTS）：同一套代码已经在 CTS 上跑，默认行为不需要改——只是 `whatsapp_phone_number_id` 填不填。
- 反例客户 2（Roman HU）：地产客户接进来同样只是填号 + 开 brief；判断规则、权重、提示词都不需要动。
  唯一客户特有的是「什么算成交」，而那本来就在客户配置里（见 §4.4）。

**换行业测试**：✓
- 反例行业 1（旅游，CTS）：已在跑。
- 反例行业 2（地产，Roman）：`conversations` / `contacts` / `brief` 的结构与物流无关。
  行业差异全部落在「成交信号的措辞」和「brief 的提示词」，那两处本来就是按客户 / 按行业配的。

**智能层 or 执行手**：收消息那一段是 **Connector（执行边界）**；
brief / 意向判断 / 归因是 **ME 智能层**，且已经存在。本轮没有新建智能层。

**红线检查**
- 红线 1（禁包装升级）：✓ 不设「WhatsApp 智能层」「对话 Intelligence」之类新能力线。
- 红线 2（禁客户 / 行业事实进共享层）：✓ 路由靠 `clients.whatsapp_phone_number_id` 一列，
  共享代码里没有也不许有 NAL 的号或 id；§7 已把「客人对话不许上升成行业手册」写成硬约束。
- 红线 3（禁直建 L1）：✓ 没有新建 L1，**不进 `platform-candidates.md`**（判为 L4 + 既有 L3/L1，不占候选名额）。
- 红线 4（换客户测试语义级）：✓ 见上，列了 2 个反例客户逐条推演。
- 红线 5（换行业测试语义级）：✓ 见上，列了 2 个反例行业。
- 红线 6（若 L1 走五道 Build Gate）：不适用（未声明 L1）。阶段 2/3 实现时仍按 A 级质量闸走。
- 红线 7（L2 只装行业级）：✓ 本轮不新增也不改任何 Playbook。

**PM 待拍板项**：见 §6（属商业 / 花钱 / 客户事实，不由我拍）。

**结论**
- 原本想法层级：统筹初判「归位既有 Leads 营销中心 / CRM 能力，不新增能力线」。
- 我的复核判定：**一致。** 多一个客户、多一条渠道，落点是客户配置 + 既有连接器 + 既有能力。
- 下一步：等 PM 回 §6 第 1 问；阶段 2/3 真动代码时按 A 级走两审（子牙 + 魏征），PR 保持草稿直到签字。

---

## 9. 按 §11 的资源优先级打分（过程亮出来）

按 `docs/ENGINEERING_QUALITY_GATES.md` §11：

- **频率：高。** NAL 的点击进 WhatsApp 广告天天在跑，9/20–10/8 共 219 次开聊 ≈ 每天 11 次，每天都在产生看不见的数据。
- **IMPACT 闭环关键度：高。** 卡在 Measure 和 Check：花出去的钱买到的开聊，ME 一条都看不到，
  等于广告自治引擎在盲投；NAL 的 300/月目标现在没有任何可读的进度。
- **收入关联度：高。** NAL 衡量 ME 的唯一口径就是开聊数（见 `playbook-ads-industry-logistics`：NAL 看消息不看留资）。
  这条通道不通 = 我们无法证明一千多块买来的开聊变成了生意，直接关系续费。

→ 零个低 + 三个高 → **P0**。

**但要说清楚**：P0 指的是「NAL 的 WhatsApp 开聊 ME 完全看不见」这个问题本身。
本轮交付只是文档（C 级），真正动手的阶段 2 要 PM 先回 §6 第 1 问。

---

## 10. Reuse Statement

- **复用了什么已有平台能力**：`conversations` / `conversation_messages` / `conversation_briefs` /
  `contacts` / `contact_identities` / `contact_touchpoints` 这一整套；WhatsApp webhook 收件与按客户路由；
  Microsoft 邮箱收件；brief 生成；广告归因。
- **新增内容哪些是真正平台共享的**：本轮零新增。阶段 3 的「出站凭据按客户取」是对既有共享模块的参数化修正，
  不新增能力，且修完对所有客户一致受益。
- **哪些是行业特有的**：无（阶段 5 的「物流成交信号」是客户/行业配置，不是共享代码）。
- **哪些是客户特有的**：NAL 的 `whatsapp_phone_number_id`、brief 的提示词上下文、成交信号规则。
- **有没有把客户名 / 客户 ID / 行业判断 / 客户私有事实写进共享运行时**：没有。本文档也没有写入任何客人姓名、
  电话号码，或 NAL 的号码本身。
- **哪些学习只在客户私域，哪些有证据升级**：客人对话与 brief **一律只在客户私域**（§7 的硬约束）。
  本轮唯一可升级为通用经验的是两条机制性教训：
  ①「本机有某个 App 的容器目录」不等于「装了/登录了那个版本」（SMB 容器是空占位）；
  ②并存模式接入前必须先处理员工手机回复的回声事件，否则「谁欠谁一条回复」会整列翻转。
- **本次实现落点与 tier-gate 决策时的分类是否一致**：一致——本轮没有实现，只有文档，落点全部在 `docs/`。

---

## 11. 这一轮做了什么、没做什么

**做了（都有证据）**：本机 WhatsApp 的账号层只读核查（App 身份 / 容器 / 会话与消息计数 / 商业线程计数器）；
生产库只读汇总查询（各客户各渠道对话数、联系人数、号填没填）；只读代码审查（webhook、send、mail-ingest、
brief、三份建表迁移）；抓取并引用 WhatsApp 官方条款、NZ 隐私委员会 IPP 3A 页面、Anthropic 商用条款；
复核统筹给的历史事实（360dialog 已弃、并存模式手机照常用、PR 2212 状态）。

**没做**：没打开任何客人对话；没导出任何对话；没截任何含对话的图；没记录任何客人姓名或电话；
没装软件；没改 WhatsApp 任何设置；没发任何消息；没对生产库做任何写操作；没跑应用的测试 / 类型检查 / 构建
（**纯文档变更，按 CLAUDE.md 记为「未运行：文档变更」**）。

**没核实到的**：这台 Mac 上登录的具体号码（原因见 §1——唯一办法是打开 App 界面，会撞红线）；
Privacy Act s 11 的逐字条文（官方网页版返回 403，只拿到二手解读和官方 PDF 链接）。
