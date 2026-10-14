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
PM 10-12 回「最小版」：2 表、预览页、授权 / 撤销接口、每 10 分钟定时函数，先只做 Facebook；设计稿 docs/specs/2026-10-12-story-lite-design.md。
10-12 PM 本人回「建表」：线上库只建 story_packs / story_items 两张（空表），已执行并回读，建表文件 docs/migrations-sql/2026-10-12-story-lite.sql。
验证（2026-10-12 08:51 UTC）：两表 12 / 21 列、各 1 条仅 service_role 的策略、匿名读被拒（42501）、服务角色读到空；线上空表跑一次只读演练扫描：0 条、没发没调 Meta。
撤销：先 drop table public.story_items; 再 drop table public.story_packs;（空表时安全，有数据先导出）。
仍未批：真实 Meta 调用 · 真发开关；周包入库已另记。
