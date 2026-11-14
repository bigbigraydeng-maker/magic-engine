# 人声闸上线与整链试跑回执（2026-10-16 · 106 号）

授权：PM 本人回「升级出片机」（经 18 号转述，可逆操作，已按方案执行；回滚点 ccddfee15 随时可用）。

## 部署
- 出片机目录 `~/Projects/magic-engine-worker`：**ccddfee15 → fb444cc3854d249d2673b69e559b2ae0cff318e0**（PR 2718 的合并提交，含 2721、2719；未取更新的主干，限制变更面）。环境文件与素材镜像未动，无新依赖。
- 重启：`launchctl kickstart -k gui/<uid>/com.magicengine.factory-worker`；旧 PID 80069 → 新 PID 54261，启动 **2026-10-16 00:16:11Z**（NZ 13:16），日志 `worker 启动 id=mac-ray-cts-one-shot-20260830`；存活记录 00:16:12Z。
- 回读：`music-vocal-gate.mjs`（7791 字节）与 `catalog/music-vocals.json`（9 条，其中 3 条 present）存在且能加载；`node --check` worker.mjs / remotion-branch.mjs 通过。

## 整链试跑（5 单，只到待审，未发布；试完已标 superseded）
| # | 工单 | 曲子 | 期望 | 实际 |
|---|---|---|---|---|
| T1 | b867b215-be8d-4d2e-981c-a4c0f9a4268e | analytical-scholar_n（含人声） | 被拦 | **被拦** MUSIC_VOCAL_PRESENT，00:16:45Z，无成片 |
| T2 | a74745c3-f1cc-4df1-aba3-888eb7316ce8 | founders-in-motion_n（未登记） | 被拦 | **被拦** MUSIC_VOCAL_UNREGISTERED，00:17:18Z，无成片 |
| T3 | 7f30609e-c1ec-4258-9de8-63dba8a26f7d | horizons-call，起点 0 | 放行 | **放行**，00:18:57Z 出片完成；回执 `music_vocal_gate`：verdict none、strength approval-only、window [0,19]、cleanUntilSec 21、sha256 53e201d1… |
| T4 | c6f54860-cba9-41a2-8f42-d01d1fe12b5c | horizons-call，起点 5 | 被拦 | **被拦** MUSIC_VOCAL_UNKNOWN「需要 25s，已核验 21s」，00:19:29Z，无成片 |
| T5 | 687b2a6f-d91b-45ad-9a13-930fdcb319a5 | sunlit-kitchen-window，起点 0 | 放行 | **放行**，00:21:14Z 出片完成；回执 verdict none、approval-only、window [0,15]、cleanUntilSec 17、sha256 1efc49f9… |

结论：5/5 与期望一致，成功标准全部满足。回执位置：存储桶 `content-factory/renders/<客户>/<工单>/segments.json` 的 `music_vocal_gate`；出片机日志 `~/Library/Logs/magicengine-factory-worker.log`（试跑相关行已拷到证据包 `evidence/2026-10-16-tale-vocals/rollout/worker-log-trial-lines.txt`）。

## 边界
- 没有发布、没有改权限、没有注册 Founders in Motion；除试跑单本身外未写生产库。
- 之后用未登记曲（`_n/_q`、momentum、founders-in-motion_n 等）出片会被拦；旧版与 recipe 路径要求前 60 秒已核验，等于全拦（近 30 天 0 单）。
