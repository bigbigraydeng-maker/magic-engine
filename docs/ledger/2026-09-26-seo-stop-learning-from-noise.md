---
id: 2026-09-26-seo-stop-learning-from-noise
title: 没有强结论和执行凭证撑着的旧 SEO / 广告经验下架，不再喂给出建议的程序（排在「整站涨跌记不知道」上线之后）
status: decided
owner: agent
decided_on: 2026-09-26
source: session:3b976bb5
verify_by: 2026-10-10
verify_how: 1b 上线后记忆提取器跑过一轮再查生产库三件事：①client_proven_patterns 与 client_failed_experiments 里来自 flywheel_outcomes、属 SEO 与广告、且动作没有强结论或没有执行凭证的行 is_active 为 false；②AI 可见度与社媒的行一条没动；③那次运行记录列出了被下架行的 id 和表名，能按清单恢复。三项全对算成
---
PM 2026-09-26 在孔子窗口回「用 deepseek 修复 你来做质量检测」。根因：诸葛亮把建议存成已执行，GSC 按整站前后差给单条建议打分，记忆提取器再把结论变成经验。
第 1 条拆两步：1a 先让新结论诚实（另卡 2026-09-26-seo-site-level-verdicts-unknown），本卡 1b 再下架旧经验。
广告负责人卫青已书面同意广告经验按同一规则下架；AI 可见度等孟子决定。
上线会切正式库记忆行的开关（可逆，只切 is_active 不删行）；停用规则、范围、回滚办法在合并前由 PM 拍板。
