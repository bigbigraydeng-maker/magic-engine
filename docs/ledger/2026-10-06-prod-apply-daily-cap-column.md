---
id: 2026-10-06-prod-apply-daily-cap-column
title: 生产库已补上「每个广告户每日上限」栏位（PM 回「补列」授权）；执行当时栏位为空
status: done
owner: pm
decided_on: 2026-10-06
done_on: 2026-10-06
done_ref: doc:docs/audits/2026-10-06-prod-ad-account-cap-column-and-values.md
source: session:ec90bb17
verify_by: 2026-10-13
verify_how: 生产库只读查 client_meta_ad_accounts 表存在该栏位且可空、约束在；再当场不外发试跑一次经 Kernel 的人工止损，确认暂停不再被「账户级日上限未配置」拒。
---
执行记录、前后对比、回滚办法都在 done_ref 指向的审计文档，账户号与项目号不在台账里复述。
