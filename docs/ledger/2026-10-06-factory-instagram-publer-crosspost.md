---
id: 2026-10-06-factory-instagram-publer-crosspost
title: 视频工厂能把 Reel 同步发到客户 Instagram（走 Publer，默认只存草稿）
status: verified
owner: agent
decided_on: 2026-10-06
source: session:ef0c078e
verify_by: 2026-10-09
verify_how: PM 合并，并在 CTS 的客户设置页「其它数据源 → Publer 发布器」里把 Instagram 账号选好保存后，看下一轮工厂发布任务的运行记录里 instagram 一栏第一次出现 drafted（Publer 里多一条草稿），且没有任何一条真发出去；样本≥1 条草稿才算能判。要真发，须 PM 另外显式打开 FACTORY_PUBLISH_LIVE
done_on: 2026-10-17
done_ref: pr:2756
verified_ref: doc:docs/ledger/2026-10-17-publer-removal-2-instagram-crosspost.md
last_checked: 2026-10-19
check_note: 被 Publer 删除 2/N 取代，Instagram 跟发整套下线，本卡无需再验
---
Meta 原生发 Instagram 需要新授权，改授权范围会让现有连接静默断开；Publer 是已买的发布通道且已有 CTS 的 Instagram 账号，所以走 Publer。
适配器、回执、事件都在 src/lib/factory/publish/instagram-*；人工卡点（账号掉线）进今日待办。
Publer 真接口本次没能真连验证（本机没有 Publer 钥匙）：请求体沿用 Facebook 孪生调用已验证形状，首次真连即上述草稿验证。
已被 Publer 删除 2/N 取代（见 2026-10-17-publer-removal-2-instagram-crosspost），本卡关闭。
