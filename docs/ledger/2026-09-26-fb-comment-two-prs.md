---
id: 2026-09-26-fb-comment-two-prs
title: FB 评论回帖两个卡 PR 判为独立路径（meta-oauth-pages-manage-engagement 和 comment-autoreply-scan-visibility），并行推、不互相依赖
status: decided
owner: agent
decided_on: 2026-09-26
source: session:bf0cd6eb
verify_by: 2026-10-10
verify_how: 两个 PR 各自 rebase 到最新 main 后走两审+PM 亲合，都 A 级；合完后生产实测 CTS 评论回帖起效（需 PM/FDE 去 Graph Explorer 生成新 env token 时勾选 pages_manage_engagement）；本卡 done_ref 指向后合并那个 PR，另一 PR 单独跟进
---
两个 PR 都 2026-09-14 停下 12 天没动。技术判定：**引擎 `src/lib/social/comment-autoreply-engine.ts` 用 `listGrantedScopes(userToken)` 走 `/me/permissions` 读的是 env token 的实际权限，不读 `platform_oauth_connections`**——所以两个 PR 完全独立：feat/meta-oauth-pages-manage-engagement 是"未来 OAuth 弹窗准备好新权限"；feat/comment-autoreply-scan-visibility 是"引擎实际能不能回帖"的开关，前提是 env token 拿到该权限（Graph Explorer 生成时勾选，非代码活）。合了 feat/comment-autoreply-scan-visibility 才能真的把 CTS 评论回帖跑起来+把三个新待办类型（scope_missing / scan_failed / source_refused）下发出去；feat/meta-oauth-pages-manage-engagement 是"为未来引擎改成读连接表"准备的。都判 A 级（原作者自评 B）：改 OAuth scope / 令牌读取逻辑 / 对外自动回帖决策都是外部行为影响面。分支 feat/meta-oauth-pages-manage-engagement 检查全绿只缺 review；分支 feat/comment-autoreply-scan-visibility 有冲突要 rebase + fix-scope FAILURE 排错。PM 2026-09-26 通过小秘书授权推进。
