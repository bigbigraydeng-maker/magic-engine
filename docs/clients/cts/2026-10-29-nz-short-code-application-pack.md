# CTS 新西兰短信「专用短号码」申请材料（行前通知，草稿）— 2026-10-29

> 给 PM / CTS 负责人用。目的：在 ClickSend 提交新西兰专用短号码申请。**方括号里的空只有你们知道，我不替你们编。**
> 设计与来历：`docs/specs/2026-10-29-me-email-sms-sending-design-v0.md`（§4.8、§4.10）。官方说明：https://help.clicksend.com/en/articles/43924-new-zealand-64

## 1. 先说结论
- **用途（PM 2026-10-29 定）**：已付款客人的**行前通知和预订确认**，服务类，不带促销。
- **周期与钱**：官方写 4–6 周；ClickSend 公布价每个客户开通费 NZ$65–600、月费 NZ$65–350（4 / 5 / 6 位），最便宜的 6 位能不能给我们，要在申请里问。**实际以他们销售的报价为准**，报价到了发给我核对，你回「批」才确认付钱。
- **现实提醒**：CTS 在 ME 里有 26 个有效订单，只有 9 个有手机号；最近的团 11/03 出发，短号码最快 12 月初才下来，赶不上；用得上的是 2027 年 3 月起的团。
- **营销短信（PM 10-29 追加，选了「放宽」口径）**：发给潜在意向客户（明确同意的人，加上最近咨询过、自己留过手机号的人），短信带链接，点开后填表单或直达指定网页。**发之前要先问清法务，并问 ClickSend 接不接受「默示同意」作为依据**；申请时同意依据**如实写**，不要写成「客人都勾选过同意」。申请时一并问清：一个号码能不能两种用途都挂、要不要两个号码（营销类要「零费率」）、各自多少钱；先按服务类提交。

## 2. 谁办、怎么办（what / how / href）
1. **谁**：PM 或 CTS 负责人本人（要公司注册信息；我不能替你们开户，提交表单也要你们本人点头）。
2. **开户**：ClickSend 官网注册账号（免费）。
3. **申请**：后台 → Global Sending → New Zealand → 注册专用短号码 → 跳转到表格 → 按下面第 3 节填写提交。href：https://help.clicksend.com/en/articles/43924-new-zealand-64
4. **之后**：ClickSend 销售会联系你们谈位数和费用（官方写要 4–6 周）。把报价转给我，我核对；你回「批」才确认。
5. **在号码正式开通、并且 ME 的短信功能（设计稿阶段 3）在内部号码上测过之前，不对真客人发任何短信。**

## 3. 申请表要填的内容（草稿；方括号 = 要你们补）
| 项目 | 内容 |
|---|---|
| 申请主体 | 法定名称 [  ]；公司注册号（NZBN）[  ]；注册地址 [  ]；品牌名 CTS Tours；官网 https://www.ctstours.co.nz |
| 联系人 | [姓名、职务、邮箱、直线电话] |
| 号码类型 | Dedicated short code, **standard rate** (transactional). Please confirm whether a 6-digit code is available to us. |
| Use case | Transactional service messages to existing customers with a confirmed booking: pre-departure reminders and booking confirmations for CTS Tours guided China tours departing from New Zealand. No promotional content. |
| Second use case (planned) | Marketing messages to prospective customers: (a) people who have explicitly opted in, and (b) people who recently enquired with CTS Tours and gave us their mobile number themselves (we rely on inferred consent for messages related to their enquiry; to be confirmed with our legal adviser and with ClickSend). Each message identifies CTS Tours, says why the person is receiving it, contains one link to a CTS Tours page or enquiry form, and a free opt-out (Reply STOP). Not live yet. |
| Questions for ClickSend | (1) Can one dedicated short code carry both transactional and marketing campaigns, or do we need two codes (standard-rate and zero-rated)? (2) Price for each option. (3) What opt-in proof do you need for the marketing campaign, and is inferred consent from a recent enquiry (the customer gave us their mobile number themselves) acceptable? (4) Is a "Reply to this SMS will be charged" line required on standard-rate messages? |
| Who receives | Only customers who have a confirmed booking (deposit or full payment) and have given CTS their mobile number. |
| Opt-in basis | Customers give CTS their mobile number when they enquire or book. CTS's privacy policy (https://www.ctstours.co.nz/privacy-policy) lists "booking confirmations, updates and travel documents" as a purpose and explains that customers can opt out by replying STOP to any SMS. [CTS to add to the booking confirmation: "We'll text you a short reminder before departure. Reply STOP to opt out." and keep a record of it.] |
| Volume | [10–30] messages per month for now (about [9] customers currently have a mobile number on file), rising with 2027 departures. [PM to confirm] |
| Sending hours | 9:00–20:00 New Zealand local time. Urgent itinerary changes may be sent outside these hours. |
| Opt-out / help | Reply STOP (any case) = removed within minutes and logged. HELP = CTS contact details. Alternatives: info@ctstours.co.nz or 0800 287 888. |
| System | Messages are sent by CTS's marketing platform through the ClickSend API; every send is logged. |

## 4. 短信样稿（英文；`{}` 是系统自动填的内容）
1. **Booking confirmation**：`CTS Tours: Thanks {first_name}, we've received your payment for the {tour} tour departing {date}. We'll email your trip info shortly. Reply to this SMS will be charged. Reply STOP to opt out.`
2. **Pre-departure reminder**（出发前约 7 天）：`CTS Tours: Hi {first_name}, your {tour} tour departs on {date}. Your final trip info has been emailed to you. Questions? Call 0800 287 888. Reply to this SMS will be charged. Reply STOP to opt out.`
3. **Urgent itinerary change**：`CTS Tours: Update for your {date} {tour} departure: {short_change}. Details emailed. Call 0800 287 888 if unsure. Reply STOP to opt out.`

说明：新西兰运营商要求每条带「Reply to this SMS will be charged」（Twilio 新西兰指南）——是否适用于标准费率号码，申请时向 ClickSend 确认。加上这句后每条可能超过 160 个字符，会按 2 段计费。

## 5. 要先补的几件事（我没法替你们做）
1. **订单确认环节加一句短信说明，并留记录**（PM 2026-10-29 确认：现在订单确认环节**没有**这句）。申请时对方要「客人如何同意收短信」的证明。CTS 官网隐私政策已写「发送订单确认、更新和旅行文件」并说明回 STOP 退订；官网联系表单收手机号，但没有短信同意那一句。
   - **加什么（英文原文，可直接复制）**：`We'll send a few short text messages about your booking to the mobile number you gave us — a confirmation, a reminder before departure, and any urgent itinerary change. Reply STOP at any time to opt out.`
   - **加在哪**：订单确认邮件、付款 / 订金确认邮件各一处（CTS 销售 / 负责人；以后每个新订单都带）；订单条款页若有，也加。
   - **怎么留记录**：首选让 ME 从已发送的订单确认邮件里自动认出这句话并记下（客人、时间、文本版本），不靠人手点；备选是 CRM 订单页手动勾选。具体放设计稿阶段 3。**这句话的原文改一个字，版本号就要变**，所以请先定稿再用。
2. **已有订单怎么办**（26 个有效订单，他们收到的确认里没有这句，**不能倒填同意**）：建议下一封发给他们的邮件（如行前须知）里加这句，并请客人回复确认手机号；回复确认的才进行前短信名单。要不要这样做，PM / CTS 定。
3. **下订单时必收手机号**。现在 26 个有效订单里只有 9 个在 ME 里有手机号，不补的话行前短信覆盖不到多少人。
4. **（营销短信前）官网表单和 Facebook 表单加「同意收短信」一句并留记录**：参考英文 `Yes, text me tour offers from CTS Tours. I can reply STOP at any time to opt out.`。官网表单由官网仓库的窗口改；Facebook 表单要先通知广告总控窗口，不要自己改正在投的表单。放宽口径下这不是硬前提，但它是把「默示同意」换成「明确同意」的路，也是 ClickSend 要求证明时的退路。

## 6. 我没核实的
- ClickSend 申请表格（Jotform）的具体字段：要开了账号才看得到，上面是按常见要求备的草稿。
- 标准费率号码是否必须带「Reply to this SMS will be charged」；6 位号码是否会批给我们；每条短信的官方单价。
- CTS 的法定名称、注册号、注册地址：ME 里没有，要你们提供。
- 营销类短号码的具体要求（零费率号码是否要单独申请、是否要先给出同意采集的证明）：问 ClickSend。
- 营销短信「放宽」口径（默示同意）：法律上站不站得住、ClickSend 接不接受，都要先问；申请表里同意依据必须如实写，不能写成「客人都勾选过同意」。
