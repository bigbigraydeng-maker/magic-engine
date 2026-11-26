---
id: 2026-11-10-social-post-readback-gap-todo-first-run
title: 发后读数缺口待办（R-2）合并后第一次每日待办生成要核三条
status: decided
owner: agent
decided_on: 2026-11-10
source: pr:3768
verify_by: 2026-11-12
verify_how: "PR 3768 合并并部署后，第一次 pm-daily-todo 自动跑完当天核对：① dev 栏或邮件里，对真实过点且缺回执的帖出现 social_post_readback_missing 或同类文案；② 同一批里测量点尚未到的帖不出现这四类缺口待办；③ 近窗有 Story 的客户至多一条 social_story_readback_unsupported 汇总，不是每条 Story 一条。三条都对算成；没有过点样本时①可记无样本但②③仍要核对。"
---
当场跑不了的原因：今日待办组装走生产库的 `pm-daily-todo` 定时任务，PR 内手动触发会读生产客户数据并生成真实待办邮件，不能在本 PR 里当场跑；合并后等首次自动运行再按 verify_how 核对。单元测试已覆盖分类逻辑。
