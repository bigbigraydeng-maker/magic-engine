---
id: 2026-09-26-seo-not-indexed-reasons-fix
title: 今日待办的「页面没被谷歌收录」改成按谷歌给的原因报数、给对动作，并认出被网站防火墙挡住的假页面
status: done
owner: pm
decided_on: 2026-09-26
source: session:3b976bb5
verify_by: 2026-10-06
verify_how: 上线（先 apply 数据库改动、再合并代码）后第一次每周重爬结束时查三件事：①今日待办 not_indexed 按谷歌原因报数、不含跳转页，也不再有「爬过却没收录」「内容太薄」旧说法；②那次重爬的任务 error_message 为空，且上线后被重爬碰到的挑战页 crawl_status 是 antibot_challenged（没被重爬碰到的旧行不算）；③被挡行的 index_checked_at 仍在滚动更新。三项全对算成
done_on: 2026-09-26
done_ref: pr:2040
last_checked: 2026-10-12
check_note: 连续两晚判不了（10-09、10-12），转 PM：夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
PM 2026-09-26 在孔子只读评估窗口回「用 deepseek 修复 你来做质量检测」。DeepSeek 写代码，本窗口审 diff、跑测试、提 PR。
改动面：数据库约束（migration：放开 antibot_challenged、回填三列）、site-audit 检测器 / job-executor / job-runner、seo/index-status、pm-todo 两个文件、blog/content-gate、站点页面清单接口与页面、seo-patrol/index-check、SiteGround SOP。
A 级（含数据库改动）：PM 先点头 apply migration，再点头合并；Risk gate 不会自动合。
不含一次性改生产数据：旧挑战页靠下一次每周重爬自动改标（每周最多 150 页，碰不到的旧行不会自动改）。
后续另开：被挡的站改成由 ME 服务器直接读（白名单对第三方阅读服务那一路无效）。
上线记录：PM 2026-09-26 在孔子窗口回「上 2040 2044」。03:04:28 UTC 先 apply 数据库改动（改前只读核过：约束三值、全表 655 行都是 crawled；改后约束含 antibot_challenged、数据未变；数据库改动记录里名为 client_site_pages_crawl_status_antibot），03:04:54 UTC 合并（`93923af0`），03:07:34 UTC 部署成功。验收查询里的 <APPLY_TIME> 用 2026-09-26T03:04:28Z；第一次每周重爬是 2026-09-27 01:00 UTC。
