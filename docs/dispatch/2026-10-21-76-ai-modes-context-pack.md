# 上下文包：CRM 两种 AI 模式（给后续开发窗口 / DeepSeek / 审查官读）

整理自 76 号窗口 2026-10-21 与 PM 的对话。PM 指令：「把上面的上下文对话记录打包成文件，然后开始形成代码进行开发」。权威设计稿：`docs/specs/2026-10-21-crm-ai-modes-design-v0.2.md`。

## PM 原话要点（按时间）
- 语音先不做，先做打字。对方进来时可切换：**1 全 AI 托管；2 AI 助力（人工主聊）**。两块都做在后台 CRM 里。
- 资料来源（PM）：①团价和班期 = ME 团目录；②剩余位置 = CRM 里的销售记录（**我最初说「CRM 没有剩余位置」是错的，销售进度页就是座位数减已订人数**）；③企业信息 = Master Brief。
- PM 纠正：团目录**不是草稿**，是严肃的正式记录；4 个已过期班期还开着是目录要改的数据问题。
- PM 对我的方案回「好」＝同意第一步，价格以团目录为准、不再走 CTS 本人确认；「都要」＝两种模式都做。
- 其它已定：WhatsApp 通话开关保持关（缺通话事件接收通道，开不了），语音不开发（台账卡 `2026-10-21-cts-whatsapp-calling-off-use-phone`）；安抚消息 6 小时限频已合并（PR 2972）。

## 已核实的事实（只读，2026-10-21）
- CTS WhatsApp 的 AI 起草已开（`messenger_agent_enabled_whatsapp=true`；私信、邮件开关关）。生产库里只有 1 条 AI 草稿，被安全检查拦下（`content_claims … promise`）。
- 批准草稿的抽屉面板（PR 2958）已上线；点批准后真发的整条链**还没在生产跑过**（台账 verify_by 10-24 要 PM 手机实测）。
- 知识库表 `client_knowledge_facts` CTS 只有 7 条（公司介绍、客服电话、免签、语气），无一条在售团；价格类要客户确认。**且读入口要求私信开关开 + 知识库上线阶段，对 WhatsApp 现在读出来是空的。**
- 团目录 `tour_catalog_*`：33 个团、37 个班期，最近修改 2026-10-19；班期座位数在 `internal.capacity`（多数 20）；`crm_bookings` 26 条有效订单，10 条没人数。
- 通话/邮箱：CTS 10 通电话（4 通点击拨号）全接通且录音转写摘要完整；邮箱授权有效，最近同步 10-20。

## 第一步（PR-A）的范围
只做「AI 读团目录 + 剩余位置」，不改知识库核心、不改安全检查、不改提示词、无库改动：
- 新文件 `src/lib/messenger-agent/catalog-knowledge.ts`：`loadCatalogKnowledgeEntries`（读团目录/班期/订单，生成 `tour.active.<slug>…` 条目）+ `getClientKnowledgeWithCatalog`（包装原读入口并追加）。
- 接线 3 处：`conversation-inbound-draft-store.ts`、`tools.ts`（两处）。
- 测试 + 变异 + 当场只读试跑（CTS 真实一条问题起草，只写草稿不发）。
- 审查：设计稿 + 代码各过子牙/魏征；A 级，PM 本人「合 N」才合。

## 后续（不在 PR-A）
PR-B：对话级 `ai_mode` 列 + 抽屉三档开关 + 人工接管降档（要改生产库，需 PM 批准）。PR-C：全托管自动发送（PM 重新拍板，改 9-15 「AI 只写草稿人批准才发」）。另开卡：WhatsApp 渠道读知识库入口只认私信开关；目录里 4 个过期班期要关。
