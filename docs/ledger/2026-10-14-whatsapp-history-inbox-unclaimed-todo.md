---
id: 2026-10-14-whatsapp-history-inbox-unclaimed-todo
title: WhatsApp 历史同步先进「待认领」收件箱、号码没人认领时下发待办（建表脚本只写没应用，先建表再订阅 history 字段）
status: done
owner: agent
decided_on: 2026-10-14
source: session:12233466
verify_how: PM 同意后在低峰先应用建表脚本、再让 56 号订阅 history 字段；并存接入后看收件箱里有对应客人号的历史行、无正文，且 ME 的会话/联系人/触点数量没有因历史增加
done_on: 2026-10-14
done_ref: pr:2595
---
代码已写完，等统筹问 PM 拿「合 N」；建表脚本需要 PM 本人点头才能在线上执行。
上线顺序：应用脚本（低峰）→ 上代码 → 订阅 history 字段。没建表就订阅，历史会一直被拒收重投。
回声和历史没有真号码，只能用官方样例验证；媒体补发只确认不存，不是无损。
