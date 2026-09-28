---
id: 2026-09-28-cn-phone-otp-password-login-design
title: 中国手机号验证码登录 + 用户名密码登录设计方案定稿，子牙+魏征第一轮复审已过，等 PM 拍板要不要排进开发
status: decided
owner: pm
decided_on: 2026-09-28
source: session:4bb834a6
verify_by: 2026-10-12
verify_how: 到期前 PM 应该已经回过要不要做、排第几优先级；没回就是这张卡说的"决定了没做"。做了之后新开一张 done 卡指向实现的 PR，不在这张卡上改。
---
背景：国内客户大量用 QQ 邮箱或没有常用邮箱，现有邮箱验证码注册卡住这批客户，PM 2026-09-28 提出要不要接手机验证码 + 用户名密码。
方案：docs/specs/2026-09-28-cn-phone-otp-and-password-login-v0.2.md（阿里云短信认证服务 PNVS，因新西兰主体无法申请大陆短信品牌签名；密码登录复用现有 signInWithPassword 机制）。
子牙、魏征各审一轮，共 3 个 BLOCKER（手机号会话铸造机制、`resolveRedirectForSession` 邮箱假设、免费额度防重复领取方向）均已在稿子里改完，可进详细设计。真正开工前还需要 PM/FDE 本人去阿里云开户实名认证——这一步开发环境做不了。
