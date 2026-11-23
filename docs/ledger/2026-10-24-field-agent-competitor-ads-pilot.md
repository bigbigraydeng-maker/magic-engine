---
id: 2026-10-24-field-agent-competitor-ads-pilot
title: 竞品广告采集先挂在网页情报上，外勤助手只负责去看和写回，人在经营页审核
status: done
owner: agent
decided_on: 2026-10-24
source: doc:docs/specs/2026-10-24-field-agent-web-intelligence-v0.md
verify_by: 2026-10-31
verify_how: 迁移应用到生产且 Render 配好三把环境变量后，在经营页点「请求采集竞品广告」。没配钥匙时页面说明没接上且不建任务；配好后任务表出现一条排队中的采集，待审广告能通过或驳回。卡住的网页检查要等代码上线后的下一次自动日程，看超过六小时没收口的运行是否变成失败并完成结算。
done_on: 2026-10-24
done_ref: doc:docs/specs/2026-10-24-field-agent-web-intelligence-v0.md
---
外勤采集写进现有网页情报观测，不另建广告表。合同在规格文档。
迁移还没进生产库。网页情报停更是因为一条检查停在未收口，预算函数会拒绝这个客户的新检查；上月没结算也会整客户锁住。
本改动让超过六小时没收口的检查按已经预留的上限结算并标失败。生产要等迁移和代码都上线后的下一次自动日程才生效。
