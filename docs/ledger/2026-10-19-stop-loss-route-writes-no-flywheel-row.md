---
id: 2026-10-19-stop-loss-route-writes-no-flywheel-row
title: 广告健康页的人工止损（先全停 / 预算降 20%）经内核执行，但不写 flywheel_actions 回执，学习与复盘看不到这类人工动作；按 §11 是 P3，不排在 CTS 10/22 前
status: decided
owner: agent
decided_on: 2026-10-19
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 查两件：①止损路径（stop-loss/route.ts → submitStopLossThroughKernel）成功后，flywheel_actions 是否出现对应行（含 action_run_id，能和 action_runs 对上）②memory/extractor-load.ts 读到的动作里是否包含这类人工止损。两件都成立才算补上；补之前别拿 flywheel_actions 当“所有广告动作”的全集用。
---
2026-10-19 T5 实测：空操作暂停成功后，NAL 的 flywheel_actions 为 0 行；读代码确认止损链（route、submitStopLossThroughKernel、runAction、pause-campaign 能力）上没有任何地方写这张表。内核自己的回执（action_runs、steps、授权决定）是齐的。
影响：记忆抽取 memory/extractor-load.ts 靠 flywheel_actions（带 action_run_id）还原“系统做过什么”，所以人工止损这类动作进不了复盘与学习。只限止损这条路径：meta-ads/execute 的降预算由 Inngest 函数写飞轮，D3 自动暂停自己写，不受影响。
按 §11 打分：频率 低（这条路由今天之前一次都没真执行成功，还坏了一段时间）· IMPACT 中 · 收入关联 低 → 两个低 → P3，不排在 10/22 前。
18 号判 T5“未通过”并登记为真缺口，口径不放宽。
