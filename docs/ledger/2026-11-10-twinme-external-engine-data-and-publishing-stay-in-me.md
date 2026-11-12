---
id: 2026-11-10-twinme-external-engine-data-and-publishing-stay-in-me
title: 数字人产品（暂名 TwinMe）只当外部出片引擎；客户档案、素材、发布、数据都留在 ME；客户用一个只讲数字人的简单界面（PM 11-10 定）
status: decided
owner: pm
decided_on: 2026-11-10
source: session:6610c9ad
verify_how: 打开 https://github.com/jundongGit/digital-human/pull/1 看到改动单存在且写着 49 条测试通过；新 ME 那一头（接入件、分身登记、简单界面）开出改动单后，再在这张卡上补链接。两头都有了才算第一阶段的代码空白补上。
---
PM 2026-11-10 原话：「我们就把 twinme 当做是一个外部引擎；数据，发布都留在 ME 内，便于客户今后真的升级为 FDE 客户，也会需要 Twinme 制作的东西；或者就是都坐在 ME 内，只是把数字人这部分单独做一个映射的界面在体系外，给客户来。这么做的原因是在于，单纯说数字人容易让客户理解，而不是一上来就进入 me 这个复杂的后台。」随后：「不需要试跑，冲击代码空白，冲击试运行。」
落地口径：「ME」指新 ME（magic-engine-platform，portal.magicengine.com.au）；出片引擎是 jundongGit/digital-human；分销走 Magic Network。开发计划 v0.3（过了子牙、魏征两轮复审）：https://claude.ai/artifact/HaZKLk6b5QfhjjW7N1CZCq 。PM 取消了计划里的「试跑一周」，直接进第一阶段。
已做：引擎那一头的 ME 专用入口（服务密钥、按客户隔离、物理删除带回执、出片结束签名通知）+ 仓库第一批自动测试，改动单 jundongGit/digital-human#1，未合并、未部署、没在真显卡主机上跑过。
已做（同日晚）：新 ME 那一头的第一刀（只有后端）——分身登记与肖像授权、管理员核对后才给引擎、出片下单、成片核对指纹后入素材库、撤回即两边物理删除；默认关闭，配了引擎地址且客户在试运行名单里才开放。Draft 改动单 magic-engine-dev/magic-engine-platform#114（分支 ray/twinme-engine），本机 28 条新测试 + 相关 229 条通过，全量测试交给 CI，没连过真引擎。引擎那边为此补了一次提交（取不到素材改报 502、按 ME 编号删分身）。
已做（同日夜）：两个页面——客户端「内容 → 数字人」（建分身带授权、生成视频、看进度、播放成片、删除）和运营端「增长 → 数字人核对」。Draft 改动单 magic-engine-dev/magic-engine-platform#115（叠在 #114 上）。#114 的线上自动检查已全绿。本机把 ME、ME 后台任务、出片引擎都跑起来，在浏览器里从建分身走到播放成片、再到删除（两边文件都核对过删干净）；显卡对口型那一步用的是替身，真显卡没验。 没做：团队工单、客户版本拦截、出片失败重试、核对通知、成片一键发布；收费与分销对接；引擎机器的备份与上锁；英文出片。页面 /ai-steward 上「NZ English 配音」「每周自动抓热点」两句上线时还做不到，PM 未定是改文案还是人工兑现。Meta 应用的「发帖」「看数据」两项审核状态未查。
