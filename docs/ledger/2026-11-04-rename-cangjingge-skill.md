---
id: 2026-11-04-rename-cangjingge-skill
title: "藏经阁技能改名：me-agent-cangjingge → cangjingge"
status: done
owner: agent
decided_on: 2026-11-04
source: session:90a50c3b
risk: A
verify_how: "合并后新开一个 Claude Code 窗口，技能列表里出现 cangjingge（不再是 me-agent-cangjingge），输入 /cangjingge 能加载藏经阁正文"
done_on: 2026-11-04
done_ref: pr:pending
---

PM 2026-11-04 要求藏经阁技能名字改简单。目录 `.claude/skills/me-agent-cangjingge/` 改为 `.claude/skills/cangjingge/`，SKILL.md 的 name 同步；CLAUDE.md 与老曹技能卡里的路径引用一并改。历史台账卡里的旧名保留不改（记录当时事实）。
