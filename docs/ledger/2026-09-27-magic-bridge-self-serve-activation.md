---
id: 2026-09-27-magic-bridge-self-serve-activation
title: Magic Bridge 新注册客户自助开通 + 防刷免费额度：自助客户自己点开通用 90 天；同一 Facebook 用户 / 同一广告账户每月各 1 美元、全平台每月 30 美元；Meta 审核通过前只有测试者能连 Facebook
status: done
owner: agent
decided_on: 2026-09-27
source: session:4bb834a6
done_on: 2026-09-27
done_ref: pr:2112
verify_by: 2026-10-04
verify_how: 迁移执行、PR 合并上线后：① 用一个测试用自助注册客户打开 Magic Bridge 页，看到「正在等 Meta 官方审核」和示例报告链接，没有连接按钮；② CTS 的 Magic Bridge 页照常打开、照常能生成报告；③ 生产 meta_ads_ai_quota_config 有三行（facebook_user 1、ad_account 1、platform 30）。不成：先查迁移是否已执行（邀请表有没有 source 列）。
last_checked: 2026-10-13
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
PM 9/27 定方向 A（新客户自助用），额度默认值 PM 同意；不接 MTC。设计：docs/specs/2026-09-27-magic-bridge-self-serve-open-design.md（分支 chore/mb-open-eval）§2、§8。
审查：设计两轮 子牙 + 魏征 + 板桥；实施后 子牙 + 魏征 + 板桥 + 狄仁杰，全部阻塞项已修。验证：本机一次性 PostgreSQL 45 项 + 原有 111 项、单元测试 951 条、变异探针 22/22。
上线顺序：先合 PR 2111（数据删除）→ PM 授权执行本 PR 迁移（必须先于代码）→ 合并本 PR。
后续：① 审核通过后给等待中的自助客户发通知邮件（发之前单独问 PM）；② 封禁名单与额度设置的后台界面；③ PR-2 自助客户现场算卡片。
