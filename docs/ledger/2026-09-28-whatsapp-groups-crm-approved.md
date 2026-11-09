---
id: 2026-09-28-whatsapp-groups-crm-approved
title: PM 立项批准——用 Meta 官方群组接口，让员工拉客户+同事进群的对话自动进 CRM
status: decided
owner: pm
decided_on: 2026-09-28
source: session:5b9407a2
verify_by: 2026-10-05
verify_how: "看 docs/specs/2026-09-28-whatsapp-groups-crm-design-v1.md 是否已收到子牙(架构)+魏征(挑刺)两份设计阶段复审意见；意见回填后交 PM 决定是否正式排期实现，本条到期时若还没排期，转成 ROADMAP 待认领而不是自动判 failed"
---

PM 看到 NAL 真实群聊记录（客户+多名员工混聊，ME 看不到）后，同意就"用 Meta 官方群组 API 让 ME 自己建群、群消息自动同步进客户记录"这个方向立项。设计稿见上方 source 文件，本轮只出设计、不动 `src/` 代码；子牙+魏征两轮设计复审通过后再排期。前提：NAL 需先拿到「官方业务账户」（比普通号高一级，另一条待办在推进）。
