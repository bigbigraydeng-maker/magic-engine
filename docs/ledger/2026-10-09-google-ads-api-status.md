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
Google 已改规则：令牌不再是门槛，级别只在 Cloud Console 管。当前级别 Explorer，登记公司名为 ABC Plus Home Pty Limited（不符）。
代码早已就绪但无建视频系列能力；生产库无任何谷歌广告数据；CTS 谷歌账户 China Travel 存在但未绑进 ME。
