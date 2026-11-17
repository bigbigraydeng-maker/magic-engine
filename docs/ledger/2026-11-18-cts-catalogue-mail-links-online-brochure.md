---
id: 2026-11-18-cts-catalogue-mail-links-online-brochure
title: 在线手册第三刀：CTS 目录信和「要目录」自动回信的链接从 PDF 换成官网在线手册 /brochure（页面照 PDF 排版、可下载 PDF）
status: done
owner: agent
decided_on: 2026-11-18
source: session:96dc6edf
verify_by: 2026-12-02
verify_how: 11-18 之后发出的目录信里，链接是 https://www.ctstours.co.nz/brochure?me=…；crm_email_link_clicks 有真客人点进 /brochure 并看团页面的记录；和换之前 48 封 PDF 目录信（9 人点开、1 人开口）比点开率和开口率
---
PM 11-18 回「开始第三刀，目录信改成在线手册」「上线」。官网页面照 PDF v11 重做并可下载 PDF：chinatravel#310（排版）、#312（手机上价格不截断、封面图换小文件），都已上线并在手机宽度下核对过。
发信设置改到第 14 版（目录链接改为 /brochure，标签 online 2027）；目录信模板 catalogue-send 到第 3 版，「要目录」自动回信 catalogue-request-reply 到第 4 版（文字改成介绍在线手册、可下载 PDF）。
不留两成发 PDF 的对照组，拿换之前 48 封 PDF 目录信的结果作对比。不改代码，只改设置和模板。
线上用测试客人收到正式目录信：链接带追踪标记，点进去会认出是这位客人（存下记号，记一条点击）。
