---
id: 2026-11-25-cts-tailor-made-default-notes-commission-fx
title: 定制行程单新建时默认带上「净价不含佣金」和「汇率变动可调价」两条说明
status: done
owner: claude-code
decided_on: 2026-11-25
source: session:366138d8
verify_by: 2026-12-02
verify_how: 合并上线后，CTS 后台定制行程单点「新建」（不是复制老单），生成的单子 Please note 里第一、二条分别是净价不含佣金、汇率变动可调价；生产库 tailor_made_itineraries 里 11-26 以后新建的 CTS 单子 payload.notes 含 "commission" 和 "exchange rate"
---
CTS 反馈后台定制行程单里「这是净价、不含佣金」那句看不到了。
核实结果：系统默认条款从 2026-07-29 第一版起就只有三句（火车票、故宫、最终价格以预订为准），代码里从没写过佣金那句。
那句原文 "All quotations provided are net rates and do not include any commission." 是 2026-08-02 顾问在一张单子的 Please note 里手动加的，之后复制老单新建的单子都带着（生产库 69 张里 15 张有），点「新建」从空白开始的单子就没有。
本次把这句和新加的汇率说明放进新建单的默认条款。已存的老单不动。
