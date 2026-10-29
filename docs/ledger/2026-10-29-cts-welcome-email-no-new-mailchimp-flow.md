---
id: 2026-10-29-cts-welcome-email-no-new-mailchimp-flow
title: 新人欢迎信不再新建 Mailchimp 流程：改由 ME 决定、Resend 发，取代 10/28 那张「用 Mailchimp 自带流程重做」的方案
status: decided
owner: agent
decided_on: 2026-10-29
source: session:33ebcd0b
verify_by: 2026-11-12
verify_how: 看 Mailchimp 里没有新建或重新打开任何欢迎流程；每天 8:01 的批次仍只发 Facebook 来路；官网订阅新人没有欢迎信的缺口有人接手
---
取代 2026-10-28-cts-welcome-email-plan-await-pm 里「新建 Mailchimp 流程」那一条路；该卡其余原则（一封、新人进来立刻发、上线同一刻停批次、先发测试信给 PM）沿用。那张旧卡仍是 decided，11-04 会出现在待办邮件里，请 126 号在其后续 PR 里收掉。
过渡期：旧自动流程保持暂停，8:01 批次（已换 2027 春季新版）照常；设计稿阶段 2 上线时，等批次跑完再把批次触发器改成 2099 年一次性日期（不删）。设计见 docs/specs/2026-10-29-me-email-sms-sending-design-v0.md §4.11。
还没定（要 PM）：首日只发哪一封——129 号的「第 1 次那 1 封，替代自动欢迎信」与 ME 自动欢迎信重叠。
