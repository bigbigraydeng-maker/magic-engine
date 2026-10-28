# 回团感谢信 3 份草稿 · 收件人改成只发测试地址（2026-10-28 NZ 下午，PM 回「接」「登好了」后，在他已登录的 Chrome 里操作）

PM 授权原话：「接」（接手回团感谢信：先把草稿改成只发测试地址，再等客人名单，发信要说「发」）；「登好了」（已重新登录 Mailchimp）。
客人邮箱不落盘；本文件没有任何客人信息。

## 一、改了什么（Mailchimp，名单 CTS Tours，3 份草稿）

| 网页编号 | 草稿（标题均带【草稿-勿发】） | 改前 | 改后 |
|---|---|---|---|
| 15910779 | 10 月回团客人感谢信（含照片使用一句），通用版 | 33 人 · All subscribed contacts in paid_customer | 1 人 · All subscribed contacts in INTERNAL TEST ONLY - 1 internal address - never for real sends |
| 15910780 | 北京-西安团回团感谢信（Tale of Two Cities，10/15 出发） | 同上 | 同上 |
| 15910781 | 上海及周边团回团感谢信（Shanghai & Surroundings，10/14 出发） | 同上 | 同上 |

操作：每份草稿 To → Send to → 勾选「INTERNAL TEST ONLY」保存分组（勾选后原来的 paid_customer 自动取消，只剩 1 项）→ Save。保存后页面读回「To · 1 recipient · All subscribed contacts in INTERNAL TEST ONLY…」，3 份都一致。
没点 Send / Schedule / Finish later，没试发测试信，没改正文、标题、发件人；状态都仍是 Draft。
用的是 WP0a（见 2026-10-28-wp0a-defuse-landmines.md）建好的内部测试保存分组，没新建分组、没给任何联系人加 / 摘标签。

## 二、没动但要知道（不在这次授权内）

读页面确认，仍指向 paid_customer 33 人（都是 Draft）：
- 15910594：旧版老客户感谢+评价+代金券草稿（主题 Thank you for travelling with CTS Tours），是上面 3 份的母版。
- 15910787：电话后跟进，2027 年 3 月出发的中国小团（PM「发54」那封，统管另有处理）。
这两份被误点发送都会发给 33 个已付款客人。等 PM 点头再改成测试分组。

## 三、客人名单（发信的前提）

两个团的客人名单仍然没有：
- 我查了 PM 的 Google 云端硬盘（标题含团名 / 北京 / 西安 / 名单 / booking 等，及全文同时含「Tale of Two Cities」和「Shanghai」的表格）：无命中。
- 统管 10-28 的记录：ME 预订表只有 10/15 一条有效预订、10/14 没有；Mailchimp 标签 booked_oct_nov_2026（11 人）混着 11/3 团；Dropbox 对照表只列 3 / 5 / 11 月之后的团。
→ 名单要 CTS / PM 给。

## 四、恢复办法

草稿 To → Send to → 取消 INTERNAL TEST ONLY，改选 paid_customer（不建议）。

## 五、没验证的

- 没试发测试信，没看过收件人实际收到的样子。
- 发前核对还没跑：团名和图的链接是否指向官网真实团页（curl 200 + title/h1）、价格日期与官网一致、同一客人 7 天不超 2 封、退订 / 别再联系名单排除、「100% 不发照片」的 no_photo_use 登记办法（统管提的，PM 还没点头建标签）。
- 原信 10/8 版在仓库有备份 docs/clients/cts/email-templates/2026-10-08-thank-you-voucher-review.html；10/28 新版（带照片使用一句）只在 Mailchimp。
