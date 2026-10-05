---
id: 2026-10-06-factory-instagram-publer-crosspost
title: 视频工厂能把 Reel 同步发到客户 Instagram（走 Publer，默认只存草稿）
status: decided
owner: agent
decided_on: 2026-10-06
source: session:ef0c078e
verify_by: 2026-10-09
verify_how: PM 合并并在客户设置页填好 CTS 的 Instagram（Publer 账号 ID）后，看下一轮工厂发布任务的运行记录里 instagram 一栏第一次出现 drafted（Publer 里多一条草稿），且没有任何一条真发出去；样本≥1 条草稿才算能判。要真发，须 PM 另外显式打开 FACTORY_PUBLISH_LIVE
---
Meta 原生发 Instagram 需要新授权，改授权范围会让现有连接静默断开；Publer 是已买的发布通道且已有 CTS 的 Instagram 账号，所以走 Publer。
适配器、回执、事件都在 src/lib/factory/publish/instagram-*；人工卡点（账号掉线）进今日待办。
Publer 真接口本次没能真连验证（本机没有 Publer 钥匙）：请求体沿用 Facebook 孪生调用已验证形状，首次真连即上述草稿验证。
