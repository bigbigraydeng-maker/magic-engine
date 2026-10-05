---
id: 2026-10-05-cts-meta-native-autoreplies-close
title: 关掉 CTS 主页在 Meta 后台开着的两条自带自动回复（问候、联系方式）——PM 已同意关，但系统权限拦住了，还没关
status: decided
owner: pm
decided_on: 2026-10-05
source: session:ebab7fb4
verify_by: 2026-10-08
verify_how: 打开 Meta Business Suite（CTS Tours 主页）收件箱的自动化设置，「自动回复」和「联系方式」两个开关都是关；「位置」那条不动
---
原因：「联系方式」那条对说了「别再联系我」的客人也回了电话号码和网站按钮，Meta 的这些回复不进我们的别再联系名单。
关闭动作被系统权限检查拦下，我没有改任何设置；上线我们自己的预沟通之前必须已关，否则客人会收到两套回复。
