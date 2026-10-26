---
id: 2026-10-19-youtube-customer-self-connect
title: 客户自行授权 YouTube 频道并核对连接结果
status: done
owner: agent
decided_on: 2026-10-19
source: session:01a14536
verify_by: 2026-11-02
verify_how: 在测试客户环境由有权限的客户成员授权一个频道，回读目标频道和有效授权均与所选频道一致；多频道、取消授权、权限撤销和并发重试均不得保存错误连接，且授权过程不得公开发布内容。
done_on: 2026-10-19
done_ref: pr:2905
---
已提交客户社媒连接面板和 YouTube 授权路由改动；尚未部署或执行真实 Google 授权。
沿用现有客户权限、加密授权记录和频道配置；真实授权验证仍待完成。
