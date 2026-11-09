---
id: 2026-10-21-creative-promo-window-pr1
title: 素材推广期第一刀：没声明推广期的素材不能批准入池，已过期的也不行
status: decided
owner: agent
decided_on: 2026-10-21
source: doc:docs/specs/2026-10-21-ad-agent-kernel-side-design-v0.3.md
verify_by: 2026-10-28
verify_how: PR 合并后，给 CTS 素材池里 3 条候选各声明推广期再批准，应能批准；不声明直接批准应被拒（422）。两条已批准的存量不受影响。自动停过期广告是下一个 PR（PR-2），不在本卡。
---
A 级草稿 PR，等子牙+魏征复审与 PM「合 N」。本 PR 不含任何自动暂停、不改内核、不改广告。
