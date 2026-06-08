# SOP — Meta System User Token 配置（CTS + Oztop）

> **目的**：拿到 **永不过期** 的 Meta System User Token，让 ME 后台能调 Meta Ads API 跑广告闭环。
> **执行人**：PM
> **耗时**：15 分钟 / BM（CTS 和 Oztop 各一次，共 30 分钟）
> **前置**：你已经是 CTS 和 Oztop 两个 Business Manager 的 Admin

---

## 一、为什么需要 System User Token？

- ❌ 普通登录 Token：60 天过期，过期后 ME 后台所有 Meta Ads 调用都会 401
- ✅ System User Token：**永不过期**，专门用于服务器对服务器调用
- 这是 Meta 官方推荐的服务端集成方式

---

## 二、操作步骤（CTS / Oztop 各做一遍）

### Step 1 — 进 Business Settings

1. 打开 https://business.facebook.com
2. 顶部选择目标 BM：
   - **CTS** 这次：选 CTS Tours 的 Business Manager
   - **Oztop** 这次：选 `Oztop Building Supplies Pty Ltd`
3. 左下角点 **⚙️ Business Settings / 业务设置**

### Step 2 — 新建 System User

⚠️ **不要复用现有的 `Conversions API System User`** — 那个是 Pixel 数据上传专用，不能管广告。我们要建一个新的。

1. 左侧菜单 → **Users / 用户** → **System Users / 系统用户**
2. 右上角点 **+ Add / + 添加**
3. 填：
   - **System User Name**：`Magic Engine Ads`
   - **System User Role**：**Admin / 管理员** ⚠️ 不能选 Employee
4. 同意条款 → **Create System User**

### Step 3 — 分配资产（关键，不分配 Token 是空壳）

新建的 System User 默认**没有任何权限**，必须手动分配：

1. 在 System User 详情页 → **Assigned Assets / 已分配的资产** → **Add Assets / 添加资产**
2. 分配以下 3 类资产，每类都勾 **Full Control / 完全控制**：

| 资产类型 | 选哪个 | 权限 |
|---|---|---|
| **Ad Accounts / 广告账户** | CTS: `act_2775766642787274` / Oztop: 你的广告账户 | ✅ Manage campaigns + View performance |
| **Pages / 公共主页** | CTS: CTSTOURS Page / Oztop: Oztop Building Supplies Page | ✅ Full control |
| **Pixels（如有）** | CTS Pixel / Oztop Pixel | ✅ View + Manage |

### Step 4 — 生成 Token

1. 回到 System User 详情页 → 右上角 **Generate New Token / 生成口令**
2. **App 选择**：选你已经创建好的 Meta Developer App（如果还没有 App，告诉子牙，我引导你 5 分钟建一个）
3. **Token Expiration / 口令到期时间**：选 **Never / 永不过期** ⚠️ 这是关键
4. **Permissions / 权限**（必须全勾）：
   - ✅ `ads_management` — 管理广告
   - ✅ `ads_read` — 读取广告数据
   - ✅ `business_management` — 管理业务资产
   - ✅ `pages_read_engagement` — 读取主页互动
   - ✅ `pages_show_list` — 列出主页
   - ✅ `read_insights` — 读取分析数据
5. 点 **Generate Token** → **立即复制** Token（页面关掉看不到，必须重新生成）

### Step 5 — Token 长这样

```
EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

通常 200+ 字符，以 `EAA` 开头。

---

## 三、配到 Render（让 ME 后台用上）

### Step 1 — 打开 Render Dashboard

1. https://dashboard.render.com
2. 选 Magic Engine 主服务（Next.js 那个，监听 main 分支）
3. 左侧菜单 → **Environment**

### Step 2 — 添加两个环境变量

| Key | Value |
|---|---|
| `META_SYSTEM_USER_TOKEN_CTS` | CTS 那个 Token（EAAxxx...） |
| `META_SYSTEM_USER_TOKEN_OZTOP` | Oztop 那个 Token（EAAxxx...） |

> 子牙备注：等 token 配好后我会做一个 client_id → token 的映射函数。**如果有第三个客户加进来再加 ENV 就行**，不需要每次改代码。

### Step 3 — 保存 + 等 Render 自动重启（~ 60 秒）

完成。ME 后台就能跑 Meta Ads 闭环了。

---

## 四、验证（PM 配完告诉子牙）

PM 配完后跟我说一声 "Token 已配 / Render 已重启"，子牙跑下面 3 个 check：

1. **健康 check**：调 `/me?fields=id,name` 看 Token 是否有效
2. **Ad Account 访问 check**：调 `/act_2775766642787274/insights` 看能不能拿数据
3. **写 check**：尝试创建一个 `status=PAUSED` 的测试 Campaign，看权限够不够

3 个都通过 = Meta 战线（C1 / O3）正式可跑。

---

## 五、安全提示

- ⚠️ Token 配到 Render 后**不要写到 git / Slack / 邮件**任何地方
- ⚠️ 如果 token 不小心泄露，立刻回到 System User 页面点 **Revoke / 撤销口令**，重新生成
- ⚠️ Token 只在 Render Environment 里存，本地开发用 `.env.local`（已在 .gitignore）

---

## 六、常见问题

**Q1：System User 角色 Employee 行不行？**
A：不行。Employee 不能调用 `ads_management` 权限，只能读不能写。必须 Admin。

**Q2：能不能用一个 Token 管两个 BM？**
A：技术上可以（如果一个 BM 通过 partnership 共享了另一个 BM 的资产），但不推荐。每个 BM 一个独立 Token 更清晰，撤销也方便。

**Q3：Meta Developer App 没有怎么办？**
A：告诉子牙，我引导你 5 分钟在 https://developers.facebook.com 建一个 Business App。

**Q4：Token 真的永不过期吗？**
A：是的，但前提：①勾了 Never；②用 System User（不是普通 User）。**注意**：如果你撤销了 System User 的某些权限或者 BM Admin 把你踢出，Token 会失效。

---

## 七、关联

- `act_2775766642787274` — CTS Tours Ad Account（数据库 `clients.meta_ad_account_id`）
- Oztop Ad Account — **PM 配完后回填到数据库**，子牙 SQL 模板待用：
  ```sql
  UPDATE clients SET meta_ad_account_id = 'act_XXXXXXXXX'
  WHERE id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84';
  ```
