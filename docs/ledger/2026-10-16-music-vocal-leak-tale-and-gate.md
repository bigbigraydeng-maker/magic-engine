---
id: 2026-10-16-music-vocal-leak-tale-and-gate
title: 背景音乐自带地产广告人声被当成纯配乐用上了三条 CTS 待审片；要加「含人声就拦」的闸并回填曲库登记
status: decided
owner: agent
decided_on: 2026-10-16
source: session:ec90bb17
verify_by: 2026-10-23
verify_how: 验收三条同时成立才算成：①出片机「音乐含人声就拦」闸上线（用含人声的 analytical-scholar 提无害测试单必被拦且回执写原因；用已登记无人声的曲子提单正常出片）；②曲库登记回填完成（在飞队列、每日计划选曲、客户自带曲都已登记，第②类未经真人听的曲不放行）；③三条旧单（ccff4bb9/abd7a705/19c191c5）被 PM 打回（不发布）。
---
事故：共享乐库里 MiniMax「Analytical Scholar」整首是一段地产英文广告旁白，目录表未标，被 Tale 系列三条待审片选用；全库 47 首转写后确认含人声的另有 Jayden小弟。已做：根因复现、证据包（本机 ~/Library/Application Support/magicengine/evidence/2026-10-16-tale-vocals/）、整库转写表（docs/clients/cts/2026-10-16-tale-music-vocals-incident.md）、Tale v3 换曲重出（ef24296d，待 PM 审）、设计稿 docs/specs/2026-10-16-music-vocal-gate-design.md（子牙+魏征两轮审）。
已做（续）：人声闸代码 PR 2718（A 级，PM 回「合」，头提交 8f097003，10-15 22:44Z 合并）；受保护路径 PR 2721（A 级，PM 回「合」，头提交 ec8778c8，10-15 22:21Z 合并）；审片清单加「已开声音听」PR 2719（B 级，已自动合并）；曲库回填 6 条已随 2718 登记。
未做：升级出片机并整链试跑（需 PM 另行授权部署，方案：docs/sops/2026-10-16-music-vocal-gate-rollout-and-trial-plan.md）；Founders in Motion 登记（等 PM 点通过 Tale v3 ef24296d 后另开 A 级 PR）；三条旧单被 PM 打回；在用曲 PM 各听 20 秒升强证据。决定：转写只提名可疑，「确认无人声」只能真人签；已发布曲目按实际用到区间登记并标弱证据。
