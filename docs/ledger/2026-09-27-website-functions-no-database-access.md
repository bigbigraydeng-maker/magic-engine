---
id: 2026-09-27-website-functions-no-database-access
title: 官网（Cloudflare Pages）服务端函数很可能没有数据库访问——免费网站诊断从没存下过线索、官网按钮打点从没记下过；决定把这些服务端逻辑搬进应用，不把数据库总钥匙再放一份到 Cloudflare
status: decided
owner: agent
decided_on: 2026-09-27
source: session:4bb834a6
verify_by: 2026-10-06
verify_how: 查两件事：① 工具实验室第二步（PR 2126）已改成调用应用接口并上线后，正式库 discovery_leads 出现来自网站诊断的新行（attribution 里 tool=site-check）；② 官网按钮点击（lab_ 开头）开始出现在 website_lead_events。都没有就问卫青窗口卡在哪。
---
证据（9/27 查正式库）：60 天内 website_lead_events 只有应用侧写的记录（proposal_*、经应用转发的 contact_submit），没有任何官网 lead-event.js 写的打点；discovery_leads 没有 scouted 行。PR 2126 预览站调用返回 no_visitor。设计稿 docs/specs/2026-09-27-tools-lab-step2-site-diagnosis-design.md 第 7 节。
