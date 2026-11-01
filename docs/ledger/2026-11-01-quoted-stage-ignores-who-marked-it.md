---
id: 2026-11-01-quoted-stage-ignores-who-marked-it
title: 「已报价」不看来源，发送用哪种事件还没定
status: decided
owner: pm
decided_on: 2026-11-01
source: pr:3432
verify_by: 2026-11-08
verify_how: 客户设置里「哪一步算合格咨询」对员工手标和系统读往来自动标同一句话；代码比较阶段时没有操作者参数。这一步仍然不往外发。
---
Ray 2026-11-01：员工手标和系统读往来自动标成同一阶段，都算合格咨询。比较阶段时不看是谁标的。
读往来记录自动标成「已报价」本来就有，这次没有新建。
发 Conversion Leads 还是普通 Lead 还没定，这一步仍然只保存、不发送。
