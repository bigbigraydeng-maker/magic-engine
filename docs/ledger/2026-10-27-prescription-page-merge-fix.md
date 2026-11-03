---
id: 2026-10-27-prescription-page-merge-fix
title: 客户页新处方文件被两版代码拼在一起，网站打不出包；已改回对话框那一版
status: done
owner: agent
decided_on: 2026-10-27
source: pr:3243
verify_by: 2026-10-28
verify_how: 到 Render 部署页看这次修复合进主干之后的构建是成功的，构建日志里不再出现处方新页面的 Expected ',' got 'import'。
done_on: 2026-10-27
done_ref: commit:46a548f881eb4331029ceecf34e6766b96bd1338
---
第 3243 号合入主干时，新处方页面把对话框入口和旧的长页面拼进了同一个文件，网站构建失败。正确内容是对话框那一版，旧页面残留已删。第 3243 号改过的其它文件没有同样的拼接。
