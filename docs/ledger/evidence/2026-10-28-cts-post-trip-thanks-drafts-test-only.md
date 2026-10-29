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

**更新（同日下午）**：名单其实在 hello@ 邮箱里——Baker 当天 12:28 发了上海及周边团 4 个邮箱、12:31 发了北京-西安团 10 个邮箱，对照结果见第七节。下面是名单到手之前的查找记录：
- 我查了 PM 的 Google 云端硬盘（标题含团名 / 北京 / 西安 / 名单 / booking 等，及全文同时含「Tale of Two Cities」和「Shanghai」的表格）：无命中。
- 统管 10-28 的记录：ME 预订表只有 10/15 一条有效预订、10/14 没有；Mailchimp 标签 booked_oct_nov_2026（11 人）混着 11/3 团；Dropbox 对照表只列 3 / 5 / 11 月之后的团。
→ 当时判断名单要 CTS / PM 给（后来 PM 指出在 Baker 的邮件里）。

## 四、恢复办法

草稿 To → Send to → 取消 INTERNAL TEST ONLY，改选 paid_customer（不建议）。

## 五、没验证的

- 没试发测试信，没看过收件人实际收到的样子。
- 发前核对还没跑：团名和图的链接是否指向官网真实团页（curl 200 + title/h1）、价格日期与官网一致、同一客人 7 天不超 2 封、退订 / 别再联系名单排除、「100% 不发照片」的 no_photo_use 登记办法（统管提的，PM 还没点头建标签）。
- 原信 10/8 版在仓库有备份 docs/clients/cts/email-templates/2026-10-08-thank-you-voucher-review.html；10/28 新版（带照片使用一句）只在 Mailchimp。

## 六、加照片（PM：北京-西安团 2 张、上海及周边团 1 张；照片在 PM 的 Dropbox 共享文件夹里）

- 取图：3 张客人团队合影——北京-西安团 2 张（长城、西安博物院），上海及周边团 1 张（上海外滩 / 东方明珠）。每张压到宽 1200px、约 0.3–0.4MB；原图没有定位信息（检查过 0 处 GPS）。该文件夹里还有账单 / 银行对账单 / 信头等私人文件，没有下载、没有打开。
- 上传：Mailchimp 内容库（Content Studio）3 张；正式链接逐个 curl 验证 200，字节数与本地文件一致。
- 草稿改动：15910780 在「Memories」段后加 2 行图 + 说明（Together at the Great Wall / Together at the Xi’an Museum）；15910781 加 1 行图 + 说明（Together in Shanghai）。每份都已 Save，纯文本版重新生成并 Save；收件人仍是 INTERNAL TEST ONLY（1 人），状态仍是 Draft。
- 预览：Mailchimp 桌面版预览看过 2 份，图片和说明显示正常，HTML 邮件大小 8KB（图片另计，在内容库）。截图已发 PM。没有发测试信。
- 没验证：手机版与各邮箱客户端（Outlook 等）里的显示；图中有人脸——照片由 PM 提供，信的收件人就是这两个团的客人，仍按「照片使用」那一句给客人退出的机会。

## 七、名单对照（Baker 当天 12:28 / 12:31 发到 hello@ 的两封邮件，共 14 个邮箱；只记计数，不记邮箱）

- 做法：在 PM 已登录的 Chrome 里只读——Mailchimp 联系人页逐个搜邮箱（再按邮箱前半段复查没找到的）+ ME 库只读 SELECT（联系人阶段、别再联系标记、近 7 天出站邮件数）。
- 结果：6 位在 Mailchimp 名单里（4 位带 suppressed_do_not_email 标签；2 位订阅中、没有抑制标签），8 位不在名单里（北京-西安团 6、上海及周边团 2）。ME 里能查到的那 3 位带标签者，别再联系 / 不感兴趣记录为 0（标签来历不明）；另 1 位带标签者 ME 里没有记录。
- 近 7 天：ME 与 Mailchimp 里都没给这 14 位发过邮件（CTS 邮箱里一对一的信看不到）。
- 结论：走 Mailchimp 群发只能到 2 位。126 号建议像 10/8 那封一样由 CTS 从自己邮箱一对一发（带标签的 4 位由 CTS 先看一眼再定），不为这封信把人加进名单（沿用「只改已有的人」红线）；等 PM 回「CTS发」。

## 八、一对一草稿包（PM：「我需要你来安排，一对一发送，标记清楚客户的名字。先把草稿发我」）

- 做了：14 位客人的「一对一草稿包」PDF（北京-西安团 10、上海及周边团 4）发给 PM：每位客人的称呼、名字来源、能不能发；两封信各以一位客人为例，其余只换第一行称呼。邮箱打码，名字只在 PDF 里、不进仓库。信的正文 = 上面两份 Mailchimp 草稿，去掉 Mailchimp 页脚与合并标签，「介绍朋友」链接的统计标签 mailchimp 改成 cts_direct。
- 名字：7 位在 Mailchimp / ME 里查到；7 位没有任何记录（4 位按邮箱推测、3 位完全看不出），这些在草稿里用黄底「待确认」标出，不能直接发。
- 状态：3 位名字确认且可发；7 位可发但名字待确认；4 位带别发标记（先别发，CTS 看过再定）。
- 发件身份调研：hello@ 的 Gmail「Send mail as」只有它自己，没有 CTS 别名；Outlook 连接器登录的是 PM 的 CTS 邮箱（已发邮件里没有 10/8 那封感谢信）；Gmail 与 Outlook 连接器都会去掉 / 拒绝 HTML 里的 img，带照片的信没法用连接器发；Mailchimp 的发件人是 info@ctstours.co.nz，但只能发给名单里的人。结论：由 Baker 从他自己的邮箱一对一发最稳，126 号把成稿做成 Outlook 能直接打开的草稿文件交给他（待 PM 点头；还没给 Baker 发任何东西）。
- 没发给任何客人；没改 Mailchimp 草稿内容与收件人（本节期间只读取了两份草稿的 HTML）。

## 九、傍晚改走 Mailchimp（PM：「能否换一个思路，在 mailchimp 里补充更新邮件名单，这些是我们的归来客户」；随后回复「确认，他们都是我们的客户，可以标成已订阅」）

**以本节为准。** 第二、七、八节里「只发测试地址」「CTS 一对一发」「一对一草稿包」的做法已被取代；旧卡 2026-10-28-cts-post-trip-thanks-drafts-test-only 里「10/29 查收件人仍是测试分组」的条件作废，改按新卡 2026-10-28-cts-post-trip-thanks-mailchimp-route 核对。

- 路线：把 Baker 名单里还不在 Mailchimp 的人加进名单（Subscribed；标签 returned_traveller + 各团标签 + paid_customer），再用现有两份草稿群发。这改变了第七节「不为这封信把人加进名单」的红线，PM 明示同意。
- 入库（只记计数）：北京-西安团新进 5 位、上海及周边新进 2 位；原本就在名单里的北京-西安 4 位用「只更新已有联系人」补了标签；上海原有 1 位的标签由 PM 手动补；1 位是「已归档联系人」，导入被挡，没有擅自恢复，等 PM 决定；4 位带「别再联系」标签的保留标记、没补团标签、不发。
- 草稿：15910780（北京-西安）收件人=标签 tour_tale_of_two_cities_oct2026、排除 suppressed_do_not_email → 6 位；15910781（上海及周边）收件人=标签 tour_shanghai_surroundings_oct2026、排除 suppressed_do_not_email → 3 位。没有名字的称呼用合并标签条件写法，统一「Kia ora, Ni hao,」（PM 定）；上海信开头图换成官网白天天际线、合影用提亮版（已传 Mailchimp 内容库）。15910779（通用版）仍是内部测试分组；15910594、15910787 仍是 33 位已付款客人，没动。
- 字体（PM 反馈「整篇使用了多个字体，看起来视觉感观不好」）：两份草稿里小标题、代金券说明、按钮、页脚原先是无衬线字体、正文是衬线字体，已统一成 Georgia；Mailchimp 预览从称呼到落款逐段看过，没有再混用。
- 测试信：先后两轮发到内部测试邮箱（18:20 / 18:21 一轮，字体统一后 18:23 / 18:24 一轮，新西兰时间），收件箱里按时间核到；PM 回复「测试邮件已经收到」。测试信里称呼显示「Kia ora << Test First Name >>」是 Mailchimp 测试信的固定占位；没名字那一支（Kia ora, Ni hao,）只有真发时才出现，发前验证不了。
- 状态（18:35 新西兰时间）：没发给任何客人，两份都还是 Draft；发信要 PM 在对话里说「发」。

## 十、发送结果（PM 回「发」「发上海」之后；新西兰时间 10/28 晚）

**以本节为准，取代第九节末尾「没发给任何客人」的状态。**

- 北京-西安团（活动 15910780）：18:38 发出，收件人 6 位（标签 tour_tale_of_two_cities_oct2026，排除 suppressed_do_not_email）。发出几分钟后的 Mailchimp 报告：成功送达 6（100%）、打开 1、点击 0、退信 0、退订 0、投诉 0。
- 上海及周边团（活动 15910781）：18:46 发出，收件人 3 位（标签 tour_shanghai_surroundings_oct2026，排除 suppressed_do_not_email）。发出几分钟后的报告：成功送达 3（100%）、打开 0、点击 0、退信 0、退订 0、投诉 0。
- 发送前核对：两份都在发之前再读回一遍收件人数（6 / 3）、发件人（Baker Gu，info@ 共享邮箱）、主题；Mailchimp 的确认窗口写明「6 subscribers」「3 subscribers」和排除项。Send time 默认选 Schedule，要改成 Send now 并 Save 才能发；发完 Mailchimp 自动弹「Resend to non-openers」窗口，两次都直接关掉，没有排任何追发。
- 上海那封中途被自动模式的安全闸拦过一次（理由「真实对外发送」，发生在 PM 问「清单上有 10 个人，为什么 mailchimp 只发 6 个」之后），没有绕过；PM 回「发上海」后放行。
- 没走 Mailchimp 的 5 位（北京-西安 4：3 位带「别再联系」标记、1 位已归档；上海 1：带标记）：没动标记、没恢复归档、没重新订阅。是否由 CTS 从自己邮箱一对一发，等 PM 定。
- 核对：10/29 10:45 日历提醒（新卡 2026-10-28-cts-post-trip-thanks-mailchimp-route）重看两封的报告数字。

## 十一、没走 Mailchimp 的 5 位（PM 回「要」之后）

- PM 要求把这 5 封一对一信直接存进 info@ 邮箱的草稿箱（Outlook 网页版），不再发压缩包给 Baker（压缩包方案作废）。5 封（北京-西安 4、上海及周边 1）按「称呼 / 收件人 / 主题 / 照片 / 全篇一种字体」做好。
- 第一版用 Outlook 默认粘贴，会洗掉按钮红底、代金券大字等样式；PM 拿其中 1 封改成发给自己测试，手机上看不到「Leave a Google review」按钮。已用「红底放在表格单元格上 + 粘贴时选保留原格式」重做 5 封，并加了一封发给 PM 自己 hello@ 的测试草稿。
- 20:00–20:01（新西兰时间）这 5 封已由 info@ 发出（PM 说 all sent；已在 info@ 的已发送箱核对：5 封，主题都是 Thank you for travelling with CTS Tours）。称呼被发送的人从「Kia ora 名字,」改成了「Kia ora & Nihao 名字,」，其余内容与草稿一致（已发送箱预览行可见）。
- 没核实：这 5 位有没有回信或退信；带别发标记的 4 位发前 Baker 有没有按建议查过（PM 没说）。10/29 10:45 的日历提醒会连同这件一起核。
