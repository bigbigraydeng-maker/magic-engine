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
已在线上库应用（PM 10-14 回「建表」，由 93 号窗口执行）：迁移文件 sha256=a3eff7bb526a4d56dfb2d450a6408efa6abd8e26ef447c5a5bc8c1fb35a35c0a，库里记录名 whatsapp_history_inbox_and_unclaimed。写后读回：两张表、行级权限开启且只有后台身份一条策略；匿名和普通登录身份读写都被拒；重复入库只留一行、坏数据被拒、没有正文类列；两张表 0 行（探测写入已回滚）；发送记录上的部分索引已建。
回滚（有数据后先让 PM 同意）：DROP TABLE public.whatsapp_history_inbox; DROP TABLE public.whatsapp_unclaimed_numbers; DROP INDEX IF EXISTS public.conversation_outbound_log_meta_message_idx;

