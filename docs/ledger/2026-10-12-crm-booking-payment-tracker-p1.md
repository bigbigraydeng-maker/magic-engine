---
id: 2026-10-12-crm-booking-payment-tracker-p1
title: CRM「订单与付款进度」第一版（只追踪付没付和到期日，不记金额）：设计稿 v0.2 已过三位审查，PM 选名单制（info、baker），开始分步开发
status: decided
owner: agent
decided_on: 2026-10-12
source: session:1a85e0eb
verify_by: 2026-10-26
verify_how: CTS 名单内账号在 CRM 客人页能加订单、勾定金尾款、看到「付款要催」名单；名单外的 CTS 账号看不到；到期日与官网条款一致（定金预订后 3 个工作日、尾款出发前 90/120 天）
---
设计稿 docs/specs/2026-10-12-crm-booking-payment-tracker-design-v0.2.md；审查：子牙（架构）、魏征（挑刺）、板桥（员工视角）。
分三步：P1-a 数据库与到期日计算；P1-b 接口与名单闸；P1-c 页面。邮件自动勾选（P3/P4）等手工版用满约一个月再排期。
