---
id: 2026-10-26-rss-fetch-headers-jon-loomer-415
title: 专家学习抓取 jon-loomer 报 415，已改请求头，合并后要再试跑一次确认
status: done
owner: agent
decided_on: 2026-10-26
source: pr:3263
verify_by: 2026-10-30
verify_how: 合并后用 perSource 1 再跑一次只读试跑，jon-loomer 能抓到条目才算成；仍是 415 就不绕反爬，改走邮件订阅或手工录入。
done_on: 2026-10-26
done_ref: commit:775e17f
---
首次试跑里 jon-loomer 返回 415、0 条。本次只改了抓取请求头（Accept 与可识别的爬虫标识），不伪装浏览器。
不保证能解决，可能是对方站点的防火墙规则；没解决就不绕过，换采集方式。
关联 issue 3088，接 3207 之后。
