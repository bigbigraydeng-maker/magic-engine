---
id: 2026-10-26-viral-analyzer-pause
title: 爆款分析和爆款发现先停，Gemini 额度不够就别再自动跑
status: decided
owner: agent
decided_on: 2026-10-26
source: session:c7bb7326
verify_by: 2026-11-02
verify_how: 部署到 Render crazycontent 之后，下一次 viral-analyzer-worker 和 viral-discovery-weekly 的定时触发都直接返回 skipped=disabled，且不再调用 Gemini。恢复：在 crazycontent 上把 VIRAL_ANALYZER_ENABLED 设成 true。后台手动按钮不受这个开关影响。
---
Ray 要求先停这两条定时任务，因为 Gemini 额度一直失败。
开关跟线索挖掘一样：环境变量不是严格的 true 就不跑。这次部署不配这个变量，两条任务一起停。
后台手动分析按钮不走这个开关，需要时仍可手点。
