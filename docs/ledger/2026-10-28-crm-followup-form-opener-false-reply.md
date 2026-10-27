---
id: 2026-10-28-crm-followup-form-opener-false-reply
title: 「客户回话了」名单被广告表单后自动出现的开场白污染（估 228 个里 103 到 112 个是假的）：复用已有的 isFormTemplateMessage 排除，但必须和第 2/3 次提醒同一批上线，否则约 99 人会掉出名单
status: decided
owner: agent
decided_on: 2026-10-28
source: doc:docs/audits/2026-10-28-crm-followup-flow-audit.md
verify_how: 修完后用线上原来的 segmentContact（不是审核里的近似 SQL）只读干跑那批人。①「回话」里只有广告开场白的私信客人移出（估 103 到 112，已被拒绝或推迟的约 9 人本来就不在线上名单里）②邮件约 46 人、WhatsApp 约 5 人、私信里有实质内容的约 63 人、重复留资约 3 人不动③变异测试：删掉开场白判断，测试必须变红；用例用英文原句加客人多说一句的变体，可借 qualify-r2.test.ts 的现成写法。
---
名单引擎（segments.ts）把 Meta 表单提交后私信里自动出现的 Hello! I filled out your form… 当成客人发来的话，最高优先级桶里约一半是假的。
转化回传那边早有测过的 isFormTemplateMessage（PM 10-05 原话：124 条近期线索里 107 条只有这一条），名单这边没用上。
修法是搬到 CRM 共享层并在触点分类里排除；B 级，不对外发信；审核里的 228 / 175 / 112 是近似复算（复审独立复算吻合），要用原函数核实。
上线顺序（魏征复审）：约 99 人（B 档 72、C 档 20、E 档 7）正因为假回话排在最上面，单修会把他们掉进先放着，所以必须与第 2/3 次提醒同批，或同时放进临时的补跟进分组。
