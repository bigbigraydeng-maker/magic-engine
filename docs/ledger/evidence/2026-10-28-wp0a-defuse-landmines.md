# WP0a 先拆雷 · 执行记录（2026-10-28 NZ 上午，PM 回「停」后在他已登录的 Chrome 里操作）

PM 授权原话：「停：关掉 E2/E3/E4 三个发信定时任务（只关不删），并把 13 封全员草稿的收件人改成只发测试地址；不动 E1 批次和同步类任务」。
邮箱不落盘；客人没有出现在本文件里。

## 一、三个发信触发器（Apps Script 项目 CTS CRM Mailchimp Tag Sync，PM 账号）

| 函数 | 原设置 | 现设置 |
|---|---|---|
| dailySendE2Batch | 时间触发 · Day timer · 早 8:00–9:00（GMT+13）· Head · 失败通知 Notify me daily | 时间触发 · Specific date and time · 2099-12-31 03:00 |
| dailySendE3Batch | 同上，早 9:00–10:00 | 同上 |
| dailySendE4Batch | 同上，早 9:00–10:00 | 同上 |

**没动**（共 5 个）：dailySendE1Batch、pollAllOpens、syncNewLeadsToMailchimp、checkCustomerReplies、onCrmEdit（表格编辑触发）。

**为什么是改日期、不是删或停用**：Apps Script 的触发器没有「停用」开关，行菜单只有「Delete trigger」。我先点了「Delete trigger」，被安全系统拦下（判为不可逆删除，也违背「只关不删」），没有执行。改用可逆办法：把触发器改成 2099 年的一次性日期，条目与代码都还在。
**保存时的授权页**：每次保存，Google 都弹出「Google 未验证此应用」的授权确认页。我没有点「继续」（授权只能 PM 本人点）。三个修改仍然生效：刷新后重新打开触发器对话框，E2 / E3 / E4 都显示 Specific date and time · 2099-12-31 03:00。
**恢复**：Edit trigger → 类型改回 Day timer → 选回原时间段 → Save（保存时可能再弹同一个授权页）。

## 二、草稿收件人（Mailchimp，名单 CTS Tours）

- 新建一个**保存分组**：`INTERNAL TEST ONLY - 1 internal address - never for real sends`，条件 Email Address is 公司内部测试地址（`hello+…@magicengine.cloud` 形式的测试联系人，名单里已有，订阅状态 subscribed），预览 1 人。没有给任何联系人加 / 摘标签。
- 已改 **11 封**（网页编号）：15910698 / 15910546 / 15910547 / 15910545（四封行前须知：Golden China 11/16、Tale of Two Cities 10/15、Best of China 11/3、10/14 那封）；15910353 / 15910352 / 15910119（圣诞 ×3）；15909530 / 15909750（Untitled ×2）；15909756 / 15909755（Email 4 / Email 3）。每封保存后读回，To 一栏均为「All subscribed contacts in INTERNAL TEST ONLY…」，1 recipient。
- **没动 2 封**：15909753（Email 1 · T+0 Welcome）、15910375（PREVIEW ONLY 新版欢迎信）。E1 批次每天从其中一封复制，PM 说不动 E1 批次；等查清哪封是批次底稿再改。
- 没动：Welcome new contacts（从未激活的自动流程草稿，不是活动）。
- 注意：被我排除的 `reeng_test_jul29` 标签看着像测试组，实际是 25 个真实客人（7 月再互动测试），**不能当测试分组用**。
- 恢复：草稿的 To → Send to → 改回 All email subscribers（不建议）。

## 三、复查（操作后）

- 触发器列表：仍是 8 个触发器，E2 / E3 / E4 为 Specific date and time，其余 5 个原样。
- Mailchimp 活动列表（每页 100 条）：草稿 36 份；收件人仍是「All subscribers」的只剩 15909753、15910375 和欢迎流程草稿；已发送的最新一封仍是 10/27 的 E1 批次，没有新发送。
- 没有点任何「Send」「Schedule」按钮；没有试发测试信。

## 四、没验证的事

- 没等到明早触发时间确认三个任务真的不跑 → 已加日历提醒 10/29 10:30。
- 没读 Apps Script 代码，不确定 E1 底稿是 15909753 还是 15910375，所以两封都没动。
- 2099 年的一次性触发器是个变通办法，不是正式的停用；以后有人在触发器页看到会觉得奇怪，已写在本文件与台账卡里。
