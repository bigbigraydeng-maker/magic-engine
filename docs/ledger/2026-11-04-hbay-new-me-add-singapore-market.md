---
id: 2026-11-04-hbay-new-me-add-singapore-market
title: HBay 在新 ME 的目标市场加上新加坡（新西兰+新加坡）；写入时误清空的服务地区和语言已按原值写回
status: done
owner: agent
decided_on: 2026-11-04
source: session:8044207b
verify_by: 2026-11-11
verify_how: 只读看新 ME 里 HBay（客户 id 5bfb7e39）企业资料的「市场」分区三栏：目标市场=新西兰、新加坡；服务地区=新西兰；语言=英文。三栏都对算成。网站仍只面向新西兰，没有新加坡内容，是否要做待 PM 另行决定。
done_on: 2026-11-04
done_ref: doc:docs/clients/hbay-water/2026-11-03-hbaywater-website-and-todo.md
---
PM 2026-11-03 说客户还在关注新加坡市场，2026-11-04 回「加新加坡」，经新 ME 写入提案确认后写入。
踩坑：「市场」分区的写入是整区覆盖，第一次只传了目标市场，服务地区和语言被清空；当场用第二个提案按原值写回，11:41 回读三栏都对。以后改这一区必须三栏一起传。
前一张卡 2026-11-03-hbay-new-me-profile-filled 里「新加坡待 PM 回话」那句已过时，以本卡为准（那张卡的核对字段已冻结，不改）。
