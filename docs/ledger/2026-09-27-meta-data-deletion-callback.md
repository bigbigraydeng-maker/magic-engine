---
id: 2026-09-27-meta-data-deletion-callback
title: Facebook 数据删除回调与说明页：用户在 Facebook 里移除 Magic Engine 并要求删数据时，自动撤销他在所有客户下的广告只读连接、清空授权和报告内容，并给他确认码查进度（Meta 审核必填）
status: done
owner: pm
decided_on: 2026-09-27
source: session:4bb834a6
done_on: 2026-09-27
done_ref: pr:2111
verify_by: 2026-10-04
verify_how: 迁移执行、PR 合并上线后，用应用密钥给一个不存在的 Facebook 编号签一个删除请求发到 https://app.magicengine.com.au/api/meta/data-deletion ，应返回确认码；打开返回的进度链接显示「没有存这个 Facebook 账号的数据」；数据库 meta_data_deletion_requests 多一行 no_data，任何连接不变。说明页 https://app.magicengine.com.au/data-deletion 不登录能打开。不成：先查迁移是否已执行（函数 meta_process_data_deletion 是否存在）。
last_checked: 2026-10-13
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
设计：docs/specs/2026-09-27-magic-bridge-self-serve-open-design.md §8.5（分支 chore/mb-open-eval）。
审查：设计两轮 子牙 + 魏征 + 板桥；实施后 子牙 + 魏征 + 板桥 + 狄仁杰（攻击验证），全部阻塞问题已修。
验证：本机一次性 PostgreSQL 32 项、单元测试 732 条、变异探针 20/20。
上线前需 PM 授权执行数据删除那条数据库迁移（2026-09-27 已授权并执行），再合并（A 级）；之后 PM 在 Meta 应用后台填删除网址与回调。
后续：授权状态签名与删除回调共用同一把应用密钥（狄仁杰低风险项），另开任务。
