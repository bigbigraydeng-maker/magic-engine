# Magic Engine Portal 应用审核材料：Messenger 回复私信（2026-11-26 草稿）

## 为什么要审

- 新版 ME 收发 Messenger 私信用的是 Meta 应用「Magic Engine Portal」（核对依据：该应用的主页订阅回调地址是 `portal.magicengine.com.au`）。
- 这个应用的 `pages_messaging` 只有标准权限：只能给应用的管理员、开发者、测试者回私信。
- 2026-11-25 ReelsMate 广告带来的真客人私信，ME 里人工回复和 AI 回复都被 Meta 退回（错误码 10）。最后是在 Meta 后台手动回的。
- 要让 ME 能回所有客人，需要给这三项权限申请「高级权限」。

## 申请哪几项（只申请回私信所需的，不顺带申请发帖、看数据）

| 权限 | 现在 | 审核前还差 |
|---|---|---|
| pages_show_list | 标准 | 可以直接加入申请 |
| pages_manage_metadata | 标准 | 1 次成功的测试接口调用 |
| pages_messaging | 标准 | 1 次成功的测试接口调用 |

ME 正常运行时的调用没有计入测试调用：11-25 04:52 ME 成功回复过一条，24 小时后计数仍是 0。所以要在 Graph API Explorer 里，用这个应用做两次只读调用：
- `GET /{page-id}/subscribed_apps` 计入 pages_manage_metadata
- `GET /{page-id}/conversations` 计入 pages_messaging

这两次调用都不发消息。做完后最多 24 小时才会显示出来。

已满足的条件：
- 企业认证通过
- 有隐私政策
- 可以提交

还没满足：联系邮箱 hello@magicengine.cloud 未验证。目前不挡提交，但建议先验证。

## 提交文字（英文，填进每项权限的用途说明）

**pages_messaging**
> Magic Engine is a marketing and customer-management platform for small businesses in New Zealand and Australia. A business connects its own Facebook Page via Facebook Login. When a customer messages the Page (often after clicking a click-to-Messenger ad), the message appears in the business's Magic Engine inbox. A staff member, or an AI-drafted reply that a staff member can review, answers the customer from the inbox, within the 24-hour standard messaging window. We only send replies to people who messaged the Page first; we do not send promotional or unsolicited messages.

**pages_manage_metadata**
> Used to subscribe our app to the connected Page's webhooks (messages, messaging_postbacks), so that new customer messages arrive in the business's Magic Engine inbox in real time.

**pages_show_list**
> After the business owner logs in with Facebook, we list the Pages they manage so they can choose which Page to connect to Magic Engine.

## 演示视频脚本（约 2 分钟，英文界面）

我用本机录屏录制，客户号用 PM 本人的个人号或测试号：

1. 打开 portal.magicengine.com.au，用管理员账号登录 ReelsMate。
2. 进入「渠道/连接」，点 Connect Facebook，弹出 Facebook 登录授权窗口，画面要能看到申请的权限，选择 ReelsMate 主页并确认。
3. 显示主页已连接。
4. 切到手机或另一个浏览器，用个人号给 ReelsMate 主页发一句 "Hi, how does the avatar work?"。
5. 回到 ME 收件箱，这条消息几秒内出现。
6. 在 ME 里打字回复，点发送。
7. 切回个人号，看到回复已到达。

注意：第 2 步会重新授权 ReelsMate 主页的连接，只用于录屏。整个过程不对外发任何内容。

## 状态

- [ ] 两次测试调用（需要 Chrome 连上）
- [ ] 录屏
- [ ] 把三项权限加入申请（工具只建草稿，不会提交）
- [ ] PM 看完材料回「交」后，在开发者后台点提交
