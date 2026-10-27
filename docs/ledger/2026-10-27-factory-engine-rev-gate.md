---
id: 2026-10-27-factory-engine-rev-gate
title: 出片机要报代码版本，太旧就不派新单
status: done
owner: agent
decided_on: 2026-10-27
source: doc:docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md
verify_by: 2026-10-29
verify_how: 用一张不带价格的明信片在当前代码出片后，成片记录里有代码版本；故意用旧出片机领单会被拒绝，工单仍在队列里，待办写明怎么在 Mac 上更新。19 秒成片体积超过上限约一成会被体检拦住。
done_on: 2026-10-27
done_ref: pr:3333
---

出片机领单和交片时上报模板目录号和代码版本，版本写在工单已有的成片记录里，不加新表。缺目录能力就拒绝派单，队列保留。成片体检按码率公式加一成余量核对体积。
