# 齐白石（后台界面美工）操作手册 v1.0

> 负责：齐白石（`qibaishi`）｜ 档案：[`docs/agents/62-qibaishi.md`](../agents/62-qibaishi.md)
> 范围：ME 后台 `/dashboard/**`、`/portal/**` 页面的视觉一致性与细节打磨（颜色、间距、组件、四种状态、手机宽度）；不含数据、接口、鉴权、广告逻辑、视频 / 图片生产
> 状态：草案，随 PR #3285 审查；未合并前以档案为准 ｜ 日期：2026-10-27 ｜ 最后核实：2026-10-27（核对了说明书、设计规范、Impeccable 脚本、`type-check` 命令都存在；**未**让齐白石真改过任何页面，只做过一次只读试跑） ｜ 风险：A（本 PR 含 `.claude/agents/` 说明书，合并闸按 A 级判；手册本身仅文档）
> 代码依据：[`.claude/agents/me-backend-ui-designer.md`](../../.claude/agents/me-backend-ui-designer.md)（说明书）· [`docs/DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md)（强制规范）· `tailwind.config.ts` · `src/components/ui/me-theme.ts` · `src/components/ui/me-primitives.tsx` · `.claude/skills/impeccable/scripts/impeccable` · `package.json` 的 `type-check`

齐白石是开发侧帮手，**不在**产品 agent 正式名单（总架构 §4 那 15 位）里，不走新 agent 五关流程，也不进每周闭环巡检。本手册只讲怎么用他。

## 0. 结论

后台页面做完、或有人说"看着不像 ME"时，叫齐白石先审后改：他只动样式，改完必须有"类型检查退出码 + Impeccable 前后数字"，没有就不算改完。合并走审查再由 PM 点头，**齐白石和 Claude 都不自己合并**。

## 1. 什么时候叫他

| 情形 | 叫不叫 |
|---|---|
| 新建 / 改动了 `src/app/dashboard/**` 或 `/portal/**` 页面，要收尾美化 | 叫 |
| PM 指出某页"颜色不对 / 手机上太小 / 空状态没说下一步" | 叫 |
| 页面还在改功能、数据没接通 | 不叫，功能做完再叫 |
| 要改数据来源、接口、字段、业务判断 | 不叫，他会停手上报 |
| 做视频 / 图片 | 不叫，走视频工厂 |
| 客户对外的营销落地页（建在客户自己域名） | 不叫，品牌色要先读 `master_briefs` 的 VI，另行处理 |

## 2. 怎么叫

1. **新开**一个 Claude Code 窗口（已开着的窗口加载不到他），按名字召唤 `me-backend-ui-designer`；说明书会自己报"我是齐白石"。
2. 给他一个明确范围：**一个页面或一个目录**，写清"只读审查"还是"审查后修改"。
3. 同一时间同一文件只允许一个写入者；他改某页时，开发窗口不要同时改这个文件。
4. 一次最多整页，不做全站大扫除；发现半个后台都是旧风格，他只出整改清单。

## 3. 他怎么干活（顺序固定）

1. 读 `docs/DESIGN_SYSTEM.md`、`tailwind.config.ts`、`me-theme.ts`、`me-primitives.tsx`，再读目标页和 2~3 个同级页。
2. **先审后改**：列出问题和文件行号，再做最小样式改动。
3. 优先复用现成组件（`MePanel`、`MeButton`、`MeTable` 等），不新增依赖、不新增 ME 色板之外的颜色。
4. 补齐加载 / 空 / 出错 / 有数据四种状态的展示；空状态用大白话说下一步。
5. 手机宽度（375px）：不横向滚动，触摸区域不小于 44px。

## 4. 改完怎么验收（缺一项就写"未运行"，不算通过）

| 检查 | 命令 / 做法 | 记什么 |
|---|---|---|
| 类型检查 | `NODE_OPTIONS=--max-old-space-size=10240 npm run type-check` | 退出码；**静默无输出不算通过**（本机内存不足会无声崩溃） |
| 页面检测 | `.claude/skills/impeccable/scripts/impeccable detect <页面目录>`（本地运行，无外部副作用） | 改前 / 改后问题数；真问题修掉，误报写理由 |
| 真实渲染 | 开发服务器看桌面宽度和 375px 手机宽度 | 截图；没渲染就写"未渲染"，不得声称视觉已验证 |
| 改动范围 | `git diff --stat` | 只能是样式 / 展示类改动；碰到数据读取或接口就是越界，退回 |

## 5. 改完谁来合并

- 齐白石**只改文件，不提交、不推送、不合并**；Claude 也不自己合并。
- 合并走 [#3087](https://github.com/bigbigraydeng-maker/magic-engine/issues/3087) 的分工规矩：**Codex 审，PM 点头后再合并**。注意：闸门现行的签字要求以 [`.github/merge-authorization.md`](../../.github/merge-authorization.md) 为准（2026-10-26 起 Codex 一签已去掉，A 级由 Claude Code 签当前提交）；两边不一致时听 PM 本人的话。
- 风险级别照实判：用齐白石改页面样式，一般是 C 级；改 `.claude/agents/` 说明书本身是 A 级（合并闸按此判）；碰了安全、数据库、鉴权、钱的文件就不再是齐白石的活，退回开发窗口。

## 6. 停手条件

- 要改的是功能或数据，不是样式 → 停，报给调用窗口。
- 目标文件正被别的窗口修改 → 停，不抢写。
- 改动文案会改变含义、价格、承诺 → 停，等 PM 定。
- 规范与现有大面积页面冲突 → 只出整改清单，不一次性全站改。

## 7. 现状与已知局限（2026-10-27）

1. 只做过一次只读试跑（工厂审核页 `ReviewInbox.tsx`，找出灰蓝主按钮、手机触摸区过小、禁用灰色文字三类问题）；没跑类型检查和 Impeccable，没渲染真实页面。
2. 他还没真改过页面。建议第一单整页修 `ReviewInbox.tsx`，用本手册 §4 的前后数字验证他是否达标；达标前本手册保持"草案"。
3. 与马良分工：后台页面样式归齐白石，图片 / 视频画面质量仍归马良。

## 8. 相关文档

- 档案：[`docs/agents/62-qibaishi.md`](../agents/62-qibaishi.md)
- 设计规范：[`docs/DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md)
- 分工规矩：[#3087](https://github.com/bigbigraydeng-maker/magic-engine/issues/3087)
