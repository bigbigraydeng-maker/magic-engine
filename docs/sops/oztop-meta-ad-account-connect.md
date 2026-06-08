# SOP — Oztop Meta Ad Account 连入 ME 后台

> **目的**：把 Oztop 的 Meta 广告账户 ID 配到数据库，让 ME 后台知道 "Oztop 跑广告时调哪个账户"。
> **执行人**：PM
> **耗时**：5 分钟
> **前置**：你已经为 Oztop 建了 Meta 广告账户（business.facebook.com → 账户 → 广告账户）

---

## 一、为什么需要这个？

数据库当前状态：
```sql
SELECT name, meta_ad_account_id FROM clients WHERE id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84';
-- 结果: oztop, NULL
```

`meta_ad_account_id` 是空的 → ME 后台跑 Walnut 清仓 FB 广告时不知道往哪个账户发请求。

---

## 二、操作步骤

### Step 1 — 找到 Oztop 的 Ad Account ID

1. 打开 https://business.facebook.com → 选 `Oztop Building Supplies Pty Ltd` BM
2. 左侧菜单 → **Accounts / 账户** → **Ad Accounts / 广告账户**
3. 找到 Oztop 的广告账户，**复制 Ad Account ID**
   - 格式：纯数字（如 `1234567890123456`）
   - 或者：带 `act_` 前缀（如 `act_1234567890123456`）
4. 子牙数据库存储要求：**带 `act_` 前缀**（CTS 那个就是 `act_2775766642787274`）

### Step 2 — 告诉子牙

在对话里发一句：

```
Oztop Meta Ad Account ID 是: act_XXXXXXXXXXXXXXXX
```

子牙立刻跑 SQL 写入数据库：

```sql
UPDATE clients
SET meta_ad_account_id = 'act_XXXXXXXXXXXXXXXX'
WHERE id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84';
```

---

## 三、验证

子牙写完后会查一次给你看：

```sql
SELECT name, meta_ad_account_id FROM clients
WHERE id = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84';
```

看到 `oztop | act_XXXXX` = 完成 → 解锁 Oztop FB Ads 战线（O3 Walnut 清仓 FB 广告）。

---

## 四、关联 SOP

- [meta-system-user-token-setup.md](./meta-system-user-token-setup.md) — Oztop 的 Token 也要在 Oztop BM 单独建一个，配到 Render `META_SYSTEM_USER_TOKEN_OZTOP`
- 两个 SOP 平行做就行，互不依赖
