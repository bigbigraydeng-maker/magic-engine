---
id: 2026-10-12-twilio-dial-callerid-fix
title: Twilio 首通试打：转给员工那一段拨不出去（dial failed），改成用我们自己的号码当主叫再试
status: decided
owner: agent
decided_on: 2026-10-12
source: session:96dc6edf
verify_by: 2026-10-13
verify_how: 合并后用 021 的手机再拨公司号码：员工手机应响铃并能接听；查库里 dial 事件应为 completed 且 talk>0，客户记录一条 spoke。仍 failed 则去 Twilio 排错日志看错误码（地理权限/主叫号码）
---
首通试打：来电被接收并存库（voice/dial/status 三类事件都进来了，流水线通），但 DialCallStatus=failed，员工手机没响。
推断原因：转接那段默认沿用来电者号码当主叫，Twilio/运营商不放行；改为用被叫的 Twilio 号码当主叫（callerId）。未证实，需再试一通。
