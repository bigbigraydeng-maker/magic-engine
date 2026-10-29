---
id: 2026-10-28-crm-origin-label-customer-initiated
title: CRM 客人列表灰色「来源」标签只认客人自己发起的第一次接触
status: decided
owner: pm
decided_on: 2026-10-28
source: session:96dc6edf
verify_by: 2026-10-30
verify_how: 打开 CTS「全部客人」，找 Hinemoa Taylor：灰色来源标签应是「FB 表单」而不是「电话」；CTS 没有电话打进来的渠道，来源列不应再出现因我们外呼记录产生的「电话」
---
问题：来源标签取「最早的一条触点」，Hinemoa Taylor 7 月导入跟进表时记了一条我们打出去的「留言未回复」，时间戳与她的 Facebook 表单同一秒，排在前面，来源被显示成「电话」。
修法：来源只在客人发起的触点（inbound、非群发工具记录）里取最早；一条都没有才退回旧做法。只改显示，不改任何数据。
当场试跑：生产只读查询，按新规则来源会变的客人约 9 位。
