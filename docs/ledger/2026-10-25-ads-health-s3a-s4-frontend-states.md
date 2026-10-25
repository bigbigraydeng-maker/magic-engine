---
id: 2026-10-25-ads-health-s3a-s4-frontend-states
title: 广告健康页：「先全停」尊重 pausable 并说清缺目标；「等你点头」读取失败不再永远加载中
status: decided
owner: agent
decided_on: 2026-10-25
source: issue:3093
verify_by: 2026-11-01
verify_how: 上线后用内部账号打开广告健康页：停投中的广告点「先全停」提示「已经不在投放中」；断网或接口报错时「等你点头」标签显示「读取失败」和「重试」按钮，不再停在「加载中…」
---
#3093 PR②（S3a + S4，纯前端，B/C 级）。S3b（改执行内核注册表让暂停不依赖目标）继续推迟，另开 draft PR。

## 补洞（#3093）
- S3a：`page.tsx` 的 StopLossBlock 读到 `pausable === false` 时不再提交暂停；409 `no_active_goal` 的文案改成「暂停需要先在目标与设置补上目标，广告没有变更」；删掉与实际不符的注释「pausing always works」。
- S4：`auto-pause-panel.tsx` 的读取包了 try/catch，网络错误显示「读取失败」+「重试」。`live-today-panel` 和 `autonomy-settings` 读代码已处理 403/读取失败，未改，线上卡住与 main 对不上，记为待查（可能线上版本较旧）。
- 状态：代码在分支 `claude/issue-3093-20261025-0117`，测试待广告 Agent 本机验证。
