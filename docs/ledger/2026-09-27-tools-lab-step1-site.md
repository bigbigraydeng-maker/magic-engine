---
id: 2026-09-27-tools-lab-step1-site
title: 工具实验室第一步（官网部分）——新增中文「Magic Engine 工具实验室」页，中文首页挂入口；广告体检介绍页去掉 17 项申请表改成「免费体检我的广告」直达注册，保留一个留邮箱的轻表单；页面可被搜索引擎收录
status: done
owner: agent
decided_on: 2026-09-27
source: session:4bb834a6
done_on: 2026-09-27
done_ref: pr:2124
verify_by: 2026-10-04
verify_how: 上线后打开 magicengine.com.au/cn/lab/ 和 /cn/meta-ads-ai/：① 页面上没有「内测 / 候补 / 招募 / Magic Bridge」；② 「免费体检我的广告」点过去是中文注册页；③ 轻表单提交一次测试（用自己的邮箱），hello@ 收到邮件；④ website_lead_events 里有 lab_ 开头的点击记录。不成：先看 Cloudflare Pages 这次部署是否成功。
last_checked: 2026-10-09
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
与应用部分 PR 2123 配套，须在 2123 上线后再合（按钮指向 /meta-ads-ai/mine）。公开打点接口已拒收 tool_signup，防伪造注册数。
