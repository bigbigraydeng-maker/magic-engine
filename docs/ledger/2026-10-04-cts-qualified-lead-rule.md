---
id: 2026-10-04-cts-qualified-lead-rule
title: CTS 合格线索改按「员工记录里有明确兴趣」判定并自动发给 Meta（PM 点头），自动发送要等部署后手动打开
status: decided
owner: pm
decided_on: 2026-10-04
source: session:4569e58a
verify_by: 2026-10-06
verify_how: 看 10/5 早 6 点 conversion-daily-pipeline 里 ctsSync：excludedNoInterest（没兴趣证据被排除）、rejectedStaleLeads（旧规则遗留待核对被自动拒绝）各几条，insertedLeads 是否只有有兴趣证据的；成交审核页待核对数是否明显下降；CTS 的 AI 自动审核开关是否仍开着
---
规则：排除词压倒一切；有 2027/2028/明年、旅行语境里的月份、very keen/interested/great talk、定金发票之类才算合格；没写记录或只写「已联系」不发。
用上个窗口人工分好类的 800 多条员工记录（只在本机）试过：明确说 2027/明年的 73 条认出 63 条；只联系过无明确意向的 329 条里误当合格 11 条；新线索 127 条 0 条误判。
没做：邮箱里「开了发票未付」的线索（需读邮件）、24 小时刹车对线索类放宽。
