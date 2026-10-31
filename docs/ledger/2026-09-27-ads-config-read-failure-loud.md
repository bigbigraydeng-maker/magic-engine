---
id: 2026-09-27-ads-config-read-failure-loud
title: 广告每日回拉读不出广告设置时要喊出来（记进运行记录、进今日待办系统欠账、经营状态表停写也报）
status: done
owner: pm
decided_on: 2026-09-27
source: session:24ed1b86
verify_by: 2026-09-29
verify_how: 部署后第一次 17:00 UTC 运行起看三件事——①该轮在读配置失败时被标成失败且 summary.errors 有 ad_config 来源 ②失败邮件第一行是 ad_config ③当天今日待办的开发欠账（邮件末尾小字与任务体检页开发欠账区）出现「广告设置读不出来」。三件都只在真实读失败时可见：没发生读失败时只能验到反面（errors 无 ad_config、ads_growth_states 当天有行、开发欠账无此条），此时记为「报警链路未经真实故障验证」而不是已验证；模拟读失败要改生产配置，需 PM 另行授权
done_on: 2026-09-28
done_ref: pr:2186
last_checked: 2026-10-30
check_note: 10-30：gh pr view 2186 状态 MERGED(2026-10-10T05:04Z)；报警链路只有真实读配置失败才触发，未获授权不模拟，只能验反面，不判verified
---
9-25 那轮读配置每次 400（代码先于加列上线），诊断和经营状态对所有客户静默跳过一天。
本卡跟踪修复 PR：配置读失败计入失败并当失败邮件头条、今日待办单独一条、ads_growth_states 纳入「跑成了没写东西」检查、加列名与建表记录对账的守卫测试。
实现 PR：pr:2116（已合并）；done_ref 指向本收尾 PR，因为台账门禁要求改卡的 PR 必须被一张卡指向。
