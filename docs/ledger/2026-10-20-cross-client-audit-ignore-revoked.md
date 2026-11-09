---
id: 2026-10-20-cross-client-audit-ignore-revoked
title: 每日串台审计不再把已撤销的授权算作挂在客户名下(撤销后告警才能消失)
status: done
owner: agent
decided_on: 2026-10-20
source: doc:docs/specs/2026-10-20-social-connection-governance.md
verify_by: 2026-10-22
verify_how: 合并部署后的下一次每日审计里,CTS 与 Celine 的 celinesyd222 不再作为串台出现;只有未撤销的重复才报。
done_on: 2026-10-20
done_ref: pr:2951
---
撤销 CTS 名下误授权的那条后,审计原先仍会报串台(它不看状态)。现只排除 status=revoked;过期/出错未撤销的仍算。
