---
id: 2026-11-03-agent-loop-step0-exam-baseline
title: 闭环升级第 0 步做完：6 道广告考题登记完（5 条已知待修已写进测试），动工前基线记下
status: done
owner: agent
decided_on: 2026-11-03
source: session:f765a75f
verify_by: 2026-11-10
verify_how: 在主干跑 vitest 相关目录全绿，且 grep -rn 考卷 src 能找到考卷1至4；第1步开工前 5 条 it.fails 必须仍在
done_on: 2026-11-03
done_ref: pr:3529
---
考题放在各自规则旁边的现有测试里，标题带「考卷」二字，已知待修的用 it.fails 写，第 1 步修好后翻成 it。
考卷5（没设置结果口径不出花钱没结果）、考卷6（读回没对上进死信要人处理）现有测试已覆盖，PR 里写了指针。
G2 基线：今日待办邮件每天总条数，10-27 至 11-02 的五次是 40/42/41/43/48，平均约 43；10-19 起每天 35 至 38，逐周上涨。
