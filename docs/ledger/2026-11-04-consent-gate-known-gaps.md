---
id: 2026-11-04-consent-gate-known-gaps
title: 出镜授权闸的已知缺口：工厂片仍用马良 v1 不看人脸、广告取片与爆款转广告未接授权闸
status: decided
owner: pm
decided_on: 2026-11-04
source: pr:3573
verify_by: 2026-12-02
verify_how: 开启任一客户的 winner-reel-sync 或广告从工单取片之前，代码里这两条路径已调用 consentVerdict（用途 meta_ads）；工厂片是否切马良 v2 有 PM 结论（牵涉每条约 0.05 美元）
---
设计 v0.2 §3.1/§5/§8 记下的缺口：工厂出品的片目前仍走马良 v1，没有人脸信息，授权闸对工厂片里的真人照片无效；winner-reel-sync（11-04 实测没有客户开启）与广告取片不读 talent_consent。开启这些路径前须先接授权闸。
