---
id: 2026-10-06-cts-launch-budget-headroom-deepseek-crosscheck
title: 预算核算函数原本是 Claude Code 自写的（违反「代码全部 DeepSeek 写」），已让 DeepSeek 只看接口说明独立重写并对拍：3005 组样本逐项一致，保留现有文件
status: done
owner: agent
decided_on: 2026-10-06
done_on: 2026-10-06
done_ref: doc:docs/ledger/evidence/2026-10-06-launch-budget-headroom-crosscheck.md
source: session:f11d56a9
verify_by: 2026-10-13
verify_how: 看证据文件里的对拍结果是否仍是「3005 组一致」，且 PR2285 与 PR2309 的 PR 正文已把「DeepSeek 0 轮」改成「已独立重写对拍，一致」；之后若有人改 launch-budget-headroom.ts，必须重跑同一份对拍。
last_checked: 2026-10-13
---
DeepSeek 1 轮约 $0.003，我的 13 个测试对它全过；对拍脚本变异检验能抓到差异。
原因文字和判定先后不比；与 Kernel 口径之间仍没有自动对账。没动任何广告账户和生产库。
