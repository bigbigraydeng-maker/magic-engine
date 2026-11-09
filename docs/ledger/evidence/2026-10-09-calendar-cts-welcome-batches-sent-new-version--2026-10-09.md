# 证据：2026-10-09-calendar-cts-welcome-batches-sent-new-version · 取数 2026-10-09（NZ 时间，日历巡检只读核实）

日历事件：查一下 CTS 今晚的欢迎信有没有正常发出去（顺带确认新版内容生效）

## 结论

Mailchimp 已发送列表里 auto_e1_batch_20260928（9/28 19:02Z，10 人）和 20260929（9/29 19:02Z，9 人）都发出；两封正文含 34 pages / 11 confirmed / shopping、无 22 pages，有 Baker 本人及客人合影图；收件人 9-10 人与当日新增个位数相符。另注意：10/1 与 10/7（NZ 10/8 早）没有批次记录，原因未查。

## 怎么查的

Mailchimp REST GET /campaigns?status=sent（只读）+ /campaigns/{id}/content grep 与 img alt；最近一批为 auto_e1_batch_20261006（10/6 19:03Z，18 人），10/7 19Z 批次不在列表。
