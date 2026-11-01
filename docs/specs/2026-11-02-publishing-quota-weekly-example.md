# 发布名额：按周写法（示例，未写入任何客户）

状态：示例。不是生产数据，也不是某一家客户的当前配置。
日期：2026-11-02（新西兰）。风险：读法是 A 级；本文件不改库。

Ray 2026-11-02 09:12（新西兰时间）定了一家客户的每周数量：**18 条 Story、4 条图文、3 条 Reel**。下面只示范形状。不要把这段贴进数据库，除非是人在改那一家、并且先看过它现有的整段配置。

## 按周（开关打开之后才生效）

`SOCIAL_WEEKLY_QUOTA_ENABLED` 必须严格等于 `true`。没设、或写成别的字，读法仍只认按天。

```json
{
  "quota": {
    "story_per_week": 18,
    "post_per_week": 4,
    "reel_per_week": 3
  }
}
```

同一段里如果还留着按天的数字，按周的那一项盖过按天的那一项。Reel 本来就是每周，键名仍是 `reel_per_week`。

## 按天（原来的写法，不用开关）

```json
{
  "quota": {
    "post_per_day": 2,
    "story_per_day": 3,
    "reel_per_week": 3
  }
}
```

没有写的那一项是「未配置」，不是 0。

## 不要整段覆盖

这一列还可以有别的键（例如每周哪天出草稿的 `weekly_pack`）。改名额时只动 `quota` 里面的数字，别把整列换成上面这一小段。

## 人要做的两步（合并之后）

1. 在这一家客户的 `publishing_calendar_config.quota` 里写入上面的按周数字。本仓库不带客户编号，也不带这一步的写入语句。
2. 在网站服务上把 `SOCIAL_WEEKLY_QUOTA_ENABLED` 设成 `true`，再重新部署一次。只改配置、不部署，页面不会变。

迁移文件 `supabase/migrations/20261102120000_clients_publishing_calendar_config.sql` 只负责「没有这列的环境补上这列」。生产上这列已经在。这份草稿没有执行它。
