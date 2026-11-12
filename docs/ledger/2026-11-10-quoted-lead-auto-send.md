---
id: 2026-11-10-quoted-lead-auto-send
title: 已报价的待核对咨询可以自动回传，开关默认关
status: done
owner: agent
decided_on: 2026-11-10
done_on: 2026-11-10
done_ref: commit:94f286371a9105baa974a0e77a9f8c55ec30e8ca
source: doc:docs/sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md
verify_by: 2026-11-17
verify_how: 开关关着的客户，已报价咨询仍留在待核对。CTS 打开后，当前阶段是已报价、未过 7 天的待核对咨询会被自动发出，审计里写着 quoted_stage_within_window。当前不是已报价的、以及定金尾款，仍留着等人看。
---
派活等级 L4，写代码模型 Grok 4.7。Ray 2026-11-10 09:28 NZDT 原话：「已报价可以自动回传」。
这覆盖手册 E-21、2026-10-04、2026-10-05、2026-10-29 里「已报价不回传」的写法。质量列的人数仍然不回传。
走现有的批准并发送，含原来的闸和去重。开关默认关，只在数据库变更里给 CTS 打开。成交自动回传不在这次。
上线前要先执行这份变更，并连同「超过时限」那份一起上。本窗口没有改生产数据，也没有调用广告平台。
