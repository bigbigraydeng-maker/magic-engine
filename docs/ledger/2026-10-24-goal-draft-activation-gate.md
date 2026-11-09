---
id: 2026-10-24-goal-draft-activation-gate
title: 草稿目标缺主指标、周期、基线或理由时，不能改成进行中
status: done
owner: agent
decided_on: 2026-10-24
source: pr:3081
verify_by: 2026-10-31
verify_how: 在含本改动的分支运行 npx vitest run src/lib/strategy/__tests__/goal-activation.test.ts，退出码为 0。缺主指标、周期、基线或理由时，草稿不能改成进行中。
done_on: 2026-10-24
done_ref: commit:fc7f9eb929f67993252c39486d08324a4dc718b2
---
只收紧草稿改成进行中的检查。不改表、不改已有目标、不改界面。
基线空着不能当成 0。销售意图的主指标不能是点击或线索。
接到保存或刷新之前，线上行为不变。
