---
id: 2026-10-25-agent-learning-review-followups
title: 学习功能第一批代码合并后的三条审查跟进已改完：原文摘录防注入、契约模型名、旧卡措辞
status: done
owner: agent
decided_on: 2026-10-25
source: session:0255470c
verify_how: PR 3138 合并后，在主干跑 npx vitest run src/lib/agent-learning 全过且 tsc 退出码 0；契约里不再有把 deepseek-v4-flash 当默认值的说法。这些代码还没有调用方，线上行为不变
done_on: 2026-10-25
done_ref: pr:3138
---
PR 3138（草稿）处理 PR 3132 合并时两边审查留下的 3 条非阻塞建议：原文摘录和作者说法送进提示词前加防注入与链接检查；契约默认模型名改成 deepseek-flash；更正 3132 那张卡里过时的措辞。
只改一个还没人调用的检查、一份契约文档和一张卡，线上不变。合并与首次真实运行仍由 Ray 决定。
