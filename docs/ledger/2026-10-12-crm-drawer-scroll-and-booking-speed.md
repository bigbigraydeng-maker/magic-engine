---
id: 2026-10-12-crm-drawer-scroll-and-booking-speed
title: CRM 客人抽屉滚轮会带着背后的页面走已修；付款进度读取从串行查库改成并行（管理员 6→4 次、名单员工 8→5 次来回），并加上耗时记录头
status: done
owner: agent
decided_on: 2026-10-12
done_on: 2026-10-12
done_ref: pr:2502
source: session:1a85e0eb
verify_by: 2026-10-19
verify_how: PM 在 CRM 全部客人页打开任意客人抽屉，鼠标滚轮只让抽屉里的内容滚动、背后的列表不动；浏览器开发者工具里付款进度接口的 Server-Timing 头能看到 gate 与 total 毫秒数，比上线当天快
---
PM 2026-10-12 录屏反馈：抽屉里滚轮不生效（背后列表被带着滚）、加载慢。修法：抽屉滚动区 overscroll-contain，抽屉打开时锁住页面滚动；付款进度接口把互不依赖的查询并行（权限判断的先后顺序与结果不变，24 条组合测试固定）。
没验证：真实登录页面上的滚动手感与线上耗时（助手无法登录），以 Server-Timing 实测为准；如整个 CRM 页本来就慢要另查。
