---
id: 2026-10-14-publishing-calendar-columns-applied
title: 线上加了两列（客户发布日历配置、Story 角色）并给 CTS 填名额 2/3/3、给现周包回填角色
status: decided
owner: pm
decided_on: 2026-10-14
source: session:61a3b5f4
verify_by: 2026-10-21
verify_how: 线上读：clients.publishing_calendar_config 与 story_items.role 两列在、可空、无默认值；CTS 名额是 2/3/3；周包 91a3475d 的 18 条各有角色（08:30 灵感 / 13:00 事实 / 20:00 邀请私信）；发布日历页显示名额与角色；其余已有数据没变
---
PM「放宽加列」（经 74 号转，统筹定线：可空、可回滚、不动已有数据）。执行 新西兰 10/14 03:33（UTC 10/13 14:33），迁移名 20261014_publishing_calendar_config，两列都可空、无默认值。
前后核对：clients 35 行、story_items 54 行，去掉新列后的整表指纹改前改后一致（一字未动）；填值：CTS 名额 2/3/3，周包 18 条（含被拦的 5 条）按序号对应回填，条目内容指纹不含角色，授权与发布不受影响。
回滚（两句）：alter table public.story_items drop column role; alter table public.clients drop column publishing_calendar_config;
