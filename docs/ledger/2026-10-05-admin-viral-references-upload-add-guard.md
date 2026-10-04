---
id: 2026-10-05-admin-viral-references-upload-add-guard
title: viral-references/upload 无 admin 检查，且把上传文件写进服务器临时目录不限大小
status: decided
owner: agent
decided_on: 2026-10-05
source: session:07fc4e50
verify_how: 改完后未登录请求返回 401、非本客户返回 403，单测覆盖，本地起开发服务试一次（不碰生产）
---
路径 src/app/api/admin/viral-references/upload/route.ts（POST）。花钱（Gemini）+ 磁盘/内存被打满风险。
修法：guardGlobalAdmin，并加文件大小上限。
