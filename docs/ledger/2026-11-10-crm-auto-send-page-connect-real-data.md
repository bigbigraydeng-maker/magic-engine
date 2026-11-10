---
id: 2026-11-10-crm-auto-send-page-connect-real-data
title: 「自动发信」页面第一版（只读）上线后，把示例数据换成真实的批次、收件人和发送情况
status: done
owner: agent
decided_on: 2026-11-10
source: session:37644f65
verify_how: 打开 ME 后台 CRM 顶部「自动发信」，不点「看示例」就能看到真实的批次（标题、收件人、发送情况）；现在只会显示「还没接通」，因为发信设计窗口的读数据接口还没给
done_on: 2026-11-10
done_ref: pr:3713
---
第一版页面（只读，不发信、不建表）已在本窗口的 PR 里：真实数据来源还没接通，先用合成示例（员工点「看示例」才显示，整页标明「示例数据（假的）」）。
接口来了只换适配器（src/lib/crm/auto-send/adapter.ts 的 createLiveAdapter），页面不用改。
「放行」按钮（只许 PM、有回执、没授权就不发）是发信设计窗口的单独件，不在第一版里；页面只画了灰掉的占位。
