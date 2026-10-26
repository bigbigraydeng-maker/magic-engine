---
id: 2026-10-26-huatuo-prescription-off-request
title: 开方先回报已经开始，处方写完再出现
status: done
owner: agent
decided_on: 2026-10-26
source: doc:src/lib/huatuo/agent.ts
verify_by: 2026-10-28
verify_how: 74 窗口在本地真调一次开方并计时。页面应在几秒内显示已开始，处方随后出现在草稿里；整次模型调用可以超过 100 秒，浏览器不应再收到网关错误页。
done_on: 2026-10-26
done_ref: pr:3227
---
开方仍是一次大约两分钟的模型调用，正式网站的代理大约 100 秒就会掐断还在等的请求。
所以开方改为先记下「正在写」，马上回复，写完再放进同一张处方。
不改处方内容，也不改打法那条还在审的改动。
74 窗口用本地真调计时验收。这里没有真调模型。
