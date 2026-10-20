---
id: 2026-10-21-content-gate-pr2-worker-gate
title: 内容实质闸第二步（出片机）：成片屏幕上没有连续可见 ≥2 秒的团名/地点/卖点/品牌卡的，渲染前直接拒单；标成「素材」的放行
status: decided
owner: agent
decided_on: 2026-10-21
source: pr:2930
verify_by: 2026-10-28
verify_how: 合并并升级出片机后：①用氛围片 17419d99 的真实 props（line=null，未标 deliverable）提单必须被拦（日志含「内容闸」、无成片）；标 deliverable=asset_only 的同参数放行且回执 content_substance.verdict=asset_only；②用已有 list/postcard/montage 工单的真实 props 重放必须全部 pass（10-21 本地重放：库里 106 张 remotion 单 list 69/postcard 30/montage 5/datacard 1 全 pass，氛围片 2 张 fail）；③回执带 capabilities=content_substance_v1。第三步（服务端重算+界面+翻开关）另开。
---
设计稿 docs/specs/2026-10-18-content-substance-gate-design.md §10/§11（在 PR 2716 分支）。本步只做出片机侧：引擎纯函数 contentSubstanceOf + remotion-branch.mjs 渲染前拒单（放在文字复扫之后、素材/音乐检查之前）+ segments.json 与 media_evidence 写回执。判据与设计稿一致，一处决定：钩子文字（hook）不计入（口号不是内容）；montage 用「词累计可见 ≥3 秒」（词本身就是内容，schema 要求 10–30 个词）。
