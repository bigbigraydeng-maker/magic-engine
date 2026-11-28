---
id: 2026-11-28-ads-early-warning-todo-lane-missing
title: 广告「提前预警」待办没分栏，PM 的邮件和页面上一条都看不到——已补进「要你拍板」一栏
status: done
owner: agent
decided_on: 2026-11-28
source: session:31475937
verify_by: 2026-12-05
verify_how: 上线后挑一个当天出了广告提前预警的客户（clients.leads_config 里当天的预警待办不为空），看当天今日待办邮件或待办页的「要你拍板」一栏有没有那条「广告预警」；有=成。到期前一条预警都没出过=判不了，写明后顺延一周，不算成
done_on: 2026-11-28
done_ref: commit:d016f226394b337b45225703f688abeb750a1454
---
车道表 LANE_OF_KIND 漏了 ads_predictive_early_warning_alert：laneOf 拿到 undefined，条目算进 PM 待办却落不进五栏任何一栏，也不进开发欠账和周报。
预警邮件给 FDE 的那条通道不受影响，丢的只是今日待办这一份。类型检查早就报了这条（TS2741），但上线构建跳过类型检查。
同时补了一条测试：让编译器念出全部待办种类，哪种没分栏就红。主干其余类型检查报错不在本单范围。
