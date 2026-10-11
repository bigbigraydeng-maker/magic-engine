---
id: 2026-10-12-finished-video-plan-handoff
title: 外部成片关联每日计划并进入广告待审素材池
status: decided
owner: agent
decided_on: 2026-10-12
source: session:01a12b1c-fbd6-7070-9283-0ad7952b18a6
verify_by: 2026-10-13
verify_how: 经 PM 授权上线后，用一条测试 MP4 验证客户素材库上传、每日计划按日期及平台预览、广告候选预览；确认原 Post 审批不变、重复提交不重复入池、归档文件不可预览；不发布、不调用投放供应商、不修改预算。若上线未获授权，只报告本地验证。
---

用户要求先打通成片进入 ME 每日计划与广告计划的草稿交接。A级：租户素材归属、并发保存与审批边界。

复用 `client_assets` / `vision_metadata`、现有每日计划和 `ad_strategy_configs.creative_pool`。文件关联记录绑定计划 ID、内容 revision、日期和平台；不会改写七天 `plan_data` 或原 Post 审批。读取只展示仍有效的同客户 MP4，陈旧关联不作为当前计划成片显示。

`client_video` 是客户素材库候选引用，不是假 Meta video ID，也不是制作工单。只能待审，现有执行审批入口拒绝它；正式广告准备与投放仍走后续授权流程。新增候选采用条件更新，保留已有候选和审批；审批写入同样采用条件更新，避免竞态覆盖新候选。

本地验收使用自制两秒测试 MP4、真实 multipart 请求、内存数据库和 Storage 替身。无生产写入、迁移、供应商调用、发布或花费。未确认的线路、价格和素材权利不因文件关联而获批准。

实现分支 `codex/cts-video-handoff`，基于 main `3a70f6e58f3c2106ebb43e044e18076e8a2dba4f`。上线及真实数据库回读仍待 PM 授权，不标记 verified。
