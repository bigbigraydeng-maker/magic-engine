# Story 自动发布 · 第一刀 · DeepSeek 指令（风险级 A，只写 Meta 适配器，零数据库、零真发）

- 权威设计稿：[docs/specs/2026-10-12-story-auto-publish-design.md](../specs/2026-10-12-story-auto-publish-design.md)（v0.4，§3 接口、§3.5 硬约束、§4.2 失败分类）。冲突以设计稿为准。
- 写入者：一个 Claude Code 会话（84 号）调用 aider 跑本指令；DeepSeek 只改下面「允许修改」的文件。其余文件只读。
- 分支：`feat/` 前缀（A 级，不用 `claude/`）；PR 保持草稿，正文单独一行 `风险级别：A`。

## 目标
为 Facebook 主页 Story（照片、视频）和 Instagram Story 各写一个**发布适配器**，错误分类沿用现有 `PagePublishError`。**纯函数式、注入 `fetcher`、默认不联网**。第一刀**不接任何调用方**，不碰数据库、环境变量、Inngest、路由。

## 不做（出现即停）
真实网络调用 · 任何 `process.env` 读取 · 数据库 / migration · 路由 / Inngest · 链接贴纸 / 文字叠加参数（**接口是否支持未核实，不许猜参数名**；留 `// TODO(story-link-sticker)` 注释并在测试里不覆盖）· 重试逻辑（调用方负责，重试会重复发帖）· 改 `publishPagePhotoPost` 行为。

## 允许修改 / 新增
1. **改** `src/lib/meta/page-posts.ts:436`：把 `function classifyPublishFailure` 改为 `export function classifyPublishFailure`（只加 `export`，其余一字不动）。
2. **新增** `src/lib/meta/page-stories.ts`（Facebook 主页 Story）
3. **新增** `src/lib/meta/instagram-stories.ts`（Instagram Story）
4. **新增** `src/lib/meta/__tests__/page-stories.test.ts`、`src/lib/meta/__tests__/instagram-stories.test.ts`

先读（不改）：`src/lib/meta/page-posts.ts:403-573`（`PublishOutcomeCertainty` / `PagePublishError` / `classifyPublishFailure` / `publishPagePhotoPost` 的写法与错误处理，**风格照抄**）、`src/lib/meta/graph-base.ts`（`GRAPH_BASE`）、`src/lib/meta/__tests__/page-posts.test.ts:1-30`（`fakeFetch` 写法照抄）。

## 2. `page-stories.ts` 要导出
```ts
export interface PublishedPageStory { postId: string; raw: Record<string, unknown> }

/** 照片 Story：先 POST /{pageId}/photos {url, published:false} 取 photo id，再 POST /{pageId}/photo_stories {photo_id} */
export async function publishPagePhotoStory(input: {
  pageId: string; pageAccessToken: string; imageUrl: string
  timeoutMs?: number; fetcher?: typeof fetch
}): Promise<PublishedPageStory>

/** 视频 Story 三步：POST /{pageId}/video_stories {upload_phase:'start'} → 上传 → POST {video_id, upload_phase:'finish'} */
export async function publishPageVideoStory(input: {
  pageId: string; pageAccessToken: string; videoUrl: string   // file_url 方式，主机须由调用方保证是 Meta 接受的
  timeoutMs?: number; fetcher?: typeof fetch
}): Promise<PublishedPageStory>

/** GET /{pageId}/stories?fields=post_id,status,creation_time,media_type,media_id,url[&since&until]，用于发后回读 */
export async function listPageStories(input: {
  pageId: string; pageAccessToken: string; since?: Date; until?: Date
  fetcher?: typeof fetch
}): Promise<Array<{ postId: string; status: string; creationTime: string | null; mediaType: string | null; mediaId: string | null; url: string | null }>>
```
要求：
- 复用 `PagePublishError` 与 `classifyPublishFailure`（从 `./page-posts` 引入）；**错误分类规则与 `publishPagePhotoPost` 完全一致**：网络异常 / 无响应 = `unknown`；2xx 带 error 体 = `unknown`；2xx 无 `post_id` = `unknown`；4xx 且带 Graph 错误体按 `classifyPublishFailure`。
- 照片 Story **两步**：第一步（上传 `published:false`）失败 = 没有任何东西发出，仍按同一分类；第二步失败 = 按同一分类（**第二步 `unknown` 时不得重试第一步**）。第一步成功后产生的未发布照片对象，**不在本刀处理**（`// NOTE` 注释说明）。
- 视频 Story 的上传步骤：本刀只实现 `file_url` 方式（把 `file_url` 放在文档所述的位置，**读设计稿 §3.1，不凭记忆**；位置不确定时用 `// TODO(verify-with-real-call)` 标出，别猜）。
- Graph 版本只用 `GRAPH_BASE`，令牌用请求体或 query 的方式与 `publishPagePhotoPost` 一致；**日志 / 错误信息里不得出现令牌**。
- `timeoutMs` 设置时用 `AbortSignal.timeout`，**未设置则不加超时**（与 `publishPagePhotoPost` 一致）。

## 3. `instagram-stories.ts` 要导出
```ts
/** POST /{igUserId}/media {media_type:'STORIES', image_url | video_url} → 容器 id（还没发布） */
export async function createIgStoryContainer(input: {
  igUserId: string; accessToken: string
  media: { kind: 'image'; imageUrl: string } | { kind: 'video'; videoUrl: string }
  timeoutMs?: number; fetcher?: typeof fetch
}): Promise<{ containerId: string; raw: Record<string, unknown> }>

/** GET /{containerId}?fields=status_code */
export async function getIgContainerStatus(input: {
  containerId: string; accessToken: string; timeoutMs?: number; fetcher?: typeof fetch
}): Promise<{ statusCode: string | null; raw: Record<string, unknown> }>

/** POST /{igUserId}/media_publish {creation_id} → 媒体 id */
export async function publishIgContainer(input: {
  igUserId: string; accessToken: string; containerId: string
  timeoutMs?: number; fetcher?: typeof fetch
}): Promise<{ mediaId: string; raw: Record<string, unknown> }>
```
要求同上；**三个函数相互独立，不在内部轮询**（轮询由调用方的接力函数做，设计稿 §4.2）；`createIgStoryContainer` 成功返回的 `containerId` 由调用方落库，本刀不管存储。

## 验收（每条都要有测试，正反两侧都测）
1. 照片 Story：两步各成功 → 返回 `postId`；第一步 400 带 Graph 错误体 → `PagePublishError` 且 `certainty==='rejected'`；第二步网络异常 → `certainty==='unknown'` 且**第二步只被调用一次**（fetch 调用次数断言，无重试）。
2. `fetch` 抛异常、2xx 带 `error` 体、2xx 无 `post_id`、429 / Graph code 4 → 分别得 `unknown` / `unknown` / `unknown` / `rate_limited`。
3. Graph code 1 或 2 且状态 400 → `unknown`（不得判 rejected）。
4. 视频 Story：start / 上传 / finish 三步顺序正确；任一步失败即抛、后续步骤不被调用。
5. `listPageStories`：参数拼接（`since` / `until` 为秒级时间戳，**以设计稿 §3.1 为准**）、空列表、`status` 为 `ARCHIVED` 照样返回。
6. 令牌不出现在任何抛出的错误 `message` 里（断言 `expect(err.message).not.toContain(TOKEN)`）。
7. Instagram 三个函数：成功路径、`image` / `video` 两种 `kind` 的请求体字段名（`image_url` / `video_url` + `media_type:'STORIES'`）、失败分类同上；`getIgContainerStatus` 不抛对「处理中」状态。
8. 所有测试注入 `fetcher`；**测试文件里不得出现真实网络调用**（可 `vi.spyOn(globalThis,'fetch')` 断言未被调用）。

## 命令（工作目录 = 仓库根）
```bash
npx vitest run src/lib/meta/__tests__/page-stories.test.ts src/lib/meta/__tests__/instagram-stories.test.ts src/lib/meta/__tests__/page-posts.test.ts
npx tsc --noEmit -p . 2>&1 | grep -E "meta/(page-stories|instagram-stories|page-posts)" || echo "no type errors in touched files"
```
通过标准：三个测试文件全绿（`page-posts.test.ts` 必须原样绿，证明那个 `export` 没改行为）；触碰文件无类型错误。仓库整体 type-check 基线本来可能是红的（记忆：type-check 基线红），**只比对触碰文件**，并如实写出整体结果。

## 编码约束
TypeScript strict，无 `any` / `@ts-ignore`；函数 < 50 行；文件 < 800 行；英文注释，风格同 `page-posts.ts`；不引入新依赖；共享代码里**不得出现任何客户名、客户 ID、行业词**。

## 当场试跑（第一刀的口径）
第一刀只有离线测试：交付时必须贴出上面命令的真实输出（退出码 + 通过数）。**真实 Graph 试跑不在 DeepSeek 范围**，那一步需要 PM 明确说 go，并由 Claude 会话单独做（设计稿 §3.5、§10：验证 IG Story 在 Facebook Login 下能否发、Reel 剪片段能否发 FB Story、Story 有无定时参数、**有无链接贴纸参数**）。没做之前，PR 正文写「真实调用：未做」。

## 交付给 Claude 会话的回报
改了哪些文件（行数）· 三条命令的退出码与输出摘要 · DeepSeek 跑了几轮、合计花费 · 任何你不确定而写了 TODO 的地方。
