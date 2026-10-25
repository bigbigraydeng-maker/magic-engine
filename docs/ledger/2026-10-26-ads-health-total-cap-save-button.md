---
id: 2026-10-26-ads-health-total-cap-save-button
title: 广告健康页「每天最多花多少」加独立「保存上限」按钮
status: done
owner: agent
decided_on: 2026-10-26
source: session:f59aabf2
verify_by: 2026-10-27
verify_how: 打开 /dashboard/clients/{id}/ads-health → 自动化设置卡里，「每天最多花多少」输入框旁边有「保存上限」按钮；改数字 → 点一下 → 看到「已保存」且下方「当前」更新；没改数字点一下，看到「没有改动」。
done_on: 2026-10-26
done_ref: pr:tbd-ads-health-total-cap-save
---
用户看广告健康页时发现「每天最多花多少」（客户总闸）输入框旁边没有保存按钮，以为无法修改——其实它靠的是整个卡片最底部的大「保存」钮一起提交，用户滚不到就以为坏了；而下面「每个广告账户各自每天最多花多少」每行都有独立的保存按钮，两边不一致。

**改法**：给 CapField（客户总闸）加一颗独立「保存上限」按钮，只 PATCH `daily_budget_cap_cents` 到 `/api/clients/{id}/ad-strategy-config`，不动模式和素材池。底部大「保存」按钮保留，继续负责自动化模式切换 + 新加视频编号的提交。按钮文字叫「保存上限」而不是「保存」，让这个按钮和底部按钮各管各的，避免用户点错。

**没动**后端 API、钱闸判据、expected_version 并发锁、autonomy_mode、素材池。只在前端新增一个只走 cap 字段的 PATCH 路径。

**风险级 B**：UI 改动，不碰 cron、不碰 DB、不碰 Meta 凭证、不改钱闸判据。
