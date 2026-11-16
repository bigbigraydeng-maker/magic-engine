---
id: 2026-11-17-cts-brochure-callback-request-slice2
title: 在线手册第二刀：客人在 CTS 官网在线手册上按「请打电话给我」（选日子和上午/下午/晚上），ME 记成客人一条往来，AI 跟进停、交员工、进回电日历
status: decided
owner: agent
decided_on: 2026-11-17
source: session:96dc6edf
verify_by: 2026-11-24
verify_how: 两张改动单上线后，用测试客人从目录信点进官网 /brochure 按一次「请打电话给我」，contact_touchpoints 里多一行 source=site_callback_request、channel=web_form、metadata.callback_at 是所选那天的上午10点/下午2点/晚上6点（新西兰时间）；客人资料页时间线显示「官网手册：客人请我们打电话 · 某月某日 下午」；员工名单里这位排在「客户回话了」最前；同一选择重复按只一行；没从邮件点进来的访客看不到这个按钮
---
PM 11-17 回「开始手册页」。方案 docs/specs/2026-11-17-cts-online-brochure-tracking-v0.md 第 9 节第 2 刀，本刀落地时定的几处（见方案 §12）：

- ME 新开对外接口 `/api/public/crm/site-callback-request`（A 级：新的公开入口）。凭证同点击接口：邮件链接里的 12 位标记；只写一行往来记录，不发任何东西。
- 只记「请打电话给我」，**不单独记小测答案**：网站表单类的往来记录在 came-back、别再联系解除、回头客等处都会被当成「客人开口了」，小测不是开口；小测答案只跟着回电请求一起记。客人点推荐的团会照常记成「在官网看了某团」。
- 页面上**先不放 PDF 下载**：现在那份 PDF 里还有已下架的圣诞团（官网 delisted-tours 登记里已有待重新导出的卡）。
- 不改数据库。
