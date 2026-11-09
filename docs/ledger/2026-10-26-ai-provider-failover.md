---
id: 2026-10-26-ai-provider-failover
title: AI 供应商自动切换：OpenAI 没钱时自动换 Claude（DeepSeek 默认关），先做切换层本身，再接简报（Ray 说「做」；这个月 OpenAI 已断 8 天）
status: decided
owner: agent
decided_on: 2026-10-26
source: session:96dc6edf
verify_by: 2026-11-03
verify_how: 刀 2（把简报接上切换层）合并后：①在本地把 OpenAI 换成必败的假错误，走真实 generateDueBriefs 带 20 秒候选预算跑一轮，conversation_briefs 里应出现 model 是 claude 开头的新行（贴 conversation_id 和 generated_at 当证据）；②三家都没钱时运行记录应写「账户级故障，已当场停下」而不是 failed 一长串；③provider_outages 里 anthropic 的账户级失败有记录；④PM 待办里能看到「今天有 N 张卡是备用模型答的」
---
设计稿 docs/specs/2026-10-26-ai-provider-failover-design-v1.md 已吸收子牙和魏征两审，共 9 条必改全部核实成立。刀 1（切换层，不接任何调用方，线上零变化）见同名 PR。
试跑查出：Claude 在真实邮件对话上 8 张里只有 5 张照要求写中文，加一句语言提醒后 8 张全对，所以切换层带了「只给备用模型」的提示词后缀。
刀 2 待做：接 brief.ts 和 brief-cycle.ts（错误类型透传、重核每段张数、落真实 model、降级提示进 PM 待办）。刀 3 起其余 5 个结构化调用点另开卡。
