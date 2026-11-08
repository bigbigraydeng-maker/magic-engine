---
id: 2026-10-28-impact-project-console
title: 后台可以按客户看这一轮走到哪，并接着去原有的页面办
status: done
owner: agent
decided_on: 2026-10-28
source: doc:src/lib/project-console/derive.ts
verify_by: 2026-11-04
verify_how: 打开后台「项目」。每个客户能看到现在停在哪一步、九个点、等谁点。没有品牌扫描时会说开不了方并链到原来的扫描页。点同意、暂停草稿、开投仍是原来的卡。不新开表。
done_on: 2026-10-28
done_ref: pr:3373
---

项目从现有客户、处方、计划和确认卡现算，不另存一份。
开方仍走原来的华佗对话，控制台不代填预算。
花钱、发布、改广告仍只在原来的确认卡上点。
