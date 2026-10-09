# 证据：三条问答没改成（2026-10-10 NZDT）

取数时间：2026-10-10 NZDT · 账户 act_1465150488793292 · 创意 1586529582952314

1. 直接改创意字段：`POST /{creative_id}` 带 `page_welcome_message` → Meta 拒绝，`code 100 / error_subcode 1815573`，
   提示「更新创意失败。请指定名称、status 或关联的广告标签来更新创意」。
2. 新建创意：`POST /act_.../adcreatives` → `code 200 / error_subcode 2490585`「没有广告账户的写入权限」
   （我们的系统身份令牌对这个账户只读）。
3. 官方广告工具的建创意接口参数表里没有 `page_welcome_message`；其更新接口明确写明不接受 `creative`/`creative_id`，
   只能新建广告——新建广告会被 Meta 当作广告组重大改动，重置学习期。
4. 浏览器到 adsmanager.facebook.com 手工改：页面可读，点击被本机权限策略拒绝（判为真实世界交易 / 账户设置变更）。

线上当前实际配置 = 文档 §4 的改前快照，三条问题的答案仍为空字符串。
