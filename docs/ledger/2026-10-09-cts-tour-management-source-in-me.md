---
id: 2026-10-09-cts-tour-management-source-in-me
title: CTS 的团信息（名字/行程）在 Magic Engine 后台统一展示，网站、邮件、内容工厂、客户回复都读同一份；价格和出发日期仍以外部原始系统为准，ME 只读取、不另存可编辑副本；表单先做三项（房型 Double/Twin、两层团下拉、护照自查）
status: decided
owner: agent
decided_on: 2026-10-09
source: session:1a85e0eb
verify_how: 打开 CTS traveller-details 表单，确认有 Double/Twin 房型、两层团下拉、护照自查三项；再确认 ME 后台能看到团信息，且网站、邮件、内容工厂、客户回复读到的是同一份；价格和出发日期在 ME 里只读，改动只能来自原始系统
---
PM 2026-10-09 拍板：团信息源头放在 ME（不放 CTS 网站后台），便于后续功能开发；ME 不管下单，只供网站/邮件/优化读取。
边界（按 ME_PRODUCT_DEFINITION 与 2026-09-14 团管理方案）：价格、出发日期等经营事实留在外部原始系统，由 Connector 只读，ME 只存营销用快照，不做可编辑的第二个事实源；若要改此边界，须先正式修改产品定义并记录例外。
PM 补充（同日）：CTS 网站没有后台，团数据全写在网站代码里，所以放进 ME 正好补上"能在页面里管理"这一块。护照自查方案 PM 已看过认可，做好后由 PM 直接验收。
现状（按实际调用方盘点）：①网站内部读取口返回 33 个团；②`clients.factory_config.render.creatomate.offers`（内容/视频工厂，`src/lib/content/price-fact-gate.ts`）；③`client_knowledge_facts`（客户回复，`src/lib/messenger-agent/tools.ts` 的 `getClientKnowledge`）；④手工 offerings.yaml（无生产调用方，`src/lib/pm-todo/knowledge-fact-expiring-items.ts` 已标注）和一份市场分析副本。需收成一份，否则网站与邮件统一后，工厂与客户回复仍会给出不同团信息。
做法分三步：①traveller-details 表单加房型/两层团下拉/护照自查（网站在 chinatravel 仓库）；②客人档案表（NZ 与中国团队共看）——另立台账卡 2026-10-09-cts-guest-profile-shared-table 单独验收；③团信息统一读取与展示并收拢上述副本（动已上线网站，需 2 审）。
