---
id: 2026-09-27-nal-monthly-300-messaging-goal
title: NAL 首条生效增长目标写库 —— 每月 300 个开聊，改前这个客户一条生效目标都没有、整条自治闭环全程瘫停
status: done
owner: pm
decided_on: 2026-09-27
source: session:0a9daab4
done_on: 2026-09-27
done_ref: doc:docs/roadmap/2026-09-27-ads-wp3-1b-v2-redo-plan.md
verify_by: 2026-10-26
verify_how: 查 goals 表这一行 status 还是 active、period_end 没过；月底（10-26）到期要复位下一轮，不复位这个客户又会回到「没有生效目标 → 一个自动动作都出不来」。另外核一眼实际开聊数往 300 走没走。
---
PM 2026-09-27 在统筹窗口授权写入。goal b1f6ad45-c003-4a12-9757-de8fca436063，主指标 messaging_started（私信/WhatsApp 开聊数）300 / 周期 2026-09-27→10-26 滚动 30 天 / baseline 0 / NZD / active。
改前实测：这个客户只有一行 2026-06-02 的种子占位（draft、target=0），**生效目标计数 = 0**，所以执行内核按「无目标不出动作」把整条广告自治闭环全程挡住了。写后回读两行并存，新行 active、旧占位仍 draft 未动。
两处判断实现时别改：baseline 填 0 不是历史值、是本期累计计数器起点（填实测的 222 会让目标进度从第一天就算出「完不成」发假警报）；周期用滚动 30 天不用自然月（定案当天已 9/27，按自然月只剩 3 天，同样发假警报）。
可达性是写前量的不是估的：近 30 天真实 222 个开聊 / NZ$1435.99 / 每个 NZ$6.47 / 日均约 NZ$48，日上限 NZ$100 有余量，222→300 约需 NZ$65/天。
客户工作日志已由统筹窗口写（fde_work_logs 42e0c2f3），日志里另记两条在飞风险：该客户档位已是 bounded_auto 但总开关关着、熔断器尚未接线所以刹车还不生效。
