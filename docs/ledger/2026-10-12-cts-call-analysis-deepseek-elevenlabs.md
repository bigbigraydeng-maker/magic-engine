---
id: 2026-10-12-cts-call-analysis-deepseek-elevenlabs
title: 通话分析改用 DeepSeek（分析）+ ElevenLabs（转写），不再用 OpenAI（余额用完）；真实客人通话放开前要先核对这两家的数据条款
status: decided
owner: pm
decided_on: 2026-10-12
source: session:96dc6edf
verify_by: 2026-10-14
verify_how: 把两个密钥填到 Render 后，用 PM 一通新测试来电：转写存下、分析每条事实带原话、触点标待复核；Inngest 后台能看到分析任务已登记
---
DeepSeek 没有语音识别，所以转写用 ElevenLabs Scribe，分析用 DeepSeek；OpenAI 整个撤掉。DeepSeek 服务器在中国，真实客人通话放开前要 CTS 书面同意 + 核对两家的数据保留条款。
已知小缺口：英文数字词（four）与中文数字（四口）对不上时，事实会被安全丢弃而不是误收。
