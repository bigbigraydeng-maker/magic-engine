---
id: 2026-10-12-cts-crm-paid-backfill-from-mailbox
title: CTS 在 ME CRM 里把邮箱核对出的 14 位已付款客人标成已付订金 / 已付全款（PM 2026-10-12 说「标」）
status: done
owner: pm
decided_on: 2026-10-12
source: session:90a50c3b
verify_by: 2026-10-16
verify_how: 在 ME CRM 客人页数「已付订金」「已付全款」两档人数（写前 5 与 2，写后应为 16 与 5）；再让 CTS 销售扫一遍对照表（Dropbox 里 2026-10-12-已订客人对照表），确认订金 / 全款是否标对、Cawte 与 Greg 两位怎么处理
done_on: 2026-10-12
done_ref: doc:docs/clients/cts/2026-10-11-cts-ads-master-plan-v1.0.md
---
写入 14 条（11 条已付订金、3 条已付全款），每条在变更记录里留了来源与团 / 出发日，改动人写 PM-2026-10-12 via claude。读回确认人数与记录一致。
回滚：按变更记录里 changed_by 以 PM-2026-10-12 开头的那批，把阶段改回原来的 from_stage。
没动：Greg（CRM 里其实有，联系人名是邮箱形式，已经是已付订金；之前误判成没有）、Cawte（已是「即将出行」，比已付更靠后）、4 单只开发票或只有客人自述的订单。款项是订金还是全款，邮箱只能判到「已付」，除 3 条明确全款外一律按订金标，待 CTS 核。
