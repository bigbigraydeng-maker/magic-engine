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
done_ref: pr:3164
---
客户总闸「每天最多花多少」输入框旁边没独立保存钮，用户以为无法修改——它靠整张卡最底部的大「保存」一起提交。给 CapField 加独立「保存上限」钮，只 PATCH daily_budget_cap_cents，不动模式和素材池。按钮文字叫「保存上限」避免跟底部大按钮同名。后端 API、钱闸判据、并发锁均未动。
