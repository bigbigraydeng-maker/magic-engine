---
id: 2026-09-27-tools-lab-step1-app
title: 工具实验室第一步（应用部分）——外人从一个固定入口进 Facebook 广告体检，中文注册 / 登录，注册完直接进体检；示例报告默认自助版；客户看得到的地方不再出现内部代号 Magic Bridge
status: done
owner: pm
decided_on: 2026-09-27
source: session:4bb834a6
done_on: 2026-09-27
done_ref: pr:2123
verify_by: 2026-10-04
verify_how: 合并上线后在正式网站查三件事：① 未登录打开 app.magicengine.com.au/meta-ads-ai/mine 跳到中文注册页（「免费注册，开始体检」）；② 示例报告 /meta-ads-ai/demo 默认是「自己用，你会看到」，底部按钮指向 /meta-ads-ai/mine；③ 第一位从这里注册的自助客户，website_lead_events 里有一条 tool_signup（destination=ads-check），且只有一条。不成：先看这位客户是不是从 /meta-ads-ai/mine 进来的。
last_checked: 2026-10-12
check_note: 连续两晚判不了（10-09、10-12），转 PM：夜巡盖章：done_ref 指向的 PR 已合并（或为文档/提交型指向），但 verify_how 要求的实证本晚未取到，不翻状态
---
设计：docs/specs/2026-09-27-tools-lab-step1-ads-check-design.md（v2，设计审 子牙 + 魏征 + 板桥）。PM 方案：https://claude.ai/artifact/VRzBuqmDHHcKvbQNBM2CJe 。官网部分（实验室首页、介绍页）另一个 PR。
实施后审 子牙 + 魏征 + 板桥：无阻塞，建议项已改（线索只记第一次验证、员工看自助客户后台显示普通链接、体检页加回工作台、文案）。留作后续：①填错邮箱后公司名被空客户占住（查重应跳过从未验证的客户）；②发验证码的按 IP 限制取的是请求头第一个地址，可伪造，要改成可信的客户端 IP；③名单里的客户只读账号仍能自助注册；④验证码邮件模板（Supabase 后台）是否英文 / 提 MTC 待核实；⑤Meta 授权页显示的应用名待核实。
狄仁杰攻击验证：无高风险；两条中风险已修（名单里的客户只读账号 / 演示管理员也拒绝自助注册；登录验证码按邮箱每小时最多 3 次）。低风险留作后续：员工邮箱可被逐个试出（409 在限次之前）；旧的跳转校验放行 `/\` 开头地址（另开任务）。
