---
id: 2026-10-23-video-factory-clip-library-catalog
title: 视频工厂素材库进入 ME 工作台
status: done
owner: agent
decided_on: 2026-10-23
source: doc:docs/STATE.md
verify_by: 2026-10-30
verify_how: 在 staging 应用目录迁移后，用一个新视频走许可核验和人工激活，并确认标签参与工厂选片。
done_on: 2026-10-23
done_ref: commit:af90e1936
---

复用声明（Reuse Statement）：扩展现有 `video_clips` 和工厂选片，复用客户访问校验、content-factory 存储桶与 `validateClipPath`；未建平行素材库或自动地点识别。
实现：ME 客户工作台内批量上传、标签编辑、来源/许可核验与人工激活；旧命令行导入也写入待审核状态。
验证：基于当前远端 `main`（`20da9966ecafe24392ff733568a4464017665cb1`）重放实现后，58 个定向测试通过（包括 5 个 API 授权、客户范围及许可闸测试，以及 23 个底层客户访问测试）；类型检查、改动文件 lint、策略检查、CLI 语法检查和使用构建专用 Supabase 占位环境的生产构建通过。全仓测试没有完成；此前一次尝试观察到其他架构/台账门禁失败和受限 socket 测试超时，当前归因未确认。
边界：本机没有可用的 Docker / Supabase CLI 运行环境，因此未完成隔离数据库重放或 migration lint；迁移未应用、生产库未访问、未部署、未上传本地 CTS 素材。staging 应用迁移后的真实上传、许可核验、激活及选片集成验证仍待完成。
