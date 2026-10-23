---
id: 2026-10-23-video-factory-clip-library-catalog
title: 视频工厂素材库进入 ME 工作台
status: in_progress
owner: agent
decided_on: 2026-10-23
source: doc:docs/STATE.md
verify_by: 2026-10-30
verify_how: 用户要求不设 staging、直接进生产。合并前完成三方 agent 复审与目标库只读预检；之后按迁移流程将 schema 迁移应用到已核实的 CrazyContent 项目，再部署应用，用新素材走上传、许可证据记录、人工激活和选片流程。每一步保存可核对结果；迁移或隔离验证失败则停止上线。
---

复用声明（Reuse Statement）：扩展现有 `video_clips` 和工厂选片，复用客户访问校验、content-factory 存储桶与 `validateClipPath`；未建平行素材库或自动地点识别。
实现：ME 客户工作台内批量上传、标签编辑、来源/许可核验与人工激活；旧命令行导入也写入待审核状态。
验证：基于当前远端 `main`（`20da9966ecafe24392ff733568a4464017665cb1`）重放实现后，原有 58 个定向测试通过。本次许可范围审计修订的素材目录与 API 授权测试共 13 项通过；类型检查和 `git diff --check` 通过。全仓测试此前有 50 项失败、尚未归因；本次未重跑全仓。
边界：代码实现和定向测试完成不等于生产功能上线。当前 PR 尚未合并，迁移尚未应用，应用尚未部署，也未导入素材。许可核验记录是人工审阅者对证据页和允许用途的声明，不是系统独立证明许可证真实性；激活前需保存证据摘要，并逐项确认商业使用、剪辑/改编和网络平台发布范围。
