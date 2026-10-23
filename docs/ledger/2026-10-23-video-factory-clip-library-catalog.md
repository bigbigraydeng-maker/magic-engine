---
id: 2026-10-23-video-factory-clip-library-catalog
title: 视频工厂素材库进入 ME 工作台
status: in_progress
owner: agent
decided_on: 2026-10-23
source: doc:docs/STATE.md
verify_by: 2026-10-30
verify_how: 用户要求不设 staging、直接进生产。先完成三方 agent 复审与 CrazyContent 目标库只读预检；将兼容迁移应用并核验到 CrazyContent 后，才合并触发生产自动部署。部署后验证旧的未核许可素材不会进入选片池、B 轨生成视频只继承已核许可的源图，并由两位不同 Supabase 用户完成新素材的许可人工声明及激活。另需完成真实 Postgres/Supabase 迁移、租户隔离和并发 CAS 验证；逐项保存结果，任一项失败则停止上线。
---

复用声明（Reuse Statement）：扩展现有 `video_clips` 和工厂选片，复用客户访问校验、content-factory 存储桶与 `validateClipPath`；未建平行素材库或自动地点识别。
实现：ME 客户工作台内批量上传、标签编辑、来源/许可人工声明与双人激活；旧命令行导入也写入待审核状态。
验证：基于当前远端 `main`（`20da9966ecafe24392ff733568a4464017665cb1`）重放实现后，原有 58 个定向测试通过。新增 14 项定向测试通过，类型检查、ESLint、worker 语法检查与 `git diff --check` 通过。定向 API 测试使用 mock；真实数据库租户隔离及并发 CAS 集成测试仍缺，全仓此前有 50 项失败且未归因，本次未重跑。
边界：代码实现和定向测试完成不等于生产功能上线。当前 PR 尚未合并，迁移尚未应用，应用尚未部署，也未导入素材。许可状态表示人工声明；证据记录绑定来源页、许可页和文件 SHA-256，但不代表系统独立证明许可证真实性。双人审核以不可变 Supabase 用户 ID 区分。旧的未核 A 轨和 AI 改图会从新选片池排除；B 轨视频必须有匹配的人工许可记录，或明确关联到已核许可的 AI 改图源图，否则不会入选。存量 B 轨来源仍需逐条分类，未分类素材会暂时退出选片池。
