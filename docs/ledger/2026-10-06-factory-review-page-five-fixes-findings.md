---
id: 2026-10-06-factory-review-page-five-fixes-findings
title: 视频工厂审核页五项改进：查实结论已出，改代码待统筹放行（通过后去向目前只有 Facebook 通，其余未接通）
status: decided
owner: agent
decided_on: 2026-10-06
source: session:619710c8
verify_by: 2026-10-13
verify_how: 五项改完开出 PR 后，PR 正文「当场试跑」有本机截图和对话框假数据实测输出；配置链接由 PM 登录正式站点一次确认落在「视频工厂配置」那一节
---
读代码结论：通过后只有 Facebook Reel 出口真通（发不发公开取决于 Render 上的真发开关，未查）；TikTok、Publer、广告、每日计划均未接通；下载按钮缺。
配置链接错在默认落在「接通」页签，工厂配置在「内容与社媒」页签且默认折叠。对话框只认待审工单，空回复显示成「(没有回复)」。
未做：真浏览器点链接、对话框实测（无登录、无环境钥匙）。待办：口吻提醒「已接受」设计说明先交统筹看；Impeccable 检查需先获准下载。
