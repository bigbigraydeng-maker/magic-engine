---
id: 2026-11-25-cyhb-ads-expand-to-auckland-region
title: CYHB 两组在投广告的投放地区从「奥克兰市中心 10 公里」改成整个奥克兰大区（PM 11-25 回「扩到大奥克兰」「合并上线 151」）；新版 ME 补了「改已有广告组投放地区」能力
status: done
owner: pm
decided_on: 2026-11-25
source: session:9505aeb2
verify_how: 从 Meta 读回 120249314357750179、120249327652000179 两组 targeting.geo_locations 只有 regions key 2724（Auckland Region），没有 10 公里圈；性别女、35–65 岁、日预算各 NZ$20 不变
---
起因：PM 以为广告投了全国。实查不是：三组都是奥克兰市中心 10 公里圈，按地区拆分 100% 花在 Auckland Region。PM 决定扩到整个大奥克兰。
新版 ME 原来只能改兴趣/年龄/性别，不能改地区。改动单 magic-engine-dev/magic-engine-platform#151（ads.act 新增 regions/locations、ads.targeting_search 新增 type=regions，改完从 Meta 读回核对，旧圈没消失算失败自动撤回）。独立审查提出的自动撤回误触发风险已修。合并 5d33ff1，手动部署 run 45465984815 deploy success。
2026-11-25 经新版 ME ads.act 改了两组：到店点击组 run 1ef8175e、WhatsApp 组 run 23a109e0，ME 均回 verified。直接从 Meta 读回：两组 geo_locations = Auckland Region(2724)，10 公里圈已去掉，其他不变。到店点击组读回时已恢复 ACTIVE，WhatsApp 组显示「审核中」（改定向后 Meta 重审，正常）。
没动：已暂停的 Messenger 组仍是 10 公里圈。两组会重新进入学习期，前几天成本可能波动。
