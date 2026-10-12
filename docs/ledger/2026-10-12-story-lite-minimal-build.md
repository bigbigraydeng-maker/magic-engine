---
id: 2026-10-12-story-lite-minimal-build
title: Story 自动发布最小版（2 张表 + 授权 / 撤销 / 预览接口 + 每 10 分钟发布函数）：只演练，建表与真发都没批
status: decided
owner: pm
decided_on: 2026-10-12
source: session:61a3b5f4
verify_by: 2026-10-19
verify_how: 看最小版 PR 是否合并；看预览页 PR 是否已另开；建表、公开存储上传、真实 Meta 调用、真发开关每一项 PM 没另批就保持未做；到期时看 cloud-story-lite-publish 是否在 cron_run_logs 里每 10 分钟有记录（演练模式也有）
---
PM 10-12 回「最小版」：2 表、预览页（授权这一周 / 停）、授权 / 撤销接口、每 10 分钟定时函数，先只做 Facebook，授权 / 开关 / 待办照搬每日图文。
设计稿 docs/specs/2026-10-12-story-lite-design.md；建表 SQL 只写不执行：docs/migrations-sql/2026-10-12-story-lite-NOT-APPLIED.sql。
本机临时库端到端演练已跑通（假 Facebook），线上库没碰。

## 2026-10-12 建表（PM 本人回「建表」，经 74 号转述）
范围：只在线上库（项目 glbdnayojixmexgofbsd）建 story_packs / story_items 两张表，别的不动。真实 Meta 调用、公开存储上传、真发开关仍未批。
撤销方法（两表此时均为空表；若已有业务数据，先导出再删）：
`drop table public.story_items; drop table public.story_packs;`（先删 items，因为它引用 packs）

验证记录（2026-10-12 08:51 UTC，建表后立即回读）：migration `20261012_story_lite_tables` 已执行；story_packs 12 列、story_items 21 列，与代码一致；两表各 1 条策略（TO service_role，FOR ALL，USING true）、行级安全已开；匿名 / 登录角色权限 0，网页接口匿名读取返回 42501 permission denied；服务角色读取返回空数组（两表均 0 行）。用真实发布扫描对线上空表跑了一次演练（只读，不写、不调 Meta）：0 条记录、没有任何发送 / 取文件 / 发事件动作。
仍未批、仍未做：周包入库（公开存储上传）· 真实 Meta 调用 · 真发开关 · 预览页面。
