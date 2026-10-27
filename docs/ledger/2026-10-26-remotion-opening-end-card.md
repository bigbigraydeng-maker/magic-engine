---
id: 2026-10-26-remotion-opening-end-card
title: 视频模板开场前两秒和片尾改成通用钩子和落版
status: done
owner: agent
decided_on: 2026-10-26
source: doc:docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md
verify_by: 2026-11-02
verify_how: 抽一条明信片成片，前 2 秒能读到钩子，标题结尾有 logo 或字标和一句行动引导，字落在手机安全区里；带价格的结尾仍是价格卡
done_on: 2026-10-26
done_ref: doc:docs/sops/2026-10-27-video-factory-template-playbook-v1.0.md
---

明信片默认打开共享开场钩子和标题片尾；其它模板要用工单里的 frame 开关才打开，避免每日成片叠两层字。
字卡改到安全区上沿或下沿，旧的固定高度会先收到安全区里。仍不检测画面主体。
缺钩子文案时显示 Watch this，缺行动引导时显示 Learn more，没有 logo 时用字标。不新增数据库字段。
