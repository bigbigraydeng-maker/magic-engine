---
id: 2026-11-04-consent-gate-known-gaps
title: 出镜授权闸的已知缺口：工厂片不受人脸规则管、广告取片与爆款转广告未接授权闸
status: decided
owner: pm
decided_on: 2026-11-04
source: pr:3573
verify_by: 2026-12-02
verify_how: 开启任一客户的 winner-reel-sync 或广告从工单取片之前，代码里这两条路径已调用 consentVerdict（用途 meta_ads）；工厂片有补授权 / 图库豁免入口后，人脸规则扩到工厂片
---
设计 v0.2 §3.1/§5/§8/§9a 记下的缺口：授权闸的人脸规则本轮只管外部成片——工厂片没有补授权入口，每周补审（v2）又会给它们写人脸数，若一起拦会把带游客 / 图库人物的工厂片成批卡死，所以工厂片里的真人暂时不受闸管；winner-reel-sync（11-04 实测没有客户开启）与广告取片不读 talent_consent。开启这些路径前须先接授权闸。
