---
id: 2026-09-27-ads-circuit-breaker-observe-not-deny
title: 广告自治装上熔断器：五条判据里前四条把开关降回「只观察」，第五条（数据没采全）只冻结当天、次日自动恢复
status: done
owner: agent
decided_on: 2026-09-27
source: session:d9b147f8
done_on: 2026-09-27
done_ref: commit:071230667a69
verify_by: 2026-10-04
verify_how: 表建好之后，人为把某个客户的日预算上限调到低于当前预算，看两件事——今日待办里出现「自治被降回只观察」那张卡（含去哪拨开关的链接），以及事件账本里当天这个客户有五行（每条判据一行）。少了待办说明下发通道没接上；账本只有一行说明写入被覆盖了。
---
熔断的落点是 ad_strategy_configs.autonomy_mode='observe'，**不是** deny：数据库那一列的取值只有 observe / bounded_auto 两档，写 deny 会被直接拒；而 deny 是管理员手工硬闸，熔断器不当它的写入者。
判定是纯函数（circuit-breaker.ts），落库另一半（circuit-breaker-apply.ts）先记账再止损——记账失败也照样止损，否则「账没记上」会变成「钱继续烧」。
第五条跟前四条分档：数据没采全只冻结当天、不改开关、不需要人点；同一天花费判定回答「数据不全，未判」，不做低置信度继续算。
只有「降回只观察」才出今日待办；当日冻结不出（次日自动恢复，进待办就是噪音）。
