---
id: 2026-11-14-add-creative-confirm-card
title: 往在投广告组加图片广告，必须先出确认卡
status: done
owner: agent
decided_on: 2026-11-14
source: session:a66a0001
verify_by: 2026-11-21
done_on: 2026-11-14
done_ref: pr:3842
verify_how: 开关默认关。用假 Meta 跑加图卡：确认后按上传图片、建创意、建广告的顺序，新广告为暂停且不改组预算；没批准计划、快照过期、广告组不在投、开关关、卡过期都不调用写接口；图传上去但创意失败时记失败且不再自动重试。
---

复用现有确认卡、开投计划闸和 flywheel_actions。不新建表，不改权限。客户开关在 leads_config.add_creative_card，默认关。要在设置里亲手打开才会出卡。
