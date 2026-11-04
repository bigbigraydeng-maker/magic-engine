---
id: 2026-11-03-ledger-comment-autoreply-done-ref-repair
title: 修好「主页评论自动回复」那张台账卡的指向，让所有新改动单的台账检查不再被它拦住
status: done
owner: agent
decided_on: 2026-11-03
source: session:96dc6edf
verify_by: 2026-11-04
verify_how: 本修复合并后，任意新开的改动单（不改台账的也算）跑台账指针检查不再报「2026-11-02-comment-autoreply-route-gate … 查不到」。
done_on: 2026-11-03
done_ref: pr:3524
---
那张卡的完成证据写成了一个合并前的提交号，主干只保留合并后的新提交，CI 上查不到，于是每个新改动单的台账指针检查都报红（至少 6 个改动单受影响）。
本次只把那张卡的完成证据改成它真正对应的已合并改动单 3524，没有改它的冻结字段、状态和内容。
同类问题会再出现：卡里写「提交号」做完成证据、而改动单是合并后换新提交号的，都会这样。以后完成证据写改动单号。
