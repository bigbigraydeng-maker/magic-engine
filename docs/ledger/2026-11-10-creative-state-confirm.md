---
id: 2026-11-10-creative-state-confirm
title: 人在确认卡上点头后，才读配置并执行素材建议
status: decided
owner: agent
decided_on: 2026-11-10
source: doc:docs/ledger/evidence/2026-11-03-ads-impact-25-packages-audit.md
verify_by: 2026-11-16
verify_how: 假数据里广告和广告组共用编号时，仍按广告编号对上花费；最新快照不完整就不出建议。确认入口先校验付费客户身份。
---

放量目的地用已启用的赢家同步配置。目标成本用客户现有配置。没有配置、账本读失败、或行数碰到上限，就不出卡。确认路由只在人点头后调用执行。
