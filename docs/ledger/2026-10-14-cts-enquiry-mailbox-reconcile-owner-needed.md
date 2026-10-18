---
id: 2026-10-14-cts-enquiry-mailbox-reconcile-owner-needed
title: 缺一位能看 info@ 邮箱的人，按文档数一次询盘封数，才能判「新事件靠不靠谱」
status: decided
owner: pm
decided_on: 2026-10-14
source: pr:2525
verify_by: 2026-10-24
verify_how: PM 指定一位有 info@ 邮箱权限的人（做什么：按口径文档 §4 只数封数、不点开、不转发，剔除测试单和重复提交，填 §4 那张表）；验收：表里「新事件」与「邮箱合计」差 ≤10% 算成，差大就写原因。到 10-24 还没人指定或没填表，就开卡说明卡在哪。
---
口径文档 docs/clients/cts/2026-10-13-cts-enquiry-definition-and-form-spec.md §4。在这件事做完之前，新事件 enquiry_thank_you 的数字只能当参考，不能当 KPI。agent 不读邮件正文，所以必须由有权限的人做。
