---
id: 2026-11-21-reelsmate-engine-hardening-backup-handed-to-jundong
title: ReelsMate 的「ME 入口加固和加密备份」已交 Jundong 审，等他合并部署后核对线上是否生效、备份是否真的在跑
status: decided
owner: pm
decided_on: 2026-11-21
source: session:8e781654
verify_by: 2026-11-27
verify_how: 三样都成才算成——jundongGit/reelsmate 的 6 号改动单已合并；打开 reelsmate.co.nz/api/health 只看到 status ok、不再带显卡和排队细节；Jundong 回话确认数据库和人像素材的定时加密备份已配好并做过一次还原演练。只合并没配备份算没成
---
11-10 写的入口加固和备份当时停在草稿、挂在一条已合并掉的旧开发线上，一直没进 ReelsMate 主干；PM 11-21 回「整理」，按当天主干重新整理后开了 6 号改动单（旧的 2 号被它替代）。
合并和部署只能 Jundong 做；备份要落地还得他在服务器上建密码文件、配两个定时任务、把镜像目录挂进容器（清单在那张改动单和仓库的 docs/engine-v1.md）。
现状：服务器只在每次部署时留一份未加密的数据库副本，人像素材没有备份；公开健康检查谁都能看到显卡和排队细节。
顺带待 PM / Jundong 定：展会访客的人像目前没有删除入口，备份上线后会在备份里也留一份，要不要定保留期限。
