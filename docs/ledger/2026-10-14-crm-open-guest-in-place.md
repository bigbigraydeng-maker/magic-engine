---
id: 2026-10-14-crm-open-guest-in-place
title: 付款总览里点客人，原地弹出客人抽屉，不再跳到全部客人页再跳回来
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2647
source: session:1a85e0eb
verify_by: 2026-10-21
verify_how: 打开付款总览，点任一订单行或客人名字，右边直接滑出客人抽屉并滚到订单与付款；按关闭或 Esc 回到原来的筛选和页码，数字刷新一次；按住 Ctrl 点名字仍可在新标签页打开
---
PM 2026-10-14：点客人资料跳走再回来体验很差，要弹窗。做法：接口加 ids 只取指定客人；新组件 ContactDrawerHost 按编号取人后用同一个抽屉；付款总览三个入口（订单行、名字、没订单名单）改为原地弹出。其他 CRM 页（今天、决策、电话复核、无人认领）本来没有跳到客人的入口，未改。
