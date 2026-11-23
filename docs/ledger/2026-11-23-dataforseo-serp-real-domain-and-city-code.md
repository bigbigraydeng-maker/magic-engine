---
id: 2026-11-23-dataforseo-serp-real-domain-and-city-code
title: 系统读谷歌排名的工具修好了——前排网站不再全显示成谷歌，按城市查不再报错
status: decided
owner: agent
decided_on: 2026-11-23
source: session:73f48377
verify_by: 2026-12-01
verify_how: 看 2026-12-01（周二早上自动跑）那次行业 AI 可见度采集——industry_ai_visibility_snapshots 里 platform=google_serp 那周的行，serp_organic_top10 里不再出现 /goto?url= 跳转链接，并且 error_message 是 40501 Invalid Field 'location_name' 的行数为 0。两样都对才算成
---
从 2026-11-02 那周起，DataForSEO 把搜索结果网址换成了谷歌跳转链接，真实网站只放在 breadcrumb / website_name 字段里。从 2026-08-31 起，按城市查（布里斯班、悉尼等）一直报 40501 错误。
这次修复在 `src/lib/dataforseo/serp.ts` 里：`resolveOrganicTarget` 把真实网站找回来，城市改用城市编号。
已知限制：跳转链接只能还原到网站这一级，具体是哪一页还原不了。所以 SEO 周循环的「是不是这一页在排名」判断可能会偏保守。周循环从 2026-09-28 起就没跑过，以后恢复时要另外处理。
