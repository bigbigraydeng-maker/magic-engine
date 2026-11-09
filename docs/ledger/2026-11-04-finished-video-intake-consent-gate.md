---
id: 2026-11-04-finished-video-intake-consent-gate
title: 外部成片接进社媒流水线 + 共享出镜授权闸（周卡 / 转公开 / 真发三处都拦）
status: decided
owner: pm
decided_on: 2026-11-04
source: pr:3573
verify_by: 2026-11-06
verify_how: CTS China Panorama 客人出镜片登记后，工单 brief.engine=external_upload 且带 talent_consent（scope 只有 facebook_organic），output.maliang_check.check_version=v2，字幕/封面两项由马良结论改成 PASS/FAIL；PM 过审后发成草稿并进周卡；单条转公开前置检查对无授权外部片返回 409
---
设计 docs/specs/2026-11-04-finished-video-intake-design-v0.2.md（子牙、魏征设计复审并入）。外部剪好的成片登记成 content_work_orders 视频工单（同一个成片仓库，广告与归因同样从这里取），复用已有登记函数 admitFinishedVideo：只收存储桶相对路径、按路径去重、记出镜授权（confirmedBy 由服务端给）、登记后自动请马良 v2 审。共享授权闸 src/lib/factory/talent-consent.ts 默认不放行：外部片必须有授权、马良没看清就拦、查出人脸而没有授权就拦；接到每周闭环、单条转公开、发布 worker 真发分支。PM 11-04 确认客人同意出镜，范围先只记 Facebook 主页发帖。
