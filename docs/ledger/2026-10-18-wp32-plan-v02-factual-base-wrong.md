---
id: 2026-10-18-wp32-plan-v02-factual-base-wrong
title: WP3.2 方案第二轮复审不通过——事实底座错了（CTS/NAL 其实是 bounded_auto，我拿文档旧说法盖掉了自己的查库结果）；改按只读 A0 切
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-10-25
verify_how: 看 v0.3 是否按 12 条改完并过第三轮复审；核三件：①§1/§5 的 autonomy_mode 是否改成 CTS/NAL=bounded_auto（库里实查）②红线 3 是否降级成已知缺口或立项改 Kernel 契约（不许做成假防线）③硬顶倍数是否改成按真实分布定、NULL 账户单列一类
---
两轮两审共 21 条意见，第二轮判不通过，根子是我的事实错：方案写「4 个客户全是 observe」，而生产库里 CTS 与 NAL 都是 bounded_auto、9 个 ads.* 键在策略表里全是 auto_approve。
我今天早些时候自己查过这张表、拿到的就是正确答案，写方案时却照权威稿 9 月那句旧说法写成了相反的话——拿文档盖掉一手证据，今天第三次犯同一类错。
连带作废：「WP3.2 依赖 WP07」这条结论、PR B 的验收口径、§8 的时机论证。
更正魏征一处：D3 注册表与策略表错配不是「已经在发生」——45 天内 ads.* 零条授权决定，因为所有客户 autopilot_dry_run=true、从没提交过。
新做法：按魏征的 A0 切（只读评估器 + 回执 + 待办，代码里根本没有写 ads_circuit_events 的路径），跑 7-10 天拿真实分布再决定接不接写入。
