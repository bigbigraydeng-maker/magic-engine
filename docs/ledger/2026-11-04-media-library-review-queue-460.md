---
id: 2026-11-04-media-library-review-queue-460
title: 素材库有 460 条机器放不了行、要人看：一半以上卡在入库时自己写的「待审核」或证据取自搜索页，补证据就能放
status: decided
owner: pm
decided_on: 2026-11-04
source: session:369fcc9e
verify_how: 跑 node scripts/media-library/review.mjs ~/Dropbox/MagicLab_Studio，看 needs_human 是否比 460 少，并核对 by_reason 里 rights:intake_marked_pending（374）和 rights:evidence_from_search_page（91）两项是否下降；没下降就是还没人处理。
---
问题和影响：这 460 条现在不能自动选片，出片时用不上。原因分布（一条可能占多项）：入库时标了待审核（单条或整批）374、许可证据取自搜索页 91、画面有别家品牌/景点/文化文物 287、能认出人脸 182、有儿童 54、可能是自己裁的版本 63。
怎么处理：每条的问题、来源页链接、Dropbox 原件位置都列在 Dropbox 的 MagicLab_Studio/99_Catalog/review-queue.json 里。先补「待审核」和「搜索页」这两类的作品页证据，补完重跑 review.mjs 就能放一批；品牌、人脸、儿童这几类要人看图后决定。
直达：Dropbox 打开 MagicLab_Studio/99_Catalog/review-queue.json。谁来补、补多少，由 PM 定。
