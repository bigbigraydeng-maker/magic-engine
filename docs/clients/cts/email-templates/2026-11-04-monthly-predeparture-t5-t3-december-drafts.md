# CTS 月度旅行建议信 · 倒数版系列 v0 + 12 月初要发的两篇草稿

> 状态：**草稿 v0.3（独立审查员 11-04 已逐句核过，据此改了 9 处；PM 11-04 回「先不说」，免签段落已删），等 PM 看，未发送**｜作者：126 号窗口｜起草日：2026-11-04（新西兰时间）｜台账卡：2026-11-04-cts-monthly-predeparture-newsletter-first-draft-due-1119
> 本文件不是发送授权：每次发送都要 PM 本人在对话里点头（手册 NL-14）；只在本机，PM 回「行」之前不推送。
> 缘起：PM 11-04 在 129 号窗口提出「给交了定金的客户持续发旅游建议 newsletter，按月，直到出发前」；回「插队」后补充「客户交定金的时间不一样，距离出发有 3、4、5 个月」，并回「对」确认**倒数版**（按每位客人离出发的月数发对应那一篇）。

## 1. 系列设计

### 1.1 谁收（正面选人）

1. ME 库（CRM）：预订状态有效 + 出发日 ≥ 发信日 + 「定金」里程碑已付（与 `src/lib/crm/sales-progress/deposited-seats.ts` 同口径）+ 没标「别再联系」。
2. Mailchimp：发信前逐人核对「已订阅」，不是退订 / 已清理 / 带 `suppressed_do_not_email` 标签。原因：ME 的「别再联系」是销售联系标记，不同步 Mailchimp 的退订，11-04 在库里没找到 Mailchimp 订阅状态字段（台账 2026-10-14 有一位退订者仍收两封群发的先例）。
3. 固定发信日 = 每月第一个周三（新西兰时间上午）：12/2、1/6、2/3、3/3、4/7。离出发月数 = （出发日 − 发信日）÷ 30.4 天，四舍五入到整月，等于本篇对应月数的人才收本篇。11-04 对这 5 个日子逐个核过，对现有 16 位的取整都落在 §1.3 那一篇（例：12/2 到 3/18 是 3.49 个月，取 3；若 12/1 发就变成 3.52，取 4，所以发信日不能随便提前）。不足 4 周不发（团级行前须知接手）；超过 5 个月的先不发，到 5 个月再开始。
4. 同一客人 7 天最多 2 封（跨所有邮件类型合计），发前在 Mailchimp 联系人档案里数。
5. 每次发信用一次性新标签（如 `predep_m5_202612`），不复用旧标签，收件人只含当次名单。
6. 与手册 PL-03 的关系：默认排除集把 `booked_*`（已订团）从营销信里排除、只收行前信；本系列正是写给这批人的行前信，所以必须是「正面选人」，不能靠默认名单。

### 1.2 一套 5 篇（以后新订团的客人用同一套）

| 篇 | 离出发 | 主题 | 主要依据 | 状态 |
|---|---|---|---|---|
| 1 | 5 个月 | 第一张清单：护照、保险、SafeTravel 登记、团含什么 | 官网签证指南页 / 团含什么页 / SafeTravel | **本稿已写（§2）** |
| 2 | 4 个月 | 认识目的地：最佳季节与城市指南 | 官网 best-time 与城市指南页 | 待读官网后写 |
| 3 | 3 个月 | 应用与支付 | 官网应用与支付页 / 新手贴士页 | **本稿已写（§3）** |
| 4 | 2 个月 | 装箱与体能 | 官网 packing 页 | 待读官网后写 |
| 5 | 1 个月 | 安全与礼仪、证件清单、行前须知何时到 | 官网 safety 页 / SafeTravel | 待读官网后写 |

晚交定金的客人从「当时离出发月数」对应的那篇开始收；前面几篇的要点在那篇里用几行回顾并附链接（§3 末尾的「quick reminder」就是这个做法）。第 3 篇的接送说法只适用于 Discovery / Signature 客人，Stopover 客人另写。

### 1.3 按现有客人的发信安排（11-04 只读核对：5 月团 6 位、3 月团 10 位；11/16 出发那位来不及）

| 发信日 | 5 月团（5/8 与 5/13 出发，6 位） | 3 月团（3/11 与 3/18 出发，10 位） |
|---|---|---|
| 12/2（周三） | 第 1 篇（5 个月） | 第 3 篇（3 个月） |
| 1/6（周三） | 第 2 篇（4 个月） | 第 4 篇（2 个月） |
| 2/3（周三） | 第 3 篇（3 个月） | 第 5 篇（1 个月） |
| 3/3（周三） | 第 4 篇（2 个月） | 不发（已不足 4 周） |
| 4/7（周三） | 第 5 篇（1 个月） | — |

约 60 封，只需写 5 篇。名单数字是快照，每次发信当天重算。

### 1.4 每期流程

草稿 → 独立审查员逐句核事实 → PM 看 → PM 回「行」 → 我在 Mailchimp 建活动（一次性标签、只含当次收件人、回复地址设成 info@、称呼用 Mailchimp 的写法并设兜底，见 §4）→ PM 回「发」→ 发出 → 发后 T+1 / 3 / 7 对账（送达、打开、点击、退订）。每期都由 PM 叫我才做，不自己定时发。

### 1.5 内容红线（客户简报 v3 + 手册 NL-17）

英语（新西兰口吻）；专业而温暖；不用表情符号；不出现 cheap / bargain / tourist trap / exotic；不出现 since 1928 / 98 years 这类历史说法（要写必须与「新西兰 25 年」成对，本稿干脆不提）；不写价格（要写必须带「每人·双人同住」）；不用倒计时 / 截止 / 只剩几席这类销售紧迫感词。「离出发约 N 个月」是对客人已订行程的服务性说明，不是销售紧迫感（独立审查员也判过：通过，请 PM 过目时一并判断）。

## 2. 第 1 篇「离出发 5 个月」（12/2 发给 5 月团 6 位）

主题：`Four things to do now for your China tour`
预览文字：`A short checklist from Baker at CTS Tours.`

```
Kia ora {{first_name}},

Thank you again for booking your China tour with CTS Tours. Over the coming months I'll send you a few short notes with practical tips, so you feel well prepared.

Here are four things worth doing now.

1. Check your passport. Make sure it is valid and has blank pages for entry stamps. We recommend at least six months of validity from the day you arrive in China.

2. Travel insurance. New Zealand's SafeTravel service advises comprehensive cover that includes medical evacuation by air, and we strongly recommend it too.

3. Register your travel plans on SafeTravel, the New Zealand government's travel advice website. It lets the Ministry of Foreign Affairs and Trade send you updates about the places you are visiting: https://www.safetravel.govt.nz/destinations/china

4. Know what is included. Our guide gives a general overview of what a guided China tour usually includes, and we are happy to go through your own itinerary with you: https://www.ctstours.co.nz/blog/what-is-included-guided-china-tour-nz?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m5_202612

If you have any questions at all, just reply to this email or call us on 0800 287 888. We are always glad to help.

Warm regards,
Baker Gu
Founder, CTS Tours
```

### 2.1 逐句出处（11-04 取页：官网原始页面 + 新西兰外交贸易部 SafeTravel 中国页「Page updated 27 August 2026」）

| 句子 | 出处 | 标记 |
|---|---|---|
| Thank you again for booking … | 客人已订团（CRM）；致谢是客套话 | 客套话 |
| Over the coming months I'll send you a few short notes with practical tips … | PM 11-04 决定：按月发到出发前。本句**不写“每月”**（审查员提醒：第 2、4、5 篇未写、每期要 PM 点头、最后 4 周不发，写死“每月”是 CTS 未必做到的承诺） | PM 决定（措辞放软） |
| Check your passport. Make sure it is valid and has blank pages for entry stamps. | 签证指南页「Check Passport Validity: Ensure your NZ passport is valid and has blank pages for entry stamps」 | 官网可溯 |
| We recommend at least six months of validity from the day you arrive in China. | 签证博客写「A passport with 6 or more months of validity remaining on the day you enter」（当作要求）；签证指南页写「no specific 6-month requirement for visa-free entry, but recommended」；SafeTravel 页没有这一条——**两页官网口径不一致，中国官方口径没核到**。本句是 CTS 自己的建议口径，两页都成立；比官方要求更保守 | 官网可溯（口径不一，见 §4） |
| Travel insurance … SafeTravel advises comprehensive cover that includes medical evacuation by air | SafeTravel 中国页「should have a comprehensive travel insurance policy in place that includes provision for medical evacuation by air」 | 官方可溯 |
| … and we strongly recommend it too. | 签证指南页「comprehensive travel insurance is still strongly recommended」；团含什么页「Travel insurance — I insist on it」；Best of China 团页「Not included … Travel insurance (strongly recommended)」 | 官网可溯 |
| Register your travel plans on SafeTravel, the New Zealand government's travel advice website … | SafeTravel 页「Register your plans and contact details so we can send you travel updates about the places you're travelling to」；页脚署名 Ministry of Foreign Affairs and Trade；官网页脚「The New Zealand SafeTravel website has up-to-date advice from the Ministry of Foreign Affairs and Trade」。注意：SafeTravel 同页另写抵达后须向当地公安登记（多数酒店代办），与本句的“登记旅行计划”是两回事，本稿不提后者 | 官方可溯 |
| Know what is included. Our guide gives a general overview of what a guided China tour usually includes … | 团含什么页「What I typically include on CTS China tours」，并写明「The exact line-up depends on Discovery vs Signature vs Stopover」，所以只说“大致介绍” | 官网可溯 |
| … we are happy to go through your own itinerary with you | 团含什么页「Contact us with your month — I will tell you exactly what is in for that departure and what is not」 | 官网可溯 |
| If you have any questions … reply to this email or call us on 0800 287 888. | 电话：官网首页（页面上显示为 0800 CTS 888，同一号码；独立审查员核到 tel 链接为 0800287888）；「直接回信」要 Mailchimp 活动的回复地址设成 info@，发前核 | 官网可溯 + 发前核 |
| Warm regards, Baker Gu, Founder, CTS Tours | 欢迎信草稿同一署名（官网首页 Baker Gu，头衔 Founder & Lead China Specialist） | 官网可溯 |

## 3. 第 3 篇「离出发 3 个月」（12/2 发给 3 月团 10 位）

主题：`Your China tour: apps and payments to set up before you go`
预览文字：`A few things worth setting up before you leave New Zealand.`

```
Kia ora {{first_name}},

Your China tour is about three months away. This month's note is about a few things worth setting up before you leave New Zealand.

On our Discovery and Signature tours the main transfers are arranged for you, so you may only need a few apps for your free time.

- Maps. Google Maps doesn't work well in China, so we suggest Amap (Gaode) or Baidu Maps. Save your hotel's address in the app before you leave.
- Translation. Pleco works offline. A hotel card written in Chinese is also handy for taxis.
- Messaging. WeChat is widely used for chat and for ordering in restaurants.
- Payments. Alipay and WeChat Pay are widely used in the cities. They can increasingly be set up with a foreign card, although the rules change, so carry some Chinese yuan in cash as well.
- Your bank. Tell your New Zealand bank your travel dates, which helps avoid your card being blocked.

Google, Facebook and Instagram are blocked in China. If you need them, it's best to arrange a VPN before you travel. Set up the apps you plan to use at home first. Our guide has more: https://www.ctstours.co.nz/blog/essential-travel-apps-china-navigation-communication-payment?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612

A quick reminder if you haven't done these yet:
- Check your passport. We recommend at least six months of validity from the day you arrive in China.
- Arrange comprehensive travel insurance.
- Register your travel plans on SafeTravel: https://www.safetravel.govt.nz/destinations/china

If you have any questions at all, just reply to this email or call us on 0800 287 888. We are always glad to help.

Warm regards,
Baker Gu
Founder, CTS Tours
```

### 3.1 逐句出处

| 句子 | 出处 | 标记 |
|---|---|---|
| Your China tour is about three months away. | 3 月团出发 3/11 与 3/18，12/2 发信时离出发 3.26 与 3.49 个月，取整 3 | 计算得出 |
| On our Discovery and Signature tours the main transfers are arranged for you, so you may only need a few apps … | 应用与支付页「On my Discovery and Signature tours, guides handle core transfers」「you may only need maps for free evenings」。**不再写“很多餐”**：独立审查员核到团页，A Tale of Two Cities 10 天含 7 早 5 午 0 晚、Best of China 15 天含 12 早 9 午 1 晚，晚餐基本自理，“many meals”会误导；3 月团订的是 Discovery 团 | 官网可溯 |
| Maps. Google Maps doesn't work well in China … Amap (Gaode) or Baidu Maps. | 新手贴士页「Baidu Maps or Gaode Maps (Google Maps doesn't work well in China)」 | 官网可溯 |
| Save your hotel's address in the app before you leave. | 应用与支付页「Learn to star your hotel and screenshot key addresses」（审查员指出“star”对不用地图应用的读者不直观，改成“保存地址”） | 官网可溯 |
| Translation. Pleco works offline. | 新手贴士页「Pleco for translation (works offline)」 | 官网可溯 |
| A hotel card written in Chinese is also handy for taxis. | 应用与支付页「A paper hotel card in Chinese still saves awkward taxi moments」 | 官网可溯 |
| Messaging. WeChat is widely used for chat and for ordering in restaurants. | 应用与支付页「WeChat (Weixin) is ubiquitous for chat, restaurant ordering …」 | 官网可溯 |
| Payments. … They can increasingly be set up with a foreign card, although the rules change … | 应用与支付页「increasingly accept foreign cards for short-term 'Tour Card' style setups — policies evolve」；原文限于“短期游客卡”式设置，故写“can be set up”而不写“can take”；新手贴士页写得更肯定（「international cards now supported」），不取 | 官网可溯 |
| … carry some Chinese yuan in cash as well. | 应用与支付页「Carry CNY cash for backup」；新手贴士页「Always carry some RMB」 | 官网可溯 |
| Your bank. … which helps avoid your card being blocked. | 应用与支付页「Notify your NZ bank of travel to reduce card blocks」；签证指南页「Notify Your Bank」（原文是“减少被拦”，不写“保证不被拦”） | 官网可溯 |
| Google, Facebook and Instagram are blocked in China. If you need them, it's best to arrange a VPN before you travel. | 新手贴士页「Many Western apps (Google, Facebook, Instagram) are blocked. If you need access, arrange a VPN before you travel」；应用与支付页另写「VPN legality and reliability change — verify current policies」，所以把细节指向指南页。审查员指出原稿“sort out your plan”太含糊，改回官网原来的说法；这一句涉及 VPN，PM 觉得敏感可整句删 | 官网可溯 |
| Set up the apps you plan to use at home first. | 应用与支付页「Install and test on your phone before leaving New Zealand」「Install and register before you fly」（原文针对 VPN 与 DiDi，本稿概括为“先在家设置好”，不写“测试”） | 官网可溯（概括） |
| A quick reminder … passport … insurance … SafeTravel | 同 §2.1 对应各行 | 同 §2.1 |
| If you have any questions … / Warm regards … | 同 §2.1 | 同 §2.1 |

## 4. 待 PM 看 / 待核

**独立审查员 11-04 的结论（后台另一个角色，自己重新取页核对，不看我的结论）：** §2.1、§3.1 引的官网原文逐条对得上；两条带追踪参数的官网链接都返回 200、标题正确；品牌红线全部通过（没有 cheap 等词、没有历史说法、没有表情符号、没有价格、没有倒计时 / 紧迫感）。它挑出 9 处我写得比来源更肯定或会误导的地方，已全部按建议改在 v0.3：①“每月”承诺放软；②“导游包办接送和很多餐”改为只说主要接送（晚餐基本自理）；③“指南讲清细节”改“大致介绍”；④支付“能刷外卡”放软；⑤“保证卡不被拦”改“有助于避免”；⑥“测试一切”改“先设置好”；⑦“sort out your plan”改回官网原话（VPN）；⑧“star your hotel”改“保存地址”；⑨SafeTravel 写完整链接并说明它是新西兰政府的旅行建议网站。它没能核实的：中国官方对护照有效期的权威说法；客人实际拿到的行程文件叫什么；5 月团订的团（官网站点地图里找不到 China Panorama 对应团页，所以邮件不写任何团专属内容）；各应用和支付在现实中是否如此（只核了“来源是否这么写”）。网页是 11-04 的快照，发信前须重核。

1. **免签：PM 11-04 回「先不说」→ 两篇都已删掉，不提签证。** 官网自己写免签（NZ 护照 30 天）只公布到 2026-12-31，而现有 16 位客人都是 2027 年出发；12/14 复核官方是否官宣延期（台账卡 2026-11-04-cts-visa-free-2027-recheck-due-1214），再问 PM 要不要在 1 月那两篇里说。审查员提醒：两封信里的官网链接打开后，页面顶部横幅就写着免签到 2026-12-31，客人可能来问——销售需要一句统一的回答，PM 要的话我来写。
2. 官网两页对护照有效期说法不一（博客写「要求 6 个月以上」，签证指南页写「无硬性要求但建议」）。本稿写 CTS 的「建议」，比官方要求保守，两页都成立；中国官方口径没核到，官网要不要统一是另一件事，不归本任务。
3. 署名用 Baker 第一人称，与欢迎信草稿一致。
4. 称呼：`{{first_name}}` 只是本文的占位符，不是 Mailchimp 的写法。建活动时换成 `*|IF:FNAME|*Kia ora *|FNAME|*,*|ELSE:|*Kia ora,*|END:IF|*`（没名字时只写 Kia ora），并用 Mailchimp 的预览和测试发送验证。
5. 「直接回这封信」：发送前把 Mailchimp 活动的回复地址设成 info@ 并真回一封验证。
6. 这批收件人在 Mailchimp 里的订阅状态还没核（11/5 例行查漏登录时顺带查）。核完才能建活动。
7. 链接：发送前逐个重核（下架团页返回 200 但内容是通用页的坑）。
8. 第 2、4、5 篇尚未写；官网对应页（best-time / packing / safety / 城市指南）起草前逐页读。

## 5. Reuse Statement

- 复用：手册 PL-03（分群）、NL-04（7 天封数）、NL-14（发送每次 PM 本人）、NL-17（内容红线）；CRM 的「定金已付」口径；客户简报 master_briefs v3；官网原始页面核对法；独立审查员做事实核对（写稿人与核对人分开）；现成的 Mailchimp（不新建系统）。
- 新增 platform-shared：无。industry-specific：「旅游行前倒数序列」的 5 篇主题骨架是旅游行业候选，目前只有 CTS 一个客户的证据，先只放在 CTS 自己的文档里，不进共享代码，也不登记候选（Low bar 登记需 PM 回「记」）。client-specific：全部文案、名单规则、发信安排。
- 没有把客户名、客户 ID 写进共享代码；本文件不含任何客人的邮箱或姓名。
- 学习仍在 CTS 私有层。
