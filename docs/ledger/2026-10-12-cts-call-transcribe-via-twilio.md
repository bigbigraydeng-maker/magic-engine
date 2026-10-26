---
id: 2026-10-12-cts-call-transcribe-via-twilio
title: 通话转写改用 Twilio 自带转写，不再用 ElevenLabs（替代前一张「DeepSeek + ElevenLabs」卡的转写部分）；中文通话效果待验证
status: decided
owner: pm
decided_on: 2026-10-12
source: session:96dc6edf
verify_by: 2026-10-14
verify_how: 把 DEEPSEEK_API_KEY 和 TWILIO_INTELLIGENCE_SERVICE_SID 填到 Render 后，PM 打一通英文、一通中文测试来电：转写存下、分析每条事实带原话、触点标待复核；中文转写读不懂就给转写服务另建中文语言的服务
---
PM 说不用 ElevenLabs，转写走 Twilio 的转写服务（直接转它存的录音，复用已有令牌），分析仍用 DeepSeek。服务现为 en-US，PM 已在 Twilio 同意 AI/ML 附加条款；真实客人通话放开前仍需 CTS 书面同意并核对 Twilio、DeepSeek 的数据条款。
