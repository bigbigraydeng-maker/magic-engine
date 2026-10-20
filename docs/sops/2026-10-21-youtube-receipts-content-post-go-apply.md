# 应用说明：给 YouTube 回执表加一列（待 PM 本人说 go apply）

状态：**未应用**。写于 2026-10-21，只读核对过生产库，没有任何写入。

## 一句话
内容工厂页（CTS）打不开，是因为页面读 `youtube_publish_receipts.content_post_id`，生产库这张表还没有这一列。应用下面这份迁移就好，`supabase/migrations/20261018130000_youtube_receipts_content_posts.sql`，来自 PR #2864，一直没应用。

## 它做什么
- 加 1 列 `content_post_id`，指向内容帖表 `content_posts(id)`，可以为空。
- 加 1 个部分索引 `youtube_publish_receipts_content_post_idx`（只对有值的行）。
- 不改任何已有数据，不碰其他表，不动权限策略。

## 为什么安全
- 幂等：两条语句都带 `if not exists`，重复执行不会报错。
- 只读核对结果（2026-10-21，生产库）：`content_posts` 表存在；这一列和这个索引都还没有；`youtube_publish_receipts` 现在 0 行；之前的两份补丁（110000、150000）已应用。
- 因为回执表现在是空的，加列不会锁住有分量的数据。

## 怎么回退
```sql
drop index if exists public.youtube_publish_receipts_content_post_idx;
alter table public.youtube_publish_receipts drop column if exists content_post_id;
```
只在这一列还没有被使用之前回退；回退后内容工厂页会回到现在的打不开状态，除非先上代码兜底。

## 应用后怎么验（读回）
1. 查库：`youtube_publish_receipts` 有 `content_post_id` 这一列，索引存在。
2. 打开 `GET /api/clients/<CTS 客户编号>/content-factory/board`，要返回 200，不是 500。
3. 打开 CTS 的内容工厂页，红字「Unknown error」消失；有 YouTube 回执时能看到 YouTube 阶段（现在没有回执，所以暂时看不到阶段是正常的）。

## 需要谁说什么
应用生产库只认 PM 本人的话：回 `go apply 130000` 才应用。其他窗口转述不算。

## 另一处顺手要修的代码问题（不属于本迁移）
看板接口读回执失败时抛出的是数据库错误对象，不是 Error，被当成「Unknown error」把真原因藏了；回执只是附加信息，读失败不该让整页死。这一条已转给负责后台入口的窗口处理。
