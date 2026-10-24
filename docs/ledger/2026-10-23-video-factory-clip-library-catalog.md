---
id: 2026-10-23-video-factory-clip-library-catalog
title: 视频工厂素材库进入 ME 工作台
status: done
owner: agent
decided_on: 2026-10-23
source: doc:docs/STATE.md
verify_by: 2026-10-30
verify_how: 用户要求不设 staging、直接进生产。兼容迁移已应用并核验到 CrazyContent，PostgREST 新列只读查询返回 HTTP 200；完成三方 agent 对最终冻结 head 的签字复审后，才合并触发生产自动部署。部署后验证旧的未核许可素材不会进入选片池、B 轨生成视频只继承已核许可的源图，并由两位不同 Supabase 用户完成新素材的许可人工声明及激活。任一项失败则停止上线。
done_on: 2026-10-23
done_ref: pr:3060
---

复用声明（Reuse Statement）：扩展现有 `video_clips` 和工厂选片，复用客户访问校验、content-factory 存储桶与 `validateClipPath`；未建平行素材库或自动地点识别。
实现：ME 客户工作台内批量上传、标签编辑、来源/许可人工声明与双人激活；旧命令行导入也写入待审核状态。
验证：基于当时的远端 main（提交号不抄在卡上，见完成指针）重放实现后，原有 58 个定向测试通过。新增 17 项定向测试通过，类型检查、ESLint、worker 语法检查与 `git diff --check` 通过。另在隔离本地 PostgreSQL 17 中重放 migration，并通过真实数据库租户范围、陈旧许可快照 CAS 拒绝及两个并发会话竞态检查；可重复 SQL 检查保存在 `supabase/tests/factory_clip_library_catalog.test.sql`。CrazyContent migration `factory_clip_library_catalog`（版本号见 supabase/migrations 里同名文件）应用成功；核验 17 个目标列、3 个索引、281 行数量不变、状态值无异常。生产 PostgREST 对新增列的只读查询返回 HTTP 200、0 行（仅验证 schema 暴露）。全仓此前有 50 项失败且未归因，本次未重跑。
边界：新激活路由现以当前审批用户 ID 验证第二人身份，避免 `reviewed_by_user_id` 尚未写入时把所有新素材误判为缺少复核人；回归测试证明批准请求已进入数据库 CAS 阶段。代码已随完成指针合并。这不等于已经部署，也不等于已经导入素材。许可状态表示人工声明；证据记录绑定来源页、许可页和文件 SHA-256，但不代表系统独立证明许可证真实性。双人审核以不可变 Supabase 用户 ID 区分。旧的未核 A 轨和 AI 改图会从新选片池排除；B 轨视频必须有匹配的人工许可记录，或明确关联到已核许可的 AI 改图源图，否则不会入选。存量未核素材会暂时退出选片池。
