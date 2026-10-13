---
id: 2026-10-14-story-pack-five-items-removed
title: Story 周包撤下 5 条（图与字对不上或排版风险）：已把这 5 条置为「被拦」，授权与其余 13 条没动
status: decided
owner: pm
decided_on: 2026-10-14
source: session:61a3b5f4
verify_by: 2026-10-19
verify_how: 预览页或线上读 story_items：周包 91a3475d 里这 5 条是被拦（原因代码以 PM_REMOVED_20261014 开头）、其余 13 条仍待发布 / 已发；周包授权记录未变；每条被拦的都没有发出（没回执）
---
PM 10-14 在统筹窗口原话「撤 5 条」：10/15 20:00 Tianmen Mountain? Message us. · 10/16 13:00 Yuyuan, Shanghai · 10/17 20:00 Suzhou to Shanghai? Message us. · 10/18 08:30 Beijing's hutongs · 10/18 20:00 Beijing, Xi'an, Hangzhou and Shanghai? Message us.（图与字对不上或排版风险，非事实错误）。74 号转述执行：方向是让它不发、可回滚。
执行 新西兰 10/14 02:02：一条改库语句只动这 5 行（要求正好 5 行，否则整体回滚，实际 5 行），改前改后都读了：授权记录一字未动、其余 13 条仍待发布。
回滚：update story_items set status='PENDING', reason_code=null where pack_id='91a3475d-8fad-40ab-9609-5922a88f877c' and reason_code like 'PM_REMOVED_20261014%';（应影响 5 行）
副作用：今日待办会把这 5 条显示成「没发出去」，计划发完第 1 条后做小改动跳过它们。
