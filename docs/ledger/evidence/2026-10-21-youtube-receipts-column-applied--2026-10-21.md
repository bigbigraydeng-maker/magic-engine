# 读回：YouTube 回执表加列（2026-10-21）

- 授权：PM 本人在统管窗口回「go apply」（2026-10-21 约 09:20 新西兰时间）。回话没带编号，统管当时只问了这一份迁移，按这一份执行；SOP 里写的严格回法是「go apply 130000」，这里按上下文理解，另两份迁移（回链列、素材关联加固）没动。
- 应用：Supabase 项目 CrazyContent（线上库），apply_migration，名字 youtube_receipts_content_posts，SQL 与仓库里 10 月 18 日那份 youtube_receipts_content_posts 迁移文件逐字一致；账本版本号由工具自动生成，与文件名里的版本号不同，以后查「跑没跑」只认对象是否存在。
- 应用前（只读）：按列读该表返回 HTTP 400、错误码 42703（列不存在）；表里 0 行。
- 应用后（只读）：查库得到 列存在 1、索引存在 1、指向内容帖表的外键 1、回执行数 0；按列读该表返回 HTTP 200。
- 页面：用 PM 已登录的浏览器打开 CTS 内容工厂页（只读）：能打开，没有红字 Unknown error，五列计数 选题 50 / 备料 11 / 出片 8 / 发布 1 / 看表现 0，与 10-21 早上一致。
- 未验证：看板接口本身没有单独请求（要登录，只看了页面）；页面上暂时看不到 YouTube 阶段，因为回执表是 0 行，属正常。
- 回退办法（只在这一列还没被使用前）：drop index if exists public.youtube_publish_receipts_content_post_idx; alter table public.youtube_publish_receipts drop column if exists content_post_id;
