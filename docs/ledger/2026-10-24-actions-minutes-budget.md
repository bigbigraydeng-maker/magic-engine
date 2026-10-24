---
id: 2026-10-24-actions-minutes-budget
title: GitHub 检查费从每月四百多美元降到大约免费额度附近
status: decided
owner: pm
decided_on: 2026-10-24
source: doc:docs/ops/2026-10-24-actions-minutes.md
verify_by: 2026-11-07
verify_how: 账单恢复并合入后，抽一个可审查 PR，老检查名字仍出现且草稿 PR 不再启动这些检查；下一次账单里 Actions 分钟应接近文档里的大约五千到八千，而不是七万五
---
每次推送大约 24 分钟，一个月大约七万五千分钟。
轻检查合成一次安装；草稿不跑；编译改由 Render 在上线时做。
Ray 必须先在 Protect main 里删掉 Application build，其它检查名字不用改。
算法和要点哪里：docs/ops/2026-10-24-actions-minutes.md
账单目前锁着，这次没能在 GitHub 上真跑一轮。
