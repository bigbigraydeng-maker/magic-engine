# 证据：2026-09-24-claimed-gates-missing · 取数 2026-09-25（NZ 时间，本机只读核实）

## 核对的三件事

| 检查项 | 命令 | 结果 |
|---|---|---|
| 盘问技能是否存在 | `ls ~/.claude/skills/` | 只有 `client-invoicing/`、`synced/`；**没有 `grilling`，也没有 `grill-me`** |
| 合并拦截是否存在 | `grep -n "gh " ~/.claude/settings.json` | **零条** `gh pr` 相关规则（只命中一行无关的提示文案） |
| 项目权限是否放行 | `grep -n "gh pr" <仓库>/.claude/settings.local.json` | `permissions.allow` 里有 **`Bash(gh pr *)`**（第 26 行），另有一条针对某次具体 `gh pr create` 的历史放行（第 39 行） |

## 结论

判据两条路里走的是第二条：**记忆改成"未安装"**，机器上什么都没动。

- `~/.claude/projects/-Users-raydeng-Projects-magic-engine/memory/feedback-grill-before-building.md`（仓库外）：
  "三层防御缺一不可 · `gh pr merge` 机械闸门" 改为 "②截至 2026-09-25 不存在，项目 settings.local.json 反而放行 `Bash(gh pr *)`"；
  "底层技能在 `~/.claude/skills/grilling`（已自动触发）" 改为 "截至 2026-09-25 未安装"。
- 同目录 `MEMORY.md` 索引行钩子同步标注"截至 9-25 都没装"。
- 权限设置（`settings.local.json` 的 allow 列表）是用户的安全设置，本次**没有改**；要不要真装拦截交 PM 决定。

## 若 PM 决定真装（供参考，未执行）

1. 项目 `.claude/settings.local.json`：把 `"Bash(gh pr *)"` 拆成 `"Bash(gh pr view *)"`、`"Bash(gh pr list *)"`、`"Bash(gh pr create *)"`、`"Bash(gh pr checks *)"`、`"Bash(gh pr diff *)"`，并在 `permissions.deny` 或 `permissions.ask` 加 `"Bash(gh pr merge *)"`。
   影响：以后任何窗口跑 `gh pr merge` 都会弹确认或被拒，等于把"等 `go merge`"变成机器拦。
2. 盘问技能：目前盘上没有可安装的源，需要先写 `~/.claude/skills/grilling/SKILL.md`；这是一件新活，另开卡。
