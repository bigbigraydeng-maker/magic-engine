---
id: 2026-10-09-cts-tour-management-source-in-me
title: CTS 的团信息（名字/行程/价格/出发日期）以后由 Magic Engine 后台统一管理，网站和邮件都来读它；表单先做三项（房型 Double/Twin、两层团下拉、护照自查）
status: decided
owner: agent
decided_on: 2026-10-09
source: session:1a85e0eb
---
PM 2026-10-09 拍板：团信息源头放在 ME（不放 CTS 网站后台），便于后续功能开发；ME 不管下单，只供网站/邮件/优化读取。
PM 补充（同日）：CTS 网站没有后台，团数据全写在网站代码里，所以放进 ME 正好补上"能在页面里管理"这一块，也便于以后在 ME 里管理 CTS 的其他功能。护照自查方案 PM 已看过认可，做好后由 PM 直接验收。
现状：网站内部读取口返回 33 个团，另有手工 offerings.yaml 和一份市场分析副本，共三处，需收成一份。
做法分三步：①traveller-details 表单加房型/两层团下拉/护照自查（网站在 chinatravel 仓库）；②客人档案表（NZ 与中国团队共看）；③团管理后台并收拢三份副本（动已上线网站，需 2 审）。
