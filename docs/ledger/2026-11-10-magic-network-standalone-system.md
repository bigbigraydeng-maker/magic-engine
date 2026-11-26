---
id: 2026-11-10-magic-network-standalone-system
title: Magic Network 做成独立系统，不放在 ME 后台里；负责分销 Magic Engine、Magic Academy 等所有产品（PM 11-10）
status: decided
owner: pm
decided_on: 2026-11-10
source: session:e5aca2ac
verify_how: 看私有仓库 bigbigraydeng-maker/magic-network 的 README「还没做」一节：数据库开了没有、网站上线没有、经销商数据从 ME 库迁过去没有。三件都做完，再撤 ME 里的旧页面（/partner、/ai-steward、后台「Magic Network」菜单），那时这张卡才算完成。
---
PM 决定：Magic Network 是独立的代理管理平台，独立代码仓库、独立数据库、独立登录，正式域名 PM 自己注册。
2026-11-10 已做：新仓库建好，整套网站搬过去（首页、产品页、凭邀请码申请、经销商后台、管理后台、每月算账），135 条测试、类型检查、构建都通过，本机点过。
还没做：没开数据库（PM 说先不急，每月 10 美元）、没上线、ME 库里的经销商「大瑞」没迁。ME 里的旧页面这期间照常在用。
