---
id: 2026-11-05-week-card-reel-list
title: 周卡「批下一周」的视频改成看得懂的清单（每条日期+18:00、看片、正文、首评，默认勾上，一次批完），按日公开模式下批视频改走清单授权
status: done
owner: agent
decided_on: 2026-11-05
source: pr:3620
verify_by: 2026-11-06
verify_how: 合并部署后管理员打开 CTS「社媒日常 → 本周总览」，「批下一周」里列出 11/9、11/11、11/13 三条（带周几和 18:00、正文、首评、看片），没排日子的不出现，没有「确认后立刻公开」字样；PM 点「同意这一周」后 flywheel_actions 里这三条的 scheduled_go_public.status 变成 armed、card_run_id 以 daily-list: 开头
done_on: 2026-11-05
done_ref: pr:3620
---
PM 11-05 看了旧周卡说 FDE 看不懂（编号、没日期、要一条条预览、几分钟过期、还写着错误的「确认后立刻公开」）。按日公开打开时周卡视频改用第 2 刀清单授权（服务端重建下周清单、指纹一致才批、只认全局管理员）；按日公开没开时周卡照旧。
