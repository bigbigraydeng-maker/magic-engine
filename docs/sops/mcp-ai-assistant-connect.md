# 连接你的 AI 商业助手 — Claude Code / Codex / Claude Desktop 接入指南

> **定位**:把客户自己的 AI(Claude Code / Codex / Claude Desktop)接上 Magic Engine,
> 让它从"通用 AI"变成**「懂你生意的 AI 商业助手」** —— 能实时看到你的排名、目标、
> 执行进度、内容交付,基于**你的真实数据**回答。
>
> **适用对象**:FDE 客户 + 购买 MTC 的客户(技术型 / 进阶用户)。
> **能力**:只读 —— 查看,不修改。强隔离 —— 只能看自己的数据。
> Phase 34 · 面向 FDE 操作 + 可转发给客户。

---

## 一、FDE:给客户发钥匙(后台,2 分钟)

1. 后台 → 客户 → [某客户] → 设置 → 滚到 **§4 · 程序化访问 / 🔌 MCP API 访问**
2. 起个名(如 `张老板的 Claude Code`)→「生成 Key」
3. 复制钥匙(`me_live_...`,**只显示一次**)
4. 安全渠道交给客户(每个客户各自的钥匙 = 各自的身份,只能看自己数据)

> 泄漏 / 离职:回这页「吊销」,客户的 AI 立即断连。

---

## 二、客户接入(三选一,看客户用哪个工具)

服务器地址(固定):`https://app.magicengine.com.au/api/mcp/mcp`
把下面命令里的 `me_live_你的钥匙` 换成我们给的钥匙。

### A. Claude Code(命令行,最简单)

```bash
claude mcp add --transport http magic-engine \
  https://app.magicengine.com.au/api/mcp/mcp \
  --header "Authorization: Bearer me_live_你的钥匙"
```

加完直接在 Claude Code 里问。

### B. Codex(CLI / IDE 通用)

钥匙放环境变量(Codex 要求,更安全 —— 不写进配置文件):

```bash
export MAGIC_ENGINE_TOKEN="me_live_你的钥匙"
codex mcp add magic-engine \
  --url https://app.magicengine.com.au/api/mcp/mcp \
  --bearer-token-env-var MAGIC_ENGINE_TOKEN
```

或手动编辑 `~/.codex/config.toml`:
```toml
[mcp_servers.magic-engine]
url = "https://app.magicengine.com.au/api/mcp/mcp"
bearer_token_env_var = "MAGIC_ENGINE_TOKEN"
```
(CLI 和 IDE 扩展共用这份配置,配一次两边通用)

### C. Claude Desktop(桌面 App,非技术友好)

编辑配置(设置 → 开发者 → Edit Config),在最外层 `{` 后加:
```json
  "mcpServers": {
    "magic-engine": {
      "command": "cmd",
      "args": ["/c", "npx", "mcp-remote",
        "https://app.magicengine.com.au/api/mcp/mcp",
        "--header", "Authorization: Bearer me_live_你的钥匙"]
    }
  },
```
（Mac:把 `"command": "cmd", "args": ["/c", "npx",` 改成 `"command": "npx", "args": [`）
保存 → 完全退出重开 → 首次调用点「始终允许」。需先装 Node.js（nodejs.org LTS）。

---

## 三、接好之后,客户能问什么

- "我的账户体检分多少 / 哪个维度最弱?"
- "我的目标进度怎么样了?"
- "我这个月的搜索表现(点击/曝光/排名)如何?"
- "你们现在在帮我做哪些事?"
- "我已经交付了多少内容?"

AI 会实时调 Magic Engine,基于该客户的**真实数据**回答。

---

## 四、安全边界(对客户透明)

- **只读**:只能看,改不了任何东西。
- **强隔离**:钥匙绑定单一客户,只能看自己的数据,碰不到别家。
- **限流**:每把钥匙 60 次/分钟。
- **可吊销**:后台一点立即失效。
- **不暴露供应商**:返回内容不出现第三方供应商真名。

---

## 五、MTC 计费(规划方向,见 ROADMAP Phase 34 二期)

每次调用已记入 `mcp_access_log`(预留了计费数据源)。将来可做:
- FDE 客户:作为服务赠送
- MTC 客户:作为付费权益 / 按调用消耗 MTC

---

## 六、常见问题

| 现象 | 处理 |
|---|---|
| 连不上 / 401 | 钥匙错或已吊销 → 后台确认 / 重发 |
| 查 Oztop 却只返回自己的数据 | **正常** —— 钥匙只能看自己客户的数据(隔离生效),不是 bug |
| SEO 返回 `pending_sync` | 该客户 GSC 数据还没同步(每日 cron),次日再看 |
| Windows Claude Desktop 报 `'C:\Program' 不是命令` | Node 装在含空格路径,用方式 C 的 `cmd /c npx` 写法(已含) |
