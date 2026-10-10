---
id: 2026-10-06-ads-non-pm-buttons-still-visible
title: 非 PM 账号界面上仍有「撤销暂停」「开始投放」按钮，点了只会收到「只有 PM 能操作」
status: decided
owner: agent
decided_on: 2026-10-06
source: session:a0f2e1de
verify_by: 2026-10-13
verify_how: 非 PM 登录时隐藏或改文案为「请联系 PM 重新开启」；用 Impeccable 检查前后对比；当场看一眼页面
---
本 PR 只收紧后端，界面没动：AdsAuditSection 的撤销按钮、ad-approval 页的批准按钮。报错文案是人话，不会误开广告，只是体验差。
