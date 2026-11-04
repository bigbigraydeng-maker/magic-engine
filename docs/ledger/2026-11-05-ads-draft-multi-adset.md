---
id: 2026-11-05-ads-draft-multi-adset
title: 起草广告支持同一系列下多个广告组（全程暂停、逐组回读、系列花费上限），用于老曹拆组实验的臂 2
status: done
owner: agent
decided_on: 2026-11-05
source: session:90a50c3b
risk: A
verify_by: 2026-11-12
verify_how: 合并部署后，74 号用 meta-ads/draft 接口建老曹臂 2（1 个系列 3 个广告组，全暂停），读回逐组为暂停、日预算 9.5/10/10.5、系列花费上限 42000，账本只记 adSetIds
done_on: 2026-11-05
done_ref: pr:3618
---
发布器、回读和核对都支持多个广告组（最多 5 个，留资/看完视频，预算在组上）；多组草案账本只记 adSetIds，「开」按钮和 go-live 卡因此读不到单个 adSetId，开不了。
不做：私信类型多组、系列预算、开投。后续：回读里看不到表单编号目前只提醒不拦，线上建出臂 2 后确认 Meta 是否回显，回显就升级成拦。
