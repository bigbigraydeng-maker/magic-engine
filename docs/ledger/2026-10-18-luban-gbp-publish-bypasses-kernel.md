---
id: 2026-10-18-luban-gbp-publish-bypasses-kernel
title: 鲁班的大模型能在对话里直接调「发布到谷歌商家」工具，不经内核授权——目前没有客户接通谷歌商家授权，所以只出草稿；一旦接通就能真发
status: decided
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 查两件：①正式库 platform_oauth_connections 里有没有谷歌商家类授权（10-18 实查：没有，只有 meta/microsoft_mail/whatsapp/google_youtube/google_ga4/google_gsc/tiktok）②有没有人计划接通谷歌商家授权。一旦要接通，必须先把这条发布路径收进内核（或至少改成人工确认后才发），再接授权
---
魏征复审 Agent 流程稿时发现、我在主干核实：src/lib/luban/tools.ts 定义了 publish_to_gbp 工具（:213 定义、:314 处理、:341 调 publishToGbp），授权在时直接真发，无人工确认一步；该文件在 kernel/boundaries.ts:78 的历史豁免名单里，所以架构测试不拦。
正式库 10-18 只读实查：没有任何谷歌商家类授权，execution_logs 里这个工具调用记录为 0 → 现在是潜伏，不是正在发生。
9-24 自治计划 §4.1 名单写司马迁「发帖、回评一律审批」，这条路径与之矛盾。另：口碑手册说谷歌发帖接口本身要向谷歌单独申请白名单（7-10 个工作日），那是谷歌侧的审批，不等于我们内部有人审——别把两者混为一谈。
按 §11：频率 低（无授权、零调用）· IMPACT 高（对外发布绕过授权闸）· 收入 中 → 恰好一个低、一个高 → P2；接通授权那一刻升 P0。
