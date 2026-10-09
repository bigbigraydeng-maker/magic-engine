---
id: 2026-10-10-nm-medspa-ad-faq-blocked-by-permission
title: NM Medspa 三条问答改自动回复，卡在权限没做成，要人放行
status: failed
owner: pm
decided_on: 2026-10-10
source: session:9d80e738
verify_by: 2026-10-13
verify_how: 读回那条广告创意的欢迎消息，三条问题要跟 PM 原文一字不差且答案不再为空；只要答案还是空的就还没做成
done_on: 2026-10-10
done_ref: doc:docs/clients/nm-medspa/2026-10-10-messenger-ad-faq-readonly-check.md
verified_ref: doc:docs/ledger/evidence/2026-10-10-nm-medspa-ad-faq-blocked-by-permission--2026-10-10.md
last_checked: 2026-10-10
check_note: 三条路都试过都被挡，线上维持原样，等放行后重做
---
Meta 的广告创意除名称状态外是只读的，这个字段不能原地改（实测被拒）。
我们的钥匙对这个广告账户只有读权限；官方广告工具有写权限但不支持这个字段，且只能新建广告（会重置学习期）。
到广告后台界面手工改是扰动最小的路，但本机权限策略拦住了点击。
要么放开这个会话在广告后台的点击权限，要么给一把有写权限的钥匙，二选一。
