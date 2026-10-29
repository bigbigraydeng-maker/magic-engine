---
id: 2026-10-28-cts-welcome-e1-template-swapped-to-v2
title: 每天 8:01 自动欢迎信的底稿已换成新人欢迎信 v2（含 Shanghai & Beyond）；测试信已核对，批次脚本本身没跑，等第一次真批次
status: done
owner: pm
decided_on: 2026-10-28
source: session:2620bc63
verify_by: 2026-10-30
verify_how: "打开 Mailchimp 活动列表，找名称以 auto_e1_batch_ 开头、10/29 或 10/30 发出的最新一条（名称里的日期是前一天；这两天没有新 Facebook 客人就不会有）：主题应是 Your China tour options for 2027 · Baker from CTS Tours，正文搜 Christmas / Brochure / Surroundings 应为 0；没有批次时，底稿 15909753（名称 Email 1 · T+0 Welcome · Baker · CTS Reborn）正文搜 Christmas 仍为 0；Apps Script 10/29 8:01 那次执行无报错"
done_on: 2026-10-28
done_ref: doc:docs/ledger/evidence/2026-10-28-cts-welcome-e1-template-swapped-to-v2.md
last_checked: 2026-10-29
check_note: 10/29 下午已核全部成立（8:01 批次已发出、5 位送达、主题正文是新版、脚本执行 Completed），证据见 10/29 核对证据文件；状态等本卡进主干后翻 verified
---
PM 10-28 晚回「开」：把每天 8:01 自动发给新 Facebook 客人的欢迎信底稿（Mailchimp 15909753）换成新人欢迎信 v2。已换：正文与 v2 逐字一致（读回核对相同）、主题行、预览文字、纯文字版；底稿从含已下架圣诞团 / 旧价 / 旧手册 / 旧团名，变成 2027 春季版并带新团名 Shanghai & Beyond。
当场试跑：从底稿发了一封测试信到内部测试邮箱，收到并核对内容无误（主题带 [Test]，正文是 v2）。没跑：每天 8:01 的批次脚本本身（跑它会真发给客人）；脚本复制底稿的方式没变，10/27 那次批次的主题就是当时底稿的主题。
没动：Apps Script、旧欢迎流程（暂停中）、E2–E4（已拆雷）；没有给官网订阅的 3 位补发。
