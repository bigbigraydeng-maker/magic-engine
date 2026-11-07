---
id: 2026-11-01-qualified-send-read-in-batches
title: 已报价超过两百条时，今日待办按编号分批读发送记录
status: decided
owner: pm
decided_on: 2026-11-01
source: pr:3432
verify_by: 2026-11-08
verify_how: 两百零一条都已发出的已报价，今日待办不再出现发给广告平台没成功。
---
七天内的已报价最多查五百条，发送记录却只读前两百条。没读到的会被当成没发过。
现在按成交编号分批读完。已经发出的不再误报成待补发。
