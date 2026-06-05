# Magic Engine MCP — 客户接入 SOP

> 让客户在自己的 Claude 里只读查看「自己的」Magic Engine 数据(排名 / 目标 / 执行进度 / 内容交付)。
> Phase 34 · 适用于 FDE 给客户开通 + 交付。

---

## 一、FDE 给客户签发 Key(后台操作)

1. 打开客户配置页:`/dashboard/clients/<clientId>/settings`
2. 滚到最下方 **§3 · 程序化访问 / 🔌 MCP API 访问**
3. 在「签发新 Key」输入框填一个**好认的名字**(如 `张老板 Claude 桌面版`),点「生成 Key」
4. 弹出的琥珀色框里是**完整 Key(`me_live_…`)—— 只显示这一次**,点「复制 Key」
5. 通过安全渠道(不要明文邮件)把 Key 交给客户

> ⚠️ 只有 Admin/FDE 能签发。客户自己进 settings 页看到的是「仅 Admin/FDE 可管理」提示,不能自助签发(MVP 策略)。
> 客户离职 / Key 泄漏 → 回同一面板点「吊销」,客户的 Claude 立即断连。

---

## 二、客户在 Claude Desktop 接入

> MVP 接入方式:Claude Desktop + `mcp-remote`(网页版一键 Connect 需二期 OAuth,见设计文档 §7)。

客户编辑 `claude_desktop_config.json`(Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "magic-engine": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://app.magicengine.com.au/api/mcp/mcp",
        "--header",
        "Authorization: Bearer me_live_你的key"
      ]
    }
  }
}
```

保存后**完全重启 Claude Desktop**。连接成功后,客户可以问:

- “我的账户体检分多少?” → `me_get_overview`
- “我的目标进度如何?” → `me_list_goals` / `me_get_goal_detail`
- “我这个月的搜索表现怎么样?” → `me_get_seo_performance`
- “你们现在在帮我做什么?” → `me_list_execution_items`

---

## 三、安全边界(对客户透明,但内部要知道)

- **只读**:MCP 只能查看,不能修改任何东西。
- **强隔离**:Key 绑定单一客户,`client_id` 从 Key 反查、绝不接受参数传入 —— 客户**无法**查看其他客户的数据。
- **限流**:每个 Key 每分钟最多 60 次请求,超出返回友好提示。
- **审计**:每次调用记入 `mcp_access_log`(谁 / 哪个工具 / 何时),`client_api_keys.last_used_at` 同步更新。
- **不暴露供应商**:返回内容经封装名过滤,不出现 OpenAI / SEMrush 等真实供应商名。

---

## 四、故障排查

| 现象 | 原因 / 处理 |
|---|---|
| Claude 连不上 / 401 | Key 错 / 已吊销 → 后台确认 Key 状态,必要时重新签发 |
| “Rate limit reached” | 1 分钟内 >60 次,等一会儿 |
| `me_get_seo_performance` 返回 `pending_sync` | 该客户 GSC 数据还没同步(每日 cron),次日再看 |
| 工具返回「Something went wrong」 | 服务端错误,查 `mcp_access_log` 里 `ok=false` 的行 + server log |

---

## 五、内部验证 SOP(每次大改后在 CF 预览跑)

> 本地 dev 容器**连不上 Supabase 数据 API**(network allowlist),真实数据 e2e 必须在 Cloudflare 预览部署跑。详见 `docs/specs/me-mcp-p34-1-auth-notes.md`。

1. Supabase 给某 QA 客户 INSERT 一把 key
2. 把 §二 的 URL 换成预览 URL `https://<preview>.magic-engine.pages.dev/api/mcp/mcp`
3. 验证 5 个工具都能返回该客户数据(或 `pending_sync` 空态)
4. 用 A 客户的 key 确认拿不到 B 客户数据(跨租户隔离)
5. 扫返回无供应商真名
6. 测完吊销所有测试 key
