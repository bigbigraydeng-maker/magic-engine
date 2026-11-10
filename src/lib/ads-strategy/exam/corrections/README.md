# 广告 agent 纠正记录（考卷候选上游）

**v1 写入方式（Ray 2026-11-08 拍板）**：PM 说「判错了」后，由人直接改本目录的 `records.json` 并开 PR；**不接**鲁班对话、Meta API 或任何自动落库。升级成正式考卷题后，在同条记录填 `promoted_to`（如 `Q23`），候选统计与转换会自动跳过。

机器可读结构、敏感字段校验、转候选题见 `index.ts` 与同目录 `*.ts`。候选题不写入 `questions.ts`，`npx tsx scripts/ads-exam.ts` 末行只报未晋升条数。
