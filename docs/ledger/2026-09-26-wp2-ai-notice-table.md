---
id: 2026-09-26-wp2-ai-notice-table
title: 认出 Meta AI 客服的接管通知，整条会话走一遍算出「最后一次真人回复」；拿 CTS 500 个真实会话精确复现设计稿数字
status: decided
owner: agent
decided_on: 2026-09-26
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 重跑试跑脚本对 CTS 全量私信算一次，四个数字应保持 500 / 377 / 6 / 117（带 :out 触点的会话 / 没有真人回过 / 触点时间该前移 / 不变）。数字漂了说明通知文案变了或判据被改动，先查 AI_NOTICE_PATTERNS
---
WP2 第一轮：automation.ts 加 AI_NOTICE_PATTERNS（Meta 的接管 / 转交 / 中性通知，每条带发现日期和样本量）+ lastHumanPageReplyAt 整条会话走一遍。判定顺序：ME 发送记录里的真人 → 系统通知（本身不算真人，但切换谁在回话）→ AI 接管期间一律机器 → 其余交给既有 isAutomatedPageMessage。
当场试跑抓到一处：5 秒「收尾话」窗口原来套在两种 human_on 通知上，但证据只支持「转移给你」。套到「你已接管」会吞掉真人回复——实测「没有真人回过」从 377 变成 379。收窄后四个数字跟设计稿用 SQL 独立算的完全一致。已加测试钉住这个区别。
未接线：读取侧 withHumanReplyCheck、link-contacts 改用、segments 的 14 天闸都在后续轮。本轮只加判据，不改任何现有行为。
