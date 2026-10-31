# 视频工厂 / 视频能力文档索引

> 负责：ME Video（视频工厂） ｜ 范围：视频工厂与视频模板相关的通用文档索引 + 能力文档统一写法（客户专属文档 `docs/clients/...` 不列入）
> 状态：**已采用（索引本身）；所列文档状态以各自文件为准，本索引只核对过标注「已读头部」的几份** ｜ 日期：2026-10-27 ｜ 最后核实：2026-10-27 ｜ 风险：C（仅文档）
> 依据：`docs/FILING.md`（`sops/` 放可复用操作手册）· `docs/skill-cards/README.md`（索引表格式）· `docs/sops/2026-10-19-social-agent-playbook-and-rules-v1.0.md`、`docs/sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md`（文件头写法）

只做链接，不搬动、不改名现有文件。

## 统一写法（能力类文档）

**文件头**：标题下一个引用块，三行，沿用社媒/广告手册写法。

```text
> 负责：<谁对内容负责> ｜ 范围：<管什么、不管什么>
> 状态：<草案 / 已核实 / 已采用 / 作废>（可附一句限定） ｜ 日期：<YYYY-MM-DD> ｜ 最后核实：<YYYY-MM-DD> ｜ 风险：<A / B / C>（<一句理由>）
> 依据：<代码路径、文档路径；核不了的写「未核实」并在末章说明>
```

- **状态**：草案（没对照代码）→ 已核实（对照过，写清核了什么）→ 已采用（团队按它做）→ 作废（写替代物）。
- **最后核实**：最近一次对照代码/现状的日期；超过 30 天没核实的，使用前先复核。
- **风险**：沿用 A/B/C 质量闸（见 `docs/ENGINEERING_QUALITY_GATES.md`）；纯文档为 C。
- **客户中立**：通用文档里示例只写「示例客户」，不写真实客户名、客户 ID、token、密钥、私有链接。

**章节顺序**：结论 → 流程 → 规则/闸 → 现状与差距 → 改进清单 → 依据与未核实项。

- 没有的章节写「无」，不改顺序，方便跨文档对照。
- 数据来自库、代码里核不了的数字，标「数据快照 <日期>」，不当成已核实事实。
- 「未核实」不许留成悬空：要么给结论，要么在末章写明为什么核不了。

## 索引

「格式」列：✅ = 已按本写法；待补 = 内容未改，格式以后有人改动该文件时顺手补，不在本次改写。「最后核实」只写本次真正打开读过头部/对照过的日期，空白 = 未逐份核实。

### 手册 / 规则

| 文件 | 一句话用途 | 状态 | 最后核实 | 格式 |
|---|---|---|---|---|
| [视频模板画廊目录 v1.0](2026-10-27-video-template-catalog-v1.0.md) | 五个出片模板各适合什么、能调什么、这次预览里哪里好看哪里别扭 | 已核实（对照代码；画面结论来自纯色占位，见该文末章） | 2026-10-27 | ✅ |
| [视频模板优化手册 v1.0](2026-10-27-video-factory-template-playbook-v1.0.md) | 入库闸、渠道分流、数据回流、模板问题与改进清单 | 已核实（3 处核不了，见该文末章） | 2026-10-27 | ✅ |
| [视频工厂交接给 97 号](2026-10-15-video-factory-handoff-to-97.md) | 视频工厂/社媒交接边界 | 未逐份核实 | | 待补 |
| [讲座视频制作](lecture-video-production.md) | 讲座类视频的制作步骤 | 未逐份核实 | | 待补 |

### 设计 / 规格

| 文件 | 一句话用途 | 状态 | 最后核实 | 格式 |
|---|---|---|---|---|
| [Remotion 明信片模板设计](../specs/2026-10-15-remotion-postcard-template-design.md) | postcard 模板设计 | 文件头写「设计稿 v2」（模板已落地，代码见 `scripts/factory-worker/engines/remotion/src/PostcardReel.tsx`） | 2026-10-27（仅头部） | 待补 |
| [明信片 Story 变体设计](../specs/2026-10-15-postcard-story-variant-design.md) | postcard 的故事版变体 | 未逐份核实 | | 待补 |
| [Codex 视频管线并入工厂设计](../specs/2026-10-16-codex-video-pipeline-into-factory-design.md) | 文字短片等管线并入工厂 | 文件头写「调研 + 设计稿」 | 2026-10-27（仅头部） | 待补 |
| [出片机 CI 设计](../specs/2026-10-18-factory-worker-ci-design.md) | factory-worker 测试进 CI | 未逐份核实（对应台账 `2026-10-18-factory-worker-tests-in-ci`） | | 待补 |
| [Remotion 模板目录与选择器](../specs/2026-10-06-remotion-template-catalog-and-selector.md) | 模板目录与两步选择 | 草案；名单和现在的五个模板对不上（见画廊目录 §4） | 2026-10-27 | 待补 |
| [视频工厂入口收口 v0.1](../specs/2026-10-25-video-factory-consolidation-v0.1.md) | 工厂入口合并 | 未逐份核实 | | 待补 |
| [Remotion 引擎开发计划](../specs/2026-10-05-remotion-engine-dev-plan.md) | Remotion 引入工厂的计划 | 未逐份核实 | | 待补 |

### 台账卡（`docs/ledger/`，一条一文件，状态以卡内为准）

| 文件 | 一句话用途 | 状态 | 最后核实 | 格式 |
|---|---|---|---|---|
| [`2026-10-15-remotion-postcard-template`](../ledger/2026-10-15-remotion-postcard-template.md) | postcard 模板决定与验证 | 见卡内 | | 台账格式 |
| [`2026-10-15-remotion-postcard-cardtop`](../ledger/2026-10-15-remotion-postcard-cardtop.md) | 字卡位置参数 | 见卡内 | | 台账格式 |
| [`2026-10-14-remotion-datacard-template`](../ledger/2026-10-14-remotion-datacard-template.md) | datacard 模板 | 见卡内 | | 台账格式 |
| [`2026-10-06-remotion-pack-b-montage-template`](../ledger/2026-10-06-remotion-pack-b-montage-template.md) | montage 模板 | 见卡内 | | 台账格式 |
| [`2026-10-18-video-template-owner-single-window`](../ledger/2026-10-18-video-template-owner-single-window.md) | 模板负责人归属待定（对应手册的「每周三模板优化」责任） | decided，核实期 2026-10-25 已过，现状未核 | 2026-10-27（仅头部） | 台账格式 |
| [`2026-10-20-content-gate-pr1-server-safe-surface`](../ledger/2026-10-20-content-gate-pr1-server-safe-surface.md) | 内容闸 PR1：服务端安全表面 | 见卡内 | | 台账格式 |
| [`2026-10-21-content-gate-pr2-worker-gate`](../ledger/2026-10-21-content-gate-pr2-worker-gate.md) | 内容闸 PR2：出片机闸 | 见卡内 | | 台账格式 |
| [`2026-10-21-content-gate-pr3a-server-recompute`](../ledger/2026-10-21-content-gate-pr3a-server-recompute.md) | 内容闸 PR3a：服务端重算 | 见卡内 | | 台账格式 |
| [`2026-10-21-content-gate-pr3b-review-checklist-v3`](../ledger/2026-10-21-content-gate-pr3b-review-checklist-v3.md) | 内容闸 PR3b：审核清单 v3 | 见卡内 | | 台账格式 |
| [`2026-10-26-remotion-true-peak-gate-with-music-gain`](../ledger/2026-10-26-remotion-true-peak-gate-with-music-gain.md) | 配乐增益与真峰值闸 | 见卡内 | | 台账格式 |

台账另有 `remotion-*`、`factory-*` 前缀的多张卡（如 `2026-10-05-remotion-*`、`2026-10-06-factory-*`），用 `ls docs/ledger | grep -E "remotion|factory|content-gate"` 查全；本索引只列与手册直接相关的。

### 代码入口（便于找依据）

| 路径 | 用途 |
|---|---|
| `scripts/factory-worker/remotion-branch.mjs` | Remotion 出片分支：入库前各道闸、成片体检、上传 |
| `scripts/factory-worker/engines/remotion/` | Remotion 引擎：`render.mjs`、各模板 `src/*Reel.tsx` |
| `src/lib/maliang/render-check.ts` | 马良分镜自检（Creatomate 与模板出片共用；工单裁决在 output.maliang_check，没过仍留在审片收件箱） |
| `src/lib/factory/worker-guard.ts` | 服务端护栏，含成片红线复扫 `scanRedlineHits` |
| `src/lib/inngest/functions/youtube-publish.ts` | YouTube 私密暂存（工厂已批准成片） |

## 维护

- 新增视频/工厂类能力文档：按上面的文件头和章节顺序写，并在本表加一行。
- Agent 档案与手册的对应、代号、负责人：见 [agents 索引](../agents/README.md)（视频工厂手册主负责苏东坡 `sudongpo`，出片检查配合马良 `maliang`）。
- 本索引不是权威状态源：状态变化以被索引文件自己为准，这里只在核实时更新「最后核实」。
