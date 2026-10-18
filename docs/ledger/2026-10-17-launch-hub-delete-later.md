---
id: 2026-10-17-launch-hub-delete-later
title: Launch Hub 确认要删，但 PM 说先不着急，先记录
status: decided
owner: pm
decided_on: 2026-10-17
source: doc:docs/audits/2026-10-17-me-dashboard-three-doors-proposal.md
verify_by: 2026-10-24
verify_how: PM 回「删」后：全站 14 处指向 /dashboard/content 与 /dashboard/visuals 的链接改指每日计划/视频工厂，再删页面与左栏条目；删前确认无人在用的功能清单已由 118 号交出
---
PM 10-17：Launch Hub 评估后确认应删（旧路线遗留，页面直连发布接口绕开审核闸），但「先不着急删，记录好」。
在 PM 说「删」之前：118/97 号不动它，也不把它放进任何新入口。

更新 10-17（PM 口述）：Launch Hub 实际没人用，Facebook / Instagram / 领英 / TikTok 都走别的接口（TikTok 是 10-16 新做的专用应用）。
旁证（只读查生产库）：content_posts 共 299 条，近 30 天动过 55 条但几乎全是自动起草的 draft；近 30 天只有 2 条推进到「已排期/已批准」，最近一次是 9-26。注意：推送接口不回写 publer_post_id，所以「从没推过 Publer」不能证明，只能说近 3 周没人批准过草稿帖。
删除仍按 A 级处理（97 号查到该接口登记在内核边界清单）：先 14 处链接改指，再删页面；PM 本人回「合 N」才合。
