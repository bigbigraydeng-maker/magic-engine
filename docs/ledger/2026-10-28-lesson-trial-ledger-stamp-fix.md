---
id: 2026-10-28-lesson-trial-ledger-stamp-fix
title: 经验对照试验台账不再抄迁移文件名里的长数字，主干台账检查才能读这张卡
status: decided
owner: agent
decided_on: 2026-10-28
source: pr:3325
verify_by: 2026-11-02
verify_how: 本 PR 合并进主干后，在主干跑 npx vitest run src/lib/ledger，退出码为 0；Ledger entries valid 不再因经验对照试验那张卡变红
---
经验开/关对照试验那张卡正文写了迁移文件名里的长数字，台账把它当成账户号，主干台账检查因此变红。
修法只改那张卡的正文：长数字换成通配文件名，仍指向同一份新表迁移。文件头没改，代码和迁移文件没动。
本卡指向本 PR，用来满足「改了台账必须有一张新建卡或指向本 PR」的检查。
