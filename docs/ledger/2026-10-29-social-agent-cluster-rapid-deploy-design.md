---
id: 2026-10-29-social-agent-cluster-rapid-deploy-design
title: 社媒 Agent 集群的快速部署与快速测试工作流设计稿（新客户几周内出第一份有依据的测试结论），待子牙魏征复审
status: decided
owner: agent
decided_on: 2026-10-29
source: doc:docs/specs/2026-10-29-social-agent-cluster-rapid-deploy-test-v0.1.md
verify_by: 2026-11-05
verify_how: 看设计稿是否已过子牙和魏征复审、PM 是否回了第 10 节四个问题；没回就再提醒一次；本卡不授权改任何代码、不授权花钱、不授权发布
---
PM 2026-10-29：「设计一套基于 AI 工具、IMPACT 工作流的快速部署社媒、测试社媒的 agent 集群工作流」。
集群是编排方式，全部复用现有 15 个 agent 和 IMPACT v1.4 的读回与判定，不新建能力线。
AI 能加速生产与排测试表，加速不了样本门槛；真正提速只有排满测试表、提发布量、可选的小额付费测试。
付费测试需要 PM 批预算，投放策略归广告支柱。
