---
id: 2026-10-09-google-ads-api-status
title: 谷歌广告接口已有令牌但只是最低级别，登记公司名写错，系统里零数据
status: decided
owner: pm
decided_on: 2026-10-09
source: doc:docs/audits/2026-10-09-google-ads-api-status.md
verify_by: 2026-11-09
verify_how: 三件事已于 2026-10-09 第二轮核实完，见审计文档 §6。到期复查这三项：①Google Cloud Console 项目 compass-489509 的 Google Ads API 访问级别是否仍是 Explorer（Explorer 下关键词规划类服务不可用，升 Basic 需先过 Brand Verification）；②谷歌开发者资料的公司名是否仍是已更正的 Magic Engine AI Technology Limited（2026-10-10 由 ABC Plus Home Pty Limited 改过来，见审计文档 §7）；③Render 服务 crazycontent 的环境变量里 GOOGLE_ADS_* 五项是否仍然一个都没有（只看键名有无，不看值），以及 docs/ENV.md 109-110 行那两个错误的 ✅ 是否已更正；④CTS 的 China Travel 账户（CID 105-817-1329）是否恢复投放（9 月起因欠费零曝光）。⑤访问级别是否仍是 Basic（2026-10-10 已由 Explorer 升到 Basic，品牌认证已发布，见审计文档 §8.4）。都没动就把日期往后挪并写明原因
---
Google 已改规则：令牌不再是门槛，级别只在 Cloud Console 管。当前级别 Explorer，登记公司名为 ABC Plus Home Pty Limited（不符）。
代码早已就绪但无建视频系列能力；生产库无任何谷歌广告数据；CTS 谷歌账户 China Travel 存在但未绑进 ME。

2026-10-09 第二轮只读核查补充（详见审计文档 §6）：
- 真实级别 = Explorer（Cloud Console 项目 compass-489509 实测），每天 2,880 次生产调用，能读能写真实账户，但关键词规划整条线在这一级被禁 —— 仓库里已写好的 keyword-planner 调不通。升 Basic 必须先过 Brand Verification。
- 线上 Render 根本没有那五个 GOOGLE_ADS_* 环境变量，docs/ENV.md 标的 ✅ 是错的；该接口 30 天零调用。
- CTS 的 China Travel 账户只有 2 条搜索广告、从没投过 YouTube/视频；近 90 天花 NZD4,048.33、269 次转化但未设主要转化；9 月 1 日起因「超过付款额度、服务可能被暂停」零曝光 —— 这件事按 §11 判为 P1，接口本身判为 P3。

2026-10-10 改动回执：Google Ads 管理账户 CID 393-489-3847 的 API 开发者资料里，公司名已由 ABC Plus Home Pty Limited 改为 Magic Engine AI Technology Limited（PM 本人授权，权威件为 Dropbox 里的新西兰公司注册证书 4002043 / NZBN 9429030519763），重新加载整页已验证；其余字段未动，可随时改回。第 4 步「申请升到 Basic / 品牌认证」被本机安全闸拦下，未向谷歌提交任何东西，等 PM 对这一动作再授权一次。

2026-10-10 续：PM 本人点了 Verify branding，谷歌判定**通过**，但结果 7 天内不发布即作废——**截止 2026-10-17，需点 Branding 页的 Publish branding**（这一下点击本机安全闸不放行，须 PM 本人点）。同日把 Google Ads API 联系邮箱由 raydeng@magicengine.com.au 改为 hello@magicengine.cloud（已重载验证）。Google Cloud 的 User support email 改不了（下拉框只有 bigbigraydeng@gmail.com，无可选群组），且它属于品牌认证审查内容，改动会把认证打回草稿——必须先发布再谈改。

2026-10-10 结果：品牌认证已发布（状态「verified and is being shown to users」），Google Ads API 访问级别**已升到 Basic**——生产账户 15,000 次/天、全功能，Explorer 下被禁的关键词规划服务随之解除。Standard 未申请（当前用量用不上，申请需 10-15 个工作日审核）。**接口仍跑不起来：线上五个 GOOGLE_ADS_* 环境变量依然一个都没有，这才是下一个卡点。**
