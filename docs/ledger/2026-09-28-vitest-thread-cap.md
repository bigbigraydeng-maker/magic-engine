---
id: 2026-09-28-vitest-thread-cap
title: vitest 加进程数上限——防止多窗口同时跑测试压垮机器
status: done
owner: agent
decided_on: 2026-09-28
source: session:d63d16ff
verify_how: 合并后观察一周内是否还发生"多窗口同时跑测试导致机器要手动 pkill"的情况；没有就算验过
verify_by: 2026-10-05
done_on: 2026-09-28
done_ref: pr:2164
---

`vitest.config.ts` 加 `pool: 'threads'` + `poolOptions.threads.maxThreads: 2`，把每个窗口的 vitest 子进程峰值从原本吃满全部核心（本机 10 个）压到最多 2 个。
起因：多窗口并发跑测试观测到 26 个 vitest 进程，PM 手动 `pkill`；小秘书先广播临时手动参数应急，这个 PR 是永久修法。
