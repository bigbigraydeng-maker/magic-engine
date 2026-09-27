---
id: 2026-09-27-tools-lab-step1-app
title: 工具实验室第一步（应用部分）——外人从一个固定入口进 Facebook 广告体检，中文注册 / 登录，注册完直接进体检；示例报告默认自助版；客户看得到的地方不再出现内部代号 Magic Bridge
status: done
owner: agent
decided_on: 2026-09-27
source: session:4bb834a6
done_on: 2026-09-27
done_ref: commit:562891f1
verify_by: 2026-10-04
verify_how: 合并上线后在正式网站查三件事：① 未登录打开 app.magicengine.com.au/meta-ads-ai/mine 跳到中文注册页（「免费注册，开始体检」）；② 示例报告 /meta-ads-ai/demo 默认是「自己用，你会看到」，底部按钮指向 /meta-ads-ai/mine；③ 第一位从这里注册的自助客户，website_lead_events 里有一条 tool_signup（destination=ads-check），且只有一条。不成：先看这位客户是不是从 /meta-ads-ai/mine 进来的。
---
设计：docs/specs/2026-09-27-tools-lab-step1-ads-check-design.md（v2，设计审 子牙 + 魏征 + 板桥）。PM 方案：https://claude.ai/artifact/VRzBuqmDHHcKvbQNBM2CJe 。官网部分（实验室首页、介绍页）另一个 PR。
