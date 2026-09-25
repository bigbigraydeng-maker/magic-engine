---
id: 2026-09-25-crm-c1a-list-server-side
title: CRM 升级 C1a：all/page.tsx 切换到 C0 的服务端分页/筛选/搜索
status: done
owner: pm
decided_on: 2026-09-25
source: session:beef24ba
verify_by: 2026-10-16
verify_how: 合并后 CTS 员工在 all 页能看到分页控件、阶段筛选按钮、搜索框防抖发请求；停留 3 周复核老表和 ME 打开天数比是否 ≤0.3（对齐方案 T1 验收）
done_on: 2026-09-25
done_ref: pr:2002
---
CRM 升级方案（pr:2000）第二轮 C1a。DeepSeek 一轮 $0.009；只改 all/page.tsx（+90/-18）。
不做（进 C1b）：URL 参数同步 · 复制视图链接 · 重要标记升级（原因+到期日）· PM 简版 4 列 · BatchEmail 搬进 · 新客人按钮。
