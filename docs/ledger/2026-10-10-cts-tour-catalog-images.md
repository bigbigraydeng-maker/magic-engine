---
id: 2026-10-10-cts-tour-catalog-images
title: 团目录里要能管理每个团的图片（PM 2026-10-10 提出）；建议复用现有客户素材库，把照片挂到具体的团上，等团目录第一版上线后单独做
status: decided
owner: agent
decided_on: 2026-10-10
source: session:1a85e0eb
verify_how: 团目录页里每个团能看到并修改主图和图集；官网 33 个团的图片地址与目录读入后一致（见 field-gap 卡）
---
PM 在团目录本机测试期间提出「系统里也要能管理 Tour 的图片」。
现有客户素材库（client_assets）已支持把照片挂到地产客户的具体房源（listingId），团图片应复用同一机制加团的挂载点，不另建图片库；需动素材库结构，属 A/B 级，另开设计与双审。
排期：团目录 P1a（PR #2383）上线后再做，不混入当前改动。
