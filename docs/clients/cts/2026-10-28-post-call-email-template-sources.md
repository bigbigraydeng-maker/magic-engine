# CTS「通话后跟进信」两份种子模板——逐句来源表

> 对应代码：`scripts/crm-email-template-seeds/cts.ts`　设计稿：`docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md` §12
> 状态：两份都是**停用**写入，等 PM / Lisa 确认后才在「邮件模板」页启用（启用 = 新版本）。
> 来源分类：**官网可溯**（官网上就有） / **目录可溯**（已发布的团目录里有，运行时读取） / **Lisa 原信**（来自 Lisa 的跟进信草稿，设计稿 §6.4 转录） / **新写·待确认**（本次新写，需要 PM / Lisa 点头） / **未证实**（找不到出处——**不写**）。

## 1. `post-call-single-tour`（通话后跟进信 · 单团详情）

| 这一句 / 这一块 | 来源 | 备注 |
|---|---|---|
| `Kia ora {{first_name}},` | Lisa 原信 | 名字取客人姓名的第一个词；取不到就不发（要销售手填） |
| `Thank you for talking with me {{call_when}}. It was a real pleasure.` | Lisa 原信 | `{{call_when}}` 只认系统记录的通话或销售亲手点的「刚和他通过电话」；两者都没有就不发 |
| `As promised, here are the details of the {{tour_name}} ({{tour_duration}}), departing {{departure_date}}.` | Lisa 原信（结构）· 目录可溯（团名、天数、班期） | 「As promised」= 电话里答应过发资料，由发信的销售负责这一点（销售点发送即确认） |
| `Why you will love this tour` + `{{tour_highlights:7}}` | Lisa 原信（小标题）· 目录可溯（亮点，最多 7 条） | 目录里亮点为空就不发，不会拿别的团顶 |
| `What is included` + `{{tour_price}}` + `{{tour_inclusions}}` | Lisa 原信（小标题）· 官网可溯（价格文案原样）· 目录可溯（包含项） | 价格就是官网上的那句话；班期有单独价、文案里没有时自动补一句 |
| `You can see the full day-by-day itinerary here: {{tour_url}}` | Lisa 原信 · 目录可溯（链接） | 链接按目录里的团和班期生成，指向在售团；下架团页发不出去。「逐日行程」在官网团页可见——上线前请抽查一页 |
| `If you have any questions, or would like to go ahead, just reply to this email and I will take care of the rest.` | Lisa 原信 | 只让客人回信，不约电话 |
| `Warm regards, {{sender_name}}, CTS Tours` | Lisa 原信 | 「CTS Tours」是客户私有写法，只在这份种子里，不在共享代码里 |
| 主题 `{{tour_name}}: your itinerary and price` | Lisa 原信 | 团名来自目录 |
| ~~`per person, twin share`~~ | **未证实 → 不写** | Lisa 原信里有，但目录里没有「twin share」这个事实；价格只引用官网原文案 |
| ~~`guaranteed departure`~~ | **未证实 → 不写** | 目录里没有「保证出发」这个事实 |

## 2. `spring-2027-follow-up`（春季团通用跟进信 · 3 月 / 5 月）

| 这一句 / 这一块 | 来源 | 备注 |
|---|---|---|
| 主题 `Our March and May departures` | 新写·待确认 | 月份与模板的筛选条件（3 月、5 月）一致。**不写年份**：筛选只认月份、不认年份，目录里出现下一年的 3 月 / 5 月班期时，写死的年份就会错；每个团卡片自带出发日期（2026-10-29 去掉了原先的 2027 字样） |
| `Kia ora {{first_name}},` | Lisa 原信 | 同上 |
| `Thank you for talking with me {{call_when}}. It was a real pleasure.` | Lisa 原信 | 同上 |
| `Here are our tours with departures in March and May:` | 新写·待确认 | 2026-10-28 的上架数据里 3 月、5 月确有班期（见设计稿 §12 的团单）；**以启用那天的目录为准** |
| `{{tour_cards}}` | 目录可溯 | 销售最多选 3 个团，每个团渲染成固定四行：名称与天数 / 出发日 / 价格 / 链接 |
| `You can see all of our tours here: {{all_tours_url}}` | 新写·待确认 | 链接来自「发信设置」里的「全部团页面」，没配置就不发 |
| `If you have any questions, or would like to go ahead, just reply to this email and I will take care of the rest.` | Lisa 原信 | 同上 |
| `Warm regards, {{sender_name}}, CTS Tours` | Lisa 原信 | 同上 |
| 没写「As promised」 | — | 这封是通用信，不假定电话里答应过什么 |

## 3. 写进模板之前就挡掉的东西（机器检查，见 `cts.test.ts`）

- 模板里没有任何写死的价格、日期、链接（全是占位符，运行时读已发布的团目录）。
- 没有销售截止 / 倒计时说法（CTS 的团没有销售截止，售完为止）、没有「免签」说法、没有邀请再约电话的说法。
- 启用前 PM / Lisa 需要核对的只有标了「新写·待确认」的 4 行，以及「逐日行程」抽查一页。
