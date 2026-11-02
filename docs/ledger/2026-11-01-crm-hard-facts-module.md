---
id: 2026-11-01-crm-hard-facts-module
title: 「谁在等谁」等硬事实改由程序算：新增独立计算模块（还没接进任何页面）
status: decided
owner: agent
decided_on: 2026-11-01
source: session:96dc6edf
verify_by: 2026-11-08
verify_how: 合并后确认模块仍未被任何路由/页面引用（grep hard-facts），且回放脚本对 40 条参考题的「谁在等谁」吻合率不低于 32/40；之后接进判断卡的窗口再把这张卡翻 done
---
设计稿 §5.1 要求「谁在等谁」等硬事实由程序算、不交给模型读。本卡对应 src/lib/crm/hard-facts/ 纯函数模块 + 单测 + scripts/crm-hard-facts-replay.ts（只读回放，不进 CI）。
不含：邮件封顶/频率、短信、接线。写代码模型 DeepSeek（aider），Sonnet 监工审 diff。
