---
id: 2026-11-04-social-weekly-loop-p3-maliang-v2
title: 社媒每周闭环 P3：马良审片 v2（逐镜头 / 声音转文字 / 可辨认人脸）
status: done
owner: agent
decided_on: 2026-11-04
source: pr:3571
done_on: 2026-11-04
done_ref: pr:3576
verify_by: 2026-11-18
verify_how: 合并后 npx vitest run src/lib/maliang 全绿；第一阶段试跑时对 CTS 至少 3 条草稿真跑一次 v2，记录花费与结论，人脸只出问题不判不过，解析失败判 unverifiable
---
设计 v1.1 §2 ③：扩展现有马良，不另起审片员。v1 行为不变；v2 加逐镜头、转文字、人脸标记、静音判不过、每周花费上限判断。未接定时任务、未调真实模型。
