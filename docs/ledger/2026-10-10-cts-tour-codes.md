---
id: 2026-10-10-cts-tour-codes
title: CTS 每个团一个固定编号（团编号 + 出发日期 = 班期编号），团目录、网站填表下拉、登记邮件三处用同一份
status: decided
owner: agent
decided_on: 2026-10-10
source: session:1a85e0eb
verify_how: 草稿表 docs/clients/cts/2026-10-10-tour-codes-draft.md 经 PM 与 CTS 确认后，团目录页面能看到并修改团编号；线上填表提交一次，CTS 收到的邮件标题和正文带班期编号（例如 CN-BOC-13MAY27）
---
PM 2026-10-10 提出：登记邮件里每个团要有固定叫法，并与团目录一致。现状：邮件只有团名和日期两行文字，团目录内部用 destination/tier/slug 标识（Best of China = china/discovery/essentials，与团名对不上）。按团名首字母自动缩写实测会重复（Guilin/Guangzhou 等），两个 Natural China 同名，所以编号必须每团单独定、存进团目录、团名改了也不变。
已做：33 个团的草稿编号表（脚本校验互不重复），等 PM 与 CTS 确认写法。未做：团目录加编号字段、网站团数据带编号、邮件标题与正文带班期编号——格式确认后再动。
