---
id: 2026-11-04-ads-auto-pause-policy-check
title: 核实广告「花钱没结果就暂停」建议是否被授权规则悄悄拦下：没拦过（内核 0 条记录），但 CTS 3 条停在演练开关、NAL 功能没开，都没进待办；两家规则仍是自动+动作声明只能人批，关演练即触雷
status: done
owner: pm
decided_on: 2026-11-04
source: session:bdccc650
verify_by: 2026-11-18
verify_how: 只读复查生产库——action_runs 与 authorization_decisions 里 action_key='ads.auto_pause_on_d3' 仍为 0 行、authorization_decisions 里 deny_code='outward_requires_human_policy' 近 90 天仍为 0 行、flywheel_actions 里该动作没有 payload->>'status'='blocked' 的行，三条同时成立算「雷没被踩」；任一出现非零即判 failed 并把行数写进证据
done_on: 2026-11-04
done_ref: pr:3594
---
来源：广告诊断 agent「开工十问」体检稿经子牙、魏征审查提出的疑点（规则 auto_approve + 动作 human_only → 内核拒 → 记 blocked → 不进待办）。
135 号窗口 2026-11-04 只读查库 8 项核实，证据见 done_ref 文件。要点：内核从没收到过自动暂停提交；CTS autopilot_dry_run=true 把近 30 天 3 条命中记成演练；NAL autopilot_enabled=false 整个跳过；两家 ads.auto_pause_on_d3 规则 = auto_approve 永不过期；qualified_stage_keys 列已上生产；frequency_7d 全空；effective_status 近 14 天 0 空；Render 批准人名单已配 1 个。
不修任何东西，修法由 PM 定。
