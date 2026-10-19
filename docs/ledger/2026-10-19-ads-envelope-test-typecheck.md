---
id: 2026-10-19-ads-envelope-test-typecheck
title: 修复广告信封事实测试的动作类型清单
status: done
owner: agent
decided_on: 2026-10-19
source: pr:2905
verify_by: 2026-10-20
verify_how: 主干完整类型检查通过，广告能力相关测试通过，且生产执行代码不变。
done_on: 2026-10-19
done_ref: pr:2911
---
测试夹具补齐已有动作，并让帮助函数从夹具键推导允许的动作；不改变生产广告行为。
