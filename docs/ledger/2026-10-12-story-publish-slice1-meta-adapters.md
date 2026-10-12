---
id: 2026-10-12-story-publish-slice1-meta-adapters
title: Story 发布第一刀（Facebook 主页 + Instagram 的发布零件）：只是零件，没人调用，真发 / 建表 / 周包入库都没批
status: decided
owner: pm
decided_on: 2026-10-12
source: pr:2499
verify_by: 2026-10-16
verify_how: 看 PR 2499 是否已合并；看 CTS Instagram 是否已登记进商务账户（台账 2026-10-09-cts-instagram-register-into-business）；真实 Meta 试跑、建表、周包入库、真发开关必须各自等 PM 另说，没说就保持原样
---
Story 自动发布第一刀：Meta 发布零件（共用请求/校验文件 + Facebook 主页 Story + Instagram Story，含离线测试），没有任何调用方、不碰数据库、不读环境变量、不联网、不带链接贴纸。
设计稿：docs/specs/2026-10-12-story-auto-publish-design.md（PR 2490）；总台账卡 2026-10-12-story-auto-publish-design。
未验证（要真实调用才知道）：视频上传请求头、Instagram Story 在 Facebook 登录下能否发、Story 有无定时参数。
