# CTS 月度旅行建议信 · 倒数版系列 v0 + 12 月初要发的两篇草稿

> 状态：**草稿 v0，未经独立审查、未发送**｜作者：126 号窗口｜起草日：2026-11-04（新西兰时间）｜台账卡：2026-11-04-cts-monthly-predeparture-newsletter-first-draft-due-1119
> 本文件不是发送授权：每次发送都要 PM 本人在对话里点头（手册 NL-14）；只在本机，PM 回「行」之前不推送。
> 缘起：PM 11-04 在 129 号窗口提出「给交了定金的客户持续发旅游建议 newsletter，按月，直到出发前」；回「插队」后补充「客户交定金的时间不一样，距离出发有 3、4、5 个月」，并回「对」确认**倒数版**（按每位客人离出发的月数发对应那一篇）。

## 1. 系列设计

### 1.1 谁收（正面选人）

1. ME 库（CRM）：预订状态有效 + 出发日 ≥ 发信日 + 「定金」里程碑已付（与 `src/lib/crm/sales-progress/deposited-seats.ts` 同口径）+ 没标「别再联系」。
2. Mailchimp：发信前逐人核对「已订阅」，不是退订 / 已清理 / 带 `suppressed_do_not_email` 标签。原因：ME 的「别再联系」是销售联系标记，不同步 Mailchimp 的退订，11-04 在库里没找到 Mailchimp 订阅状态字段（台账 2026-10-14 有一位退订者仍收两封群发的先例）。
3. 离出发月数 = （出发日 − 发信日）÷ 30.4 天，四舍五入到整月，等于本篇对应月数的人才收本篇。不足 4 周不发（团级行前须知接手）；超过 5 个月的先不发，到 5 个月再开始。
4. 同一客人 7 天最多 2 封（跨所有邮件类型合计），发前在 Mailchimp 联系人档案里数。
5. 每次发信用一次性新标签（如 `predep_m5_202612`），不复用旧标签，收件人只含当次名单。
6. 与手册 PL-03 的关系：默认排除集把 `booked_*`（已订团）从营销信里排除、只收行前信；本系列正是写给这批人的行前信，所以必须是「正面选人」，不能靠默认名单。

### 1.2 一套 5 篇（以后新订团的客人用同一套）

| 篇 | 离出发 | 主题 | 主要依据 | 状态 |
|---|---|---|---|---|
| 1 | 5 个月 | 第一张清单：护照、免签状态、保险、SafeTravel 登记、团含什么 | 官网签证页 / 团含什么页 / SafeTravel | **本稿已写（§2）** |
| 2 | 4 个月 | 认识目的地：最佳季节与城市指南 | 官网 best-time 与城市指南页 | 待读官网后写 |
| 3 | 3 个月 | 应用、支付与上网 | 官网应用与支付页 / 新手贴士页 | **本稿已写（§3）** |
| 4 | 2 个月 | 装箱与体能 | 官网 packing 页 | 待读官网后写 |
| 5 | 1 个月 | 安全与礼仪、证件清单、行前须知何时到 | 官网 safety 页 / SafeTravel | 待读官网后写 |

晚交定金的客人从「当时离出发月数」对应的那篇开始收；前面几篇的要点在那篇里用一句话回顾并附链接（§3 末尾的「quick reminder」就是这个做法）。

### 1.3 按现有客人的发信安排（11-04 只读核对：5 月团 6 位、3 月团 10 位；11/16 出发那位来不及）

| 发信时间 | 5 月团（5/8 与 5/13 出发，6 位） | 3 月团（3/11 与 3/18 出发，10 位） |
|---|---|---|
| 12 月初 | 第 1 篇（5 个月） | 第 3 篇（3 个月） |
| 1 月初 | 第 2 篇（4 个月） | 第 4 篇（2 个月） |
| 2 月初 | 第 3 篇（3 个月） | 第 5 篇（1 个月） |
| 3 月初 | 第 4 篇（2 个月） | 不发（已不足 4 周） |
| 4 月初 | 第 5 篇（1 个月） | — |

约 60 封，只需写 5 篇。名单数字是快照，每次发信当天重算。

### 1.4 每期流程

草稿 → 独立审查员逐句核事实 → PM 看 → PM 回「行」 → 我在 Mailchimp 建活动（一次性标签、只含当次收件人）→ PM 回「发」→ 发出 → 发后 T+1 / 3 / 7 对账（送达、打开、点击、退订）。每期都由 PM 叫我才做，不自己定时发。

### 1.5 内容红线（客户简报 v3 + 手册 NL-17）

英语（新西兰口吻）；专业而温暖；不用表情符号；不出现 cheap / bargain / tourist trap / exotic；不出现 since 1928 / 98 years 这类历史说法（要写必须与「新西兰 25 年」成对，本稿干脆不提）；不写价格（要写必须带「每人·双人同住」）；不用倒计时 / 截止 / 只剩几席这类销售紧迫感词。「离出发约 N 个月」是对客人已订行程的服务性说明，不是销售紧迫感，请 PM 过目时一并判断。

## 2. 第 1 篇「离出发 5 个月」（12 月初发给 5 月团 6 位）

主题：`Five things to do now for your China tour`
预览文字：`A short checklist from Baker at CTS Tours.`

```
Kia ora {{first_name}},

Thank you again for booking your China tour with CTS Tours. Between now and your departure I'll send you a short note each month with practical tips, so there are no surprises on the day.

Here are five things worth doing now.

1. Check your passport. Make sure it is valid and has blank pages for entry stamps. We recommend at least six months of validity from the day you arrive in China.

2. Visa-free entry. New Zealand passport holders can currently enter China visa-free for up to 30 days, and this is published until 31 December 2026. Your tour departs in 2027, so we are watching for China's announcement about the new year and will email you as soon as we have confirmed news. There is nothing you need to do right now. Our visa guide always shows the latest: https://www.ctstours.co.nz/china-visa-guide-for-new-zealanders?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m5_202612

3. Travel insurance. New Zealand's SafeTravel service advises comprehensive cover that includes medical evacuation by air, and we strongly recommend it too.

4. Register your trip on SafeTravel (safetravel.govt.nz). It lets the Ministry of Foreign Affairs and Trade send you updates about the places you are visiting.

5. Know what is included. Your itinerary page lists what is and is not included in your tour, and our plain-language guide explains the details: https://www.ctstours.co.nz/blog/what-is-included-guided-china-tour-nz?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m5_202612

If you have any questions at all, just reply to this email or call us on 0800 287 888. We are always glad to help.

Warm regards,
Baker Gu
Founder, CTS Tours
```

### 2.1 逐句出处（11-04 取页：官网原始页面 + 新西兰外交贸易部 SafeTravel 中国页「Page updated 27 August 2026」）

| 句子 | 出处 | 标记 |
|---|---|---|
| Thank you again for booking … | 客人已订团（CRM）；致谢是客套话 | 客套话 |
| Between now and your departure I'll send you a short note each month … | PM 11-04 决定：按月发到出发前（台账卡） | PM 决定 |
| Check your passport. Make sure it is valid and has blank pages for entry stamps. | 签证指南页「Check Passport Validity: Ensure your NZ passport is valid and has blank pages for entry stamps」 | 官网可溯 |
| We recommend at least six months of validity from the day you arrive in China. | 签证博客写「A passport with 6 or more months of validity remaining on the day you enter」（当作要求）；签证指南页写「no specific 6-month requirement for visa-free entry, but recommended」——**两页官网口径不一致**，本句取两页都成立的「建议」 | 官网可溯（口径不一，见 §4） |
| New Zealand passport holders can currently enter China visa-free for up to 30 days, and this is published until 31 December 2026. | 签证指南页、签证博客、新手贴士页、全站横幅都写 30 天、到 2026-12-31；签证指南页注「Confirmed by China MFA, May 2026. Verify with the Chinese Embassy before travel」 | 官网可溯；**发送当天必须重核官方最新状态** |
| Your tour departs in 2027, so we are watching … will email you as soon as we have confirmed news. | 出发年份来自 CRM；「关注并及时通知」是 CTS 的承诺 | PM 决定（见 §4 第 1 条） |
| There is nothing you need to do right now. | 判断：免签期内无需办理；若延期未获确认，到时再通知 | 未证实（PM 过目） |
| Our visa guide always shows the latest | 签证博客「I keep it updated whenever the policy moves」 | 官网可溯 |
| Travel insurance … SafeTravel advises comprehensive cover that includes medical evacuation by air | SafeTravel 中国页「should have a comprehensive travel insurance policy in place that includes provision for medical evacuation by air」 | 官方可溯 |
| … and we strongly recommend it too. | 签证指南页「comprehensive travel insurance is still strongly recommended」；团含什么页「Travel insurance — I insist on it」 | 官网可溯 |
| Register your trip on SafeTravel … send you updates about the places you are visiting. | SafeTravel 页「Register your plans and contact details so we can send you travel updates about the places you're travelling to」；页脚署名 Ministry of Foreign Affairs and Trade | 官方可溯 |
| Your itinerary page lists what is and is not included … | 团含什么页「read the Inclusions and Exclusions on the itinerary page I give you」 | 官网可溯 |
| If you have any questions … reply to this email or call us on 0800 287 888. | 电话：官网首页（页面上显示为 0800 CTS 888，同一号码）；「直接回信」要 Mailchimp 活动的回复地址设成 info@，发前核 | 官网可溯 + 发前核 |
| Warm regards, Baker Gu, Founder, CTS Tours | 欢迎信草稿同一署名（官网首页 Baker Gu，头衔 Founder & Lead China Specialist） | 官网可溯 |

## 3. 第 3 篇「离出发 3 个月」（12 月初发给 3 月团 10 位）

主题：`Your China tour: apps, payments and staying connected`
预览文字：`A few things worth setting up before you leave New Zealand.`

```
Kia ora {{first_name}},

Your China tour is about three months away. This month's note is about the small things worth setting up before you leave New Zealand.

On our guided tours your guide looks after the main transfers and many meals, so you may only need a few apps for your free time:

- Maps. Google Maps doesn't work well in China, so we suggest Amap (Gaode) or Baidu Maps. Star your hotel and save key addresses before you leave.
- Translation. Pleco works offline. A hotel card written in Chinese is also handy for taxis.
- Messaging. WeChat is widely used for chat and for ordering in restaurants.
- Payments. Alipay and WeChat Pay are widely used in the cities and are increasingly able to take foreign cards, although the rules change. Carry some Chinese yuan in cash as well.
- Your bank. Tell your New Zealand bank your travel dates so your card isn't blocked.

Google, Facebook and Instagram are blocked in China, so if you rely on them, sort out your plan before you go. Download and test everything at home first. Our guide has the details: https://www.ctstours.co.nz/blog/essential-travel-apps-china-navigation-communication-payment?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612

A quick reminder if you haven't done them yet: check your passport (we recommend at least six months of validity from the day you arrive in China), arrange comprehensive travel insurance, and register your trip on SafeTravel (safetravel.govt.nz).

Visa-free entry. New Zealand passport holders can currently enter China visa-free for up to 30 days, and this is published until 31 December 2026. Your tour departs in 2027, so we are watching for China's announcement about the new year and will email you as soon as we have confirmed news. There is nothing you need to do right now. Our visa guide always shows the latest: https://www.ctstours.co.nz/china-visa-guide-for-new-zealanders?utm_source=mailchimp&utm_medium=email&utm_campaign=predeparture_m3_202612

If you have any questions at all, just reply to this email or call us on 0800 287 888. We are always glad to help.

Warm regards,
Baker Gu
Founder, CTS Tours
```

### 3.1 逐句出处

| 句子 | 出处 | 标记 |
|---|---|---|
| Your China tour is about three months away. | 3 月团出发 3/11 与 3/18，12 月初发信时离出发约 3.3～3.5 个月，取整 3 | 计算得出 |
| On our guided tours your guide looks after the main transfers and many meals, so you may only need a few apps … | 应用与支付页「On my Discovery and Signature tours, guides handle core transfers」「Discovery and Signature programmes handle core transfers and many meals — you may only need maps for free evenings」；3 月团订的是 Discovery 团（Best of China、A Tale of Two Cities） | 官网可溯 |
| Maps. Google Maps doesn't work well in China … Amap (Gaode) or Baidu Maps. | 新手贴士页「Baidu Maps or Gaode Maps (Google Maps doesn't work well in China)」 | 官网可溯 |
| Star your hotel and save key addresses before you leave. | 应用与支付页「Learn to star your hotel and screenshot key addresses」 | 官网可溯 |
| Translation. Pleco works offline. | 新手贴士页「Pleco for translation (works offline)」 | 官网可溯 |
| A hotel card written in Chinese is also handy for taxis. | 应用与支付页「A paper hotel card in Chinese still saves awkward taxi moments」 | 官网可溯 |
| Messaging. WeChat is widely used for chat and for ordering in restaurants. | 应用与支付页「WeChat (Weixin) is ubiquitous for chat, restaurant ordering …」 | 官网可溯 |
| Payments. Alipay and WeChat Pay … increasingly able to take foreign cards, although the rules change. | 应用与支付页「increasingly accept foreign cards … policies evolve」（新手贴士页写得更肯定：「international cards now supported」，本稿取更谨慎的一句） | 官网可溯 |
| Carry some Chinese yuan in cash as well. | 应用与支付页「Carry CNY cash for backup」；新手贴士页「Always carry some RMB」 | 官网可溯 |
| Your bank. Tell your New Zealand bank your travel dates … | 应用与支付页「Notify your NZ bank of travel to reduce card blocks」；签证指南页「Notify Your Bank」 | 官网可溯 |
| Google, Facebook and Instagram are blocked in China … | 新手贴士页「Many Western apps (Google, Facebook, Instagram) are blocked」 | 官网可溯 |
| Download and test everything at home first. | 应用与支付页「Install and test on your phone before leaving New Zealand」「Install and register before you fly」（原文针对 VPN 与 DiDi，本稿概括为全部应用） | 官网可溯（概括） |
| A quick reminder … passport … insurance … SafeTravel | 同 §2.1 对应各行 | 同 §2.1 |
| Visa-free entry … | 同 §2.1 对应各行 | 同 §2.1 |
| If you have any questions … / Warm regards … | 同 §2.1 | 同 §2.1 |

## 4. 待 PM 决定 / 待核（一次只问一个，按顺序）

1. **要不要在第一期如实写免签只公布到 2026-12-31**（两篇的「Visa-free entry」那段）。官网自己写免签到 2026-12-31，而现有 16 位客人都是 2027 年出发。建议写：信息本来就公开在官网上，客人迟早会看到，由 CTS 先平静地说清、并承诺有确认消息立刻通知，比沉默稳妥。不写的话删掉这一段并把序号顺延。**发送当天必须重核官方最新状态**（那时可能已官宣延期）：核对中国驻新西兰使馆签证页与外交部通告，写明核对日期。
2. 官网两页对护照有效期说法不一（博客写「要求 6 个月以上」，签证指南页写「无硬性要求但建议」）。本稿写「建议」，两页都成立；官网要不要统一是另一件事，不归本任务。
3. 署名用 Baker 第一人称，与欢迎信草稿一致。
4. 「直接回这封信」：发送前把 Mailchimp 活动的回复地址设成 info@ 并真回一封验证。
5. 这批收件人在 Mailchimp 里的订阅状态还没核（11/5 例行查漏登录时顺带查）。核完才能建活动。
6. 链接：发送前逐个核（下架团页返回 200 但内容是通用页的坑），本稿用到的三条官网页 11-04 已取回、标题与内容对得上，SafeTravel 页 11-04 已取回。
7. 第 2、4、5 篇尚未写；官网对应页（best-time / packing / safety / 城市指南）起草前逐页读。

## 5. Reuse Statement

- 复用：手册 PL-03（分群）、NL-04（7 天封数）、NL-14（发送每次 PM 本人）、NL-17（内容红线）；CRM 的「定金已付」口径；客户简报 master_briefs v3；官网原始页面核对法；现成的 Mailchimp（不新建系统）。
- 新增 platform-shared：无。industry-specific：「旅游行前倒数序列」的 5 篇主题骨架是旅游行业候选，目前只有 CTS 一个客户的证据，先只放在 CTS 自己的文档里，不进共享代码，也不登记候选（Low bar 登记需 PM 回「记」）。client-specific：全部文案、名单规则、发信安排。
- 没有把客户名、客户 ID 写进共享代码；本文件不含任何客人的邮箱或姓名。
- 学习仍在 CTS 私有层。
