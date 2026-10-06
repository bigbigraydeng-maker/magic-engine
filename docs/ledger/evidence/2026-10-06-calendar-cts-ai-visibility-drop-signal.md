# 日历巡检证据：查一下 CTS AI 可见度回填之后，自动跑的三件事有没有出问题

- fetched_at: 2026-10-06（新西兰时间 21:50 前后）
- 方式：只读查生产库（Supabase SQL 只读）
- 日历事件：查一下 CTS AI 可见度回填之后，自动跑的三件事有没有出问题

- SQL：select detected_at, current_value, reference_value from anomaly_signals where client_id=CTS and rule_id='geo-visibility-score-drop' and detected_at >= '2026-09-20' order by 1
- 结果：9/21 到 9/27 每天 1 条（共 7 条），数值完全一样
- 事件要求 9/21 不应有新记录，故判没达预期；但数值每天不变，更可能是旧告警重复，需对比 9/20 之前的记录才能断定
- 未核：周日普查周报表行数、周一诊断分数（已另开卡 2026-10-06-calendar-cts-ai-visibility-other-two-checks 跟进，本次未查，不视为通过）
