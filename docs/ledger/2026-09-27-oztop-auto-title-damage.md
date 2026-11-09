---
id: 2026-09-27-oztop-auto-title-damage
title: Oztop 官网 18 页标题被自动改成关键词原样——改回正常标题，并把 oztop-seo-optimizer 永久下线（已临时暂停）
status: decided
owner: agent
decided_on: 2026-09-27
source: issue:2145
verify_by: 2026-10-04
verify_how: 逐页读 Oztop 官网线上 <title>，Issue 2145 表里那 18 页都不再是关键词原样（有原标题底稿的恢复成原样，没有的按信息完整闸门重写或用「页面 H1 + 品牌」保底）；render.yaml 里没有 oztop-seo-optimizer 条目，Render 上这个服务已删除或仍是 suspended；seo_meta_log 队列没被人为清理。三项全对算成
---
孔子 2026-09-27 只读核查（证据全在 Issue 2145）：生成器从 7 月起把 23 条「关键词原样 + 空描述」推上官网，其中 18 页现在线上仍是坏标题；所有行都没存原标题。
子牙判 P0，定下硬约束：谁都不许动 seo_meta_log 队列。插件拉队列不分客户，一疏通就会把 CTS 的行拿去改 Oztop 的网站。
PM 在子牙窗口回「停」，子牙 12:50 UTC 用 Render 接口暂停了这个定时服务并回读确认。render.yaml 里这一条还在，重新同步部署可能把它恢复，所以永久下线要走 A 级 PR 删掉。
修复方案由孔子出，子牙审过再问 PM；插件和钥匙归换钥匙窗口处理；要不要告诉 Oztop 由 PM 定。
