---
id: 2026-10-12-cts-2027-departures-backfill-into-catalog
title: CTS 2027 年中国团班期补录进团目录：已录 18 条（新建 8、补返程日与内部字段 10），7 条等 CTS 确认后再录；团目录仍未上架
status: done
owner: agent
decided_on: 2026-10-12
done_on: 2026-10-12
done_ref: doc:docs/clients/cts/2027-departures-master-table.md
source: session:1a85e0eb
verify_by: 2026-10-19
verify_how: 团目录「修改记录」能看到批次 5d1f5b7a 的 18 条改动；2027 中国团班期 19 个，其中 18 个有返程日且配额 20；团目录上架状态仍为「还没上架过」
---
统筹 18 号转 74 号清单（docs/clients/cts/2027-departures-me-backfill-list.md）：经团目录自带「出团表导入」录入（有改前改后、可回滚），只写返程日与内部字段（航司/航段/配额 20），不碰价格、状态、对外字段。
没录 7 条：Natural China 新班期 5 个（档位待 CTS 确认，清单标推断）、Legacy of China 2027-09-03（新建，返程日空，导入规则要求必填）、Legacy of China 2027-05-28（已有，返程日与航段原表为空）。收到 CTS 答复后补录。
