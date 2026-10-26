---
id: 2026-10-12-story-lite-shelved-parts
title: 旧 8 表方案里搁置不用的零件（已合并但没有调用方，建表 SQL 作废）
status: decided
owner: pm
decided_on: 2026-10-12
source: session:61a3b5f4
verify_by: 2026-10-26
verify_how: 到期时问 PM：这些搁置的零件是删掉还是继续留着；留着就不得有人当成现行方案接线
---
搁置不用（已合并，无调用方）：src/lib/social/story-publish 下的 gates / authorization / evaluate / preview / authorize / 两个 store / pack-ingest / 旧 4 个接口 story-packs，以及旧 8 表建表 SQL（已标注作废）。
仍在用：Facebook / Instagram 发布适配器（src/lib/meta/page-stories.ts、instagram-stories.ts、story-graph.ts）和 story-publish/file-check.ts。
最小版代码在 src/lib/social/story-lite；新接口在 /api/clients/[id]/story-lite。
