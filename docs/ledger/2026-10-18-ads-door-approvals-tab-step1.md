---
id: 2026-10-18-ads-door-approvals-tab-step1
title: 广告门加「等你点头」标签（第一步只立门牌 + 直达链接，真内容第二步搬）
status: done
owner: agent
decided_on: 2026-10-18
source: session:c668eb35
done_on: 2026-10-18
done_ref: doc:docs/specs/2026-10-18-ads-door-merge-design-v0.1.md
verify_by: 2026-10-23
verify_how: 打开某客户广告健康页，看标签是「今天看这里/每条广告/等你点头/目标与设置」四个；点「等你点头」应出现去专属批准页的链接；网址带 ?tab=approvals 应直接落在该标签；带认不出的值应落回「今天看这里」。第二步（把 auto-pause 页内容搬进来）尚未做
---
照设计稿 §5 步 1 做的，C 级：只加标签 + 支持 ?tab=，不取数据、不渲染按钮，不可能影响批准行为。
链接只从 kernel/dedicated-approval-entries.ts 那张登记表取，不在页面里拼网址；搬完改登记表一处，待办链接会一起跟着走。
三条变异验证：去掉标签→红3、无视网址→红1、什么值都认→红1；还原后 16/16 绿。
过程里自己抓到一条空测试（断言某段「不在」，而那段本来就不会渲染，变异全绿才发现），已改成断言「哪个标签是选中态」。
