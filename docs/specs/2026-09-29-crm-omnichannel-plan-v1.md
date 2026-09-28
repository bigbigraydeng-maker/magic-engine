---
title: CRM 多渠道收发中心方案 v1——WhatsApp（并存）/ Messenger+IG 私信 / 邮件 / 短信 / 电话外呼
status: draft
owner: session:5b9407a2
decided_on: 2026-09-29
source: PM 原话「CRM 内需要尽快整合对外发 SMS、电话外呼、WA message（coexistence 模式）、email 往来、站内 message 往来的多渠道功能（基于 Meta 生态），这是承接广告和后面业务的关键核心部分」
---

**权威说明**：本文件。**写入者**：本会话，唯一。**本轮只出方案，不动 `src/`。**

按 §11：频率 高（跟进团队天天用）/ IMPACT 高（卡在 Act——广告带来的线索接不住就白花钱）/ 收入 高（NAL 月目标 300 开聊、CTS 成交都走这里）→ 零低 → **P0**

**层级判定（me-platform-tier-gate）**：统一收发中心 = 既有 CRM 能力的扩展（平台共享，不新增支柱）；每个供应商（360dialog、Twilio、Outlook、Meta Graph）= L3 Connector，挂在同一个渠道接口下。不进 platform-candidates。

## 一、现状（2026-09-29 只读盘点，证据见文末）

| 渠道 | 收 | 发 | 员工在抽屉里能回 | 凭据 |
|---|---|---|---|---|
| WhatsApp | ✅ webhook | ⚠️ 只能纯文本，**超 24 小时发不出**（没接模板） | ✅ `WhatsAppReply` | ⚠️ 全局单号，不能多客户 |
| Messenger | ✅ webhook + 每小时同步 | ✅ | ✅ `MessengerReply` | ✅ 按客户 |
| 邮件 | ✅ 仅 Outlook（无 Gmail） | ✅ | ✅ `EmailReply` | ✅ 按客户 |
| Instagram 私信 | ❌ | ❌ | ❌ | — |
| 短信 SMS | ❌ | ❌ | ❌ | — |
| 电话 | ⚠️ 只有 AI 接听来电 | ❌ 不能外呼 | ❌ | ⚠️ Twilio 变量在、无代码用 |

**地基问题**：
1. `src/lib/messaging/channels.ts` 的统一渠道接口已写好，但**生产代码一次都没接上**，三个回复框各走各的发送路由。
2. 渠道取值三处对不上：`conversations.channel` 不允许 sms / instagram / phone，写进去会被数据库拒。
3. WhatsApp 连接本身没通：CTS 缺 4 个库字段 + 5 个环境变量；接号码这条路径 9-26 PM 定「先不花」暂停（`docs/ledger/2026-09-26-whatsapp-crm-no-spend-park.md`）。

## 二、关键外部事实（决定方案形状）

- **并存模式（coexistence）**：同一号码手机 WhatsApp Business App 和系统同时可用，员工手机回的消息由 Meta 通过 `smb_message_echoes` 推给系统，近 6 个月 1:1 历史可同步。经 360dialog 托管开户，**ME 不需要先拿 Meta 技术服务商资格**（360dialog 9-07/09-10 书面确认）。起步 €250/月含 5 个号，Meta 消息费原价透传。
- **并存号的硬限制（Meta 官方文档原话）**：**不能打 WhatsApp 电话、群聊不同步也不能用官方群组接口**、群发列表禁用、固定 20 条/秒。→ 电话外呼走 WhatsApp 这条路不通，必须走电信供应商。
- **短信和普通电话不在 Meta 生态里**：Meta 没有短信产品；WhatsApp 通话接口本身也不录音。短信 + 外呼 + 录音统一走一家电信供应商（仓库已有 Twilio 变量占位，优先它）。
- 🔴 **并存上线前必须先修的坑**：现在 webhook 把所有消息的 `from` 当客人（`route.ts:361/384`）——并存一开，员工手机回的每条消息都会被记成「客人说的」，客人的「最后说话时间」被员工冲掉，跟进提醒全部失真。**这条不修不许切并存。**

## 三、分段（每段独立 PR，各自过风险闸）

**第 0 段 · 地基（不花钱，可立即开工）**
- 统一渠道接口接上生产：抽屉里一个回复框，按客人有哪些渠道自动给选项，发送都走 `channels.ts`。
- 渠道取值对齐：`conversations.channel` 放开 sms / instagram / phone（**A 级：改库结构，合并前问 PM**）。
- WhatsApp webhook 支持 `smb_message_echoes`（员工回复记成「我方发出」、署名到人）+ 送达状态回调。
- WhatsApp 凭据从全局单号改成按客户按号（为多客户、多号铺路）（**A 级：碰凭据/验签**）。
- 超 24 小时用模板消息发（WhatsApp 规则，否则老客人联系不上）。

**第 1 段 · WhatsApp 并存接入（要花钱，需 PM 点头）**
- 经 360dialog 开户，CTS、NAL 各接一个号；webhook 验签和发送改走 360dialog（**A 级**）。
- 当场试跑：私人手机给号发一条 → 抽屉里出现 → 员工在手机回 → 系统记成我方发出、署名对。

**第 2 段 · Meta 站内私信：Messenger（已有）+ Instagram 私信（新接）**
- Instagram 私信走同一套 Meta 接口，复用 Messenger 的页面令牌与同步逻辑。

**第 3 段 · 短信 + 电话外呼 + 录音（要花钱，需 PM 点头）**
- 抽屉里「点一下拨号」：供应商先呼员工手机、再接通客人，通话自动录音 → 转文字 → 落客户时间线。
- 短信收发同一家供应商、同一个号。录音开头播一句提示（合规，NZ/AU 各自规定待核）。

**第 4 段 · AI 分析打标签（WP-C，等前面跑稳）**
- 聊天 + 通话文字 → 复用既有 `segmentContact` / note-parser 打标签分类，不另造一套。

**不在本方案里**：WhatsApp 官方群（并存号用不了，另开纯系统号时再议，见 `2026-09-28-whatsapp-groups-crm-design-v1.md`）；网站在线聊天插件（如 PM 说的「站内」指这个，另议）。

## 四、需要 PM 拍板（花钱 / 不可逆）

1. 360dialog 每月 €250（恢复 9-26 暂停的那笔）。
2. 电信供应商（短信 + 外呼 + 录音）按量计费 + 每号月租，开号前报具体价格。
3. 第 0 段里的两处 A 级改动，合并前在对话里问。

## 复审意见

（待子牙 / 魏征回填）
