---
id: 2026-10-20-social-connection-g2-lite
title: TikTok 授权回来先查归属:账号已属别的客户 / 客户已有另一个账号就拒绝,并给管理员 TikTok 断开入口(G2-lite)
status: done
owner: agent
decided_on: 2026-10-20
source: doc:docs/specs/2026-10-20-social-connection-governance.md
verify_by: 2026-10-27
verify_how: 合并部署后在测试客户上:①用同一个 TikTok 账号连第二个客户 → 设置页提示「暂时无法连接,请联系团队核实」且库里没新增行;②同客户换另一个账号 → 提示「已连接另一个账号」;③管理员点「断开此 TikTok 授权」后再连成功。数据库唯一索引需 PM 说 go apply 才应用,应用前须确认没有重复的有效授权。
done_on: 2026-10-20
done_ref: pr:2959
---
精简版,不做:拦截时自动进今日待办、「确认并替换」卡片。已知缺口:被拦的尝试只在设置页横幅可见,没有自动待办;TikTok 刷新失败仍不标 error;唯一索引文件已写未应用(supabase/pending/20261020…_*)。 同一客户并发授权两个不同账号的窗口,唯一索引不兜底(不会串台,接受)。
