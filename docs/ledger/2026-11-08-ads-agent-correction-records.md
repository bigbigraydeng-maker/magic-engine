---
id: 2026-11-08-ads-agent-correction-records
title: 广告 agent「纠正记录」首版：PM 判错落成 JSON + 转考卷候选题，脚本可统计候选数量
status: decided
owner: agent
decided_on: 2026-11-08
source: doc:docs/ROADMAP.md
verify_by: 2026-11-18
verify_how: 合并后 npx vitest run src/lib/ads-strategy/exam/corrections 全绿；npx tsx scripts/ads-exam.ts 末行显示候选题数量与 records.json 条数一致
---
路线图「三个缺口」第 2 项首刀：records.json + 校验 + 候选题转换，不并 questions.ts。Ray 定：新纠正只 accrue 到 JSON 还是还要 UI/API；agent 口述「判错了」谁落库。
