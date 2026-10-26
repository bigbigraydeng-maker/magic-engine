---
id: 2026-10-26-crm-drawer-ai-overview
title: 客人抽屉顶部加「AI 概况」卡（概况/想要什么/我们承诺过/顾虑），往来原文默认折叠
status: decided
owner: pm
decided_on: 2026-10-26
source: session:aedf9b5a
verify_by: 2026-11-02
verify_how: 部署后用已登录的 Chrome 打开 CTS 任一有 AI 简报的客人抽屉（如 Julie Cawte / 有 channel=email 简报的人）：①顶部出现「AI 概况·未核实，以原文为准」卡，内容来自 conversation_briefs（概况、想要什么、我们承诺过、顾虑有才显示）②往来记录默认收起，只有一行「看完整往来原文（N 条）」，点开才铺原文，换人后重新收起③没有简报的人不显示概况卡、抽屉其余照常④/api/clients/<id>/crm/contacts/<cid>/brief 只读、换人会先清空不留上一个人的概况。抽查 3 张卡的「我们承诺过」能在往来原文里找到依据。不成则改 failed 写原因。
---
AI 概况数据全来自现成的 conversation_briefs（私信 + 邮件简报），新接口只读、不写、无副作用，没动数据库。
刻意不并进时间线接口（2026-10-10 起有测试守着「不查 conversation_briefs」），也不并进列表接口（全带会拖慢那页）——抽屉打开时单独取一次。
已知未解决：①简报是 AI 生成、偶尔编商业事实（卡上标「以原文为准」兜底）②点开原文后邮件仍可能被截断（库里只存 255 字，全文存储由窗口 96dc6edf 在修，与本刀互补）。
