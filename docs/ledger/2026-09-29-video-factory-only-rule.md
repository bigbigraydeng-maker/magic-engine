---
id: 2026-09-29-video-factory-only-rule
title: 我们管理的社媒账户，视频生产只认视频工厂——禁止另写脚本绕过
status: decided
owner: pm
decided_on: 2026-09-29
source: session:31cdcfa9
verify_by: 2026-10-13
verify_how: 判据不是「文档写了」，是「绕开工厂的路有没有真的被堵住」。①抽查这两周内新出现的视频相关脚本（`scratchpad/*.mjs`、任何目录下含直调 Muapi/WaveSpeed/Seedance + 平台发布 API 的新代码），确认没有第二例「另写脚本绕过工厂」；②本条规矩目前只是文字约束，没有技术闸——若两周内没有排上技术闸（静态检查 / 统一发布凭证）的实施卡，本条降级为「未生效，只挡住了会读文档的窗口」，转交 PM 决定要不要投入做真正的闸；③East Inter 那两条已发布视频的处置结果（撤 / 保留）应已有台账记录，没有则本条连带失败。
last_checked: 2026-09-29
check_note: 技术闸已实现（静态CI检查，PR待开），见 doc:docs/ledger/2026-09-29-video-factory-bypass-gate.md；另两项判据（两周内无第二例、East Inter两条视频处置结果）仍待夜巡/PM确认
---
2026-09-28 East Inter 客户两条 Facebook Reel 由另开的临时脚本（不在 `src/lib/factory/` 下）直接调 Muapi 生成、直接调 Facebook 接口发布，绕开视频工厂 = 绕开配方对账、分镜自检、事实溯源三道闸。发出去的视频没有声音（生成模型不带音轨，流程没加配音步骤），文案「$0.28/kg」「35 天」「4 步流程」查不到任何来源。
PM 2026-09-29 拍板：往后凡是要发布到我们管理的 FB / IG 等社媒账户的视频，一律只能走视频工厂流程，不许另写脚本绕过。已落地：CLAUDE.md §8、`docs/agents/14-sudongpo.md`、`docs/PITFALLS.md` D14。
本条只是文字规矩，尚无技术闸拦住「另开脚本」这条路——这本身就是今晚反复出现的同一个坑（文字规则不自己生效），后续技术闸另开实施卡跟进，不在本条范围内。
