---
id: 2026-10-14-crm-all-per-page-50
title: 全部客人平铺名单每页 100 人减到 50 人：每页每个人都要读往来记录并算「该做什么」，人数减半以进一步提速
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2606
source: session:1a85e0eb
verify_by: 2026-10-21
verify_how: 在 PM 的 Chrome 里量名单接口 perPage=50：默认打开比 perPage=100 的约 1.4 秒更快；页脚显示按 50 人一页的总页数；智能分段视图不受影响
---
PM 2026-10-14 回「减到50」。只改前端：平铺名单请求 perPage=50、页脚页数按 50 算；分段（智能）视图仍按服务端默认 100 一页。预计再快约 0.3 秒，合并后实测。
