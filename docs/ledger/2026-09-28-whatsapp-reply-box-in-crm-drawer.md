---
id: 2026-09-28-whatsapp-reply-box-in-crm-drawer
title: 顾问能在 ME 里回客人的 WhatsApp 了——在这之前整条方案的前提不成立
status: done
owner: pm
decided_on: 2026-09-28
done_on: 2026-09-28
done_ref: commit:840f74cd
source: session:5b9407a2
verify_by: 2026-10-05
verify_how: 号码接上当天按板桥定的演示流程当着顾问跑一遍——① 用一部私人手机给 CTS 那个号发一条消息；② 在 ME「今天该联系谁」里点开这个人，抽屉里应出现「📱 在这里直接回他的 WhatsApp」和倒计时；③ 在框里回一句、点发送、确认那部手机真收到；④ 回库核对 `select direction, sent_by_email from conversation_messages where conversation_id=<那条> order by sent_at` 能看到 outbound 一行且署名是操作人。任一步不成立 = 这张卡回退成 failed
last_checked: 2026-10-10
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---

## 一句话

整条 WhatsApp 方案的前提是「客人在 WhatsApp 说话、顾问在 ME 里回」。**在这个改动之前，ME 里没有任何地方能回 WhatsApp。** 这不是界面缺憾，是前提不成立。

## 怎么发现的

魏征（挑刺）和板桥（客户视角）两个复审**各自独立**撞到同一条。我逐条核实：

- `find src/app/api -path '*reply*'` 只有 `messenger/` 和 `email/`；
- `drawer-actions.ts` 和 `segments.ts` **grep 不到 `whatsapp`**；
- `sendWhatsApp` 的生产调用方只有 `messenger-agent/channel-dispatch.ts:59`（自动问候那条）和 `messaging/adapters/whatsapp.ts:73`，而 `whatsappAdapter` **从未被注册**（全仓 `registerChannel` 只有定义处，零调用方）；
- 唯一能看到 WhatsApp 正文的是 CRM 时间线（`crm/contacts/[cid]/timeline/route.ts:192` 拉全渠道），**只读，没有输入框**。

**不做的后果（板桥的判断，我认同）**：顾问回不了就会用自己手机回 → 那条线 ME 看不见 → 系统天天误报「这个客人没人跟进」→ 假警报一出现，「今天该联系谁」这一页就没人信了。客人那侧更糟：问一句 → 收到一句自动问候 → 然后没人理；旅游是大额消费，这比不上线还差。

## 落点选择

放在 **CRM 抽屉**，跟 `MessengerReply` / `EmailReply` 并排，不另开一个 `/whatsapp` 页面 —— 顾问本来就在「今天该联系谁」里干活，多一个页面等于多一处要翻。三块都自判断：没有对应渠道的会话就什么都不渲染，不给点了没用的入口。

## 四处刻意的取舍

| 取舍 | 为什么 |
|---|---|
| **只做自由文本，不做 AI 草稿三按钮** | 那个批准接口写死 `channel='messenger'`（`messenger/.../drafts/route.ts:89`），WhatsApp 会话直接 404。在它通之前落 pending 草稿只会生成一条办不了的待办 —— 跟 `42d82d0b` 刚修过的形状一样 |
| **`template_only` 翻成 `closed`** | ME 一个模板都没接（`send.ts` 的 `postToGraph` 固定发 `type:'text'`），所以今天它对顾问的实际含义就是「发不出去」。🔴 真接上模板必须改这个映射，否则顾问会以为发不了而其实能发 |
| **复用 `ReplyBox` 而不是抄一份** | 它自己的文件头写着：这是唯一对真实客户说话的输入框，抄第二份意味着以后改确认文案时会漏改一处，而漏掉那处正对着客户。它本来就设计成「新渠道照两张表添一行」 |
| **窗口用 `whatsappWindow` 不是 `messagingWindow`** | WhatsApp 是 24 小时从客人最后一条算；Messenger 是 24h + 7d 人工客服窗。共用一个算法会让其中一边的倒计时是错的 |

## 顺带修掉三处「照抄就出洋相」

板桥挑出、我实测确认，都在共享组件里：

1. `humanError` 没有 whatsapp 分支 → WhatsApp 失败会显示「**Facebook** 已经不让回这条了」。且 `send.ts` 把四种原因全归到 `no_token`，适配器一律翻成「授权掉线了请重连」—— 顾问去重连修不好「号码填错一位」。现在按状态码分开说，并且**不出现供应商真名**。
2. `CONFIRM_TEXT` 的 messenger 那行写死「以 **CTS** 的 Facebook 主页发出去」。whatsapp 这行刻意不写客户名。
3. `WindowNotice` 的 `closed` 那句原文是「Facebook 已经不让回这条了」，对 WhatsApp 是错的渠道，顾问会去检查 Facebook 那边。加 `channel` 参数只改这一句。

## 当场试跑

起开发服务器（:3001）实打实打两条新路由：

| 路由 | 结果 |
|---|---|
| `GET .../crm/contacts/contact-1/whatsapp` | `HTTP 401 {"error":"Unauthorized"}` |
| `POST .../whatsapp/conversations/convo-1/reply` | `HTTP 401 {"error":"Unauthorized"}` |

**401 而不是 404** —— 路由真的注册上了，而且鉴权闸先开火。服务器日志无错误。

测试 8 文件 / 140 条全过；`tsc --noEmit` 在改动文件上无新增错误。变异实测三处，各自只挂对应那一条（地址改成 messenger 的 / 去掉 humanError 分支 / 窗口提示退回 Facebook 那句），失败测试名跟主张对得上。

**未运行**：真实端到端。原因是号码还没接上，生产库里 whatsapp 会话 0 条。判据写在上面 `verify_how`。

## 遗留（不在这个改动里，都另有记录）

客人发的图在 ME 里只显示一行 `[图片]`（`route.ts:156-158` 自己写着「下载是以后的 PR」）· 新消息没有实时提醒，只进第二天那封待办邮件 · 超 24 小时一个字都发不出去（没接模板）· `drawer-actions.ts` / `segments.ts` 的渠道清单仍没有 whatsapp，所以 WhatsApp 来的人卡片上仍只给拨号按钮 · kill switch 一个开关管三渠道（`RESUME-ALL` 会把零信誉新号的自动回复一起打开）· `CONFIRM_TEXT` 的 messenger 那行把客户名写死在共享组件里（红线 2）。

详见 [[2026-09-28-cts-whatsapp-onboarding-design-review]]。
