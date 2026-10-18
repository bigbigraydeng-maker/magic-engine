# 出片机测试接进 CI · 设计稿（A 级：改 `.github/workflows`，草稿 PR，须 PM 本人回「合 N」）

> 106 号 · 2026-10-18 · 18 号要求：先出设计——哪些测试接、跑多久、失败怎么提示、会不会误伤现有 PR；别扩大范围。

## 1. 问题（已核实）
- `.github/workflows` 里**没有任何一条**跑 `scripts/factory-worker` 下的测试：`pr-application-validation.yml` 只跑「CRM focused tests」（指定几个 CRM 文件）+ 类型检查 + 构建；`ops-review-loop-ci`、`ai-orchestrator-ci`、`kernel-architecture`、`tour-catalog-boundary`、`ledger-check` 各跑自己的子集。没有「全量 vitest」。
- 所以出片机的测试——人声闸、文字/红线复扫接线、渲染拒单、回填工具、配方序列（共 **296 条 vitest + 511 条引擎 node:test**）——**只在谁改谁本机跑**。「检查全绿自动合」对这类文件没有把关作用；删掉一个闸的测试，CI 照样绿（正是魏征 10-16 提过的「闸被悄悄改弱」风险）。

## 2. 接哪些测试（只接这两套，不扩大）
1. **出片机 vitest**：`npx vitest run scripts/factory-worker`（8 个文件 / 296 条：`worker`、`worker.recipe-sequence`、`creative-recipe`、`remotion-branch`、`remotion-postcard-branch`、`remotion-assets-stage`、`music-vocal-gate`、`tools/backfill-music-vocals`）。
2. **Remotion 引擎 node:test**：`cd scripts/factory-worker/engines/remotion && node --test test/*.test.mjs`（511 条：模板校验、`no-client-facts`、模板接线测试等）。真渲染冒烟 `render-smoke` 仅在 `RUN_REMOTION_RENDER=1` 时跑，**CI 不设**（需要 Chrome+ffmpeg，几分钟，不接）。
- **不接**：`inngest-pilot` / `inngest-cts-workflow` / `worker-inngest-bridge`（node:test、需 inngest 包，由该包自己的脚本跑；根 vitest 已排除）；任何真渲染、任何联网/调用外部服务的东西。

## 3. 跑多久、要装什么（本机在干净检出上实测）
- 干净检出 `origin/main`（6d9e822d5）：引擎 `npm ci --ignore-scripts` **3 秒（有缓存）/ 264 个包 / 367MB**，冷缓存预计 30–60 秒；vitest **2.0 秒**；引擎 node:test 几秒。整个 job 预计 **约 2–4 分钟**（大头是根目录 `npm ci`，其它 workflow 也在付这个钱）。`timeout-minutes: 15`。
- **环境依赖实测**：把 PATH 里的 ffmpeg / ffprobe / tesseract 全去掉再跑：vitest 296 全过、引擎 507 全过（0 失败；少的 4 条是本机有 ffmpeg 才执行的用例，在 CI 里自然跳过）→ **不依赖外部二进制**。
- Node ≥ 22.18（引擎直接 import `.ts` 靠类型剥离）：`setup-node '22'` 取最新 22.x，job 里加一步显式断言版本。
- 引擎依赖用 `--ignore-scripts`：不触发任何安装脚本、不下载浏览器。

## 4. 失败怎么提示
- 沿用既有 CI 做法：`--reporter=verbose` 把每条断言名打进日志；失败时 `if: failure()` 往 `GITHUB_STEP_SUMMARY` 写一段人话（「哪个套件、本机复现命令、这些测试守的是人声闸/红线复扫接线/渲染拒单，不要跳过」）；最后一步「确认没改工作区」（和 ops-review-loop CI 一样，测试若改了文件就红）。
- 检查名固定 **`factory-worker-tests`**。把它加成**必过检查**要在 GitHub 的 `Protect main` 规则集里加一行——这是仓库设置，**不在本 PR 内**，由 PM/18 号决定；在加入前它是「可见但不强制」。

## 5. 会不会误伤现有 PR
- 每个 PR 都会多跑这一项（不加路径过滤——和 ops-review-loop CI 同一个理由：过滤过的必过检查会让没触发的 PR 永远 Pending 死锁）；只读、无 secrets，不会改任何东西。
- **误伤风险**：①当前 main 上这两套测试全绿（本机干净检出实测），所以不会让现有 PR 一合并就红；②它们只用注入的假件和临时目录，不联网、不读本机路径、不依赖时间（实测无 flaky 迹象），但**我无法在 GitHub 上提前证明冷环境一定通过**——所以本 PR 先作为**非必过**检查观察几个 PR，确认稳定后再升为必过；③别人改 `scripts/factory-worker` 时如果测试本来就坏着，会在这里第一次暴露——这是目的，不是误伤。
- 不改任何现有 workflow，不改任何测试，不改业务代码。

## 6. 风险级别与验收
- **A**（`.github/workflows/` 受保护路径）：草稿 PR、正文「风险级别：A」、PM 本人回「合 N」，不得 `--admin`。
- 验收：①本 PR 自身的 `factory-worker-tests` 在 GitHub 上跑绿（**已跑绿：Node 22.x 真实运行通过**）；②**破坏演示（两套测试各一条）**：另开一次性草稿分支，**同时**把根 vitest 里一条出片机测试改弱（例如人声闸「未登记即拒」的断言改成放行）、把引擎 node:test 里一条改弱（例如 `template-wiring` 的接线断言）→ 检查必须变红；两套是独立的，漏演示任何一套都不算验证；演示完关掉分支；③确认合并后在下一个无关 PR 上也出现并通过。
- **观察期退出条件（子牙复核补）**：先作为「可见但不强制」的检查，**连续 5 个无关 PR 全绿**后，再由 PM/18 号决定是否在 `Protect main` 里升为必过；期间若出现一次非代码原因的红（网络、缓存、版本），先修 workflow 再重新计数。
- **版本与行为说明（魏征复核补）**：本机只有 Node 26，CI 用 Node 22.x——引擎直接 import `.ts` 靠 22.18 起默认开启的类型剥离，workflow 里有显式版本断言；本 PR 在 GitHub 上的运行（Node 22）已通过。`remotion-branch.test.mjs` 里 `skipIf(!hasEngine)` 的 2 条用例：没装引擎依赖时「294 过 2 跳」，装了「296 全过」（会真加载引擎、渲染函数是假的、不开浏览器），所以**引擎依赖安装必须排在 vitest 之前**（workflow 现在就是这个顺序，不要调换）。

## 7. 不做什么
不改 `Protect main` 规则集（设置，非代码）；不接真渲染；不接 inngest 那三个；不把根 `npm test` 全量接进 CI（范围太大，另议）；不改测试内容。
