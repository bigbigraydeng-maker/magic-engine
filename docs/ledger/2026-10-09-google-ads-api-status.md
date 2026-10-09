---
id: 2026-10-09-google-ads-api-status
title: 谷歌广告接口已有令牌但只是最低级别，登记公司名写错，系统里零数据
status: decided
owner: pm
decided_on: 2026-10-09
source: doc:docs/audits/2026-10-09-google-ads-api-status.md
verify_by: 2026-11-09
verify_how: 对照审计文档 §6 复查三项：①Cloud Console 项目 compass-489509 的 Google Ads API 访问级别；②Render 服务 crazycontent 上 GOOGLE_ADS_* 五项环境变量是否仍然一个都没有（只看键名有无，不看值），以及 docs/ENV.md 109-110 行两个错误的 ✅ 是否已更正；③CTS 的 China Travel 账户（CID 105-817-1329）是否恢复投放。都没动就把日期往后挪并写明原因
---
三项只读核查结论见 [[2026-10-10-google-ads-api-basic-upgrade]] 与审计文档 §6：级别当时为最低档、线上五个密钥一个都没有、CTS 账户只有两条搜索广告且 9 月起零曝光。
登记公司名当时为错误主体（已于 2026-10-10 更正，见新卡）。生产库无任何谷歌广告数据，CTS 谷歌账户未绑进 ME。
按 §11 三维打分：频率低 / IMPACT 中 / 收入低 → P3；CTS 欠费停投另判 P1。
