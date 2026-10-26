# 窗口纪律 · 三个自动提醒

装于 2026-09-04。解决三件事：开窗口认不出在做什么、做着做着跑偏、干完不收导致文件烂在本地。

## 三个提醒

| 什么时候 | 做什么 | 脚本 |
|---|---|---|
| 每次开窗口 / 恢复 / 上下文压缩后 | 报到：这个窗口在做什么、分支、上次改动、有没有没提交的文件、其他窗口欠多少账 | `session-start.sh` |
| 每次发消息时 | 当前分支跟开窗口时说好的对不上，喊一次（每个窗口只喊一次） | `drift-check.sh` |
| 每次回答结束 | 有没提交的文件就拦一次，逼出「合了 / 开了 / 写了」三选一（每个窗口只拦一次） | `wrap-up.sh` |

挂在 `~/.claude/settings.json` 的 `hooks` 里，对所有项目生效。

## 契约文件

每个窗口一张，存在 `briefs/<工作目录路径的 md5>.txt`：

```
在做: 一句话说清这个窗口干什么
做完就停: 一个可验证的终点，例如「PR 开出来就停」
风险级: A 或 B 或 C
分支: 当前分支名
```

**故意不放在代码仓库里**——放进去会变成一个未提交文件，反过来触发自己的收尾告警。

风险级定法见 `docs/ENGINEERING_QUALITY_GATES.md`：
A = 安全 / 改数据库 / 花钱 / 对外发布；B = 普通业务；C = 界面文案 / 原型。
对应模型强度：A 用 Opus 关 fast + 先出方案，B 用 Opus 开 fast，C 用 Sonnet 开 fast。

## 其他文件

- `cache/debt-<repo-key>.txt` — 每个仓库一份的全量工作副本欠账统计（key 取自 git-common-dir，不排除任何窗口），开窗口时后台刷新，前台读上一次的值，读取时才排除自己（扫 30 个副本要一两秒，不能让它拖慢开窗口）
- `locks/<会话 id>.*` — 节流锁，保证同一个窗口不会重复唠叨

## 想关掉

只删本工具挂的那几条（按路径标记过滤，其他工具的钩子——比如团队记忆的
`SessionStart`/`Stop`——不受影响）：

```bash
jq '
  .hooks |= (
    with_entries(
      .value |= (
        map(.hooks |= map(select((.command // "" | contains("window-discipline")) | not)))
        | map(select((.hooks | length) > 0))
      )
    )
    | with_entries(select(.value != []))
  )
' ~/.claude/settings.json > /tmp/s.json && mv /tmp/s.json ~/.claude/settings.json
```

只关其中一个，就把对应事件数组里含 `window-discipline` 路径的那一条删掉。原始配置备份在 `~/.claude/settings.json.bak-*`。

## 已知边界

- 只在 git 仓库里生效，非仓库目录直接放行。
- 「跑偏」只认分支变了这一种机械信号。目标变了但分支没变，机器看不出来——那种要靠开窗口时把「做完就停」写具体。
- 收尾拦截只拦一次。第二次关窗口不会再拦，防止卡死。
