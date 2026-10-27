---
id: 2026-10-26-remotion-multi-aspect
title: 一张视频工单可以按要求同时出竖版、方版和横版，不要求就还是只出竖版
status: done
owner: agent
decided_on: 2026-10-26
source: session:4692e3b0
verify_by: 2026-10-29
verify_how: 抽一张写了多个画幅的 Remotion 工单（测试数据即可），交片记录里应有竖版主文件，以及方版或横版的旁路文件；没写画幅的定时单仍然只有竖版。
done_on: 2026-10-26
done_ref: commit:5621127
---
一张工单可在制作说明里点名要哪些画幅。竖版仍是主文件。多出来的成片记在原有交片记录里，不改数据库。
没点名的工单行为与现在相同。没有改发布、广告或定时任务。
