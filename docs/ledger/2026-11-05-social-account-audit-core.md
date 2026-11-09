---
id: 2026-11-05-social-account-audit-core
title: 社媒 Agent 账号自检环第 2.5a 刀（本体）：6 项检查、读工单的只读层、CTS 41 条考题；定时回执与今日待办是下一个 PR
status: done
owner: agent
decided_on: 2026-11-05
source: pr:3627
verify_by: 2026-11-06
verify_how: src/lib/social/account-audit 存在，npx vitest run src/lib/social/account-audit 全过，其中 exam.test.ts 第 1 题（CTS 2026-11-05 的 41 条）要命中模板集中、BGM 重复、改版扎堆、形式覆盖、视觉单一五项并报「内容柱量不出来」；这一刀没有定时任务也没有写库，所以验收只看这些测试；定时回执与今日待办归下一个 PR（第 2.5a-2）
done_on: 2026-11-05
done_ref: pr:3627
---
对应设计 docs/specs/2026-11-05-social-agent-account-self-check-loop-v0.1.md。与设计的一处差别：BGM 的「单曲 ≤ 30%」规则在 CTS 数据上不成立（最高一首占 22.5%，但前 4 首占 80%），改成「30 天内前 3 首合计 ≤ 60%，且同一首 7 天内不重复」；阈值放在旅游行业配方里（候选，只有 CTS 一个证据）。形式覆盖里，工厂现有的 postcard / list 模板都算「destination」，没有真人 / 干货模板，所以这两类报「缺」。
