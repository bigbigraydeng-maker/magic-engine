---
id: 2026-10-12-cts-twilio-number-registration-in-review
title: CTS 的 Twilio 新西兰号码合规注册已提交，等批准后才能买号码并做第一通真实测试来电
status: decided
owner: pm
decided_on: 2026-10-12
source: pr:2468
verify_by: 2026-10-13
verify_how: 看 Twilio 注册状态：批准→选地址、PM 看到价格（那个新西兰号码，每月 3.15 美元）回「买」、填 voice/status 回调地址、用受控号码打 3 通+响铃中挂断 1 通，查原始事件/通话状态/客户记录各一条；被退回→按原因补材料
---
注册名义是 China Travel Service (N.Z.) Limited（CTS 同意），证明文件由 PM 本人上传；Twilio 账号已升级，主档案已批准。
连接记录与令牌已就绪：生产库 telephony_connections 里有 CTS 的 Twilio 连接，环境变量 TWILIO_AUTH_TOKEN_CTS 已生效。
未做：员工点击拨号、录音下载/转写/摘要、按键确认接听（接真实客人线路前必须，见另一张台账卡）。
