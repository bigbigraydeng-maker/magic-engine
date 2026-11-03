---
id: 2026-10-26-ai-failover-brief-wired
title: AI 简报接上自动切换（刀 2）：OpenAI 没钱时简报自动换 Claude 再换 DeepSeek，落库记真实答题的模型，降级张数并进「该充值了」那条待办
status: decided
owner: agent
decided_on: 2026-10-26
source: session:96dc6edf
verify_by: 2026-11-02
verify_how: 合并部署后①手动触发一次简报任务（GET /api/cron/messenger-brief-hourly 带 CRON_SECRET），OpenAI 有钱时 generated 大于 0 且新写的行 model 是 gpt 开头；②下一次 OpenAI 真断电时（看 provider_outages 有新行）conversation_briefs 里应出现 model 是 claude 开头的新行，且运行记录不是一长串 failed；③三家都没钱时运行记录应写「所有 AI 供应商都不可用」并当场停下；④OpenAI 断电那天的今日待办里「该充值了」那条应带「简报已自动改用备用 AI：今天有 N 张」；⑤抽查三张备用模型写的卡，一句话和下一步都是中文
---
刀 2 接 brief.ts 和 brief-cycle.ts：走切换层、聚合错误单独认（否则整轮不再当场停下）、storeBrief 落真实 model、断电待办按供应商给指引（Claude 没钱别让人去 OpenAI 充值）。
当场试跑走真实 generateDueBriefs 带 20 秒候选预算，网络层把 OpenAI 拦成「余额用光」：邮件和私信各 3 条全部由 Claude 答完，OpenAI 只被打 1 次，model 如实记 claude。
试跑还查出 DeepSeek 对每条请求都 400（提示词里没有 json 这个词、也没把格式写给它），已修，修后 6 条真实对话全部通过严格校验。
未验证：真正的 OpenAI 断电那天的端到端（今天是拦截模拟）。
