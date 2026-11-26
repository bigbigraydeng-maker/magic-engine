---
id: 2026-11-10-ads-target-cpl-shared
title: 熔断和素材建议共用客户自己的目标线索成本
status: done
owner: agent
decided_on: 2026-11-10
done_on: 2026-11-10
done_ref: pr:3714
source: doc:docs/ledger/2026-11-09-ads-circuit-breaker-propose-pause.md
verify_by: 2026-11-12
verify_how: 客户设置里的目标、熔断配置、已批准计划三处若数字不一致，当天不出线索成本暂停卡，也不出素材建议卡。只填客户设置时，两处用同一个数。仓库里没有写死金额。
---
目标线索成本只从客户设置、熔断配置或已批准计划读。三处都空，或数字对不上，就当没配，不出卡。
不新加表，也不在仓库里写死某个客户的金额。要让某个客户用上这个数，得在现有客户设置里填写，不能靠改代码。
