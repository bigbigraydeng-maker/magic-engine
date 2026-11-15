---
id: 2026-11-16-cts-dataset-attached-to-main-ad-account
title: CTS 主数据集已连到主力广告账户（尾号 7274），并把「挂数据集」写进数据集搭建流程的必做步骤
status: done
owner: agent
decided_on: 2026-11-16
source: session:f2f2eb69
done_on: 2026-11-16
done_ref: pr:3870
---
PM 11-16 回「挂数据集」，并要求这一步写进流程（他此前不知道要做这一步）。
已做：在 Meta 商务设置里把「CTS Tours 数据」绑定到广告账户 2775766642787274；用 Meta 广告工具读回，该账户的数据集列表里已出现「CTS Tours 数据」。原先只绑着另一个账户 CTS（尾号 0470），没动。
这一步只让账户「能用」数据，现有广告的优化目标没变、没花钱。
流程：skill `me-meta-dataset-setup` 新增第 5 步（切正式当天就挂、读回核对），原第 5、6 步顺延为第 6、7 步。
漏掉原因：11-10 切正式时只把它当成后面的前置条件一句带过，没单独提醒 PM，也没进流程。
