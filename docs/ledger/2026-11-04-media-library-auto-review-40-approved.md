---
id: 2026-11-04-media-library-auto-review-40-approved
title: 素材库 500 条已由马良按规则加 AI 看图审完：40 条可自动选片，460 条要人看；看图共花 2.23 美元（PM 批了 10 美元）
status: decided
owner: agent
decided_on: 2026-11-04
source: session:369fcc9e
verify_how: 在主干检出里跑 node scripts/media-library/review.mjs ~/Dropbox/MagicLab_Studio（不加 --apply），输出的 eligible_any 应为 40、needs_human 为 460；Dropbox 99_Catalog/approved-selection.json 里正好 40 条，每条都带 bucket、object_path、sha256、record_sha256；review-runs 下有同一 run_id 的抽查记录 -spotcheck.md。三条都对上才算成。
---
设计稿 docs/specs/2026-11-04-media-library-auto-review-v0.3.md（子牙、魏征设计审）。抽查 4 轮：前 3 轮各查出 1 类 AI 漏判（霍比屯片场、毛利木雕、能认出的人脸），每轮改规则后全部重跑；第 4 轮 30 条零漏判才写入；实施复审后修了批次级待审核等漏洞，重新写入 40 条。
「能自动选片」不等于「能发布」。出片机和 ME 后台还没读这份清单，那是第三步，开工前先跟 PM 讲清楚。
要人看的 460 条见卡 2026-11-04-media-library-review-queue-460。
