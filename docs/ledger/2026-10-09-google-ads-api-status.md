---
id: 2026-10-09-google-ads-api-status
title: 谷歌广告接口已有令牌但只是最低级别，登记公司名写错，系统里零数据
status: decided
owner: pm
decided_on: 2026-10-09
source: doc:docs/audits/2026-10-09-google-ads-api-status.md
verify_by: 2026-11-09
verify_how: 到期看是否已在 Google Cloud Console 查到真实访问级别、公司名是否更正、Render 五个环境变量是否确有值；三项都没动就把日期往后挪并写明原因
---
三项只读核查结论见 [[2026-10-10-google-ads-api-basic-upgrade]] 与审计文档 §6：级别当时为最低档、线上五个密钥一个都没有、CTS 账户只有两条搜索广告且 9 月起零曝光。
登记公司名当时为错误主体（已于 2026-10-10 更正，见新卡）。生产库无任何谷歌广告数据，CTS 谷歌账户未绑进 ME。
按 §11 三维打分：频率低 / IMPACT 中 / 收入低 → P3；CTS 欠费停投另判 P1。
