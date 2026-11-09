---
id: 2026-09-28-pillar-agents-learning-and-kernel
title: 孔子、孟子、苏东坡三个 agent 的经验手册要能持续学习，对外动作要进执行内核、效果要进记忆
status: decided
owner: agent
decided_on: 2026-09-28
source: doc:docs/specs/2026-09-28-pillar-agents-capability-memory-kernel-v0.1.md
verify_by: 2026-10-12
verify_how: 查三件：①三个支柱的手册已搬进 docs/playbooks/ 且各有 inbox.md 候选区，本周学习任务各有一条运行记录（有候选就有 PR 号，没有就写明原因）；②批 1（边界测试按真实路径判）与批 2（SEO 收编、render.yaml 删掉 oztop-seo-optimizer）的 PR 已合并；③docs/agents/ 下有孔子、孟子、苏东坡三份手册。三项都有算成；缺哪项就把缺的那批交回 PM 排期，不要默认在做
---
PM 2026-09-28 要求：确保孔子、孟子、东坡自身的手册一直都在学习；思考它们需要什么 capability、memory、kernel。
设计 v0.1 经魏征两轮设计审（3 个 BLOCKER 已消化，处置表在设计稿 §0.1）。批 0（Oztop 自动改标题）已于 2026-09-27 12:50 UTC 经 PM 回「停」暂停，见 issue:2145。
待 PM 决定的 3 件见设计稿 §6。
