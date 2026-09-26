---
id: 2026-09-26-wp2-ai-notice-table
title: 认出 Meta AI 客服的接管通知，整条会话走一遍算出「最后一次真人回复」；拿 CTS 500 个真实会话精确复现设计稿数字
status: decided
owner: agent
decided_on: 2026-09-26
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 跑 `npx tsx --env-file=<.env.local> scripts/probe-wp2-human-reply.ts`，四个数字应保持 500 / 377 / 6 / 117（带 :out 触点的会话 / 没有真人回过 / 触点时间该前移 / 不变），且三项之和必须等于第一项。数字漂了先看 INPUT 行是不是也涨了（新私信会进来），再查 AI_NOTICE_PATTERNS
---
WP2 第一轮：automation.ts 加 AI_NOTICE_PATTERNS（Meta 的接管 / 转交 / 中性通知，每条带发现日期和样本量）+ lastHumanPageReplyAt 整条会话走一遍。判定顺序：ME 发送记录里的真人 → 系统通知（本身不算真人，但切换谁在回话）→ AI 接管期间一律机器 → 其余交给既有 isAutomatedPageMessage。
当场试跑抓到一处：5 秒「收尾话」窗口原来套在两种 human_on 通知上，但证据只支持「转移给你」。套到「你已接管」会吞掉真人回复——实测「没有真人回过」从 377 变成 379。收窄后四个数字跟设计稿用 SQL 独立算的完全一致。已加测试钉住这个区别。
未接线：读取侧 withHumanReplyCheck、link-contacts 改用、segments 的 14 天闸都在后续轮。本轮只加判据，不改任何现有行为。

四条 M1 的归属轮次（魏征复审 W61-2 要求写清，别让它们无主）：
- M1-③ 通知匹配去零宽 + trim → **本轮已做**，有测试。
- S3 收尾话窗口常量化 → **本轮已做**（且按实测收窄到只对「转移给你」生效）。
- M1-① markContactFollowedUp 按发件身份区分人/机器 → **接线轮**（改 send.ts 写入侧，跟 withHumanReplyCheck 同一轮）。
- M1-② 两个自动发件身份常量合并 + 改成按域 allowlist → **接线轮，且必须先于 sentByHumanViaMe 接线**；否则 governed-reply-agent@magicengine.cloud 会被当成真人。scripts/probe-wp2-human-reply.ts 里现在硬写了一份该常量，那一轮要删掉改成 import。
- M1-④ withHumanReplyCheck 请求内按 threadId 缓存 → **接线轮**（那个函数本轮还不存在）。
- M3 每天扫没见过的通知文案 → **接线轮或更早**。魏征 W61-3 纠正后这条升级为安全网：认不出通知 → AI 回复被算成真人 → 热线索被埋，方向是危险那边，不是安全那边。
