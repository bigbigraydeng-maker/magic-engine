---
id: 2026-11-02-comment-autoreply-route-gate
title: 主页评论只有问候和常见问答才自动回，其余交给人
status: done
owner: agent
decided_on: 2026-11-02
source: doc:docs/ledger/2026-11-01-social-comment-human-todo-routing.md
verify_by: 2026-11-09
verify_how: 合并后第一次评论自动回复跑完，问价、投诉、退款的新评论没有公开回复也没有私信，并出现在「要人回」待办里；问候和签证/行程/怎么订这类问答仍会自动回。
done_on: 2026-11-02
done_ref: commit:c6a074d020367b354c6e061aa80f57c7c8baf2bc
---
发送前先走同一套评论分流。分流报错、认不出、或不是问候/常见问答，只记待人处理，不写 Meta。
私信收件箱的固定安抚没有改。没有新表、没有新开关。
当场试跑：2026-11-02 UTC，相关 Vitest 3 个文件 19 条通过。未连生产库，未发真实评论。
