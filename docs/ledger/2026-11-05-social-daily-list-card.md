---
id: 2026-11-05-social-daily-list-card
title: 社媒 Agent 第 2 刀：每日清单逐条放行（服务端重建清单、绑定 PM 看到的内容）、单条剔除写原因、没批过期回内容池、每日排期改 06:30
status: done
owner: agent
decided_on: 2026-11-05
source: doc:docs/specs/2026-11-05-daily-list-card-design-v0.1.md
verify_by: 2026-11-06
verify_how: 合并部署后：管理员打开 CTS 客户社媒页能看到「今天到后天要发的 Reel」（GET /api/clients/<CTS>/daily-list 返回条目与指纹）；对同一清单 POST dry_run 返回逐条判定、flywheel_actions 没有新增 social_daily_list_decision 行；11-06 06:30 新西兰那次 social-weekly-draft 运行记录存在且没有 failures
done_on: 2026-11-05
done_ref: pr:3617
---
设计 v0.2 §9 吸收子牙+魏征设计复审 6 条必改。放行不收口令，改为当前内容指纹必须等于 PM 看到的指纹，且每次放行服务端重建清单核对条目在不在上面；剔除删发布日并打标记，两条排期路径都拒绝；同组最新一条被剔除则整组不排；没批过期的片删发布日回到内容池；今日待办新类归「要你拍板」。发布仍由按日公开执行器在各条日子做，开关 WEEKLY_PACK_REEL_SCHEDULED_PUBLIC 未开。
