---
id: 2026-11-02-social-wp1-p3-story-register
title: 新发的 Story 先登记进读回链，开关默认关着
status: done
owner: agent
decided_on: 2026-11-02
source: doc:docs/specs/2026-10-29-social-wp1-readback-implementation-brief-v2.md
verify_by: 2026-11-09
verify_how: 两个开关都不是正好 true 时，Story 发布不发补登记事件，监听函数不查库也不写动作行。只把新发登记开关开成 true 后，当场真发的 Story 才写动作行；补登记开关仍关着时不会扫历史 Story。
done_on: 2026-11-02
done_ref: commit:c64c684e45a8d7a96f1ca96133d25feafdaaf704
---
规格是社媒读回实施说明里的 P3。不写判定行，也不进定时读数。
补登记代码在，但默认不跑，发布任务也不会自动触发它。每轮最多写 50 条。已登记的不占这 50 条，扫完前 1000 条已登记的 Story 后仍会继续找后面的缺口。
不调用 Meta 写接口。这次不写生产库。
