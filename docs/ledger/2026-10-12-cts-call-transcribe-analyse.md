---
id: 2026-10-12-cts-call-transcribe-analyse
title: 通话录音转写与分析（待复核）这一块写好了，先只处理 PM 自己的测试录音；默认关，真实客人通话要 CTS 书面同意后才开
status: decided
owner: pm
decided_on: 2026-10-12
source: session:96dc6edf
verify_by: 2026-10-14
verify_how: 迁移应用并把测试连接的 analysis_enabled 打开后，用一通 PM 自己的测试来电：录音进私有桶、转写存下、分析里每条事实都带原话、触点元数据带「待复核」标记；故意让转写失败一次，确认状态是 failed 且没有假摘要
---
走 OpenAI（对外 Content Engine，已拍板的现有供应商）。分析只写待复核，不改联系人、不进学习样本；每条事实必须带转写里能找到的原话，编造的会被丢弃并计数。
真实客人通话放开前必须：CTS 书面同意 + 核对 OpenAI 数据保留/训练条款 + 录音告知文案确认。
