---
id: 2026-10-14-whatsapp-reject-log
title: WhatsApp 收信入口拒收时留一行说明（原先拒签完全没有日志，Meta 测试推送是否到达查不出来）
status: done
owner: agent
decided_on: 2026-10-14
source: session:12233466
verify_how: 上线后让 56 号再点一次 Meta 后台的测试推送，到 Render 日志里搜 delivery rejected，应看到原因码和密钥来源；同一原因每分钟最多 20 行
done_on: 2026-10-14
done_ref: pr:2622
---
只加日志，状态码和响应内容一字未改；每个原因每分钟最多 20 行，超出的合并成一行。
日志里只有原因码、用的哪种密钥、号码个数、有没有签名头，不含密钥、签名、号码和正文。
