---
id: 2026-10-14-outbound-gate-step1-scanner
title: 对客发送第一刀：中文价格日期承诺扫描器接进 CTS 草稿检查和评论自动回复，命中就拦下
status: decided
owner: agent
decided_on: 2026-10-14
source: session:fc769d17
verify_by: 2026-10-28
verify_how: 合并后在代码里删掉任一处接入，对应测试必须变红；再用测试环境喂入中文价格、日期、保证出签三句，确认草稿被拦、评论回复改用写死话术，全程不发任何消息
---
设计稿第 4 节的第一步，只多拦不多发，不改发送函数和数据库。
第二步（发送函数验来路 + 数据库加列）仍须 PM 另行点头。
