---
id: 2026-11-14-document-library-live-in-production
title: 资料库已在线上开通：表和私有桶已建好，CTS 的 9 个文件已放入并设为员工可下载（PM 11-14 回「建」和「放入·员工可下载」）
status: done
owner: agent
decided_on: 2026-11-14
source: session:940bdb1b
verify_by: 2026-11-17
verify_how: 用 CTS 员工账号（非内部账号）登录后台，打开资料库页能看到 9 个文件，点「下载」能存下 PDF；内部账号也点一次下载拿到 PDF。两个账号都拿到才算成；任何一个失败，按迁移文件注释里的办法回滚。
done_on: 2026-11-14
done_ref: doc:docs/ledger/evidence/2026-11-14-document-library-live-in-production--2026-11-14.md
---
做了什么：PM 回「建」后在线上执行了资料库迁移（登记表 + 私有桶）；PM 回「放入·员工可下载」后，把 CTS 的 9 个文件（手册 v11 + 8 个单团 PDF）放进去，9 个都标「客户员工也能下载」。
核对了什么：表行级保护开、普通账号无权限、桶私有；9 个文件大小和指纹与原件一致；用真实临时链接取回字节一致；管理员登录的页面列出 9 个文件。细节见证据文件。
没验的：真点一次下载把 PDF 存到电脑；CTS 员工账号（非内部账号）视角。
主卡：doc:docs/ledger/2026-11-10-client-document-library.md
