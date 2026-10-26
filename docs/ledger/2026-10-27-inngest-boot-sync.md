---
id: 2026-10-27-inngest-boot-sync
title: 部署后生产进程自己登记云端函数
status: decided
owner: agent
decided_on: 2026-10-27
source: pr:3219
verify_by: 2026-10-28
verify_how: 这次部署上线后，不用人去后台点同步，新函数应出现在云端函数列表里。本卡交付时没有跑生产。
---

生产进程启动约半分钟后，自己调用现成的接收地址登记云端函数。用已经配好的签名密钥。不新增环境变量，不新开服务。本地、构建和预览不登记。
