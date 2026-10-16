---
id: 2026-10-16-promo-plan-scale-monitor-shelved-calculator-in-me
title: 「利润监控（只读，动态）」设计搁置，改为把经营计算器搬进 ME（手填、可存多场景）
status: decided
owner: pm
decided_on: 2026-10-16
source: session:8aade036
verify_by: 2026-10-23
verify_how: 一周后看 docs/specs/2026-10-16-business-calculator-in-me-design-v0.1.md 是否已过子牙+魏征审并拿到 PM「做/不做」；若做了，看 CTS 客户页「经营测算」页能否用默认值得出 40,571 / 720 / 575，并存两个场景做对比。PR 里 `me_calculator_scenarios` 迁移须 PM 回「合」才合并
---
PM 原话：「我考虑了一下，还是不要做成动态的了。不方便我们多场景模拟。你还是只把这个计算器功能做到 ME，数据先不用打通。可以保存不同的模拟场景。」
动态监控设计 `2026-10-16-promo-plan-scale-profit-monitor-design-v0.2.md` 已过子牙+魏征各两轮审查，**搁置不删**，其中的审出事项（订单无渠道来源、花费表三级会翻倍、空人数不补默认值、文案不得读成加预算授权、配置别放 `plan_data`）日后若重做监控仍有效。
