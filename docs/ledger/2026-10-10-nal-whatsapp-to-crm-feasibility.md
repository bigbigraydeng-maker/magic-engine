---
id: 2026-10-10-nal-whatsapp-to-crm-feasibility
title: NAL 第一步定了先整理资料：本机那些 WhatsApp 群里的客户资料进 CRM，不接接口不花钱
status: decided
owner: pm
decided_on: 2026-10-10
source: session:fdcade14
verify_by: 2026-10-17
verify_how: 看 PM 有没有回文档第六节开工前那三句（正文存不存 / 用哪条路读 / 小样要不要先看）。三句都回了=这张卡结，另开一张卡跟进小样与整批入库（判准：给 PM 看的那版跟入库后回读的一致）。没回就继续摆到 PM 眼前。
---
方案：`docs/clients/new-asian-logistics/2026-10-10-whatsapp-to-crm-feasibility.md`（第三版）。
更正第一版一条错判：本机那个 WhatsApp 就是 NAL 的号，群聊本身就是客户对话，我拿「客服号该长什么样」当判据否定了事实。
分水岭已查实：官方接口明文不支持 WhatsApp Business App 的号用群功能，接口与拉群的工作方式二选一。
第一阶段零结构变更、零花费、默认不存正文；算资料只需时间/发送者/群标识三列。
层级判定：L4 客户配置 + 既有连接器 + 既有能力，不新增能力线，不进候选表。
