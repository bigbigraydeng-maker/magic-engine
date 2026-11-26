---
id: 2026-11-10-social-story-register-dry-run
title: Story 发出后登记默认关，关着只留演练记录
status: decided
owner: agent
decided_on: 2026-11-10
source: doc:docs/handoffs/2026-11-01-social-agent-handover-97.md
verify_by: 2026-11-17
verify_how: 开关仍关时，一条已发出的 Story 在运行记录里有演练行，带上帖子编号和发出时间，且没有写成已发布动作。打开该客户的登记开关后，同一条才写入已发布动作。
---
总开关或客户开关不是正好打开时，不写已发布动作，只留一行演练记录。
失败（对不上、写不进）留失败记录，不悄悄跳过。
不调用对外发布接口。客户配置里没有这一项等于关。
