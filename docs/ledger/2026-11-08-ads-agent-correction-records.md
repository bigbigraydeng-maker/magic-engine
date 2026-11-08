---
id: 2026-11-08-ads-agent-correction-records
title: 广告 agent「纠正记录」首版：PM 判错落成 JSON + 转考卷候选题，脚本可统计候选数量
status: decided
owner: agent
decided_on: 2026-11-08
source: doc:docs/ROADMAP.md
verify_by: 2026-11-18
verify_how: 合并后 npx vitest run src/lib/ads-strategy/exam 全绿；npx tsx scripts/ads-exam.ts 末行候选数为 1（三条已 promoted_to Q23–Q25 不计入）
---
路线图「三个缺口」第 2 项首刀。v1：人手改 records.json，不接对话/API；升入 formal 后填 promoted_to 即出候选池。
