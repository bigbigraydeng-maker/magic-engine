---
id: 2026-09-27-ads-config-read-failure-loud
title: 广告每日回拉读不出广告设置时要喊出来（记进运行记录、进今日待办系统欠账、经营状态表停写也报）
status: decided
owner: agent
decided_on: 2026-09-27
source: session:24ed1b86
verify_by: 2026-09-29
verify_how: 合并上线后看第一次自动运行（每天 17:00 UTC）——运行记录 summary.errors 里没有 ad_config 来源、ads_growth_states 当天每个有 Meta 账户的客户各有一行；再用测试环境或下一次真实配置读失败确认今日待办系统欠账栏出现「广告设置读不出来」一条。任一项查不到就算没验成
---
9-25 那轮读配置每次 400（代码先于加列上线），诊断和经营状态对所有客户静默跳过一天。
本卡跟踪修复 PR：配置读失败计入失败并当失败邮件头条、今日待办单独一条、ads_growth_states 纳入「跑成了没写东西」检查、加列名与建表记录对账的守卫测试。
