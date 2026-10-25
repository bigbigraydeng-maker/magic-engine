---
id: 2026-10-25-video-factory-entry-consolidation
title: 视频工厂入口一次到位合并：先摘掉改名，再做 6 个标签
status: decided
owner: agent
decided_on: 2026-10-25
source: issue:3090
verify_by: 2026-11-01
verify_how: 看客户页出片卡、推广活动页、自助客户左栏、两个改名页头；标签页 PR 2/3 落地后各入口可达
---
规格见 docs/specs/2026-10-25-video-factory-consolidation-v0.1.md。PR 1（摘掉+改名）代码已推；PR 2/3（标签壳、客户侧并入）未做。
最近 30 天写入已只读核实（2026-10-25，见规格第五节）：production_packages / video_clips / visual_assets 均 0 新增 0 更新，content_posts 在用（新增 34、更新 48）；series 无单独表。生产包页保留，Execution 量产提示保持链到生产包页（社媒日常看不到量产草稿），无 packageId 时链生产包列表。
