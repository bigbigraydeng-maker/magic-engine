---
id: 2026-10-10-nal-whatsapp-to-crm-feasibility
title: NAL 的 WhatsApp 客人对话能进 ME CRM，但不是从 PM 这台 Mac 读，而是走官方接口接号
status: decided
owner: pm
decided_on: 2026-10-10
source: session:fdcade14
verify_by: 2026-10-17
verify_how: 看 PM 有没有回「要不要现在申请 Meta 两项高级权限」。回了=这张卡结；没回就继续摆到 PM 眼前。若回「申请」，另开一张卡跟进接号与当场试跑（发一条测试消息真的落进对话表，且员工手机回复不被记成客人发的）。
---
可行性文档：`docs/clients/new-asian-logistics/2026-10-10-whatsapp-to-crm-feasibility.md`。
核实结论：这台 Mac 上登录的不是 NAL 客服号（32 个群聊、13 个一对一、商业线程计数器=1，形状不对）。
官方接口那条路代码已建好、CTS 在用；NAL 只差填号。NAL 的邮件通道其实已经在跑（库里 38 段对话）。
接号前必修：员工手机回复的回声事件现在完全没处理，不修会把员工回复记成客人发的。
层级判定：L4 客户配置 + 既有连接器 + 既有能力，不新增能力线，不进候选表。
