---
id: 2026-11-02-creative-pool-video-thumbnails
title: 广告设置页「可用于广告的视频」每行加缩略图、Meta 标题和时长，防止批错视频
status: done
owner: agent
decided_on: 2026-11-02
source: session:c0b3f482
verify_by: 2026-11-05
verify_how: 合并上线后在有素材池的真实客户页面（广告健康页 设置标签）看每行是否出现缩略图；没有令牌或没读视频权限的客户应显示灰色占位而不是报错
done_on: 2026-11-02
done_ref: pr:3506
---
只读显示改动，C 级；没碰批准和推广窗口逻辑。缩略图每次打开页面现读 Meta，不入库。
本窗口只用假数据在独立页面里验过画面，真实页面和真实 Meta 返回还没验，所以留 verify_by。
