# GSC 词×页每日存档 · DeepSeek 指令存档（风险级 A）

- 设计：docs/specs/2026-10-13-gsc-query-page-daily-design.md；台账：docs/ledger/2026-10-13-gsc-query-page-daily-archive.md
- 分工：触及在线页级链的参数化改动、迁移 SQL、Inngest 接线、探针路由、读库函数、PATCH 校验由 Claude 会话手写（核心改动 / A 级，写入者唯一）；
  纯函数品牌拆分与两份测试由 DeepSeek 写，Claude 逐文件审、跑测试、做变异抽查。
- 实测坑（沿用 reference-aider-deepseek-oneshot-recipe）：
  1. `yes n |` 会把「Create new file?」答成 No，整份测试被 Skipping；测试文件一次写两份时上下文大也不落盘 → 拆成每轮一个文件 + `--yes-always`。
  2. DeepSeek 写的测试有两处 fixture 自相矛盾（receipt id 没按「由 run id 算出」、pullEventId 从错的模块导入）——红了先核 fixture。
  3. 它写的测试漏了两个真实变异（冲突键漏掉 query、开跑时作业名用错），由 Claude 补两条测试后才被抓住。

## r2 — brand-split（纯函数 + 测试）
见提示词：normalizeQueryText / readBrandConfig / classifyQuery / splitQueryRows 的规则逐条列出；一轮落盘。随后 Claude 改了域名主体并入规则（仅当延伸已配置品牌词）并补测试。

## r1a / r1b — 存储测试 / 两条链隔离与端到端测试
r1 一次写两份被跳过；拆成 r1a（query-page-daily-store 测试）与 r1b（链隔离 + 本地端到端 + onFailure）后一次落盘。
