# 狄仁杰攻击审查：PR 2270（官网产品事实快照）

- 审查对象：`feat/cts-product-facts-snapshot` @ `0008739`（草稿），只读审查，未改 PR 代码、未连真实库、未访问客户官网。
- 方法：把 PR 文件取到临时目录，用 tsx 直接跑 `guardedGet` 与 `refreshProductFacts`/`getProductFacts`（假网络 + 假表，假表按真实表的 `UNIQUE (client_id, canonical_url, content_hash)` 建模）。
- 结论：**应升 A 级并按 A 级流程走**。依据 `docs/ENGINEERING_QUALITY_GATES.md` §A 级「SSRF、凭据、密钥、重定向、外部网络安全边界」与 §8「connection-bound SSRF fetch：A 级」。

## 逐项攻击结果

| # | 攻击 | 结果 | 代码依据 |
|---|---|---|---|
| 1 | 内网/元数据/localhost/IPv6 回环/十进制、八进制 IP | 全部拒绝（`host_not_allowed`，未发请求）。URL 解析器先把十进制/八进制规整成点分 IP，再对白名单比对 | `fetch.ts:38` |
| 2 | 白名单站 302 跳外站、跳 `http://169.254.169.254`、协议相对 `//evil.com`、无限跳 | 全部拒绝；跳转逐跳重查；第 4 跳报 `too_many_redirects`（最多跟 3 次） | `fetch.ts:2,36-45` |
| 3 | `evil.com?x=…`、`…co.nz.evil.com`、`站名@evil.com`、尾点、西里尔字母仿冒 | 全部拒绝；大写域名放行但仍是同一站（解析后小写）；`evil.com@站名` 实际访问的是客户站本身，无害 | `fetch.ts:12-15,38` |
| 3b | **端口不受限**：`https://站名:6379/` 放行 | 低危。只有客户站自己发跳转才能触发，且仍连到该域名的公网地址 | `fetch.ts:38` 只比 `hostname` |
| 4 | **DNS 重绑定** | 未防：校验只比对字符串域名，连接时由系统再解析。缓解：只走 https，证书校验会让「改指向内网」大概率握手失败；域名来自服务器环境变量，攻击者须控制客户域名的 DNS | `fetch.ts:38-39` |
| 5 | 3MB 响应 / json / 无内容类型 | 拒绝（`too_large`/`bad_content_type`）；超时 10 秒/跳 | `fetch.ts:17-29,39,47-48` |
| 5b | `image/svg+xml` 被放行（正则只找 `xml`） | 低危，只会被当文本解析 | `fetch.ts:47` |
| 5c | `parse.ts:32` 去 script/style 的正则（懒匹配 + 回溯引用）在 2MB 内塞大量未闭合 `<style` 时近似平方级耗时 | 低危，只有客户站本身能构造 | `parse.ts:32` |
| 6 | 谁能触发 | 目前**没有任何调用方**（全仓只有试跑脚本）；目标网址只来自环境变量 `CLIENT_PRODUCT_FACT_SOURCES`，请求方无法指定网址 | `collect.ts:18-28`、`store.ts:18-21` |
| 7 | 失败模式 | 抓取各环节失败都变 `fetch_failed`/`not_measured`，配置读不出返回未配置——fail-closed。**例外见下方「必修 2」** | `collect.ts:44-63` |

## 必修 1：自写抓取绕开平台已有的安全抓取（复用 + 重绑定）

`src/lib/net/safe-fetch.ts` 的 `safeFetchText` 已经做了：逐跳重新解析并把连接绑死在已验证的地址上、按网段拦内网/元数据/IPv6 映射、多地址任一不合法就拒、体积上限、跳转上限，且已有 `site-audit`、`web-intelligence/targets`、`tools-lab` 等多个调用方。PR 2270 另写了一个更弱的 `guardedGet`，违反 Reuse First。
修法（实现由作者定）：用 `safeFetchText(url, { maxRedirects: 3, maxResponseBytes: 2_000_000, userAgent })`，拿到结果后对最终 `res.url` 再查一次域名白名单 + 只认 443 端口 + 内容类型（只放 `text/html`、`application/xml`、`text/xml`、`text/plain`）。

## 必修 2：同一天重跑，失败页从读取结果里消失

- 原因：`store.ts:34` 的判重指纹 = 内容 + `verified_at` + **日期**。`ok` 的页 `verified_at` 每次不同所以会写新行；`not_measured`/`fetch_failed` 的页 `verified_at` 为空，同一天第二次的指纹与第一次相同 → 数据库报重复 → `store.ts:39` 把重复**算成写入成功**。读取时 `store.ts:77-79` 只取最新一轮的行，这些页就没了。
- 实测（假表复现）：

```
refresh1 [ 'a:ok', 'b:not_measured' ] { written: 2, wf: 0 }
refresh2 [ 'a:ok', 'b:not_measured' ] { written: 2, wf: 0 }   // 同日 2 小时后
getProductFacts [ 'a:ok' ]                                      // b 消失，不是 not_measured
```

- 最坏情形：将来按这份快照自动建视频工单时，抓失败的产品不会显示「没测成」，而是像不存在一样被跳过，没人知道漏了。同理，`write_failures` 的页也会在读取时静默缺席（只在刷新返回值里有个计数）。
- 修法方向：指纹里带完整刷新时间（或刷新批次号），让每一轮每页都落一行；并加用例「同日两次刷新，第二次读取仍含 not_measured 页」。

## 最小测试用例（未提交，给作者参考）

```ts
it('rejects redirect off the allowlist and to metadata', async () => { /* 302 → http://169.254.169.254/ ⇒ host_not_allowed */ })
it('rejects non-default port on allowed host', async () => { /* https://www.<host>:6379/ ⇒ rejected */ })
it('same-day second refresh keeps not_measured pages visible', async () => {
  await refreshProductFacts(CID, { fetchImpl: site, gapMs: 0, now: new Date('2026-10-06T08:00:00Z') })
  await refreshProductFacts(CID, { fetchImpl: site, gapMs: 0, now: new Date('2026-10-06T10:00:00Z') })
  const g = await getProductFacts(CID, new Date('2026-10-06T11:00:00Z'))
  expect(g.ok && g.facts.map(f => f.status)).toEqual(['ok', 'not_measured'])   // 现在得到 ['ok']
})
```

## 将来接线时必须守住（写给接线的 PR）

1. 入口只接受客户 ID，绝不接受网址或域名参数。
2. `getProductFacts` 用的是总钥匙（`supabaseAdmin`），会越过数据库的权限保护；任何对外入口必须先确认调用者属于这个客户。
3. 刷新是 30 页 × 1.5 秒的外部请求，入口要限频，别让人反复触发去刷客户官网。

## A 级流程要求

PR 正文写「风险级别：A」并保持草稿；按 CLAUDE.md §4 走设计审 + 实施后两审（含狄仁杰实施后补一刀）；合并须 PM 在对话里本人同意。
