---
id: 2026-10-16-social-daily-entry-step1
title: 社媒日常入口第 1 步代码写好：改名、头条按线分别报、最近 Reel 背景音乐重复提示、客户页主卡；等两位审查后合并
status: decided
owner: agent
decided_on: 2026-10-16
source: session:c45254ff
verify_by: 2026-10-23
verify_how: PR 合并后，管理员打开每日计划页「社媒日常」标签，能看到三条线分别的头条和 Reel 背景音乐提示行；客户页「内容生产」栏最前面有「社媒日常」卡；页面上没有裸的「已发」两个字
---
设计稿 docs/specs/2026-10-15-social-daily-entry-design-v0.1.md 第 3、4 节第 1 步。只读：不写库、不建表、不碰授权 / 发布 / 开关。
代码由 DeepSeek 经 aider 写（6 轮约 0.022 美元），我审 diff 并本机跑测试。Reel 没有计划日，统计的是最近 30 条没被隐藏的 Reel，页面文字写「最近 N 条」。
