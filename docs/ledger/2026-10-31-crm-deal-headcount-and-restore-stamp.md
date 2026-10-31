---
id: 2026-10-31-crm-deal-headcount-and-restore-stamp
title: 通话人数按存下来的样子读，成人儿童分开写时不自动发成交
status: done
owner: agent
decided_on: 2026-10-31
source: pr:3433
verify_how: 订单没填人数时，通话里存的人数数组能读出来；写了成人和儿童分项就不自动算总人数、不自动发送。成交恢复后按新的那一笔款作废，不按最初创建时的那一笔。
done_on: 2026-10-31
done_ref: pr:3433
---

审查指出三处会把错误金额发给广告平台，或让恢复后的成交撤不掉。都在原成交记录上修，没有改表。
