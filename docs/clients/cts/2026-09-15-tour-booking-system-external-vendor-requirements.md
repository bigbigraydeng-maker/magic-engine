# CTS Tour 下单系统 —— 给外部程序员的技术需求（PM 已定稿，2026-09-15）

> 背景：CTS 委托外部第三方程序员独立开发一套专属 Tour 下单系统（后台管理产品线路/订单/旅团/代理商 + 前台展示）。Magic Engine（ME）负责 CTS 除这套系统外的所有其他系统（官网、后台 CRM、对外广告），本文档站在 CTS 技术方（ME）视角，回复对方发来的三个问题。
>
> 状态：**PM 已拍板，可直接发给对方**。服务器由 ME 提供（PM 2026-09-15 明确）。
>
> 与既有方案的关系：ME 曾在 [`docs/specs/2026-09-08-cts-tour-inventory-and-agent-portal-spec.md`](../../specs/2026-09-08-cts-tour-inventory-and-agent-portal-spec.md) 自行设计过"Tour 库存 + Agent 门户"方案（未开发、未获批），现由外部程序员独立承接同一需求，**该内部方案作废，ME 不再自建，改为通过对方导出文件 + AI 识别的方式同步数据**（见下文第一节）。

---

## 平台层级判定（Tier Classification，补记于 2026-09-15 复审）

> [跟班 · Tier] 对方导出文件 + ME 用 AI 识别同步 → **L3 Connector**（外部系统只读导出接入，挂在既有"客户记录同步"能力下，不新增能力线）；CTS 字段如何映射进 ME 自己的记录系统 → **L4 Client Configuration**（CTS 专属，不通用，不下沉平台层）。
> [跟班 · 判据] 换客户测试：如果把 CTS 换成 Oztop，"导出文件+AI识别"这个连接方式本身可以复用（L3），但具体导出哪些字段、怎么对应 CTS 的代理商/团期概念是 CTS 专属（L4）。
> [跟班 · 继续吗？] 本判定不涉及新增 L1/L2，不用登记 candidates；补记目的是让这份文档满足 CLAUDE.md 的平台层级门要求，不影响已发给对方的需求内容。

## 关键事实（决定了这份需求的形状）

- CTS 目前**没有真正的下单系统**：客人靠电话/邮件/网页表单询价，CTS 员工人工报价、人工收定金尾款，全程无库存/订单追踪。
- 这套新系统的使用者是 **CTS 内部员工和代理商（旅行社中介）**，不是普通游客自己操作——游客还是走询价老路，由员工/代理商代客下单。
- ME 与这套新系统**不做实时接口对接**（不用 API/webhook），而是通过**对方系统的导出功能 + AI 识别导出文件**这种半自动方式，把订单情况同步进 ME 自己的客户记录系统。
- 代理商模块是**确定要做**的需求（非可选），PM 原话已在 2026-09-07 确认过"agent 怎么自主订 tour，能查看到 available seat"。
- 服务器由 **ME 这边提供**（2026-09-15 PM 拍板），不需要对方自己找服务器商。

---

## 中文版（可直接发给对方）

**主题：CTS Tour 下单系统——技术需求（来自 CTS 技术方 Magic Engine）**

你好，

谢谢你提的问题。Magic Engine 是 CTS 的技术方，负责 CTS 除这套下单系统以外的所有其他系统（官网、内部CRM/后台管理、广告投放）。这套新的下单系统完全是你们独立开发，跟我们不打通，但下面是一些要求，好让它跟CTS现有的东西对得上。

**背景说明**：这套系统是给CTS内部员工和代理商（帮CTS卖团的中介）用的，用来代客户下单、录入客户信息，不是给普通游客自己上网下单结账用的。游客还是走电话/邮件/网页询价这条老路，由CTS员工或代理商在你们系统里帮他们下单。

---

**第一，后台（产品线路、订单、旅团、代理商）**

- 系统界面全部用**英文**，代理商用的部分也一样。
- CTS员工和代理商都要能：创建订单、填客户信息、选择产品和出发团期，并填写这笔订单实际报名的**旅客人数（占用名额数）**——一张订单可能是一位游客单独报名，也可能是全家或一个团体多人合并成一笔订单，必须如实记录实际人数，**不能默认按"一单固定扣一个名额"处理**。下单成功后，系统要**按这笔订单的实际占用名额数自动扣减该团期的剩余名额**。
- **名额扣减必须是原子操作，不能超卖**：校验"剩余名额是否≥这笔订单要占用的名额数"和"按该数量扣减名额"必须在同一个原子操作里完成——哪怕两个代理商同时对最后几个名额下单，也必须保证已售出名额任何时候都不超过团期总容量。同一笔订单如果因为网络重试/重复点击被提交了两次，要能用同一个订单标识识别出是重复提交，不能被重复扣减名额。
- **名额释放同样必须是原子且幂等的操作，释放数量要等于该订单占用的名额数**：订单被取消、被退款、超过约定付款时限自动作废，或客户改期/改到另一个团期时，系统必须在同一个原子操作里，把之前按该订单占用名额数扣减的名额**如数**加回原团期的剩余名额池——"剩余名额"任何时候都必须等于"总容量 − 仍然有效占用的名额"，已取消/已退款/已作废/已迁出的订单不能继续占用名额。同一笔取消/作废/改期操作即使被重复触发（网络重试、重复点击、人工重复操作），也只能释放一次（按该订单的占用数释放一次），不能多退。
- **订单修改同行人数时，名额也要跟着原子调整**：如果客户下单后增加或减少同行旅客人数（比如从 2 人加到 4 人），系统必须原子地调整该团期的剩余名额——增加人数按上面同样的超卖校验规则扣减新增的名额，减少人数则把差额按上面同样的幂等规则加回名额池，不能只改订单上的人数字段而不联动库存。
- 不需要跟我们做实时的接口对接（不用API/webhook）。你们需要提供一个可靠的**导出功能**（导出成Excel/CSV这类常见表格格式就行），我们会定期拉取这份文件，用AI识别里面的内容来更新我们自己的记录。每次导出至少要包含：
  - 订单编号
  - 客户姓名和联系方式
  - 这单是CTS员工直接下的，还是某个代理商下的——如果是代理商，要注明是哪一个
  - 订的产品/线路和具体出发日期
  - **这笔订单实际占用的名额数（旅客人数）**——不能假设每笔订单固定占 1 个名额
  - 定金状态/金额和付款日期；全款状态/金额和付款日期
  - **订单状态**（比如：待确认/已确认/已取消/已退款/已完成）
  - **取消/退款时间**（如果订单被取消或退款过）
  - **最后更新时间**（这条订单记录最近一次被修改是什么时候）
- **请明确这份导出是全量快照还是增量**：是每次都包含全部历史订单（包括已取消的），还是只导出自上次以来有变化的订单？我们需要知道这一点，才能判断"记录里突然消失的订单"是被取消了，还是只是没被导出，否则我们这边会一直保留错误的客户阶段和预订记录。
- **导出格式要是固定、有版本号的机器可读结构，不能是随意排版的 Excel**：列名和每列的数据类型要保持一致，日期时间统一用 ISO 8601 格式并注明时区（新西兰时间还是 UTC），金额要注明币种；以后只要改动列结构或列名，请同步给我们一个新的"导出格式版本号"。**代理商、产品/线路、团期都要有你们系统里稳定不变的 ID**（不能只给中文名字——代理商改名或线路改名后 ID 不能跟着变），我们靠这个 ID 做匹配，不是靠名字模糊匹配。
- **AI 识别置信度不够、或者某一行数据不符合上面约定格式的，我们会转人工核对，不会直接更新到CRM**——所以格式一旦约定好请尽量保持稳定，减少不必要的人工核对量。
- **产品/团期信息要跟CTS官网、CTS后台保持一致，并且要明确以哪边为准（system of record）**：以 CTS 官网 / CTS 后台的产品数据为准（目前产品数据维护在 `chinatravel` 仓的 `tours.ts` 里），你们系统里能下单的团（比如"Golden China"）的价格、团期信息应该是从那边同步过去的镜像，不是两边各自独立维护、出了问题再对齐。不需要做成实时自动同步，人工/半自动维护也可以，但**任何一边改了价格、容量或出发日期，负责改动的一方要在 1 个工作日内通知另一方同步**，不能让同一个团在两边显示不一样的价格或团期。一旦发现两边不一致，在确认哪边是最新值之前，你们系统里对应的团期要**暂停接受新下单（stop-sell）**，避免代理商按错误价格或日期成交。
- 代理商模块：这是确定要做的需求，不是可选项。代理商需要有自己的账号，能看到剩余名额，能自己下单。**必须做到代理商之间数据隔离（验收条件）**：每个代理商只能查看和修改自己创建的客户和订单，看不到其他代理商的客户姓名、联系方式、付款状态等任何信息。CTS 员工能看到的范围（是否所有代理商的订单都能看）由 CTS 另行定义。

**第二，前台**

- CTS官网（ctstours.co.nz）不需要为了支持"选团期→下单→付款"这种消费者结账流程而做改动，因为游客不会直接使用你们的系统——下单是由CTS员工或代理商代替游客操作的。
- 唯一的要求是：官网上展示的产品、价格、团期信息要跟你们系统里保持一致（参考上面的同步要求）。
- 品牌视觉：请使用CTS现有的品牌色和视觉规范，不要另配一套颜色。主色为正红`#B61E2E`，辅助色为金色`#D6A756`，背景用暖白色。logo文件和完整的品牌规范文档我们可以提供。
- 如果需要视觉/交互参考，CTS现在的官网（www.ctstours.co.nz）在调性上是最好的参考——考虑到这是一个内部/代理商工具而不是消费者电商结账页面，更适合参考典型的B2B旅行代理下单系统那种简洁、高效的录入式界面，而不是零售电商的风格。

**第三，域名、服务器、邮件**

- 域名：建议用CTS现有域名底下的一个子域名（比如`agent.ctstours.co.nz`或`booking.ctstours.co.nz`），域名解析权限留在CTS/我们这边。
- 服务器：**由我们这边提供**，你们只需要告诉我们系统用什么技术做的（编程语言/框架、需要什么数据库），我们把服务器环境准备好，你们把代码部署上去就行，不用自己找服务器商。
- 邮件：系统自动发的邮件（账号邀请、密码重置、订单通知）建议用CTS现有的邮箱域名发送（比如`no-reply@ctstours.co.nz`），不要另起一个发信域名。

有其他问题随时问。

CTS / Magic Engine

---

## English version (ready to send)

**Subject: CTS Tour Booking System — Technical Requirements from CTS's Technology Partner (Magic Engine)**

Hi,

Thanks for your questions. Magic Engine is CTS's technology partner responsible for all other CTS-facing systems (the public website, the internal CRM/back-office, and paid advertising). We're not involved in building the new Tour Booking System — that's fully your build — but below are the requirements so it fits cleanly alongside what CTS already has.

**Context**: This new system will be used internally by CTS staff and by CTS's travel agents (resellers) to create bookings and record customer details on the customer's behalf. It is not a self-service checkout for the traveling public — travelers still enquire by phone/email/web form, and a CTS staff member or an agent then creates the order inside your system.

---

**1. Back-office (products/tours, orders, tour departures, agents)**

- The system should be entirely in **English**, including the interface used by agents.
- Both CTS staff and agents need to be able to: create an order, enter the customer's details, select a tour + departure date, and record the **number of travelers the order actually covers (seat count)** — a single order may be for one traveler, or for a whole family or group booked together, so the real headcount must be recorded and the system **must never assume every order occupies exactly 1 seat**. On successful order creation, the system should **automatically decrement the available seats for that departure by the order's actual seat count**.
- **The seat decrement must be atomic, and must never allow overselling**: checking "are there at least as many seats available as this order's seat count" and "decrementing by that seat count" must happen in a single atomic operation, so the number of seats sold can never exceed total capacity — even if two agents submit orders for the last remaining seats at the same time. If the same order is submitted twice (e.g. a network retry or a double click), the system must recognize it as a duplicate using a consistent order identifier and must not decrement seats twice for it.
- **Seat release must be equally atomic and idempotent, and must release exactly the order's seat count**: when an order is cancelled, refunded, auto-voided after a payment deadline, or rebooked onto a different departure, the system must, in a single atomic operation, add back the exact number of seats that order had decremented to that departure's available pool — "available seats" must always equal "total capacity minus seats still validly held," and a cancelled/refunded/voided/moved-out order must never continue to hold a seat. If the same cancellation/void/rebooking action is triggered more than once (network retry, double click, duplicate manual action), it must only release that order's seats once, never more.
- **If an order's traveler count is edited after creation, the seat allocation must adjust atomically too**: if a customer adds or removes travelers on an existing order (e.g. going from 2 to 4 people), the system must atomically adjust that departure's available seats — increasing the count applies the same overselling check as a new booking, decreasing it releases the difference under the same idempotency rule — rather than just editing a headcount field on the order without touching inventory.
- We do not need a real-time API/webhook connection between your system and ours. Instead, your system needs a reliable **export function** (CSV/Excel is fine) that we will periodically pull and parse (using an AI-based reader on our side) to keep our own records current. Please make sure each export includes, at minimum:
  - Order ID
  - Customer name and contact details
  - Who created the order: direct (CTS staff) vs. agent — and if agent, which agent
  - Tour/product and specific departure date
  - **The number of seats this order actually occupies (traveler headcount)** — never assume 1 seat per order
  - Deposit status/amount and paid date; full-payment status/amount and paid date
  - **Order status** (e.g. pending/confirmed/cancelled/refunded/completed)
  - **Cancellation/refund timestamp** (if the order was cancelled or refunded)
  - **Last-updated timestamp** for the order record
- **Please confirm whether each export is a full snapshot or incremental**: does it include every historical order (including cancelled ones) every time, or only orders that changed since the last export? We need to know this to tell whether an order that's missing from a later export was cancelled, or simply wasn't exported — otherwise we'll end up holding stale customer stages and booking records.
- **The export must follow a fixed, versioned, machine-readable schema — not free-form spreadsheet formatting.** Column names and per-column data types must stay consistent; all dates/times must use ISO 8601 with an explicit timezone (NZ local time or UTC); monetary amounts must state the currency; any change to the column structure or naming must come with a bumped "export format version" you tell us about. **Agents, products/tours, and departures must each carry a stable ID from your system** (not just a display name) — we match records on that stable ID, not on fuzzy name matching, since display names can change (e.g. an agent renaming their agency, a tour being renamed).
- **Rows that don't match the agreed schema, or where our AI-based reader has low confidence, will be routed to manual review on our side rather than auto-applied to the CRM** — so please keep the format stable once agreed, to keep the manual-review volume low.
- **Products/tours and departures should stay consistent with CTS's public website and back-office, with one clear system of record.** CTS's public website/back-office product data is authoritative (currently maintained in `tours.ts` in the `chinatravel` repo); the products/departures bookable in your system should mirror that data, not be independently maintained and reconciled after the fact. This does not need to be a live automatic sync — a manual/semi-automatic process is fine — but **whichever side changes a price, capacity, or departure date is responsible for notifying the other side within 1 business day** so both stay in sync; the same tour must never show a different price or date in the two systems. If an inconsistency is ever found, your system must **stop-sell that departure** (pause new bookings for it) until it's confirmed which value is current, to prevent agents from selling at the wrong price or date.
- Agent module: this is a confirmed requirement, not optional. Agents need their own accounts, need to see available seats, and need to be able to create bookings themselves. **Agent-to-agent data isolation is a required acceptance criterion**: each agent must only be able to view and modify the customers and orders they created themselves, and must never be able to see another agent's customer names, contact details, or payment status. Whatever visibility CTS staff need across all agents' orders is CTS's to define separately.

**2. Front-end**

- No changes are required to CTS's public website (ctstours.co.nz) to support a "select date → book → pay" consumer checkout flow, since travelers do not use your system directly — bookings are entered by CTS staff or agents on the traveler's behalf.
- The one requirement on the public-website side is that displayed tours, pricing, and departure dates stay consistent with what's bookable in your system (see the sync point above).
- Branding: please use CTS's existing brand colors and visual identity — do not create a new color palette. Primary red `#B61E2E`, secondary gold `#D6A756`, warm off-white background. We can provide the logo file and the full brand guideline document on request.
- If you'd like a visual/UX reference, the current CTS website (www.ctstours.co.nz) is the best reference for tone — this is an internal/agent tool rather than a consumer e-commerce checkout, so a clean, efficient data-entry-style UI (similar to typical B2B travel-agent booking portals) is more appropriate than a retail storefront look.

**3. Domain, hosting, email**

- Domain: a subdomain of CTS's existing domain (e.g. `agent.ctstours.co.nz` or `booking.ctstours.co.nz`), with DNS control staying with CTS/Magic Engine.
- Hosting: **we will provide the server.** Please just let us know your tech stack (language/framework, database requirements) so we can prepare the environment — you deploy your code to it, no need to arrange your own hosting.
- Email: system-generated emails (account invitations, password resets, order notifications) should be sent from CTS's existing email domain (e.g. `no-reply@ctstours.co.nz`), not a separate third-party sending domain.

Happy to answer any follow-up questions.

Best regards,
[CTS / Magic Engine]

---

## 后续进展（对方回复服务器/邮件要求后，2026-09-15）

对方回复的服务器技术栈：**Linux + Nginx 1.24 + PHP 7.4 + MySQL 5.7**。PHP 7.4 已于 2022-11 停止官方安全更新，MySQL 5.7 也已于 2023-10 停止 Oracle 官方更新，两者都属于 EOL 运行时——**这个风险不能简单归为"对方系统一侧"**：因为服务器账号、root、网络和备份都由 ME 管理（见下文"服务器已上线"），一旦 PHP 或 MySQL 运行时层面出漏洞导致主机或数据被攻破，CTS 和 ME 同样受影响（这套系统处理客户联系方式和付款状态）。数据库容器只绑定服务器本机 `127.0.0.1:3306` 并不能消除这个风险：面向公网的 PHP 应用本身就是攻击入口，一旦被攻破，攻击者可以借着应用已有的数据库连接向 MySQL 发起攻击查询，"只绑定本机回环地址"挡不住这条路径。
对方还问了 SMTP 发信的服务器/邮箱/用户名/密码/端口/加密方式。

**PHP 7.4 EOL 处理（待 PM 确认，未随"服务器已上线"一并拍板）**：已落地的补偿措施见下文"服务器已上线"——对方账号只给部署权限无 root、数据库不对外网开放、防火墙只开 22/80/443、每周自动备份。但这些是服务器层隔离，**不能替代 PHP 运行时本身的补丁**。两个选项二选一，需 PM 明确：
1. 要求对方把运行时升级到**当时仍在官方安全支持期内、且留有足够迁移窗口**的 PHP 版本。按 PHP 官方支持时间表核对到 2026-09-15 这个时间点：PHP 8.1（安全支持已于 2025-11-25 到期）、8.2（安全支持已于 2025-12-08 到期）都已经是 EOL，不能作为升级目标；8.3 虽未到期但安全支持只剩到 2026-11-23，等于给不出迁移窗口。应要求对方以 **PHP 8.4（安全支持至 2027-11-21）或更新版本**为最低目标，ME 服务器环境随之调整；并约定持续升级策略——当前使用版本进入官方"仅安全支持"倒数一年内，双方就要启动下一次升级，不允许一直裸跑到 EOL 才处理。
2. 如果短期内无法升级，PM 需明确批准"接受 EOL 运行时"并给出迁移期限，期间由 ME 在服务器层加一道 WAF／加强监控作为补偿，而不是默认接受无限期裸跑 EOL 版本。

**MySQL 5.7 EOL 处理（待 PM 确认，未随"服务器已上线"一并拍板）**：MySQL Community 5.7 已于 2023-10 停止更新，同样保存着客户联系方式和付款信息，风险归属和处理逻辑与 PHP 7.4 一致，两个选项二选一，需 PM 明确：
1. 要求对方把数据库升级到仍在官方支持期内的版本——**MySQL 8.0（Oracle 延伸支持至 2029-04）或 8.4 LTS（支持窗口更长）**，ME 服务器环境随之调整；或
2. 如果短期内无法升级，PM 需明确批准"接受 EOL 数据库"并给出迁移期限，期间由 ME 在服务器层记录清楚当前的隔离措施（仅绑定 `127.0.0.1`、防火墙限制）作为临时补偿，而不是把"只绑定本机"当成风险已消除；**每周主机快照不算数据库层的有效补偿**，交易数据的 RPO 缺口需要单独按下文"数据库备份 RPO 待补强"补上，不能用它顶替 EOL 风险的补偿措施。

### 服务器：推荐 DigitalOcean，等 PM 拍板开通
ME 名下没有现成的裸 Linux 服务器账号（现有站点都在 Render，不支持这套老技术栈）。推荐 **DigitalOcean**，最基础规格（约每月 NZ$20），原因：定价透明、这类 LAMP 技术栈的搭建资料最全。**服务器本身的账号密码留在 ME 手上，只给对方开一个"仅能部署代码"的账号，不给 root 全权限。** 状态：等 PM 说"开"才会实际下单付费。

### 邮件：不新开 CTS 邮箱账号，走专用发信钥匙
- 已确认 CTS 官网（`chinatravel` 仓）本来就用 Resend 这个发信工具，以 `info@ctstours.co.nz` 身份发送表单邮件（`FROM_ADDRESS = 'CTS Tours <info@ctstours.co.nz>'`），说明这个域名已经在 Resend 验证过。
- **不建议把任何真实 CTS 邮箱（尤其 info@，装着全部客户往来记录）的真实密码交给外部程序员**——密码是通用钥匙，拿到手不止能发信，还能登进邮箱看到所有客户报价/定金/付款记录。
- 推荐方案：在同一个 Resend 账号里，单独给这套下单系统开一把新的、**仅能发信、不能读取任何邮件内容、随时可作废**的 API 钥匙，通过 Resend 的 SMTP 中转（`smtp.resend.com`）发送。对外显示的发件人地址可以维持在 CTS 域名下（如 `no-reply@ctstours.co.nz`，具体哪个地址待定）。不新开 M365 邮箱账号，不占付费坐席，免费额度（每月3000封）足够用。
- PM 2026-09-15 一度考虑直接复用 `info@` 真实密码省事，但因为上述风险改为先问清楚对方的真实用途再定档。

### 已发给对方的追问（等对方回复后才最终确定邮件方案）

> **关于邮件权限的问题**
>
> 在给你们配置发信账号之前，想先确认一下系统对邮件的具体使用场景，这样能配置成最合适的权限，避免多开不必要的账号。
>
> 麻烦确认：
>
> 1. **系统需要发送邮件的场景有哪些？**（比如：下单成功后给客户发确认信、给代理商发通知、给CTS员工发提醒等，请列全）
> 2. **系统除了"发"邮件，需不需要"收/读"邮件？** 比如：
>    - 需要查看某个邮箱收件箱里的回信内容吗？
>    - 需要处理退信（发送失败的通知）吗？
>    - 需要接收客户回复并做进一步处理吗？
>
> 确认后我们会尽快把发信账号的具体信息（地址/端口/用户名/密码/加密方式）发给你。

**判断逻辑**：如果对方回复"只发不收"——用上面的 Resend 专用钥匙方案，不新开邮箱。如果对方确实需要"收/读"邮件（比如要读某个邮箱收件箱做处理）——才需要单独为这套系统开一个新的 M365 邮箱账号（会占用付费坐席，需要 PM 在 admin.cloud.microsoft 里手动创建，ME 不能代为创建账号）。

### 待办
- [x] PM 拍板：服务器开通 DigitalOcean（2026-09-15 PM 已确认开通）
- [ ] 等对方回复邮件权限问题，再最终确定：Resend 专用钥匙 vs 新开 M365 邮箱账号
- [ ] PM 确认 PHP 7.4 EOL 处理方式：要求对方升级到 PHP 8.4+，还是接受风险 + 给迁移期限（见上文"PHP 7.4 EOL 处理"）
- [ ] PM 确认 MySQL 5.7 EOL 处理方式：要求对方升级到 MySQL 8.0/8.4 LTS，还是接受风险 + 给迁移期限（见上文"MySQL 5.7 EOL 处理"）
- [ ] PM 确认是否现在就上数据库级更短 RPO 备份（每日 mysqldump/binlog PITR + 异地存储）+ 定期恢复演练——每周主机快照 RPO 太长，见上文"数据库备份 RPO 待补强"

## 服务器已上线（2026-09-15）

账号：DigitalOcean，`hello@magicengine.cloud`（ME 公司账号，注意跟 PM 个人 `bigbigraydeng@gmail.com` 账号是两个不同账号，容易混）。

| 项 | 值 |
|---|---|
| 服务器名 | `cts-booking-system` |
| 地区 | Singapore（离新西兰最近的 DigitalOcean 机房） |
| 公网 IP | `206.189.152.68` |
| 系统 | Ubuntu 22.04 LTS |
| Nginx | **1.24.0**（对方要求的版本；**不锁版本、不冻结安全更新**，见下文"Nginx 安全更新策略"） |
| PHP | **7.4.33** + 常用扩展（mysqli/gd/mbstring/curl/xml/zip/bcmath/intl） |
| MySQL | **5.7.44**（用 Docker 跑,只绑定服务器本机 `127.0.0.1:3306`,不对外网开放） |
| 月费 | $14.40 美元（约 NZ$24：服务器 $12 + 每周自动备份 $2.40） |
| 防火墙 | 只开 22(SSH)/80(HTTP)/443(HTTPS)，其余全部拒绝 |
| 备份 | 每周自动备份已开启（主机级快照，RPO 待补强，见下文"数据库备份 RPO 待补强"） |

**给对方的账号权限**：只开一个"部署专用"账号（`deploy`），SFTP 方式上传代码，**没有服务器的完整登录权限**，看不到、碰不到服务器上除了他们自己代码目录以外的任何东西。数据库账号也只给了这套系统自己能用的那一个（不是数据库的总管理员账号）。服务器的总控制权（root）留在 ME 手上。

**Nginx 安全更新策略（2026-09-15 补记）**：Nginx 版本**不锁死、不冻结自动更新**——服务器已开启 Ubuntu `unattended-upgrades`，Ubuntu 安全仓库放出的 Nginx 安全补丁会在补丁发布后 24 小时内自动安装（同大版本内的安全修复，不含跨大版本的功能性升级）。此外每月人工核对一次是否存在需要跨大版本才能修复的 Nginx CVE；如有，2 周内在非生产环境验证与 CTS 系统的兼容性后再升级到生产。不存在"锁死版本、无限期不打补丁"的空窗期。

**数据库备份 RPO 待补强（2026-09-15 补记）**：上表"每周自动备份"是 DigitalOcean 的主机级快照，RPO 接近 7 天——对订单、付款状态、名额这类交易数据来说不够：如果主机在两次快照之间损坏、被误删或被入侵，恢复后名额会跟着数据库一起回退到最多一周前的状态，可能导致已经卖出的名额被系统当成"还没卖"再次放出。需要在主机快照之上再加一层数据库级、更短 RPO 的保护：
1. 每日（或更短周期）对 MySQL 做逻辑备份（如 `mysqldump`/`mydumper`），并开启 binlog 支持时间点恢复（PITR），备份产物存放到服务器以外的地方（如对象存储），不能只留在同一台主机上；
2. 至少每季度做一次真实的恢复演练，验证备份确实可用、恢复流程确实走得通，而不是"开了自动备份就当风险已解决"。
这项已记入上文"待办"，等 PM 确认后落地。

**账号密码不写进这份文档**（安全规定：密码不进代码仓库），已经在对话里直接发给 PM，由 PM 转给对方。

**还没做的**：
- HTTPS 证书——要等 PM/对方定好子域名、把域名解析指过来这台服务器的 IP 之后才能装（域名解析没完成前，浏览器打开这个IP会提示"不安全"，属于正常，等域名接好就会解决）
- 服务器验收测试网址：`http://206.189.152.68/`（目前显示"CTS Booking System server is ready. Deploy your app here.”），对方确认收到部署账号后可以直接试着传一个文件上去验证
