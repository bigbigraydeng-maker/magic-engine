---
id: 2026-10-28-crm-call-reached-advances-stage-and-fb-form-facts
title: CRM 两个缺口：打通电话后客人仍显示「新线索」、Facebook 表单的预算和出发时间抽屉里看不到
status: decided
owner: pm
decided_on: 2026-10-28
source: session:96dc6edf
verify_by: 2026-10-30
verify_how: 合并后新来一位表单客人，列表里应直接显示「新线索」而不是「还没标」；合并后等每小时那一轮跑完，打开 CTS 客人 Lala Teaomutu 的抽屉：阶段应是「已联系」、时间线里有一条「系统按已跟进判的」；再打开任意一位 Facebook 表单来的客人，往来记录上方应出现「出发时间 · 预算 NZD」一行。若阶段没变，查 brief-cycle 摘要里的 callAdvance（candidates/advanced/failed）
---
问题一：系统只给「还没有阶段」的人填阶段，填表当天会被放进「新线索」；之后员工拨出并接通电话，没有任何一处会据此改阶段，客人一直挂着「新线索」。
修法：每小时那一轮多一步——阶段是「新线索」、且是 AI 放进去的（人手标的不碰）、且有一通接通的外呼电话、或同事回过一封邮件（群发和自动回执不算），就改成「已联系」并留一条「系统按已跟进判的」记录。只用「接通/回过邮件」这个事实，不读内容。
问题二：Facebook 客资表单里的出发时间和每人预算一直存在库里（metadata.custom_answers），只是抽屉没读，官网表单那套才显示。
修法：抽屉同一行人话也读 Facebook 表单的答案；认不出的新选项显示原话，不丢。
问题三：表单新线索（Facebook 表单、官网表单）建档时没有阶段，要等每小时任务补成「新线索」，期间列表显示「还没标」（Tracy Morgan）。
修法：这两个入口新建人的当下就标「新线索」（只对阶段配置里有 new 的客户；失败不挡入库）。
当场试跑：生产只读查询，按同样三个条件按电话条件会推进 3 人（Lala Teaomutu、Lisa Li、Newasian Logistics，均为 CTS），加上邮件条件见 PR 说明；真正写库发生在合并后的第一轮每小时任务，尚未跑。
