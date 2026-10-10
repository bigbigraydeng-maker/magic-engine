---
id: 2026-10-10-crm-owed-quote-into-today-list
title: NAL「先放着」里有 52 个欠报价、27 个等我们回的客人，要按销售每天能打的数提进「今天要联系」，等 PM 定数
status: decided
owner: pm
decided_on: 2026-10-10
source: session:f53ba28d
verify_by: 2026-10-17
verify_how: PM 回一个每天能打的人数后，另开 PR 把「欠报价」「等我们回」两组按最近有动静排、填到这个数进今天要联系；上线后 NAL 今天要联系的人数 ≤ 这个数，且这两组之外的人不被挤进来
---
依据：docs/specs/2026-10-10-crm-intent-calibration-plan.md「先放着名单审计」。PM 盲测 10 段全回「该」，其中 7 位在先放着里。整批搬进来会让今天要联系变成 107 人，所以要先有每天能打的数。
