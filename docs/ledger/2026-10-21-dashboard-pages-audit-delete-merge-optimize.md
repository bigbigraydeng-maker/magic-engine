---
id: 2026-10-21-dashboard-pages-audit-delete-merge-optimize
title: 后台页面实测结论：5 项可删、4 组可并、7 项可改；内容工厂打不开的根因是生产库缺一列
status: decided
owner: pm
decided_on: 2026-10-21
source: doc:docs/audits/2026-10-21-dashboard-pages-delete-merge-optimize.md
verify_by: 2026-10-24
verify_how: PM 回复清单里哪些要做；对应窗口落地后逐页实测。内容工厂页能打开且看板接口返回 200；删除的页面不再出现在侧边栏和链接里；今日待办首屏 5 秒内出内容；广告健康的目标和计划文字与 v5 一致。
---
PM 10-21 凌晨授权用已登录的 Chrome 逐页检查后台，要删除、整合、优化三张清单。统筹实测 11 个页面加 8 个关联页，一个批准或保存类按钮都没点。完整证据和清单见 source 文档。
比页面更急的三件事：AI 文字账户钱用完已 3 天；内容工厂 500（生产库缺 youtube_publish_receipts.content_post_id，10-18 那份 YouTube 回执迁移要 PM 说 go apply，文件名见 source 文档）；v5 方案在系统里仍是草稿。
