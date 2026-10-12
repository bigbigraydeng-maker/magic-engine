---
id: 2026-09-25-crm-c1b1y-front
title: CRM 升级 C1b-1y-front：抽屉里加"⭐重要标记"编辑区（note + 到期日），行内挂徽章 + 到期红 pill
status: done
owner: pm
decided_on: 2026-09-25
source: session:beef24ba
verify_by: 2026-10-05
verify_how: 合并后员工点行展开抽屉能写"约好周三 3 点回电"、选到期日、点保存；行上出现 ⭐+12 字截断的徽章；到期日过后自动出红色"到期"pill。到期自动进今日待办是再下一轮
done_on: 2026-09-25
done_ref: pr:2006
last_checked: 2026-10-12
check_note: 夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
方案 pr:2000 §7 C1 板桥硬伤 2 收官（UI 半）。DeepSeek 一轮 $0.006；只改 all/page.tsx；1034 行，tsc 0 新增。
下一步：到期日到了自动进今日待办 pm-todo（另一小轮）；卡片页退役（C5）。
