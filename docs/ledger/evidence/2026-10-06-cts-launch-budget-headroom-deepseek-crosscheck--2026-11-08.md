# 证据 · 2026-10-06-cts-launch-budget-headroom-deepseek-crosscheck · 2026-11-08
fetched_at: 2026-11-08T21:35:34+13:00
查了什么：①对拍证据文件是否仍写「3005 组一致」；②PR 2285、2309 正文是否已改成「已独立重写对拍，一致」；③此后有没有人改过 launch-budget-headroom.ts（改了就要重跑对拍）。
数字（带样本量、两边取数状态）：
- docs/ledger/evidence/2026-10-06-launch-budget-headroom-crosscheck.md 第 17 行：「样本 3005 组，两份输出一致 3005 组，不一致 0 组」；变异检验（<= 改 <）抓到 5 组不一致。
- gh pr view 2285 正文「DeepSeek 使用情况」段：「3,005 组样本逐项输出完全一致……保留现有文件（#2332）」；gh pr view 2309 正文同段「补充」：「3,005 组逐项一致，保留现有文件（#2332）」。两个 PR 均 MERGED。
- git log -- src/lib/ads-strategy/launch-budget-headroom.ts（origin/main 84bef08e2）：只有 1 次提交 c8e8ebea9（2026-10-06，建文件），之后没人改过，不需要重跑对拍。
来源/命令：grep 证据文件；gh pr view 2285/2309 --json body；git log -- src/lib/ads-strategy/launch-budget-headroom.ts
结论：成。三项都满足。
