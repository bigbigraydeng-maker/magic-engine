# 建 TikTok 开发者应用（一次性，约 30 分钟）

> 为什么必须是人去做：TikTok 要求用真实身份创建应用并签开发者协议。这一步没有接口，谁都绕不过。
> 做完之后 TikTok 发布就跟 Facebook 一样全自动，不用再管。

## 先说清楚一件事

**应用没过 TikTok 审核之前，发出去的片子只有你自己看得见。** 这是 TikTok 定的规矩（官方原文：未审核的应用发的内容一律限制为私密），不是我们的开关。

所以流程是两段：

1. **建应用**（30 分钟）→ 立刻能跑通全流程，片子发到 TikTok 上，只有你能看到
2. **提交审核**（等几天到几周）→ 通过后同一个按钮就能公开发布，代码一行不用改

---

## 第一步：建应用

去 https://developers.tiktok.com/ → 用 **MagicLab Academy 的 TikTok 账号**登录 → `Manage apps` → `Connect an app`

填这些：

| 字段 | 填什么 |
|---|---|
| App name | `Magic Engine` |
| Category | Business / Marketing |
| Description | 内容管理平台，帮小生意主把自己制作的视频发布到自己的 TikTok 账号 |
| Website URL | `https://app.magicengine.com.au` |
| Terms of Service URL | `https://magicengine.com.au/terms` |
| Privacy Policy URL | `https://magicengine.com.au/privacy` |

## 第二步：加产品和权限

在应用里点 `Add products`，加这两个：

- **Login Kit**
- **Content Posting API** → 里面把 **Direct Post** 打开

然后在 Login Kit 的 `Scopes` 里勾上这三个（少一个都发不出去）：

- `user.info.basic`
- `video.publish`
- `video.upload`

## 第三步：填回调地址

Login Kit → `Redirect URI`，**一字不差**填这个：

```
https://app.magicengine.com.au/api/auth/tiktok/callback
```

## 第四步：把两个字符串给我

应用建好后，页面上会有 **Client key** 和 **Client secret**。

把这两个值发给我（或者你自己填进 Render 环境变量，名字是 `TIKTOK_CLIENT_KEY` 和 `TIKTOK_CLIENT_SECRET`）。

> ⚠️ Client secret 是密码性质的，别贴到公开的地方。

## 第五步（我来做完之后你点一下）

配好之后，客户设置页会出现「连接 TikTok」按钮 —— 跟 Facebook 那次一样，点一下、在 TikTok 授权页确认，之后永久有效（令牌会自动续期，不用你再管）。

---

## 第六步：申请审核（想公开发布才需要）

在应用页面点 `Submit for review`。TikTok 要看：

- 应用怎么用的说明（就写：帮用户把自己制作的视频发到自己的账号）
- 一段演示录屏（等我们跑通一次，我给你录）

审核期间不影响使用，只是片子还是仅自己可见。

---

## 排查

| 现象 | 什么意思 |
|---|---|
| 页面提示「TikTok 应用还没过审」 | 正常，片子已经在你 TikTok 上了，只有你看得见 |
| 「授权过期或权限不够」 | 第二步那三个勾少了一个，或者授权时取消了某个勾 —— 重新点一次「连接 TikTok」 |
| 「TikTok 不接受这条片的格式或时长」 | TikTok 对时长有限制，来找我们看 |
