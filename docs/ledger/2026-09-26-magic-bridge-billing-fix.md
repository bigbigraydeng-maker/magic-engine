---
id: 2026-09-26-magic-bridge-billing-fix
title: Magic Bridge（Meta 广告 AI 客户页）报告不再因写超长失败，失败时按真实用量扣免费额度而不是一律扣 12 美分
status: done
owner: agent
decided_on: 2026-09-26
source: session:4bb834a6
done_on: 2026-09-26
done_ref: pr:2043
verify_by: 2026-10-10
verify_how: 合并后下一次有客户点生成报告时，看报告是否生成成功；若失败，该任务的扣费应等于模型真实成本（几美分）而不是 0.12。样本 1 次生成即可判；10/10 前没人生成则记「判不了·没人用」
last_checked: 2026-10-11
check_note: 2026-10-11 夜巡到期复核未取得新证据，仅盖章；待下一晚按 verify_how 实查。
---
PM 2026-09-26 授权「A」（经小秘书转达 + 本窗口 abc）。设计：docs/specs/2026-09-26-magic-bridge-rule-findings-design.md（PR-A 节）。
起因：最近 3 次失败都是输出上限 2000 被截断；8 次失败各扣 $0.12，CTS 9 月免费额度 $1.04 里 $0.96 是失败白扣的。
退款方案另见 docs/specs/2026-09-26-magic-bridge-sept-refund-plan.md，执行前 PM 另点头；建议先合本 PR 再退。
