---
id: 2026-09-23-ai-tracker-100pct-failure-pm-todo-alert
title: 客户 AI 可见度体检整周全挂时进 PM 待办告警——代码写完、两轮复审已过，PR 待合
status: done
owner: pm
decided_on: 2026-09-23
source: session:963c2e80
verify_by: 2026-09-30
verify_how: "查 PR 1943 是否已合并；合并后到了下周一 AI 体检跑完，找一个探测全挂的客户（或人为制造一次），确认待办邮件里真的出现了这条提醒，而不是一片空白"
done_on: 2026-09-28
done_ref: pr:2199
last_checked: 2026-10-20
check_note: 10-20：10-20 待办邮件无 ai_tracker_all_failed 条目，但同封邮件写 OpenAI 文字账户已连续2天没钱(AI体检会被跳过)，尚无探测全挂的真实事件可对照，判不了；owner 已是 pm
---
真实事故：2026-09-20 East International 24/24 探测全挂，看起来跟「没被提到」一模一样，三天没人发现。
改动：新增 `ai_tracker_all_failed` 待办项自动报警（分供应商给修复指引，不用你操心的原因单独归开发栏）
+ 修好旧周检的失败计数 + 查询加分页防截断。经子牙+魏征+Codex 三轮复审共 12 条意见，均已修或记为
已知缺口，30 个测试全过。已知缺口（均待下轮补）：数据库写入失败/更新失败时检测不到、批次没跑完时
可能误报一次（会自愈）。PR 1943。
