---
id: 2026-09-25-crm-c1b1x-pin-column
title: CRM 升级 C1b-1x：all 页加"⭐置顶"列（用现有 pin 接口）
status: done
owner: pm
decided_on: 2026-09-25
source: session:beef24ba
verify_by: 2026-10-02
verify_how: 合并后员工能在 all 页点星标切换某人的置顶状态；后端 contacts.pinned_at 字段变化；C1b-1y 会接着加"原因+到期日"两个新字段
done_on: 2026-09-25
done_ref: pr:2003
last_checked: 2026-10-04
---
方案 pr:2000 §7 C1 的第一小块（板桥硬伤 2 起步）。DeepSeek 一轮 $0.01；只改两个文件；tsc 0 新增，7 个既有测试全过。
下一轮 C1b-1y：migration + 新 PATCH /important 接口 + UI 支持"原因+到期日"（要 migration，B 级）。
