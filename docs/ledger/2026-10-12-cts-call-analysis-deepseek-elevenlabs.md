---
id: 2026-10-12-cts-call-analysis-deepseek-elevenlabs
title: 通话分析改用 DeepSeek（分析）+ Twilio 自带转写（转写），不再用 OpenAI / ElevenLabs；真实客人通话放开前要先核对 Twilio 与 DeepSeek 的数据条款
status: decided
owner: pm
decided_on: 2026-10-12
source: session:96dc6edf
verify_by: 2026-10-14
verify_how: 把 DEEPSEEK_API_KEY 和 TWILIO_INTELLIGENCE_SERVICE_SID 填到 Render 后，用 PM 一通新测试来电：转写存下、分析每条事实带原话、触点标待复核；再用一通中文来电确认转写语言够用（服务现为 en-US）
---
DeepSeek 没有语音识别，所以转写用 Twilio 自带的转写服务（直接转它存的录音，PM 2026-10-12 拍板不用 ElevenLabs），分析用 DeepSeek；OpenAI 整个撤掉。DeepSeek 服务器在中国，真实客人通话放开前要 CTS 书面同意 + 核对 Twilio 与 DeepSeek 的数据保留条款。转写服务语言现为 en-US，中文通话是否够用未验证。
已知小缺口：英文数字词（four）与中文数字（四口）对不上时，事实会被安全丢弃而不是误收。
