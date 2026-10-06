---
id: 2026-09-27-nal-messenger-needs-connect-not-reverify
title: 纠正——救 NAL 私信的按钮是「连接 Meta」不是「重新核实」；点错那个会让卡片变绿而私信依旧一条不进
status: done
owner: pm
decided_on: 2026-09-27
done_on: 2026-09-27
done_ref: commit:42d82d0b
source: session:5b9407a2
verify_by: 2026-09-30
verify_how: ① 有人点过「连接 Meta」之后，`select via from` 判定结果应为 `client_oauth`（不是 `staff_verified`）—— 看每小时那次同步的运行记录里 NAL 那条不再报 `page_not_verified`；② `select max(last_message_at) from conversations where client_id='4ae76381-cd45-43bd-85cd-98cfd7604007' and channel='messenger'` 要追到当天，而不是停在 2026-09-16；③ 若卡片变绿但②仍停在 9-16，说明授权账号在主页上没有「消息」权限，按卡上那句换账号再点一次
supersedes: 2026-09-27-nal-messenger-outage-task-already-sent
last_checked: 2026-10-06
check_note: 夜巡只能读仓库和公开页面，这条要登录后台或查生产库才能验，今晚判不了
---
**我 2026-09-27 早先那张卡写「人工任务写得对」，这一条把它纠正了。** 那条任务教人先点「重新核实」——那个按钮救不了私信。

## 一句话

设置抽屉里那张 Facebook 卡上有**两个**按钮，解开的是不同的东西：

| 按钮 | 走哪条路 | 用哪把令牌 | 结果 |
|---|---|---|---|
| **重新核实** | `staff_verified` | 补一条核实记录后**改用公用令牌** | 表单线索恢复；**私信照旧不进** |
| **连接 Meta** | `client_oauth` | 存下**授权人自己的**主页令牌 | 私信 + 表单线索都恢复 |

## 为什么（生产实测，不是推断）

公用令牌那个账号在五个客户主页上拿到的角色都是 `["ANALYZE","ADVERTISE","CREATE_CONTENT"]` —— **没有 `MESSAGING`**。拿它逐个试：

- 五个主页读私信**全部** `HTTP 403 (#200) Requires permission: pages_messaging or User associated with the Page access token does not have an appropriate role on the Page`；
- 同一把令牌读**表单**是好的（NAL 主页列出两张表单：`3PL用户表单` 3 条、另一张 17 条）。

2026-09-27 06:10 那次同步的运行记录正好把两种失败并排摆着：

| 客户 | 结果 | 说明 |
|---|---|---|
| CTS Tours NZ | ✅ 8 段对话 / 4 条消息 | 有自己的 OAuth 主页令牌（`client_oauth`），带「消息」 |
| NM Medspa | ✅ 1 段对话 | 同上 |
| **Roman HU · East International** | ❌ 403 code=200 | **已经过了这道闸**，然后被 Facebook 挡在私信门口 |
| **NAL · NZCPE 2026** | ❌ `page_not_verified: unverified_shared_token` | 还没过闸 |
| Magic Lab Class | ❌ 190 权限被撤 | |

**Roman 和 East 就是「点了重新核实之后」的样子。** NAL 点下去会变成同一个样子：卡片绿了，表单恢复，私信还是 0。

## 改了什么

`src/lib/pm-todo/page-binding-items.ts`：`unverified_shared_token` 这一档单独换成 `HOW_RECONNECT`，先说「连接 Meta」+ 必须用有「消息」权限的账号，并明写「重新核实只会恢复表单线索，私信仍然一条都进不来」。别的档一个字没动（Roman 那条仍是旧文案，因为它的问题不同）。

- 两条测试钉住：该档先说「连接 Meta」；别的档不许被污染。
- 变异实测双向：去掉分支 → 只挂第一条；分支放宽到所有档 → 只挂第二条。失败的测试名跟主张对得上。
- `**粗体**` 不能用：`daily-todo.ts` 把 `how` 走 `esc()` 直接塞 HTML，星号会原样显示。已换成书名号。

## 当场试跑

拿生产数据跑 `pushPageBindingItems`（该函数零写操作）：产出 3 条，NAL 和 NZCPE 拿到新文案、Roman 保持旧文案，NAL 原话已确认无裸星号。

## 同时纠正另一处

我早先说「9 月丢了 6 条表单留资」也是错的。那是把广告平台记的 `onsite_conversion.lead` 当成填表 —— 而 NAL 跑的是点击转 WhatsApp 的广告，那个动作把 WhatsApp 来的人也算进去。实际去读表单：`3PL用户表单` 3 条，库里 3 条都在，**一条没丢**；另一张 6 月老表 17 条超过 Meta 90 天保留期，读不出来也不是我们手上丢的。

**真缺口是开聊那条线：9 月广告记了 207 次开聊，CRM 一次都没收到**（9 月只有邮件在进）。WhatsApp 和 Messenger 各占多少，存下来的动作类型分不出来。
