---
id: 2026-10-18-promo-plan-cards-form
title: 推广计划页能填经营判断卡、实验卡、销售承接了（表单 + 算式显示，还是不拦批准）
status: done
owner: agent
decided_on: 2026-10-18
done_on: 2026-10-18
done_ref: pr:2790
source: session:579d2d02
verify_by: 2026-10-25
verify_how: 合并上线后在真实推广计划页加一张经营判断卡、填满、保存成功，再读库确认 plan_data.promo.phases[].business_case 有值；并确认页面上「可承受的每条线索成本」那块显示的是算式 + 数字，没填的项显示「未知」而不是 0
---
设计稿 docs/specs/2026-10-18-promo-plan-business-case-and-gates-design-v0.1.md 的 PR①-b，接在 PR 2781（只加 schema）之后。
本刀仍然不碰批准闸：卡没填不会挡住批准，那是下一刀（A 级）的事。
算式口径（统筹 10-18 定）：可承受的每条线索成本 = 每座留存 × 每单几座 × 成交率；页面把式子和代入的数都写出来，任何一项没填就显示「未知」，不显示 0。
