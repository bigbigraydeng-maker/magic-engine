---
id: 2026-11-14-mn-distributor-backoffice-mvp
title: Magic Network 单位制经销商后台第一刀：复用旧账号和登录，旁边加 v1.2 计算，不切换现有月结
status: decided
owner: pm
decided_on: 2026-11-14
source: session:mn-distributor-backoffice
verify_how: src/lib/distributor/mn 的测试核对了方案里的 Lab 客户表、团队查表和三位伙伴例子；旧佣金测试仍过。迁移文件未执行。
---

旧的纽币经销商规则（普通 / 一级 / 特级）继续有效，直到某个 1 号并且汇率已锁定。单位制页面在 `/partner/network`，账本未启用时不显示金额。身份获得方式、汇率、年付折法、自购上限仍待定，代码里是配置，默认不把建议当成已确认。细则和待拍板清单见 `docs/mn-marketplace/reuse-map.md`。
