---
id: 2026-10-26-tour-catalog-create-new-tour
title: CTS 团目录补上「新建团」，Baker 发来的新线路 China Unveiled 才能录进后台再同步官网
status: decided
owner: agent
decided_on: 2026-10-26
source: session:74bb515b
verify_how: 部署后在后台 CTS 团目录点「新建团」建一条草稿团，列表里能看到、修改记录里有「新增团」，再把它删掉或用来录 China Unveiled；上架前不会出现在官网。
---
PM 定的路径：先进 ME 后台团目录新建，再同步到官网（不是直接改官网）。原来目录只能改已有团、加班期，没有新建整条团的入口。
本 PR 加：POST tours 接口（仅 Magic Engine 管理员，只进草稿，不碰数据库结构）+ 团列表下的「新建团」弹窗。
还没做：China Unveiled 本身（4 个出发日 + 14 天行程，附件在 Baker 10-23 邮件）的录入，以及上架到官网——上架要 PM 点头。
