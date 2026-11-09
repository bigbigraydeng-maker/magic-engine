---
id: 2026-10-12-publer-legacy-entries-close-account-fallback
title: 旧发布入口关门：删掉“账号找不到就拿第一个”、账号必须属于该客户、发完写库必须检查报错
status: decided
owner: agent
decided_on: 2026-10-12
source: doc:docs/roadmap/2026-10-12-platform-lead-s0-and-migration-ledger-v0.md
verify_by: 2026-10-20
verify_how: 在仓库里搜 accounts[0] 回退，发布相关代码应为 0 处；账号不属于该客户的请求被拒绝有测试证明；写库后检查 error 的测试存在。没合并就是没做。
---
范围见文档 §2.2 与派工单 81（Publer 旧入口）、82（工厂工作器）。目前没有任何客户配置 Publer，属于关门不是救火；A 级，需 PM 本人回「合」。
