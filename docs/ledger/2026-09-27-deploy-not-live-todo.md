---
id: 2026-09-27-deploy-not-live-todo
title: 合进主干的代码超过 30 分钟没上线正式网站，今日待办就出一条「正式网站已经 X 小时没换上新代码」，写明从哪个 PR 起没上线
status: done
owner: agent
decided_on: 2026-09-27
source: session:a853a3c2
done_on: 2026-09-27
done_ref: pr:2074
verify_by: 2026-10-01
verify_how: PR 合并上线后打开今日待办页面，主干正常时不出现这条也不出现「上线检查自己没跑成」（后者出现 = 生产里 GitHub 钥匙或 Render 变量读不到，要修）；能一次性复现时，在主干上线失败期间页面出现这条且链接打开是 crazycontent 的上线记录
last_checked: 2026-11-27
check_note: 11-27 gh pr view 2074 MERGED(2026-09-26)；今日待办页需登录，夜巡无登录态；近 3 天 github-actions 正常自动合入 3937-3941 说明主干上线链路在跑，但页面上这条出没出现看不到，判不了
---
起因：2026-09-25 一次合并把主干编译搞坏，约 7 小时每次上线都失败，正式网站停在旧版，没人发现。
检查代码在 src/lib/pm-todo/deploy-health-items.ts，挂在今日待办的基础设施检查里；子牙审一轮，意见全改。
已知缺口：早上邮件一天只跑一次，9-25 那种白天坏、晚上前修好的断档邮件抓不到，只有页面看得见；每小时主动推送待 PM 排优先级。
