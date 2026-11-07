---
id: 2026-11-01-recovery-list-skips-sent
title: 成交页补发列表先丢掉已经发出的，再限条数
status: decided
owner: pm
decided_on: 2026-11-01
source: pr:3432
verify_by: 2026-11-08
verify_how: 最新两百条已报价都已发出时，更早还在排队的那条仍出现在成交页补发列表。
---
成交页先取最新两百条，再丢掉已经发出的。全发出去时，更早还没发出的被挤掉。
现在按页继续往后找，先丢掉不用处理的，再凑够这一页。成交下一步同一套。
