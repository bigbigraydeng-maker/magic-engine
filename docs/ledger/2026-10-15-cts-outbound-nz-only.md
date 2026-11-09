---
id: 2026-10-15-cts-outbound-nz-only
title: CTS 外呼（点击外呼和以后的 AI 外呼）默认只放行新西兰号码，澳洲和其他国家要在服务器设置里显式加才放行
status: decided
owner: pm
decided_on: 2026-10-15
source: session:96dc6edf
verify_by: 2026-10-17
verify_how: 合并部署后，对测试客人把号码临时改成澳洲号码点「用 CTS 号码拨打」，接口返回「这个号码所在地区暂不支持外呼」且不发起通话；新西兰号码仍能正常拨
---
PM 2026-10-15 经统筹转述「限新西兰」。只收紧放行范围，不改别的外呼闸；环境变量 TELEPHONY_OUTBOUND_COUNTRIES 仍可覆盖。
