# 音乐人声闸「上线与整链试跑方案」（一页）

> 106 号 · 2026-10-16 · 对象：PR 2718（人声闸，头提交 8f097003，已合并）+ PR 2721（受保护路径，已合并）。
> **本方案是方案，没有执行；升级出片机 = 部署，需 PM 另行授权后才做。** 授权人回复「升级出片机」即可开始，执行人 106 号。

## 0. 现状（已核实）
- 出片机：`~/Projects/magic-engine-worker`（脱离分支检出），当前提交 **ccddfee15**，开机自启任务 `com.magicengine.factory-worker`，环境文件 `scripts/factory-worker/.env`（本次**不改**）。
- 闸的登记表随代码一起上线（`engines/remotion/catalog/music-vocals.json`，9 条：3 条含人声 + 6 条回填的弱证据）；**没有新依赖**，不需要 `npm ci`。
- 此刻队列：无 queued / claimed / producing 工单（上线当天再核一次）。

## 1. 上线前检查（必须全过再动）
1. 库里 `content_work_orders` 状态为 queued/claimed/producing 的数量 = 0；若 >0，等它们出完或与 18 号商量。
2. 出片机在线：`cron_run_logs` 的 `factory-worker-alive` 最近一条 ≤10 分钟。
3. 记下要上线的 main 提交 SHA（含 2718 合并提交），在 `~/Projects/magic-engine` 里 `gh pr view 2718 --json mergeCommit` 取得。
4. 备份：记录当前出片机提交 `ccddfee15`；`.env` 不动。

## 2. 升级步骤
```bash
cd ~/Projects/magic-engine-worker && git fetch origin && git checkout --detach <main 上的合并提交 SHA> && git rev-parse --short HEAD
launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker
```
然后核：①新进程已起（`launchctl list | grep factory-worker` 有 PID）；②2 分钟内 `factory-worker-alive` 出现新一条；③`git rev-parse` 等于上线 SHA。

## 3. 整链试跑（真实出片机、真实登记表、只出到待审、**不发布**；每张试跑单角度标注「VOCAL GATE TRIAL (not for review)」，预算 $0.5，试完把它们标为 superseded 以免进 PM 的待审清单）
| # | 试跑单（拷自哪张） | 曲子 | 期望 | 要看到什么 |
|---|---|---|---|---|
| T1 | 拷 Tale v3 ef24296d，改 musicFile=`music/analytical-scholar_n.mp3` | 含人声 | **被拦** | 单子失败，错误含「音乐人声检查没过…MUSIC_VOCAL_PRESENT」，无成片、渲染没启动 |
| T2 | 拷 Tale v3 原样（founders-in-motion_n） | 未登记 | **被拦** | 错误含 MUSIC_VOCAL_UNREGISTERED（待 PM 点通过 v3 并另开 A 级 PR 登记后，这条会变放行） |
| T3 | 拷 Panorama v4 cb752a8f（horizons-call，起点 0，约 19.0s） | 弱证据窗口到 21s | **放行** | 到待审；`segments.json` 的 `music_vocal_gate` 回执：verdict=none、strength=approval-only、cleanUntilSec=21 |
| T4 | 拷 T3，`musicStartSec`=5 | 同上，窗口越界（5+19+1>21） | **被拦** | MUSIC_VOCAL_UNKNOWN（人声窗口未覆盖） |
| T5 | 拷 fd7e3e5a（sunlit-kitchen-window，起点 0，约 15.0s） | 弱证据窗口到 17s | **放行** | 同 T3 的回执，window≈[0,15.019] |
成功标准：T1/T2/T4 被拦且**没有任何渲染产物**，T3/T5 放行且回执字段齐全；任一不符 = 试跑失败，立即回滚。

## 4. 回滚（任何一条触发就做）
触发：已登记曲子的真实工单被误拦；出片机崩溃重启循环；`factory-worker-alive` 断档 >10 分钟；试跑不符。
```bash
cd ~/Projects/magic-engine-worker && git checkout --detach ccddfee15
launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker
```
再核存活与提交号；回滚后闸即失效，**期间禁止用没听过的新曲出片**。

## 5. 上线后
- 核对 T1–T5 回执，贴进台账；`docs/ledger/2026-10-16-music-vocal-gate-code-pr.md` 记 done（done_ref=pr:2718）并按其 verify_how 验证。
- 新增/换曲子出片前必须真人听过并经 A 级 PR 登记（PM 点通过 v3 后，由 18 号通知我开登记 Founders in Motion 的 A 级 PR）。
- 已知后果：用 `_n/_q` 版、momentum、founders-in-motion_n 等**未登记曲**出片会被拦；旧版与 recipe 路径要求前 60 秒已核验，等于全拦（它们近 30 天 0 单）。
