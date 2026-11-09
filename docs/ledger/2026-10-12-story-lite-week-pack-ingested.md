---
id: 2026-10-12-story-lite-week-pack-ingested
title: CTS 10/13–10/18 周包的 18 张 Story 图已入库（待授权）；还没授权、没发、没调 Meta
status: decided
owner: pm
decided_on: 2026-10-12
source: session:61a3b5f4
verify_by: 2026-10-13
verify_how: 打开 /dashboard/clients/<CTS 客户 id>/story，应看到「CTS 周包 10/13–10/18 Story」共 18 条、状态「还没授权」、无红色问题；PM 点「授权这一周」后到点（10/13 08:30 新西兰时间起）只会演练、不发，除非真发开关被另批打开
---
PM 10-12 说「不用手动过渡，直接做好一起发」，74 号转述并同意入库。
做了什么（2026-10-12）：把 docs/clients/cts/2026-10-13-week-pack-v0.md 的 18 张 Story 图（1080×1920）传到公开存储桶 visual-assets 的 CTS 目录 `<CTS 客户 id>/story/<日期>/`，逐个回读：都能打开、尺寸对、哈希一致；写入 story_packs 1 条 + story_items 18 条（Facebook、状态待发布、不授权）。线上预览检查：18 条全无问题，可授权。
只传了 Story 图，没有任何客人信息。回滚：删 story_items 18 条与 story_packs 1 条，再删存储桶该目录下 18 个文件。
没做：授权（要 PM 在页面点）· 真实 Meta 调用 · 真发开关。
