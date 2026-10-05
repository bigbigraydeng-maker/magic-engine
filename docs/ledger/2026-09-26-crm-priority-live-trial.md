---
id: 2026-09-26-crm-priority-live-trial
title: 4 段跟进视图对 CTS / NAL 真实数据当场试跑通过（没人凭空消失、分段只分组不改判），试跑脚本入库可复跑
status: done
owner: agent
decided_on: 2026-09-26
done_on: 2026-09-26
done_ref: pr:2045
source: session:5b9407a2
verify_by: 2026-10-03
verify_how: 重跑 `npx tsx --env-file=<.env.local> scripts/probe-crm-priority-view.ts`，两条断言都要成立：四段人数之和 = 联系人总数；每段人数 = 该段成员 segment 在平铺口径下的人数之和。任一条不成立说明分段跟判据脱钩了
---
PM 2026-09-26 定「以后才自动跑 / 会改变员工看到什么的东西，交付前必须当场手动触发一次」。#2045 是读路径，回头补这一次。
CTS：989 人 / 5039 条触点 → 客人在等你 221、还没搭上话 55、先放着 637、不在今天名单 76；合计 989 = 总人数，交叉核对逐段相等。
NAL：197 人 → 22 / 7 / 167 / 1；合计 197 = 总人数，交叉核对逐段相等。
两条断言都成立：没人凭空消失（2026-08-02 那次 33 人漏掉的事故形态不成立），分段只做分组、没有改判任何人的 segment。
试跑脚本落进 scripts/probe-crm-priority-view.ts，下次改判据或加段直接重跑，不用再手搓。
观察（不是结论）：CTS 的 callback_due 和 retry_channel 两段在 989 人里都是 0。两者分别依赖「员工在 ME 里记了回电日期」和「最近 3 天打过电话」，CTS 员工主要在 Google 表格和 Facebook 后台工作，为零合理；但也可能是信号没进来，碰这两段的判据前先查一遍。
