# 未提交文件盘点（2026-10-10，70 号窗口，只读）

**范围**：主目录 + 124 个 worktree 的 `git status`（本地快照，未 fetch，`origin/main` = `0b6cf9a31`）。只读，未动任何文件。
**判「已有副本」的方法**：把文件内容算指纹，在 `origin/main` 历史或任一分支里找得到同指纹 = 有副本；找不到 = 独一份。
**没跑的检查**：没 fetch 远端（远端比本地新的部分可能没看到）；没逐文件读内容（只看路径、首行、指纹）；`.env.local` 只确认存在且被忽略，未读。

## 结论

- 合计 235 条未提交（主目录 52 条，展开后 68 个文件）。其中约 168 个文件**独一份、丢了没副本**；其余是已有副本、生成物，或盘点期间已被窗口自己提交（7 个）。
- 最危险 3 处：①主目录 68 个（手机号注册登录 + 社媒增长上手方案，9/30–10/2 写的，没 PR 没分支）；②会议室类型窗口 51 个（今天正在改，PR #2383 还开着）；③codex 的 Meta 转化回传 15 个（9/18 的，没 PR）。
- 另有 6 个老窗口各躺 1–2 个设计文档/台账卡（9/25–10/10），没副本，量小但丢了就没了。

## 清单（按风险）

| 路径（worktree） | 分支 | 数量 | 是什么 | 风险 | 建议 |
|---|---|---|---|---|---|
| 主目录 `magic-engine` | codex/ads-o1-budget-release（该分支 PR #2207 已合并） | 68（改 29 / 新 39） | ①手机号自助注册登录（`src/lib/auth/china-phone*`、`sms/`、`api/auth/phone-*`、`account/phone`、两个数据库变更文件）②社媒增长上手方案（`social-onboarding/`、dashboard 页、数据库变更文件）③一张 CTS 旧任务退役台账卡 | **高（丢了无副本）** | 由对应窗口提交到新分支；统筹先做文件备份 |
| `meeting-room-types-customer-3b016a` | claude/meeting-room-types-customer（PR #2383 开着） | 51（改 1 / 新 50，多数是已有文件的新改动） | 旅游产品目录对客户员工开放的权限改造 + 测试 + 一份本地测试表 | 高，但窗口今天还在写 | 对应窗口自己提交；别人不动 |
| `.codex/worktrees/magic-engine-1796` | codex/meta-capi-self-serve-mvp（无 PR） | 15 | Meta 转化回传自助连接（接口、面板、数据库变更文件） | 高（9/18 起没动） | 需 PM 决定：还要不要；要就提交，不要就归档 |
| `magic-engine-logo-redesign-14e21c` | claude/magic-engine-logo-redesign（无 PR） | 11 | 官网首页/中文页改版 + 产品文档改动 + 4 个设计工具临时文件 | 中高（10/7 起没动） | 对应窗口提交；`.impeccable/` 临时文件应进 .gitignore |
| `priceless-wilbur-973355` | feat/ads-impact-wp2-kernel-envelope（PR #1979 已合并） | 82，其中独一份 3 | 独一份：R4「工厂 Reel→广告草稿」设计稿 1 份 + 代理客户页 2 个文件的新改动；其余 79 个与主干相同或已在主干历史里 | 中（3 个独一份） | 把 3 个独一份提交到新分支；其余可丢 |
| `epic-matsumoto-d5f69c` | claude/nifty-goldwasser-4799be | 4 | East Inter 第一周内容日历、帖子草稿、Reel 订单草稿、台账卡 | 中（今天写的） | 对应窗口提交 |
| `magic-engine-central-asia-kids-4c4977` | claude/…central-asia-kids | 3 | 中亚童装市场调研 README + 核验日志 | 中 | 对应窗口提交 |
| `wizardly-vaughan-150cc9` | claude/wizardly-vaughan | 2 | Meta 企业认证复查台账卡 + WhatsApp 商业号接入方案 | 中 | 提交 |
| `great-wright-6bd83c` | claude/great-wright | 2 | 第三方用量计量方案 + 对应数据库变更文件（9/26） | 中 | 提交或让 PM 判是否还要 |
| `compassionate-bose-2ecbe8` | claude/compassionate-bose | 2 | 结果判定「指标方向」方案 + 台账卡（9/26） | 中 | 提交 |
| `brave-poincare-37eec7` | claude/brave-poincare | 2 | 已死供应商清理方案 + 台账卡（9/26） | 中 | 提交 |
| `elated-bohr-665956` / `suspicious-ramanujan-dc25e9` / `eager-goodall-f19554` | 各自 claude/* | 各 1 | 3 张台账卡（9/25、9/27、9/26） | 低中 | 提交 |
| `magical-wu-57d825` / `interesting-austin-ac186b` | feat/crm-one-next-action / claude/interesting-austin | 各 1 | 意向校准探针脚本（今天）/ 客户时间线组件改动（9/28） | 低中 | 对应窗口提交 |
| `magic-engine-env-path-c09a7f`、`distracted-robinson-9ca5c0`、`xenodochial-wilbur-d95a77`、`zealous-gagarin-87b4fc` | claude/* | 2+2+1+1 | 已有副本（提交 7ad58dc62 等「抢救」过） | 低 | 可丢弃 |
| `interesting-bohr-94cfec`、`heuristic-kalam-6ba9f2`、`amazing-roentgen-51c69f` | 各自 | 各 1 | 视频出片工具的 `node_modules` 文件夹（生成物） | 无 | 进 .gitignore，可删 |
| `inspiring-driscoll-20c628` | claude/me-website-video-skills | 1 | 设计检查工具的二进制程序（生成物） | 无 | 进 .gitignore |
| `magic-engine-aider-trial` | aider/deepseek-trial-v2 | 1（改 .gitignore，60 行） | 试用分支的忽略规则改动 | 低 | 看不出重要性，需 PM 一句话 |
| `upbeat-napier-7a914d`（PR #2430 开着） | feat/daily-plan-auto-publish-tables | 0（盘点时 7 个，随后已被窗口提交） | — | 无 | 无需处理 |
| 其余约 80 个 worktree | — | 0 | 干净 | 无 | 无需处理 |

> 备注：主目录 `.env.local`（被忽略、未读内容，疑似含密钥）正常，不算丢失风险。
> 备注：此前已有一次「抢救」提交 `7ad58dc62`（把三个老窗口的方案提进仓库）。

## 建议动作

1. **（统筹，可直接做）** 把主目录 68 个文件整体复制一份到仓库外的备份文件夹（只复制，不动原文件）。
2. **（统筹，可直接做）** 通知会议室类型窗口、East Inter 窗口、中亚童装窗口：今天内自己提交。
3. **（对应窗口，需派活）** 主目录的手机号登录和社媒增长上手方案，各开新分支提交（A 级：碰鉴权和数据库）。
4. **（对应窗口）** 老窗口里 9/25–9/28 的台账卡和方案，各自提交（台账卡只改 docs，可自动合）。
5. **（统筹，可直接做）** 生成物（`node_modules`、`.impeccable/`、设计工具二进制）加进忽略规则。
6. **（PM 决定后）** codex Meta 转化回传 15 个文件、logo 改版 11 个文件：要还是不要。

## 需要 PM 决定

只有一件：Meta 转化回传（9/18）和官网 logo 改版（10/7）这两批没提交的东西，是要保住还是放弃。
