# agents 索引（代号 · 分组 · 档案 · 手册）

> 负责：agent 档案维护者（`docs/agents/`） ｜ 范围：agent 名单对照、代号、档案与操作手册的互相链接（客户专属手册不列入）
> 状态：**已采用（索引本身）；名单内容以 §4 为准，本索引只做对照与链接** ｜ 日期：2026-10-27 ｜ 最后核实：2026-10-27（对照仓库文件名与各手册文件头，未对照运行时代码） ｜ 风险：C（仅文档）
> 依据：`docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md` §4（PM 已认）、§4.4 · `docs/sops/video-factory-index.md`「统一写法」

## 名单以谁为准

**以 [`docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md`](../specs/2026-09-24-agent-autonomy-operating-plan-v1.md) §4 为准**（§4.1 支柱与运营、§4.2 审查团、§4.3 常驻；§4.4 是代码对照）。[`00-architecture.md`](./00-architecture.md) §二 的 9 Agent 表已标「过时，不再维护」。本索引不改 §4.1–§4.3 的内容；冲突时以 §4 为准。

## 代号规则

- 代号 = 现有档案文件名去掉编号（`11-weiqing.md` → `weiqing`），已有拼写不改（魏征仍是 `weicheng`）。
- 代号在 `docs/agents/` 和 `docs/sops/` 通用：每份手册文件头有一行「负责 agent：<中文名>（`<代号>`）」，不改手册文件名。
- 「角色名」是该 agent 的业务范围标签（`ads` / `seo` 等，取自 §4.1 的括号和目标），用来对上手册文件名里的英文角色名，不是新的命名体系。

## 对照表

状态：**在用** = 在 §4 名单上；**已撤** = 已被 PM 撤；**名单外，去留待 PM 定** = 按 §4.4 原文，不替 PM 下结论。「手册」只列通用手册。

### §4.1 支柱与运营

| 中文名 | 代号 | 角色名 | 状态 | 档案 | 手册 |
|---|---|---|---|---|---|
| 卫青 | `weiqing` | `ads` | 在用 | [11-weiqing.md](./11-weiqing.md) | [广告手册](../sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md) |
| 孔子 | `kongzi` | `seo` | 在用 | [13-kongzi.md](./13-kongzi.md) | [SEO 手册](../sops/2026-10-11-seo-agent-playbook-and-rules-v1.0.md)、[SEO 工作流方案](../sops/2026-10-14-seo-agent-workflow-and-goal-plan-v1.md) |
| 孟子 | `mengzi` | `ai-visibility` | 在用 | [15-mengzi.md](./15-mengzi.md) | 暂无 |
| 苏东坡 | `sudongpo` | `social` / `video-factory` | 在用 | [14-sudongpo.md](./14-sudongpo.md) | [社媒手册](../sops/2026-10-19-social-agent-playbook-and-rules-v1.0.md)、[视频模板优化手册](../sops/2026-10-27-video-factory-template-playbook-v1.0.md) |
| 司马迁 | `simaqian` | `reputation` | 在用 | [16-simaqian.md](./16-simaqian.md)（骨架） | 暂无 |
| 张骞 | `zhangqian` | `scout` | 在用 | [30-zhangqian.md](./30-zhangqian.md) | 暂无 |
| 华佗 | `huatuo` | `diagnosis` | 在用 | [40-huatuo.md](./40-huatuo.md) | 暂无 |
| 鲁班 | `luban` | `execution` | 在用 | [50-luban.md](./50-luban.md) | 暂无 |
| 马良 | `maliang` | `visual` | 在用 | [60-maliang.md](./60-maliang.md) | [视频模板优化手册](../sops/2026-10-27-video-factory-template-playbook-v1.0.md)（出片检查一侧，主负责见苏东坡） |
| 李白 | `libai` | `copy` | 在用 | [70-libai.md](./70-libai.md) | 暂无 |

### §4.2 审查团（自动被叫）

| 中文名 | 代号 | 角色名 | 状态 | 档案 | 手册 |
|---|---|---|---|---|---|
| 魏征 | `weicheng` | `review` | 在用 | [90-weicheng.md](./90-weicheng.md) | 暂无 |
| 狄仁杰 | `direnjie` | `attack-review` | 在用 | [91-direnjie.md](./91-direnjie.md)（骨架） | 暂无 |
| 板桥 | `banqiao` | `plain-language-review` | 在用 | [92-banqiao.md](./92-banqiao.md)（骨架） | 暂无 |

### §4.3 常驻

| 中文名 | 代号 | 角色名 | 状态 | 档案 | 手册 |
|---|---|---|---|---|---|
| 子牙 | `ziya` | `tech-lead` | 在用 | [10-ziya.md](./10-ziya.md) | 暂无 |
| 诸葛亮 | `zhuge` | `account-manager` | 在用 | [20-zhuge.md](./20-zhuge.md) | 暂无通用手册（每客户一份项目经理手册，客户专属，不列） |

### 已撤 / 名单外

| 中文名 | 代号 | 状态 | 档案 | 说明 |
|---|---|---|---|---|
| 达芬奇 | `davinci` | **已撤**（PM 2026-09-24，§3） | [80-davinci.md](./80-davinci.md)（历史参考） | 7 个审查问题并入子牙设计审查清单（`10-ziya.md` §四b） |
| 孙子 | `sunzi` | **名单外，去留待 PM 定**（§4.4 原文） | 无 | 代码在 `src/lib/seo-agent/`，只被 `seo-agent/plan` 接口调 |
| 司马徽 | — | **名单外，去留待 PM 定**（§4.4 原文） | 无 | CLAUDE.md 的 DAPE「发现」段有，名单和代码都没有 |

「角色名」中 `ads` / `seo` / `social` / `video-factory` 对应现有手册；其余（`scout`、`diagnosis` 等）是按 §4.1 目标写的描述性标签，没有对应手册，若 PM 想改名随时改。`sunzi` 是按拼音给的暂定代号，仅供索引引用，不代表收编。

## 手册归属说明

| 手册 | 负责 agent | 理由 |
|---|---|---|
| 广告手册 | 卫青（`weiqing`） | 广告支柱；手册本身已链 `11-weiqing.md` |
| SEO 手册、SEO 工作流方案 | 孔子（`kongzi`） | SEO 支柱（§4.1） |
| 社媒手册 | 苏东坡（`sudongpo`） | 社媒支柱（§4.1） |
| 视频模板优化手册 | 苏东坡（`sudongpo`）；出片检查一侧配合 马良（`maliang`） | §4.4：苏东坡代码入口含 `src/lib/factory/`，叫醒登记是 `factory-publish-sweeper` / `factory-publish-worker`，且标「兼审查：是」；马良代码入口是 `src/lib/maliang/render-check.ts`，叫醒登记 `maliang-render-check`，同样「兼审查：是」。手册管入库闸、渠道分流、数据回流（出片 / 发布链路）→ 主负责归苏东坡；其中画面自检（马良）是配合项。分工以 §4.1「苏东坡：生成候选、任何发布须问 PM；马良：出片不出丑」为准 |

## 还没有操作手册的 agent

孟子、司马迁、张骞、华佗、鲁班、李白、魏征、狄仁杰、板桥、子牙、诸葛亮（通用手册；客户项目经理手册不算）。达芬奇已撤，不需要。

> 张骞→华佗→诸葛亮→鲁班的诊断执行链说明在 [`00-architecture.md`](./00-architecture.md) §三，不是操作手册。

## 非 agent 档案

`CODEX.md`、`2026-10-18-automation-inventory.md`、`intake/`、`prompt-library/` 不是 agent 档案，不在本表。

## 维护

- 新增 / 撤销 agent：先走 §4（PM 认），再在这里加一行，并给档案和手册各加一个互链。
- 新增 agent 手册：文件头加「负责 agent：<中文名>（`<代号>`）」，并在对应档案的「操作手册」节加链接。
- 本索引不是权威状态源：名单以 §4 为准，手册状态以手册自己为准。
