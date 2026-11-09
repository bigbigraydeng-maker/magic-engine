# Remotion 包 A：音乐目录 + 自动节拍 + 清单模板 logo 改动（2026-10-06）

范围依据：`docs/specs/2026-10-06-remotion-template-catalog-and-selector.md` §3、§6 WP-A；PM 2026-10-06 回「开工」。风险级别 **B**（新增文件全在 `scripts/factory-worker/` 下，不碰 `package.json`，已用 `classifyFile` 核实）。基线：`origin/main` = `2d9ce0c8b`（2026-10-06 刷新）。

## 做了什么
- `scripts/factory-worker/tools/analyze-music.py`（71 行）：PM 备份里已验证的节拍检测原样改造，输出时长 / 检测 BPM / 首拍偏移 / 小节位。
- `catalog/music.json`：29 首（`Music` 12 + `_shared/music` 17），`cts_xmas_suno`（客户专属）、`_preview` 试听片段、`remotion-assets` 里的重复曲不入目录。
- `src/music.ts`（151 行）：目录校验、`effectiveBpm`（>150 折半）、`beatGrid` / `beatsFor`（出 props 里的 `beats`）、`stagedFileName`（props 里 `musicFile` 要写的安全文件名）。
- `src/timing.ts` / `src/ListReel.tsx`：logo 只在最后 `LOGO_BEATS = 2` 拍出现，不再常驻。
- `test/music.test.mjs`（30 条）；`schema.test.mjs` 末尾一行 import 把它带进 `npm test`（`package.json` 是受保护路径，不动）；README 加音乐一节。
- 写代码：DeepSeek 两轮（music.ts + 测试；logo 三处小改），合计约 US$0.016（含一次因 aider 自动答「否」没落盘的空跑 $0.008）；analyze-music.py 与目录数据由 Claude Code 改写/生成（前者是备份脚本的改造，后者是数据）。

## 与方案的差异（如实）
- 方案写「入库时没听过的先标待定」，实做**所有歌默认 `beats_unverified`（节拍还没量过，与版权无关），只有渲后量过偏差的转 `ready`**（目前只有 `pipa-trap`）。更严，因为其余 28 首的节拍没人量过。
- 行数：非测试代码约 240 行（≤300 ✓），测试 292 行（DeepSeek 写得偏详细，没砍）。

## 验证（目录 `scripts/factory-worker/engines/remotion`，Node v26.7.0）
| 命令 | 退出码 | 结果 |
|---|---|---|
| 修改前 `npm test` | 0 | 145 条全过（基线） |
| 修改前 `npm run type-check` | 0 | 通过 |
| 修改后 `npm test` | 0 | 176 条全过（+30 音乐、+1 logo 时间） |
| 修改后 `npm run type-check` | 0 | 通过 |
| 变异：①`firstIndex` 改恒 0 ②折半阈值 150→250 ③logo 起点 `-LOGO_BEATS`→`+` ④`effectiveBpm` 不折半 | — | 分别 4 / 8 / 2 / 4 条测试变红，恢复后全绿（只比对了失败条数，没逐个比对测试名） |
| 测试里第一轮 1 条失败 | — | 是**我写在提示词里的期望值算错**（折半示例应为 0.433/1.1/1.767），代码是对的，已改测试 |
未运行：仓库根 `npm test` / `build`（没动 `src/` 主站代码）；`render-smoke`（`RUN_REMOTION_RENDER` 未开，改为下面手工真渲）。

## 当场试跑（本机，成片在会话临时目录，不在仓库）
素材：ffmpeg 占位渐变镜头 + 占位 logo（不是真实镜头）+ 真音乐 `琵琶陷阱`（检测 139 BPM）；虚构「悉尼公寓」内容 7 个条目，27 拍。
| 版本 | 渲染 | 音画偏差（`qa.py`） |
|---|---|---|
| 旧：手写等间隔节拍 0.5s | 退出码 0，13.2 秒 | **−138 ms**；逐切点中位偏差 −73 ms，±50ms 内 12% |
| 新：`beatsFor` 自动节拍 | 退出码 0，12.1 秒，用时 31 秒 | **−10 ms**（目标 ±50 ✓）；逐切点中位偏差 +1 ms，±50ms 内 31% |
- 逐切点百分比**不是干净指标**：切点检测会把白闪衰减的几帧也算成切点，且不是每个拍点都有鼓点；以全局偏差为准。
- 新版 9 宫格逐格自检：文字、价格、logo 完整；logo 只在最后一格出现（前 8 格没有）；无错字。第 7 格是价格段入场白闪（原有 CutFlash），正常。
- **只验证了一首歌**；其余 28 首的折半与偏差没量过，所以都标 `beats_unverified`（节拍没量过，与版权无关）。**没有用真实 CTS 内容渲**（方案里写的是「CTS 真实 props」，本包用虚构内容，因为官网事实快照 #2270 当时未合并，价格团期不该手抄）。

## Reuse Statement
复用：R1 引擎与 `ListReel`、`SAFE_REL_PATH` / `MUSIC_EXTS` / `formatZodIssues`、PM 备份的节拍检测与 `qa.py`。新增均为 platform-shared（音乐目录、折算函数、分析脚本）；industry-specific 无；client-specific 无（客户专属曲已排除，测试断言目录文本不含客户名）。
