---
id: 2026-10-06-cts-shanghai-price-line-db-2699
title: 生产库里 CTS 上海周边团旧流程的价格行已从 3,399 改成 2,699（PM 说「必须改成 2699」）
status: done
owner: pm
decided_on: 2026-10-06
done_on: 2026-10-06
done_ref: doc:docs/audits/2026-10-06-cts-factory-config-price-line-2699.md
source: session:ec90bb17
verify_by: 2026-10-13
verify_how: 生产库只读查 CTS 客户出片配置里上海周边团的价格行为 2,699；仓库里 offerings 配置那一行旧价由换词窗口另改；划掉 3,399 的样式本轮未做，PM 要再说。
last_checked: 2026-10-13
---
只改了 CTS 客户出片配置里旧 Creatomate 流程用的一行价格文字，条件为原值恰好是旧价才改，返回 1 行，别的字段与别的客户未动。
回滚：把该行价格文字改回旧价。该配置只影响旧 Creatomate 出片流程，新 Remotion 工单不读它。
