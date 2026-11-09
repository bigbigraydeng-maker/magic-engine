---
id: 2026-09-24-claimed-gates-missing
title: 记忆里说"已装好"的两个机械闸（开工盘问技能、合并拦截）在机器上不存在——要么补装要么把记忆改成"没装"
status: verified
owner: agent
decided_on: 2026-09-24
source: session:beef24ba
verify_by: 2026-10-01
verify_how: ls ~/.claude/skills/grilling 存在且 settings 里没有放行 gh pr merge；或对应记忆文件已改为"未安装"
done_on: 2026-09-25
done_ref: pr:1989
last_checked: 2026-10-13
check_note: 实查：盘问技能和合并拦截确实都没装，但记忆文件已经改成「未安装」——verify_how 的「或」第二条分支满足
verified_ref: doc:docs/ledger/evidence/2026-09-24-claimed-gates-missing--2026-10-13.md
---
审计发现 feedback-grill-before-building 声称装了 grilling 技能和 gh pr merge 拦截，
实际 settings.local.json 反而放行了 gh pr *。"防护已建"的记录本身是假的。
