# 证据 · 2026-11-14-document-library-live-in-production · 2026-11-14
fetched_at: 2026-11-14T23:21:14+13:00

查了什么：资料库在生产库里是否已按设计开通——表、私有桶、CTS 的 9 个文件，以及文件能否经真实临时链接取回、字节是否与原件一致。

建表建桶（PM 11-14 回「建」；MCP apply_migration，名称 client_documents，内容与主干 supabase/migrations/20261110140000_client_documents.sql 逐字一致；项目 glbdnayojixmexgofbsd，本应用的生产库）：
- 建前（同一轮重查）：表、桶都不存在；clients 40 行、clients.id 是 uuid；storage.objects 只有 2 条策略，都只给 service_role 且限定各自的桶；storage.buckets 的列够迁移里的 insert 用。
- 建后：表 19 列、18 条约束、4 个索引，行级保护开，只有 client_documents_service_role（ALL，仅 service_role）一条策略；anon 与 authenticated 对表的 select / insert / update / delete 全为 false，service_role 的 select / insert 为 true；桶私有、上限 52428800 字节、7 种文件类型；storage.objects 策略仍是 2 条；其余 11 个桶的公开 / 私有状态与建前一致；迁移登记表新增一行（11-14 10:12:47 UTC，名称 client_documents）。

放入 9 个文件（PM 回「放入·员工可下载」；scripts/client-documents/import-files.ts --apply，--project-ref 与环境文件指向的项目核对通过；清单里 9 个都写 client）：
- 先演练（9 个文件的类型、大小、重复检查全通过），再写入：9 行都是 ADDED，退出码 0。
- 对账（SQL，样本 = 9 / 9）：9 行都在 CTS 名下，手册 brochure / client / current / v11，8 个单页 sheet / client / current / v11；行里的大小和完整 SHA-256 与本地原件一致 9 / 9；存储对象大小一致 9 / 9、类型 application/pdf、缓存 max-age=0；路径都是「客户号/行号/文件名」；行 9、对象 9、没有无对象的行、没有无行的对象；其他客户 0 行。

取回验证（一次性只读脚本，用库自己的 createDownloadUrl 取真实临时链接，字节读进内存比对、没写盘；样本 9 / 9）：
- 全部 HTTP 200，字节数和 SHA-256 与登记值一致，类型 application/pdf，Content-Disposition 带原文件名。
- 不带签名的公开链接 9 / 9 返回 400；用匿名钥匙走 authenticated 路径 9 / 9 返回 400 → 桶确实对外不可读。

页面验证（PM 已登录的 Chrome，管理员账号，只读；没点下载、没存文件，验完已关掉我开的标签页）：
- app.magicengine.com.au 的资料库页列出 9 个文件，每个带「v11」「客户员工也能下载」，有下载 / 换新版 / 改信息 / 归档按钮；左侧菜单有「资料库」入口，指向该客户的资料库页。
- 页内对真实文件的下载地址发请求（不跟随跳转）：得到跳转响应（接口放行并跳向临时链接）；对不存在的文件号、不存在的客户号各得到 404。

没验的：
- 真点一次「下载」把 PDF 存到电脑（浏览器对附件的处理）。
- CTS 员工账号（非内部账号）视角：能看到 9 个文件并下载。这一条只有单元测试覆盖（56 条访问矩阵，用的是真实的访问判断），没有真账号验证。

来源 / 命令：
- Supabase MCP：apply_migration 一次；execute_sql 只读查询若干（项目 glbdnayojixmexgofbsd）
- npx tsx --env-file=<主目录环境文件> scripts/client-documents/import-files.ts --client <CTS 客户号> --manifest <Dropbox 清单> --apply --project-ref glbdnayojixmexgofbsd
- 一次性取回脚本（草稿目录，不在仓库里）
- 浏览器：PM 已登录的 Chrome 标签页，只读
