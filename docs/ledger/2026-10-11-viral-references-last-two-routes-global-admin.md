---
id: 2026-10-11-viral-references-last-two-routes-global-admin
title: 爆款库最后两个接口也改成只放全局管理员（补 PR 2432 合并时漏掉的一提交）
status: decided
owner: agent
decided_on: 2026-10-11
source: session:34af475f
verify_by: 2026-10-14
verify_how: 合并后 viral-references 目录下 8 个接口都用 guardGlobalAdmin，限定客户的演示账号被拒
---
PM 10-11 回「一起改」。PR 2432 在这一提交推上去之前已被合并，这里补上。
