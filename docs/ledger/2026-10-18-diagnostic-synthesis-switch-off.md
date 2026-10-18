---
id: 2026-10-18-diagnostic-synthesis-switch-off
title: 华佗诊断 AI 叙事写入必报错却照花模型费，PM 已在 Render 把开关关掉，修好后再开
status: done
owner: pm
decided_on: 2026-10-18
source: session:ec90bb17
done_on: 2026-10-18
done_ref: doc:docs/ledger/2026-10-18-diagnostic-synthesis-switch-off.md
verify_by: 2026-10-20
verify_how: 10-19 周一 diagnostic-weekly 跑完后确认没再调大模型写叙事、Anthropic 用量无周一尖峰；95 号修好写入 bug 合并后把 DIAGNOSTIC_SYNTHESIS_ENABLED 改回 true
---
根因（95 号）：diagnostic_narratives 的 upsert onConflict 对不上表达式唯一索引，报 42P10，错误被吞；模型调用在写入之前，照花钱；限流判据依赖表里有行，表空则永不限流。
PM 10-18 在 Render 设 DIAGNOSTIC_SYNTHESIS_ENABLED=false 并已部署。空花总额是上限估算 US$26–129，未核实。
