---
id: 2026-11-04-ads-health-page-blank-server-import
title: 广告健康页白屏已修：浏览器端误引入服务器数据库钥匙
status: done
owner: agent
decided_on: 2026-11-04
done_on: 2026-11-04
done_ref: pr:3569
source: session:90a50c3b
verify_by: 2026-11-05
verify_how: 合并部署后打开 CTS 广告健康页，应能看到内容而不是白屏；控制台不再报 Missing SUPABASE_SERVICE_ROLE_KEY。仍白屏就回 74 号。
last_checked: 2026-11-05
check_note: PR3569 已合并(11-03)；verify_how 要求打开真实页面确认不白屏+控制台无报错，夜巡无法登录后台，判不了；需白天有人登录验证
---
原因：今日目标进度组件间接引了带服务器数据库钥匙的文件，浏览器里没有钥匙，页面加载即崩。
改法：把一个常量挪到不依赖服务器的新文件，并加了守卫测试防再犯。
