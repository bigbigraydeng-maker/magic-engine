---
id: 2026-10-24-outcome-level-evidence
title: 销售目标不能用点击或线索充当成交
status: done
owner: agent
decided_on: 2026-10-24
source: issue:3079
verify_by: 2026-10-31
verify_how: 在含本模块的分支运行 npx vitest run src/lib/strategy/__tests__/outcome-levels.test.ts，退出码为 0；销售意图下点击键与线索键被拒绝，原因写明不能代替成交。接到目标保存或现值刷新之前，线上行为不变。
done_on: 2026-10-24
done_ref: commit:bed052e7d17b9e45185c3feab3dfc0dc620b3c1d
---
纯函数按指标目录把结果分成曝光/点击、联系成功、合格线索、成交。联系成功目前没有目录键。
报名数标明是笔数，不是座位，也不是线索。本卡不改取数、不改调用点。
下一步接到目标现值刷新：先判断再写入。被拒绝的键保持未知，不写成 0，也不写成成交。
