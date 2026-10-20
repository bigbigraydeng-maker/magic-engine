---
id: 2026-10-20-instagram-pr4-switch-scopes-token
title: Instagram 发布开关 + 发布权限集 + 令牌唯一出口与续期(Instagram PR4,默认关闭)
status: done
owner: agent
decided_on: 2026-10-20
source: doc:docs/specs/2026-10-20-instagram-native-publish.md
verify_by: 2026-10-27
verify_how: 合并部署后(开关仍关闭):Instagram 授权流程行为与之前完全一致(只要基本资料权限),设置页 Celine 的 Instagram 仍显示「已保存」。打开开关(INSTAGRAM_PUBLISH_ENABLED=true)前须先看台账 2026-10-20-instagram-native-publish-plan 的 PM 前置清单;打开后旧只读授权应显示「需要重新授权」。
done_on: 2026-10-20
done_ref: branch:claude/codex-social-media-handoff-a3b7bb-x9mowj
---
新增:`INSTAGRAM_PUBLISH_ENABLED`(默认关,恰好 "true" 才开);开关开启时授权要多要 `instagram_business_content_publish`,回调只接受实际拿到该权限的授权,面板对旧只读授权显示需重新授权;`getInstagramPublishToken()` 是发布取凭据的唯一出口(开关、唯一连接、发布权限、未过期、账号编号合法,距到期 7 天内且仍有效时续期,续期用到期时间做乐观锁,保存失败即报错不放行)。
未接入任何发布调用方(Instagram adapter 在 PR5)。已知缺口:①开关打开后旧授权的「重新授权」只在设置页可见,没有自动进今日待办;②授权临近过期(长期不发布)的提醒待办未做;③`INSTAGRAM_OUTCOMES.connected` 文案仍写「尚不支持发布」(PR7 展示统一改);④Instagram 授权回调还没有「账号被别的客户占用」守卫(TikTok 已有),Instagram 开放给更多客户前应复用同一个守卫。
