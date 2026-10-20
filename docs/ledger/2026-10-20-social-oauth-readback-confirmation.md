---
id: 2026-10-20-social-oauth-readback-confirmation
title: 社媒授权回跳先核实保存记录再显示连接成功
status: done
owner: agent
decided_on: 2026-10-20
source: doc:docs/specs/2026-10-19-social-channel-onboarding.md
verify_by: 2026-10-22
verify_how: 上线后用获准的测试账号走完授权，确认回调写入的账号、权限、有效期与客户状态一致；读失败或账号不符时界面不报成功。
done_on: 2026-10-20
done_ref: commit:d56c20d57c4d5431acd058b5e244f8a6d30b02a0
---
沿用既有连接表、客户范围读路径和授权入口；此改动不新增权限或发布动作。
