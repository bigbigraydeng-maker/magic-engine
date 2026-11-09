---
id: 2026-10-14-crm-new-untouched-epoch-gap
title: 全部客人「该做什么」里出现「进线 20739 天 还没人联系」：没有来信时间的客人被拿 1970 年当进线时间算 → 没有时间就不说时间
status: done
owner: agent
decided_on: 2026-10-14
done_on: 2026-10-14
done_ref: pr:2577
source: session:1a85e0eb
verify_by: 2026-10-21
verify_how: 全部客人里「今天要联系」段，WhatsApp Business、Dan Sun 这类没留联系方式的客人，原因文字改为「进线了，还没人联系」，不再出现 20739 天
---
PM 2026-10-14 截图。根因：segments.ts 里 lastInbound 为 0（这个人没有任何来信记录）时，仍拿 0 去算「进线多久」，得到从 1970 年起的 20739 天。修法：没有来信时间就只写「进线了，还没人联系」。新增一条回归测试（去掉修复即变红）；没有改分段规则本身。
