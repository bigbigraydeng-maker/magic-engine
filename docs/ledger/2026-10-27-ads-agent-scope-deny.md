---
id: 2026-10-27-ads-agent-scope-deny
title: 广告 Agent 的钥匙默认不能批准、开投或改预算
status: done
owner: agent
decided_on: 2026-10-27
source: issue:3198
verify_by: 2026-10-28
verify_how: 用带新范围的测试钥匙调用批准、开投、改预算、改上限、上传名单和写 Meta，应得到拒绝，并在访问记录里留一行。不发真钥匙，不写生产库。
done_on: 2026-10-27
done_ref: pr:3247
---

广告 Agent 只许读计划种子和保存草稿。其它动作默认拒绝。发钥匙和两个正式接口留在后面的刀。
