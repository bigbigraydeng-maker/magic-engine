# Agents 索引（档案 ↔ 操作手册 ↔ 代号）

> 负责：待 PM 指定 ｜ 范围：`docs/agents/` 的 agent 档案与 `docs/sops/` 通用操作手册的对应关系；客户专属手册（`docs/clients/...`、文件名带客户名的 sops）不列入
> 状态：已采用（索引本身）；各档案 / 手册的状态以各自文件为准 ｜ 日期：2026-10-27 ｜ 最后核实：2026-10-27（只核对文件存在与文件头字段，未逐份核正文） ｜ 风险：C（仅文档）
> 依据：[`docs/specs/2026-09-24-agent-autonomy-operating-plan-v1.md`](../specs/2026-09-24-agent-autonomy-operating-plan-v1.md) §4（PM 已认）· [`docs/specs/2026-09-25-merge-gate-two-tiers-design.md`](../specs/2026-09-25-merge-gate-two-tiers-design.md)（闸门 role）· [视频工厂索引](../sops/video-factory-index.md)「统一写法」

## 名单以谁为准

**2026-10-28 更新：PM 批准了整合方案，当前名单以本索引为准；下面说的 spec §4 还没同步改，两者冲突时以本索引为准。**

**Agent 名单以上面 spec 的 §4 为准**（§4.1 支柱与运营 · §4.2 审查团 · §4.3 常驻 · §4.4 代码对照）。本索引只补代号、互链和手册对应，**不改** §4.1–§4.3 的内容。

- [`00-architecture.md`](./00-architecture.md) §二 的 9 Agent 表已自标过时；[`CODEX.md`](./CODEX.md) 的速查表已改为指向本索引。
- `docs/ARCHITECTURE.md` 如需列 agent，请只链到本索引，不再另列一份名单（PR #3104 如有同类名单，合并时请改成链接）。

## 代号规则

代号 = 现有拼音档案名去掉编号，两个文件夹通用。已有拼写不改：魏征沿用 `weicheng`。
合并闸签字的 `role` 值是另一套拼法（`ziya` / `weizheng` / `direnjie`），见下表「闸门 role」列；**两边都不改名**，对照靠这张表。「角色名」列里 `ads` / `seo` / `social` / `video-factory` 是现有手册用语，其余是按 §4.1 目标起的描述性标签，PM 可改。

## 名单与对照表

| 中文名 | 代号 | 闸门 role | 角色名 | 主要功能 | §4 分组 | 状态 | 档案 | 操作手册 |
|---|---|---|---|---|---|---|---|---|
| 卫青 | `weiqing` | — | `ads` | 盯每个客户每条 Meta 广告，出诊断和处方；信封内可自动暂停单条、小额调预算 | 4.1 | 在用 | [11-weiqing](./11-weiqing.md) | 见下「手册归属」 |
| 孔子 | `kongzi` | — | `seo` | 盯网站在谷歌的排名与收录，出诊断；信息闸全绿时可改标题和摘要；含 SEO 规划（原孙子的 seo-agent 代码） | 4.1 | 在用 | [13-kongzi](./13-kongzi.md) | 见下 |
| 孟子 | `mengzi` | — | `geo` | 测品牌在 ChatGPT 等 AI 回答里被提到、被引用的比例 | 4.1 | 在用 | [15-mengzi](./15-mengzi.md) | 暂无 |
| 苏东坡 | `sudongpo` | — | `social` / `video-factory` | 按爆款配方产出帖子和 Reel，管评论与私信自动回复；任何发布须 PM 授权 | 4.1 | 在用 | [14-sudongpo](./14-sudongpo.md) | 见下（另有[社媒经验手册](#经验手册playbooks)） |
| 司马迁 | `simaqian` | — | `reputation` | 【休眠，口碑非 P0】盯评价不漏回，起草回复和谷歌商家帖子，发布一律审批 | 4.1 | 在用（档案为骨架） | [16-simaqian](./16-simaqian.md) | 暂无 |
| 张骞 | `zhangqian` | — | `collect` | 并入华佗：每周只读采集站点、关键词、AI 可见度、竞品数据 | 4.1 | **已撤**（名字并入华佗，代码与每周采集照常运行） | [30-zhangqian](./30-zhangqian.md) | 暂无 |
| 华佗 | `huatuo` | — | `prescribe` | 给每个客户开处方，并含每周采集（原张骞）；6 维打分在 diagnostic 模块 | 4.1 | 在用 | [40-huatuo](./40-huatuo.md) | 暂无 |
| 鲁班 | `luban` | — | `execute` | 把已批准的动作真做出去并留回执；目前靠人在页面对话触发；【受限】谷歌商家发帖的绕审批漏洞修好前不接谷歌商家 | 4.1 | 在用 | [50-luban](./50-luban.md) | 暂无 |
| 马良 | `maliang` | — | `render-check` | 出片检查，逐镜自检不过关不给 PM 看；另管素材视觉分析，并含文案溯源与提示词库（原李白） | 4.1 | 在用 | [60-maliang](./60-maliang.md) | 见下（配合） |
| 李白 | `libai` | — | `copy-qa` | 并入马良：文案句句可溯源（官网 / brief / 未证实），管提示词库 | 4.1 | **已撤**（名字并入马良，提示词库与文案溯源照常运行） | [70-libai](./70-libai.md) | 暂无（提示词库见档案） |
| 魏征 | `weicheng` | `weizheng` | `review` | 审查团牵头：上线前代码审查挑刺；含狄仁杰（A 级攻击验证）、板桥（大白话审客户可见内容）两种模式，意见交子牙汇总 | 4.2 | 在用 | [90-weicheng](./90-weicheng.md) | 暂无 |
| 狄仁杰 | `direnjie` | `direnjie` | `review-attack` | 并入审查团：改动命中 A 级清单时做攻击验证 | 4.2 | **已撤**（并入审查团，魏征牵头；闸门 role 不变） | [91-direnjie](./91-direnjie.md) | 暂无 |
| 板桥 | `banqiao` | — | `review-plainlang` | 并入审查团：用大白话审客户 / PM 看得到的页面、邮件、报告 | 4.2 | **已撤**（并入审查团，魏征牵头） | [92-banqiao](./92-banqiao.md) | 暂无 |
| 子牙 | `ziya` | `ziya` | `tech-lead` | 技术大脑：架构、安全、开发统筹、合并前审查汇总 | 4.3 | 在用 | [10-ziya](./10-ziya.md) | 暂无 |
| 诸葛亮 | `zhuge` | — | `account-manager` | 每个客户的账户经理：统筹增长，授权内自主决策与沟通 | 4.3 | 在用 | [20-zhuge](./20-zhuge.md) | 暂无通用手册（客户专属手册不列入） |
| 客人沟通 | `conversation` | — | `crm-conversation` | 接管客人沟通这条线的无主程序：私信 / 邮箱同步、自动安抚、AI 起草回复、电话、Mailchimp 与线索表同步（约 20 个） | 新增 2026-10-28 | 在用（档案为骨架） | [17-conversation](./17-conversation.md) | 暂无 |
| 记性 | `memory` | — | `learning-memory` | 接管效果归因、记忆提取、每周学习汇总、KPI 回填、行业基准（约 6 个无主程序） | 新增 2026-10-28 | 在用（档案为骨架） | [18-memory](./18-memory.md) | 暂无 |
| 达芬奇 | `davinci` | — | — | 已撤，审查问题并入子牙 | §3 | **已撤**（审查问题并入子牙，见 10-ziya §四b） | [80-davinci](./80-davinci.md) | — |

2026-10-28 PM 批准整合方案后，在用 13 个：运营 8 个（卫青、孔子、孟子、苏东坡、司马迁〔休眠〕、华佗、鲁班、马良）、审查团 1 个（魏征牵头）、常驻 2 个（子牙、诸葛亮）、新增挂名位 2 个（客人沟通、记性）。

张骞、李白、狄仁杰、板桥的名字已并入他人（状态显示「已撤」），**他们的代码和自动程序照常运行**；孙子、司马徽两行已删（孙子的 SEO 规划代码归孔子，司马徽没有档案也没有代码）；达芬奇早已撤。

## 开发侧帮手（名单外，不计入 15 人）

| 中文名 | 代号 | 主要功能 | 分组 | 档案 | 操作手册 |
|---|---|---|---|---|---|
| 齐白石 | `qibaishi` | 开发侧美工：只管后台 /dashboard、/portal 的界面样式，不碰数据（子代理 `.claude/agents/me-backend-ui-designer.md`，不是产品内后台 agent，不在 spec §4 名单） | 开发侧（名单外） | [62-qibaishi](./62-qibaishi.md) | [UI 美工手册 v1.0](../sops/2026-10-27-qibaishi-ui-designer-playbook-v1.0.md) |

## 经验手册（playbooks）

| 目录 | 归谁 | 说明 |
|---|---|---|
| [`docs/playbooks/social/`](../playbooks/social/README.md) | 苏东坡 `sudongpo` | 社媒经验手册：平台层 `platform-general.md` · 行业层 `industry-travel.md` · 客户层 `clients/`（只列目录）· [README](../playbooks/social/README.md) · [MIGRATION-MAP](../playbooks/social/MIGRATION-MAP.md)。涉及视频工厂的部分归 ME Video 维护 |

## 手册归属（通用手册）

| 手册 | 归谁 | 依据 / 备注 |
|---|---|---|
| [广告 agent 手册 v1.0](../sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md) | 卫青 `weiqing` | 手册自述为广告 agent；与档案互链 |
| [`meta-ads-angle-test-and-budget`](../sops/meta-ads-angle-test-and-budget.md) | 卫青 | #3261 补充评论建议，待 PM 确认 |
| [`winner-reel-auto-sync`](../sops/winner-reel-auto-sync.md) | 卫青 | #3261 补充评论建议，待 PM 确认 |
| [SEO agent 手册 v1.0](../sops/2026-10-11-seo-agent-playbook-and-rules-v1.0.md) | 孔子 `kongzi` | |
| [SEO 工作流与目标方案 v1](../sops/2026-10-14-seo-agent-workflow-and-goal-plan-v1.md) | 孔子 | **含客户层**：§6 是客户层数据，不当通用规则用 |
| [`keyword-gap-attack-playbook`](../sops/keyword-gap-attack-playbook.md) | 孔子 | #3261 补充评论建议，待 PM 确认 |
| [`brand-aliases-setup-for-gsc`](../sops/brand-aliases-setup-for-gsc.md) | 孔子 | #3261 补充评论建议，待 PM 确认 |
| [社媒 agent 手册 v1.0](../sops/2026-10-19-social-agent-playbook-and-rules-v1.0.md) | 苏东坡 `sudongpo` | |
| [视频模板优化手册 v1.0](../sops/2026-10-27-video-factory-template-playbook-v1.0.md) | 苏东坡（主），马良（出片检查配合） | 见下「视频工厂手册归属」 |
| [`messenger-ai-rollback`](../sops/messenger-ai-rollback.md) | 苏东坡 | #3261 补充评论建议，待 PM 确认；§4.4 苏东坡入口含 `src/lib/messenger/` |
| [`tiktok-app-setup`](../sops/tiktok-app-setup.md)、[`tiktok-production-audit-checkpoint`](../sops/tiktok-production-audit-checkpoint.md)、[`tiktok-publishing-test-checkpoint`](../sops/tiktok-publishing-test-checkpoint.md) | 苏东坡 | #3261 补充评论建议，待 PM 确认（`tiktok-*`） |
| [`2026-10-21-youtube-receipts-content-post-go-apply`](../sops/2026-10-21-youtube-receipts-content-post-go-apply.md) | 苏东坡 | #3261 补充评论建议，待 PM 确认 |

其余 `docs/sops/` 文件（接入、迁移、密钥、客户专属等）归属**待定**，本次不判。

### 归属待定

| 手册 | 归谁 |
|---|---|
| [`2026-10-15-video-factory-handoff-to-97`](../sops/2026-10-15-video-factory-handoff-to-97.md) | 待 ME Video 定 |
| [`lecture-video-production`](../sops/lecture-video-production.md) | 待 ME Video 定 |

### 视频工厂手册归属：苏东坡主，马良配合

依据 §4.4：苏东坡的代码入口含 `src/lib/factory/`，叫醒登记是 `factory-publish-sweeper` / `factory-publish-worker`；马良的入口是 `src/lib/maliang/render-check.ts`，叫醒登记是 `maliang-render-check`。该手册管入库闸、渠道分流、数据回流，属出片 / 发布链路，所以主负责归苏东坡；其中出片检查一侧归马良。

## 文件头格式（统一写法）

目标格式见 [视频工厂索引「统一写法」](../sops/video-factory-index.md)：负责 / 范围 / 状态 / 日期 / 最后核实 / 风险 / 依据。本次**不改写正文**，下表只记缺哪几项。按文件前 12 行核对，2026-10-27。

| 文件 | 格式 | 缺 |
|---|---|---|
| 13 份档案（10 / 11 / 13 / 14 / 15 / 20 / 30 / 40 / 50 / 60 / 70 / 80 / 90） | 待补 | 都缺 负责、最后核实、风险；13 / 14 / 15 有「设计依据」，其余缺 依据；80 已有「已撤」状态说明，其余缺 状态 |
| 16 / 17 / 18 / 91 / 92 骨架档案 | 待补 | 缺 负责、风险、日期 |
| 广告手册 | 待补 | 缺 负责（本次已补「负责 agent」）、最后核实；有状态、风险；依据只有「起因」 |
| SEO 手册 | 待补 | 同上 |
| SEO 工作流方案 | 待补 | 缺 负责、最后核实、风险、依据；**含客户层** |
| 社媒手册 | 待补 | 缺 负责、最后核实、依据；有状态、日期、风险 |
| 视频模板手册 | 符合 | — |

## 还没有操作手册的 agent

下列 agent **暂无**通用操作手册：孟子、司马迁、华佗、鲁班、魏征、子牙、诸葛亮、客人沟通、记性。马良只配合视频模板手册，无自己主负责的手册。
（诸葛亮有客户专属的项目经理手册，按规矩不列入通用索引。）

## 不是 agent 档案的文件

| 文件 | 说明 |
|---|---|
| [`CODEX.md`](./CODEX.md) | Codex 参考手册，速查表已改为指向本索引 |
| [`00-architecture.md`](./00-architecture.md) | 总架构与规则；§二 名单过时 |
| [`2026-10-18-automation-inventory.md`](./2026-10-18-automation-inventory.md) | **一次性快照**（2026-10-18），不随代码更新 |
| `intake/` · [`prompt-library/`](./prompt-library/) | 资料目录；提示词库归李白 |
