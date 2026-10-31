---
id: 2026-09-26-today-page-slow-load
title: 「今日待办」页面打开太慢——改成各项检查同时查、外网链接检查最多等 2.5 秒
status: done
owner: pm
decided_on: 2026-09-26
source: session:37bf3bc6
verify_by: 2026-09-29
done_on: 2026-09-26
done_ref: pr:2067
verify_how: 上线后在浏览器打开 app.magicengine.com.au/dashboard/today，按 F12 看 Network 里 /api/workbench/today 那一条耗时；连开 3 次，每次都在 3 秒内且页面待办条数跟当天早上邮件一致算成
last_checked: 2026-10-27
check_note: 10-27：PR 2067 已合并(2026-09-26)；要登录后在浏览器 F12 连量三次 /api/workbench/today 耗时，夜巡无登录态量不了，仍判不了
---
PM 2026-09-26 报页面「loading 非常慢」。本地假库实测：每次打开要排队查 73 轮数据库（每次查库 40ms 时 3.0 秒、100ms 时 7.4 秒），外网链接卡住再多等 8~16 秒。
修法：各项检查同时查（73 轮 → 11 轮）；链接检查结果记 10 分钟；页面最多等 2.5 秒，没验完的先显示；每日邮件照旧等验完。
没在正式环境量过，上线后按上面的办法核对。
