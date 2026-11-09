---
id: 2026-11-02-manual-rx-supersedes-approved
title: 同一目标的新手动处方草稿记下要替换的已批准版本
status: done
owner: agent
decided_on: 2026-11-02
source: pr:3515
verify_by: 2026-11-09
verify_how: 同一目标再存一版手动草稿，supersedes_id 指向该目标最新已批准处方；批准新版后旧版变为已替换，未批准的草稿不改旧版状态。
done_on: 2026-11-02
done_ref: pr:3515
---
手动入库以前总写空的替换指针，批准时旧版不会被换下，已批准处方也无法撤回。
只补入库时的指针。批准动作仍走原来的落地。处方链和每周复查本来就不把已替换的行当成还在用。
