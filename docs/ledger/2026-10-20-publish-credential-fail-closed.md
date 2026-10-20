---
id: 2026-10-20-publish-credential-fail-closed
title: 发布取凭据不再「取最新一条」:TikTok 有多条有效授权就拒绝并提示人话,YouTube 按目标频道精确取(G1)
status: done
owner: agent
decided_on: 2026-10-20
source: doc:docs/specs/2026-10-20-social-connection-governance.md
verify_by: 2026-10-27
verify_how: 合并部署后:正常单授权客户的 TikTok / YouTube 发布不受影响(看当天发布回执);人为构造同客户两条有效 TikTok 授权的试验客户,发布返回「存在多个 TikTok 授权,已暂停发布」且没有调用 TikTok。
done_on: 2026-10-20
done_ref: pr:2951
---
普查显示 tiktok / google_youtube / instagram 没有同客户多条有效授权的存量,所以无停发风险。YouTube 对不上目标频道也会拒绝。
