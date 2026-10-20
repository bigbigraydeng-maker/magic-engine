---
id: 2026-10-20-form-answer-mapping-to-client-config
title: 官网表单答案（出发时间、预算）的选项映射改成客户配置，邮件里直接带稳定代码，换行业或官网改选项不用改共享代码
status: decided
owner: pm
decided_on: 2026-10-20
source: session:96dc6edf
verify_by: 2026-11-20
verify_how: 官网表单邮件里带每个答案的稳定代码（官网 PR 的邮件本来就有可用的代码）；ME 解析优先读邮件里的代码、读不到再按客户配置里的选项映射表兜底；换一个客户或改选项文案，只改配置不改共享代码；映射不到时回执 unknownExtras 计数并有日志
---
现状：选项映射和年份（2027）写在共享模块 form-facts.ts 的常量里，只适合当前这一版官网表单，PR 2937 先上线再改。
