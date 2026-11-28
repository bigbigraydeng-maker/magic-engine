---
id: 2026-10-23-branch-wip-phone-auth-social-onboarding-uncommitted
title: codex/ads-o1-budget-release 分支上有一堆没提交的改动（手机号自助注册+社媒成长引导），没写清是谁在做、做到哪
status: decided
owner: agent
decided_on: 2026-10-23
source: session:8d76116b
verify_how: 查这个分支（或其继任分支）有没有把这批文件提交并开出 PR；没有就找上一个写这批代码的窗口确认是继续做还是放弃
---
本窗口开工时发现分支 `codex/ads-o1-budget-release`（当前 HEAD 是广告 O1 预算放量那次提交）还挂着 29 个已改+约 25 个未纳入版本控制的新文件，内容明显是另一件事：中国手机号自助注册/登录（`china-phone*`、`phone-register`、`phone-link`、`sms-hook`）+ 社媒成长引导（`social-growth-onboarding`）+ 两个未应用的数据库迁移。本窗口没有碰过这批文件、也不清楚是谁、何时开始写的，只是在开工检查时看到它们还留在工作目录里没提交。

停在哪（2026-10-23 收尾时核对）：分支 `codex/ads-o1-budget-release`，HEAD `d79c03ed4`，共 56 项未提交（29 个已改文件 +1478/-300 行，其余为新文件）；本窗口没改过其中任何一个，没提交、没推送。另有两个 `.env.local.bak-*` 备份文件在目录里，不要提交。

下一步：由认领这批改动的窗口确认是继续完成并提交，还是不要了可以清掉；如果继续，要分开成自己的分支，不要和广告 O1 预算这条无关的改动混在一起提交。
