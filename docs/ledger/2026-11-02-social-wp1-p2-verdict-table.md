---
id: 2026-11-02-social-wp1-p2-verdict-table
title: 社媒读回的判定表只写进仓库，生产库先不建
status: done
owner: agent
decided_on: 2026-11-02
source: doc:docs/specs/2026-10-29-social-wp1-readback-implementation-brief-v2.md
verify_by: 2026-11-09
verify_how: PM 回 go apply 后，空库能建出判定表；若已有重复的 Story 动作行，迁移整份回滚且不删行。开关不是正好 true 时不写判定行。
done_on: 2026-11-02
done_ref: commit:54692ec9b011ad28e6ef0d9121b9b588dece7cb0
---
判定表和 Story 防重复索引只在迁移文件里，没有在任何库执行。
重复的 Story 动作行只做计数预检，发现重复就整份回滚，不删行。
写入函数默认关。冲突复用已有的读回失败记录，不覆盖旧判定。
规格是社媒读回实施说明里的 P2。删客户的授权步骤不在这一包。
验收看迁移预检和空库约束，不要连生产库。
