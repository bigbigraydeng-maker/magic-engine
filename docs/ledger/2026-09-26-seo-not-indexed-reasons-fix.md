---
id: 2026-09-26-seo-not-indexed-reasons-fix
title: 今日待办的「页面没被谷歌收录」改成按谷歌给的原因报数、给对动作，并认出被网站防火墙挡住的假页面
status: decided
owner: agent
decided_on: 2026-09-26
source: session:3b976bb5
verify_by: 2026-10-06
verify_how: 上线且 Oztop 下一次每周重爬成功后查三件事：①今日待办 not_indexed 两条不再出现「爬过却没收录」「内容太薄」旧说法，改按谷歌原因报数且不含跳转页；②生产库 client_site_pages 里正文含 Robot Challenge Screen 的行 crawl_status 已是 antibot_challenged；③这些行的 index_checked_at 仍在滚动更新。三项全对算成
---
PM 2026-09-26 在孔子只读评估窗口回「用 deepseek 修复 你来做质量检测」。DeepSeek 写代码，本窗口审 diff、跑测试、提 PR。
改动面：site-audit/antibot-detector、seo/index-status、pm-todo/manual-item-types 与 manual-items、site-audit/pages 接口与页面、seo-patrol/index-check。B 级，机器判级后自动合。
不含一次性改生产数据：旧假页面靠修好检测后的下一次每周重爬自动改标。
