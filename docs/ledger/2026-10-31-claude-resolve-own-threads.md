---
id: 2026-10-31-claude-resolve-own-threads
title: Claude 不再解决审查对话，新建分支仍只在 claude/ 下
status: done
owner: agent
decided_on: 2026-11-02
source: session:679e38ca
verify_by: 2026-11-07
verify_how: Ray 亲手合入后，确认 Claude 仍能在 claude/ 下建分支并开草稿 PR，且不能用 gh api 或 graphql 解决审查对话。
done_on: 2026-11-02
done_ref: pr:3446
---
Ray 2026-11-02 决定去掉解决审查对话，包括只解决自己开的对话。
只留：在 claude/ 加一段小写名字下建分支（仍拒 claude/ledger-verify-）、开草稿 PR、跑测试。
不改这个自动任务的权限，仍禁止合并、强推、改写历史、批准、标成可合并、删分支。
合这个改动要 Ray 亲手合。本 PR 保持草稿。
