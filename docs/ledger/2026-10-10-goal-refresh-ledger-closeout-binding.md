---
id: 2026-10-10-goal-refresh-ledger-closeout-binding
title: 目标自动刷新那张台账卡已改成"做完了"，完成证据指向真正修复的那次改动
status: done
owner: agent
decided_on: 2026-10-10
source: pr:2039
done_on: 2026-10-10
done_ref: pr:2039
verify_how: "核对原卡 2026-09-26-goal-refresh-multi-active-goals 的状态为 done 且 done_ref 为 pr:2038；跑 npx vitest run src/lib/ledger 确认台账条目校验通过"
---
收尾 PR 只改台账；用这张新卡满足"改卡的 PR 必须带新卡"的门禁，不覆盖原卡的完成证据。
原卡 2026-09-26-goal-refresh-multi-active-goals 的 done_ref 保持 pr:2038。
