# P34.0 Transport Spike — Result: ✅ PASS

> 日期：2026-06-05 NZST · 分支 `claude/magic-engine-mcp-design-GJNWq` · PR [#369](https://github.com/bigbigraydeng-maker/magic-engine/pull/369)
> 验证目标：设计文档 §2.1 标记为「整个方案唯一可能翻船」的 transport 适配风险。

## 翻船假设（要证伪的）

`@modelcontextprotocol/sdk` 的 `StreamableHTTPServerTransport` 期望 Node 原生 `http.IncomingMessage` / `ServerResponse`（Express 风格），而 Next.js 14 App Router route handler 拿到的是 Web `Request` / `Response` —— 签名不兼容。若成立，要么自写 Web-stream 适配层（高风险、撑爆工期），要么放弃挂主 app（违背「零额外部署」）。

## 解决路径

选 **Vercel 官方 `mcp-handler` 包**（`createMcpHandler`），它内部已封装 Web 标准适配。导出签名为 `(request: Request) => Promise<Response>` —— **原生兼容 App Router**，不需自写适配。Stateless JSON 模式（`sessionIdGenerator: undefined` + `disableSse: true`）契合 App Router 请求模型。

## 实测（用 MCP 官方 client 模拟 Claude）

测试脚本（用完即删，已 gitignore 移除）：MCP `Client` + `StreamableHTTPClientTransport` → `connect()` → `listTools()` → `callTool('me_ping')`。

```
ready after 7s                                             ← dev server 起来
warmed OK                                                   ← /api/mcp/mcp 路由编译
OK connect/initialize                                       ← MCP initialize 握手成功
OK tools/list: me_ping                                      ← tools/list 返回工具清单
OK tools/call me_ping ->
  [{"type":"text","text":"pong: spike @ 2026-06-05T01:37:48.360Z"}]
SPIKE_RESULT=PASS
```

**Cloudflare Pages 生产 build（commit `33b6a0e`）：✅ Deploy successful** —— 新依赖（`mcp-handler` 0.x + `@modelcontextprotocol/sdk` + `zod`）在生产 build 环境下亦通过，不只是 dev。

## 结论 & 对下游 PXX 的影响

- 🟢 翻船假设**证伪**。Next.js 14 App Router 可承载 Streamable HTTP MCP transport。
- 🟢 工期估算（6–7 天）**仍然成立**，无需回炉（设计文档 §9 留的逃生口未触发）。
- 🟢 文档定下的 stateless JSON 形态实测可行（魏征/子牙双审推荐路径）。
- ➡️ **解锁 P34.1**：Bearer-token 鉴权层接入 —— 用 `withMcpAuth(handler, verifyToken)`，`verifyToken` 回调里查 `client_api_keys` 反查 `client_id`。
- ➡️ **P34.4 隔离层接入点**：scoped-queries 在 tool callback 内构造（`client_id` 来自 `withMcpAuth` 注入的 `req.auth`），不在 tool 入参，子牙 B5 不变量满足。

## 代码地基（已在 commit `33b6a0e`）

- `package.json`：新增 `mcp-handler` / `@modelcontextprotocol/sdk` / `zod`
- `src/app/api/mcp/[transport]/route.ts`：stateless `createMcpHandler` + 一个 `me_ping` stub tool，导出 `GET`/`POST`/`dynamic`/`maxDuration`

客户端连接路径（spike 阶段，无鉴权）：`POST http://<host>/api/mcp/mcp`（`basePath: '/api/mcp'` + Streamable 子路径 `mcp`）。
