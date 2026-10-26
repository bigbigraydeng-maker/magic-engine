---
id: 2026-10-25-prescription-approve-no-kanban
title: 批准处方不再往看板上生成待办
status: done
owner: agent
decided_on: 2026-10-25
source: doc:src/lib/diagnostic/prescription-landing.ts
verify_by: 2026-10-28
verify_how: 合并部署后，在旧处方页点批准：目标下仍出现阶段，看板上不新增待办，处方变为已批准并记下批准人。
done_on: 2026-10-25
done_ref: commit:52902502f96b86fbb7f773c7f963a390262065c7
---
批准只保留目标下的阶段，并标成已批准。不再插入看板上的待办，待办生成失败也不再让批准失败。
周二自动开方仍会自动批准。它跟这条批准共用同一段落地，所以也会不再生成看板待办。是否改成只存草稿，等 Ray 定。
