---
id: 2026-10-12-story-publish-slice2a-gates
title: Story 发布第二刀 a（离线闸门零件 + 建表 SQL 只写不执行）：没有任何调用方，建表 / 真实 Meta 调用 / 周包真上传 / 真发都没批
status: decided
owner: pm
decided_on: 2026-10-12
source: session:61a3b5f4
verify_by: 2026-10-19
verify_how: 看第二刀 a 的 PR 是否合并；看 PM 是否另批「建表」（没批就不得执行 docs/migrations-sql 里的 SQL）；看第二刀 b（授权 / 撤销接口、事件、预览墙、真实入库调用）是否已另开且仍默认只演练
---
零件：数据契约、内容指纹、授权判断、发布闸（fail-closed，默认只演练）、回执构造（不许伪造提供方回执）、周包入库（读写都经注入接口，不碰真实存储）。全部纯函数，无调用方。
建表 SQL 只放在 docs/migrations-sql/2026-10-12-story-auto-publish-NOT-APPLIED.sql，未执行；已在本机临时数据库验证语法与 5 条约束，临时库已删。
设计稿：docs/specs/2026-10-12-story-auto-publish-design.md。
