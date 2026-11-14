---
id: 2026-10-29-social-metrics-asset-layers-design
title: 社媒指标分四级、社媒素材库与客户素材库打通并分平台行业客户三层的设计稿，待子牙魏征复审
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-social-metrics-and-asset-library-layers-v0.1.md
verify_by: 2026-11-05
verify_how: 看设计稿是否已过子牙和魏征复审、PM 是否回了第 6 节两个问题；第一步指标实测（CTS，只读）有没有开工；本卡不授权改任何代码、不授权写客户数据
---
PM 2026-10-29：社媒指标需要想清楚；社媒素材库要和客户在 ME 的素材库打通，分平台、行业、客户三层。
推荐目标落在社媒自然渠道归因线索数，私信会话数作先导，互动数只作测试信号；能否分开自然与付费、能否按单条拆都未验证，先实测。
素材库不另建，沿用现有 ownership 与 source 字段，补素材到内容的连接。
