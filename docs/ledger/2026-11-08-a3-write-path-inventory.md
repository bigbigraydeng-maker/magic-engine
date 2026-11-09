---
id: 2026-11-08-a3-write-path-inventory
title: 广告写入入口清单写完了，还有八个入口没走确认卡
status: decided
owner: pm
decided_on: 2026-11-08
source: pr:3671
verify_by: 2026-11-15
verify_how: 对照 docs/audits/2026-11-08-a3-meta-write-paths.md。过卡的五条在没有未过期确认卡时不得写。清单里标成没过卡的入口，不能被说成已经收进确认卡。
---
十六条能改 Meta 广告的入口里，五条只在确认卡点头且没过期之后才写。十一条没有这道卡。暂停和恢复归另一支。新的八条入口这一支不改，因为接进现有确认卡会改谁能点或改服务身份。
清单在 docs/audits/2026-11-08-a3-meta-write-paths.md。没有调用 Meta，没有新表。
