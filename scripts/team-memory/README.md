# 团队工作记忆（Team Working Memory）

一句话：**一个窗口踩过的坑，下一个窗口开工时自动就知道。**

## 为什么要有它

2026-08-02 实测：

| 目录 | 记忆条数 |
|---|---|
| `magic-engine` 主目录 | 95 |
| 32 个 `.claude/worktrees/*` 自动 worktree | 各 **0** |
| `magic-engine-cts` / `-messenger` / `-seo-loop` 等命名 worktree | 各 **0** |
| `chinatravel` / `midashand` / `magic-lab-academy` | 14 / 15 / 6，互不相通 |

Claude Code 的记忆是**按目录**存的。每开一个新工作目录，那个窗口就是一张白纸。
这是「同一个坑踩三遍」的机械根因（三天搭 Dropbox 重复系统、自造 `APIFY_TOKEN` 而
仓里早有 `APIFY_API_KEY`……都属于这一类）。

## 装 / 卸

```bash
node scripts/team-memory/install.mjs --dry-run   # 先看会改成什么样
node scripts/team-memory/install.mjs             # 装
node scripts/team-memory/install.mjs --uninstall # 卸
```

改的是 `~/.claude/settings.json`（全局）。动手前自动备份，**只增删自己那几条** ——
已有的 `gh pr merge` 确认闸门原样保留。

生效范围：`magic-engine` / `chinatravel` / `midashand` / `magic-lab-academy`
及其**全部 worktree**。其它目录的窗口一个字都不上报。

一次性把现有记忆搬进后台：

```bash
node scripts/team-memory/import-existing-memory.mjs --dry-run
node scripts/team-memory/import-existing-memory.mjs
```

## 四个 hook 分别干什么

| 时机 | 脚本 | 干什么 | 会不会拖慢 |
|---|---|---|---|
| 开窗口 | `session-start.mjs` | 拉相关教训 + 套路 + 上次交接摘要，注入上下文；顺手用本机 git 验证待确认的 commit | 3 秒超时，拿不到就放行 |
| 每次工具调用 | `record-event.mjs` | 往本地文件追加一行 | 不联网 |
| 每轮回答结束 | `session-end.mjs` | 冲刷到后台（防窗口被强杀丢数据），不提炼 | 5 秒超时 |
| 会话真结束 | `session-end.mjs --final` | 标记结束 + 触发提炼 + 清本地缓冲 | 15 秒超时 |

**铁律：任何一步都不许挡住干活。** 网络挂了、后台 500、密钥没配 —— 一律静默放行。

## 什么东西才准进库

PM 2026-08-02 拍板：教训和套路**都全自动入库，不用他点**。
所以把关全部落在机器可验证的证据上（`src/lib/team-memory/evidence.ts`）：

| 证据 | 说明 |
|---|---|
| `user_correction` | PM 当场纠正过我 —— 最强 |
| `merged` | 改动真的合进 main 了（本机 git 验证后回填，服务器没有 git） |
| `tests_passed` | 测试真的跑过了 |
| `multi_session` | 同一现象在 ≥2 个独立会话里重现 |

一条都凑不出 → **不许新建**教训，只允许给已有教训 +1 次确认。
「Claude 说搞定了」不在列，永远进不来。

套路更严一档：必须有 `merged` 或 `tests_passed`。
（PM 纠正过我，只能证明我错过，不能证明这套步骤是对的。）

## 自动收拾

- 教训被推翻 2 次 → 自动撤下
- 套路最近 2 次连续失败 → 自动下架
- 都由 `team-memory-sweeper` cron 每 30 分钟跑一次，PM 不用点

## 安全绳

套路自动上线的是**说明书，不是执行权**。
步骤里出现合并 / 建表改表 / 对外发布 / 花钱 / 群发 / 删除，
落库时自动 `requires_approval=true`，执行时仍要 PM 显式 go —— 现有闸门一根不拆。

## 密钥

两道脱敏，故意重复：

1. 本机 `redact.mjs` —— 离开这台电脑之前就抹
2. 服务端 `src/lib/team-memory/redact.ts` —— 落库前再抹一次

只上传工具调用的**摘要**，不上传对话原文。
从会话记录里只取两样：这次在干什么（首条消息）、PM 纠正了我几次。

## 后台在哪看

`/dashboard/team-memory` —— 平时不需要来点任何东西，是**出问题时查**用的：
某条离谱的教训是哪次会话来的、某个套路为什么被下架了。

## 部署后必做一步

在 Render 后台把 `team-memory-sweeper` 这个 cron 关联到 `me-shared-cron-secret`
环境变量组。`sync:false` 不会自动填值 —— `daily-cron-digest` 就是栽在这儿哑了 51 天，
而 digest 只报「失败」不报「没跑」，静默失效不会有任何告警。
