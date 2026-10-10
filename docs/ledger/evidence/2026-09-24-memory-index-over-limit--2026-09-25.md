# 证据：2026-09-24-memory-index-over-limit · 核对 2026-09-25（NZ 时间，本机只读核实 + 记忆目录整理）

## 结论

**原判据做不到，卡翻 `failed`；整理工作已做完，换成两级索引并开新卡 `2026-09-25-memory-index-two-level`（status done）。**

原判据要求「MEMORY.md 小于 17KB」和「每个 .md 都在 MEMORY.md 里有一行」同时成立。实测这两条在当前文件数下互斥：

| 量 | 数值（`wc -c` / `ls`，2026-09-25 整理前） |
|---|---|
| 记忆目录 .md 文件数（不含 MEMORY.md） | 348 |
| 348 个文件名的字节总和 | 15,767 |
| 每条链接最少额外 5 字节（`[](`+`)`），标题 0 字 | 348 × 5 = 1,740 |
| **标题一个字都不写的理论最小索引** | **17,507 字节 > 17,408（17KiB）** |

也就是说，哪怕把 348 个标题全删光，索引也塞不进 17KB。要让原判据成立，文件数得压到约 260 个（按平均标题 12 字节算）。这次合并了 27 个文件（349 → 322），离 260 还差 60 多个，而剩下的都是有独立价值、或"拿不准"的记忆——任务规矩是拿不准就留，不硬删。所以按规矩：不改判据，卡翻 `failed`，新开一张可达成的卡。

## 做了什么

1. **读了全部 144 个不在索引里的文件**（含 3 个 `.archived.md`）的正文，分三类处理。
2. **27 个文件合并进手册或主题记忆后挪出记忆目录**（没有物理删除，全部移到 `~/.claude/projects/-Users-raydeng-Projects-magic-engine/memory-retired-2026-09-25/`，整理前的完整备份在同级 `memory.bak-2026-09-25.tar.gz`）。每个目标文件末尾都加了「原独立记忆 X，2026-09-25 并入」的段落，目标文件的 `description` 也补了钩子；其余文件里指向这 27 个名字的 `[[链接]]` 全部改指目标文件，脚本验证零残留。
3. **索引改成两级**：`MEMORY.md`（13,642 字节）留通用规则、验证排错、产品决策、出片红线；四份分区索引 `memory-index-clients.md` / `memory-index-content.md` / `memory-index-tools.md` / `memory-index-me2.md` 兜住客户细目、内容工厂、工具坑、ME2 工程。`MEMORY.md` 顶部第一段就是四份分区索引的入口。
4. **核对脚本** `~/.claude/scripts/memory-index-check.sh`（仓库副本：`docs/ledger/evidence/2026-09-24-memory-index-over-limit--check.sh`），三项判据：总索引 < 17000 字节 · 每个 .md 在总索引或分区索引里有链接 · 无死链。退出码 0/1，夜巡或任何窗口可直接跑。

## 核对脚本输出（2026-09-25，整理后）

```
OK   MEMORY.md = 13642 字节（< 17000）
OK   326 个记忆文件全部在索引里（总索引 + 4 份分区索引）
OK   索引里没有指向不存在文件的链接
exit=0
```

326 = 322 个记忆文件 + 4 份分区索引。整理期间另一个窗口新写了 1 个记忆文件（`feedback-design-facts-verify-relations-not-just-columns.md`），已收进总索引——说明"新写的记忆没进索引"这个原病灶要靠脚本定期跑才守得住，不靠人记。

## 合并/挪出的 27 个文件（原文件 → 并入哪里）

| 原文件 | 并入 |
|---|---|
| feedback-client-vi-first-check-master-brief | feedback-client-vi-master-brief-first |
| feedback-track-b-means-video-factory | feedback-two-track-thinking-me-contribution |
| feedback-prospect-report-no-cost-mention | feedback-parallel-discovery-agent-pattern |
| feedback-reel-safe-zone-coding-rule | feedback-video-caption-short-big |
| feedback-mutation-probe-must-assert-anchor-hit | feedback-mutation-probe-must-distinguish-two-paths-to-empty |
| feedback-as-unknown-as-hides-shape-mismatch | feedback-test-fixtures-must-match-real-schema |
| feedback-fake-and-sql-must-stay-in-sync | feedback-fake-supabase-must-model-table-not-callorder |
| feedback-baseline-precreate-swallows-constraints | feedback-migration-ledger-version-is-regenerated |
| feedback-openai-models-listing-is-not-availability | feedback-verify-before-claiming-missing |
| feedback-factory-stock-chain-strips-credit-cc-unsafe | project-me-video-two-line-strategy |
| feedback-bayside-is-internal-shorthand-not-market-facing | project-roman-hu-ray-white-mission-bay |
| feedback-all-videos-need-logo-watermark | playbook-social-general §四 |
| feedback-cts-reel-publish-rules | reference-cts-content-render-publish-pipeline（规则在 playbook-social-general §八） |
| feedback-indexation-classifier-ignores-crawl-status | playbook-seo-general §三 |
| feedback-seo-optimize-only-with-complete-data | playbook-seo-general §二 |
| project-ads-auto-execute-authorization-2026-09-22 | project-ads-full-autonomy-authorization-2026-09-24 |
| project-crm-ai-agent-build-control-gate | project-cts-messenger-governed-agent |
| project-cts-manychat-messenger-autoreply | project-cts-messenger-governed-agent |
| project-cts-sheet-to-mailchimp-zap-disabled | project-cts-mailchimp-four-parallel-lead-pipelines |
| project-cts-thruplay-wrong-page-incident-20260922 | playbook-ads-meta-general §二十四 |
| project-docs-restructured-into-docs-folder | project-worktree-sprawl-cleanup-2026-08-04 |
| project-magicpicks-pagefly-homepage-brief | project-magicpicks-me-commerce-customer-zero |
| project-nal-video-factory-first-content | project-nal-meta-ads-connected-2026-09-13 |
| project-oztop-video-audience-blocked-unverified | playbook-ads-meta-general §二十五 |
| project-realtor-third-party-citation-playbook | playbook-geo-industry-realestate（本来就是它的原始记录） |
| reference-daishu-anz-landing-alias | project-me-anz-landing-service-line |
| reference-meta-ads-mcp-server-official | playbook-ads-meta-general §二十六 |

其余 117 个原本不在索引里的文件全部加进了总索引或分区索引（含 3 个 `.archived.md`，挂在各自的活文件旁边）。

## 没做 / 留意

- 记忆文件之间早就存在的死 `[[链接]]`（例如 `[[feedback-no-fabricated-client-data]]`、`[[reference-zhangliang-tier-gate-alias]]` 这类从来没有过的文件名）不在本卡范围，没动。
- 如果 PM 仍要"全部文件都在 MEMORY.md 一个文件里"，唯一路径是把文件数压到 ≤ 260——要再合并 60 多个记忆（主要是客户 9 月的逐日事故记录和 Creatomate 那一簇），那是另一件要拍板的活，没有自作主张做。
- 两级索引的代价：分区索引里的条目不会随开窗口自动进上下文，要靠 Claude 看到 `MEMORY.md` 顶部入口后主动打开。总索引现在还有约 3.3KB 余量给新条目。
