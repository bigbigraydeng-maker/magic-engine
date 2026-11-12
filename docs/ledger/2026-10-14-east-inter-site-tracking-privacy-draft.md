---
id: 2026-10-14-east-inter-site-tracking-privacy-draft
title: East Inter 官网追踪代码和隐私页已上线（Meta 像素 + GA4），GA4 报表还要再看一次
status: done
owner: agent
decided_on: 2026-10-14
source: session:342d4a50
done_on: 2026-10-14
done_ref: pr:2619
verify_by: 2026-10-16
verify_how: 官网站点提交 571de66 已发布。已验：eastinter.com.au/privacy 打开 200，Meta 数据集 last_fired 有新时间。还要验：GA4 实时报表看到访问和邮件点击事件；Meta 事件里出现 Contact/ViewContent（数据有延迟，次日再看）。
---
范围只有追踪和 /privacy。草稿和测试在 docs/clients/east-inter/site-tracking-2026-10/，官网仓库没动。
Meta 像素和 GA4 的编号都已填（编号在 tracking-config.js，台账不写长数字），PM 10-14 回「发布」，官网提交 571de66。回滚：官网仓库删 tracking-config.js、tracking.js、privacy.html，index.html 与计算器页还原到 35fa64f。
