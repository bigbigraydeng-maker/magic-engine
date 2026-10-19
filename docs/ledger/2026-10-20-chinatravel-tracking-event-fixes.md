---
id: 2026-10-20-chinatravel-tracking-event-fixes
title: 官网追踪事件小修：留资不带假价值、感谢页不再重复记留资、团页新增查看内容事件、订阅事件改名
status: done
owner: agent
decided_on: 2026-10-20
source: session:ec90bb17
verify_by: 2026-10-23
verify_how: Meta 数据集近期事件里留资事件仍在到达且不带价值；团页打开一次只出一个查看内容事件（用官方接口读事件统计，或像素助手）；订阅类自定义事件 NewsletterSignup 出现；没有投放在用旧的订阅事件
done_on: 2026-10-20
done_ref: doc:docs/ledger/2026-10-20-chinatravel-tracking-event-fixes.md
---
官网 PR 251、252 已合并上线。谷歌广告里那条固定 1 元的转化值没动，要有人看一眼广告后台再定，已写在 PR 里。
核对过：官方广告账户的自定义受众和广告组没有用订阅事件，所以改名不影响投放。
