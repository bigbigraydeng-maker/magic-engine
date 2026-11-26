---
id: 2026-11-10-partner-page-paused-draft
title: 伙伴主页广告先用客户自己的主页走暂停草稿，伙伴主页编号只从客户配置读
status: done
owner: agent
decided_on: 2026-11-10
source: doc:docs/specs/2026-11-09-a5-launch-type-inventory.md
verify_by: 2026-11-17
verify_how: 相关单元测试里，partner_page 默认身份是客户自己的主页；配置里的伙伴主页编号才会换身份；没权限或没分享时中文拒绝且没有创建；打开只走开投确认卡并先对已批准计划上限。不调用真实 Meta。
done_on: 2026-11-10
done_ref: doc:docs/specs/2026-11-09-a5-launch-type-inventory.md
---
Ray 2026-11-10 02:43 NZDT 同意先做投放侧。类型 partner_page 走现有暂停草稿卡，建成暂停。
身份默认是客户自己的主页。伙伴主页编号只来自该客户 leads_config.ads_partner_page，不写进代码。
缺权限或资产分享时用中文拒绝，不建对象。令牌和权限清单没改。换成伙伴主页仍等 Meta 权限。
