# 证据：2026-10-09-calendar-diagnosis-no-fake-ai-not-mentioned · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下诊断报告还会不会再编造「AI 里没人提到你」这种结论

## 结论

9-28 起共 9 条 ai_visibility 结论：5 条带实测的(measured=3,failed=0,latency 38600–43430ms)均为真探测；其余4条无 live_probe 的来自周快照(East International 10-05 那条 brand_not_mentioned 对应快照 0/12 次提及，是真测的)或「未追踪」，没有 failed>0 或毫秒级耗时的假结论。

## 怎么查的

SQL(只读) diagnostic_findings dimension=ai_visibility created_at>=9-28：9-28 East International live_probe_no_mention/low_ai_rank measured3 failed0 43430ms；10-05 NAL live_probe_no_mention 3/0/42191ms，Roman low_ai_rank 3/0/38600ms；East brand_not_mentioned critical evidence=null，核对 ai_visibility_snapshots 2e3f040d… week 9-28 mentions_count=0,total_runs=12(gpt-5-search-api)，属真测零提及；NZCPE 为 ai_visibility_not_tracked，oztop low_ai_rank 无探测字段。修复 a0862d80a 在 origin/main。未核：9-21 那5条假结论是否已从库/门户清掉(描述里的顺带项)。
