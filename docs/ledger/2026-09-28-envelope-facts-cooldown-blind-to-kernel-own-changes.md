---
id: 2026-09-28-envelope-facts-cooldown-blind-to-kernel-own-changes
title: 72 小时冷却期看不到系统自己刚做的改动——主干上没有任何地方在执行后补写「改后快照」，潜伏中：现在没有自动提交方，演练开关一翻就会咬人
status: decided
owner: agent
decided_on: 2026-09-28
source: session:c668eb35
verify_by: 2026-11-03
verify_how: 查三件：①主干 git grep "kernel_post" 是否出现生产写入方（现在只有消费方 portfolio/diagnostics/loader.ts 与类型定义）②envelope-facts.ts 的 hoursSinceLastRealChange 是否认 changed 之外的原因（现在只认 changed）③在 DEMO 客户上连做两次广告组改动，第二次是否被 72 小时冷却拦下。三件都成立才算修好；PM 决定翻开 autopilot_dry_run 之前，这张卡必须先是 verified
---
摘回自已关闭的 PR 2019 分支（原卡 P0），2026-10-18 对主干重新核实：问题仍在，但严重度要重打分。
仍成立的证据：主干执行前只抓 kernel_pre（capabilities/ads/common.ts:68），无任何 kernel_post 写入方；冷却判据 envelope-facts.ts 的 hoursSinceLastRealChange 只认 capture_reason=changed，而 changed 只由定期快照对账产生，所以同一实体连续两次自治动作之间若没轮到下一次对账，第二次读到的是旧数字。
同文件里 4000 行截断那条（原卡姊妹）主干已修（冷却期单独按实体查、limit 200），不迁。
按 §11 重打分：频率 低（主干上没有任何自动提交方在跑：生产里 ads.* 动作从未执行过，D3 在演练模式）· IMPACT 高 · 收入 高 → 恰好一个低 → P1，不是原卡的 P0；一旦有自动提交方上线或 PM 翻开演练开关，立即按 P0 处理。
