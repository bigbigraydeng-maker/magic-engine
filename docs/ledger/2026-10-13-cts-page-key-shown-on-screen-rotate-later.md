---
id: 2026-10-13-cts-page-key-shown-on-screen-rotate-later
title: CTS 主页的发帖授权码曾完整显示在一个窗口的屏幕输出里，PM 决定先不换，等不发内容的时候再重新连接
status: decided
owner: pm
decided_on: 2026-10-13
source: session:90a50c3b
verify_by: 2026-10-20
verify_how: 确认 CTS 的 Facebook 主页已重新连接并换了新授权码，换完后自动发帖、评论回复、互动读数各真实跑通一次；或者 PM 明确说等它自然到期再换，并写下到期日
---
只读接口时脚本输出带出了完整授权码，只留在那个窗口的对话记录里；已搜过仓库改动与脚本目录，没有写进任何文件。
PM 判断风险小、换的代价是自动发帖会停，所以先不换。到期日未核实，旧笔记写约 11 月初。
以后读接口的脚本不许打印请求地址与返回内容。重新连接需要 PM 本人登录 Facebook。
