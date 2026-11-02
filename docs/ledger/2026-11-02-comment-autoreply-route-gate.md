---
id: 2026-11-02-comment-autoreply-route-gate
title: 主页评论只有问候和常见问答才自动回，其余交给人
status: done
owner: agent
decided_on: 2026-11-02
source: doc:docs/ledger/2026-11-01-social-comment-human-todo-routing.md
verify_by: 2026-11-09
verify_how: 合并后第一次评论自动回复跑完：问价、投诉、退款和对不上问候的夸赞没有自动回复，并出现在「要人回」待办；分类器认成垃圾的评论仍会隐藏；问候和常见问答仍会自动回。
done_on: 2026-11-02
done_ref: pr:3524
---
问候和常见问答才自动回。问价、投诉、退款、认不出的评论，以及对不上问候的夸赞，只交人。
分类器认成垃圾的评论仍按原来的方式隐藏。分类器报错或分流报错则不隐藏，改交人。
私信收件箱的固定安抚没有改。没有新表、没有新开关。
当场试跑：2026-11-02 UTC，相关 Vitest 3 个文件 21 条通过。未连生产库，未发真实评论。
