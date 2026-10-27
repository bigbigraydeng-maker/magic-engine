---
id: 2026-10-27-kernel-arch-rpc-timeout-only
title: 架构检查只放过一种已知的测试工具超时
status: done
owner: agent
decided_on: 2026-10-27
source: pr:3307
verify_by: 2026-10-30
verify_how: 本 PR 的 Kernel architecture test 为绿。另用一条不是 onTaskUpdate 超时的未处理拒绝跑同一套豁免，进程必须失败。
done_on: 2026-10-27
done_ref: pr:3307
---
架构测试 203 条都能过，但测试工具偶发报 onTaskUpdate 超时，整次检查被判失败。
不能因此关掉所有未处理错误，否则真的异步失败也会变绿。
只放过这一条已确认的超时。别的未处理拒绝或异常仍然让检查失败。
