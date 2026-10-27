---
id: 2026-10-27-postcard-layout-dodge
title: 明信片不再写死字卡高度，logo 也不再全程挂着
status: done
owner: agent
decided_on: 2026-10-27
source: doc:docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md
verify_by: 2026-10-29
verify_how: 用一张不带价格、不写字卡高度、不写全程 logo 的明信片本地出片。四个场景的字卡按下、上、下、上交替，都落在安全区里；钩子期间没有角标；结尾是品牌落版。复活一条写死高度的旧单时，工单里的固定高度和全程 logo 被去掉，不批量改生产数据。
done_on: 2026-10-27
done_ref: pr:3335
---

下单代码里没有写死字卡高度的地方，是历史工单自己带了这两个字段。出片时忽略它们，除非工单写了手动版式。人点复活或打回重开时才改那一条工单。
