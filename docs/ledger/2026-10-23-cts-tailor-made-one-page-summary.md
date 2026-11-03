---
id: 2026-10-23-cts-tailor-made-one-page-summary
title: 给「定制行程单」页面加一个一键生成「一页简化版」摘要的功能，给客人/旅行社看
status: decided
owner: agent
decided_on: 2026-10-23
source: session:8d76116b
verify_how: 查「定制行程单」页面有没有这个一页摘要导出功能；没有就还没做
---
CTS 需求（PM 10-23 转达，也就是之前微信里说的「一页简化版（无锡生成）」，无锡是口误/误记，跟城市无锡无关）：围绕 ME 已有的「定制行程单」页面（`src/app/dashboard/clients/[id]/tailor-made/`），加一个功能——从已做好的定制行程方案一键生成一份「简化版一页纸」摘要，给客人或旅行社看，不是完整多日详细行程文档。

平台层级判定（已过 `me-platform-tier-gate` skill，Inline 模式）：归 L4（CTS 专属，目前只有 CTS 用这个页面），不是新能力线，不用登记候选表；实现时用通用字段（不写死 CTS 专属措辞），以后有别的旅游客户要用时能顺带复用，不用现在额外处理。

下一步：排一个窗口设计并实现这个导出功能。
