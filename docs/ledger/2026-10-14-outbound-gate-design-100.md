---
id: 2026-10-14-outbound-gate-design-100
title: 对客自动发送收口设计稿：发送函数验来路 + 中文价格日期承诺闸，等 PM 批准后分四步做
status: decided
owner: agent
decided_on: 2026-10-14
source: session:fc769d17
verify_by: 2026-10-28
verify_how: 打开设计稿，确认 PM 已回答第 8 节三个问题；实现合并后按第 6 节八条探针各删一次，确认测试变红，并在测试会话上拿到拦下且审计零新增的试跑记录
---
设计稿在 docs/specs/2026-10-14-outbound-gate-consolidation-design.md。修好前任何窗口不得新开对客自动发送开关。
关键发现：私信/WhatsApp/邮件发送函数内都不查内容；CTS 评论自动回复已开，只认阿拉伯数字。
