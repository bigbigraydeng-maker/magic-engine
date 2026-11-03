---
id: 2026-10-25-prescription-weekly-check-not-approve
title: 每周二不再自动开方，只复查已经批准的方案
status: done
owner: agent
decided_on: 2026-10-25
source: doc:docs/strategy/ME_PRODUCT_DEFINITION.md
verify_by: 2026-10-28
verify_how: 下一次周二任务跑完后，运行记录里是各份已批准方案的进度和调整建议，没有新处方、没有自动批准；今日待办不再出现「一个可执行动作都没排出来」。
done_on: 2026-10-25
done_ref: pr:3160
---
周二任务改为复查正在执行的方案，并留下调整建议。建议只写给人看，不自动改方案、不批准、不动广告、不发消息。
结果写在这条任务原有的运行记录里，今日待办读这段人话。没有新表。
