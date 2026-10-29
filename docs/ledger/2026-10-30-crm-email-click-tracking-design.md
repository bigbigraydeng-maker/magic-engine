---
id: 2026-10-30-crm-email-click-tracking-design
title: 邮件点击跟踪（专属链接）设计稿已写好、待两位独立审查和 PM 点头：先跟踪目录下载链接，「是否打开」不做；还没写任何代码
status: decided
owner: pm
decided_on: 2026-10-30
source: session:9562a9b6
verify_by: 2026-11-13
verify_how: 设计稿申请单通过两位独立审查并由 PM 点头合并；PM 回「做」后开实现改动单（先迁移后代码）；实现合并并部署后，用 hello@magicengine.cloud 当场试跑：信里目录链接真点一次，点击表出现 1 行真人点击、客人时间线出现「点了目录下载」、跳转到目录文件；再点一次触点仍 1 行；模拟机器点击不记触点；任何一步没走到，就写卡在哪
---
PM 10-30 定：想知道客人有没有看邮件，先做「点链接」跟踪（目录下载链接优先），与短信的专属链接共用一套；「是否打开」不做（不准：苹果邮件会替客人预读图片，我们 10-29 已踩过一次）。
设计稿：docs/specs/2026-10-30-crm-email-click-tracking-design-v0.md（草稿申请单，风险级别 A，不含代码）。
前置（要人做）：目录 PDF 放上官网并给下载链接；CTS 域名加一条解析记录；Render 后台加域名；CTS 隐私政策加一句邮件点击跟踪的说明（法务确认）。
硬前置：台账卡 2026-10-29-crm-email-open-counts-as-last-contact（点击不算联系）先修好上线，才能对 CTS 打开本功能。
