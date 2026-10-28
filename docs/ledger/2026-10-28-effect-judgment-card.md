---
id: 2026-10-28-effect-judgment-card
title: 开方时把效果判断卡写进处方，开投检查和计划种子改读这张卡
status: done
owner: agent
decided_on: 2026-10-28
source: doc:docs/specs/2026-10-26-prescription-to-act-full-auto-design-v0.1.md
verify_by: 2026-11-04
done_on: 2026-10-28
done_ref: pr:3372
verify_how: 新开一份处方后，处方页能读到每个结果成本、每天上限、配速、第7天和第14天；缺数写原因且不补0。开投检查的成本和复盘日跟这张卡一致，对不上的每天上限不会被拿去改预算。
---
开方时写入处方已有的 generation_meta.measure。不新建表，不改预算，不写广告账户。
每天上限只记录和核对。老处方没有这张卡时，计划种子仍按原来的算法；开投检查不再自己重算成本和复盘日。
