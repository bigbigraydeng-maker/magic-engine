# 新人欢迎信 v2（2027 春季版）· 草稿做好 · 证据（2026-10-28 NZ 晚，PM 回「现在回到 FB 新的欢迎邮件」之后）

取数方式：Mailchimp 网页后台（PM 已登录的 Chrome）、官网 curl 下载页面文字、hello@ 邮箱（Gmail 连接器）读测试信。
没有客人邮箱、姓名落盘。**没发给任何客人，没改任何自动流程，没改每天 8:01 批次的底稿，没碰 Apps Script。**

## 一、结论（先看这里）

1. 新欢迎信草稿已做好：Mailchimp 草稿 **15910789**（名称「【草稿-勿发】新人欢迎信 v2（2027 春季版）」），由现在每天批次用的底稿 15909753 复制而来；收件人仍是「INTERNAL TEST ONLY」（1 个内部测试地址），状态 Draft。
2. 测试信发了两封到 hello@（NZ 20:26 一封、20:29 一封；第二封才是改完预览文字和页脚的最终版）。
3. 信里 6 个团的价格、出发日、城市都对过官网 10/28 的页面；9 个链接逐个打开核过页面标题（都是对应的团，不是通用列表页）。
4. **每天 8:01 的批次此刻仍用旧底稿 15909753**：明早若有新 Facebook 客人，仍会收到含已下架圣诞团和旧价的旧信，直到 PM 点头换新版或新流程上线。

## 二、做了什么

- 复制底稿 15909753 → 15910789；改名；主题改为「Your China tour options for 2027 · Baker from CTS Tours」，预览文字「Small-group departures from March 2027, and a personal note from me.」。
- 在 Mailchimp 的 HTML 编辑器里按 13 处逐个替换（每处都先确认只匹配到 1 次才替换），再改 2 处小的（隐藏预览文字、页脚来由句）。保存后读回：没有 Christmas / Golden China / 手册字样，合并标签（姓名、退订、更新资料）都在。
- 没点 Send / Schedule；没改底稿 15909753、已发的 15910752、旧欢迎流程 3209、表格脚本。

## 三、改动对照（旧 → 新）

| 位置 | 旧（现在每天在发的那封） | 新（v2） |
|---|---|---|
| 主题 | Your China itinerary inside · Baker from CTS Tours | Your China tour options for 2027 · Baker from CTS Tours |
| 标题 | Your China itinerary is ready | Your China options for 2027 |
| 称呼 | Kia ora *\|FNAME\|*,（没名字会变成「Kia ora ,」） | 有名字写名字，没名字写 Kia ora, |
| 手册段与按钮 | 2026–2027 手册（34 页、11 个确认出发团）+ 下载按钮（手册 PDF 已过期） | 改成「春季小团出发」一句话 + 按钮「See all 2027 China tours」→ 官网 /china-tours |
| 团列表 | 16 Nov 金色中国；22 Dec 两个圣诞团（已下架）；3 月三个团；5 月两个团 | 6 行：11 Mar Best of China、18 Mar A Tale of Two Cities、22 Mar China Unveiled、25 Mar Shanghai & Surroundings、13 May Silk Road、28 May Legacy of China；每行日期 + 团名链接 + 天数 + 城市 + 起价 |
| 上海及周边价格 | from NZ$3,399（过期） | from NZ$2,699（官网现价） |
| 长城图说明 | 提到「圣诞出发」 | 改成 A Tale of Two Cities、Best of China、Legacy of China（官网这三个团页都含长城） |
| 火车图的替代文字 | 写成「长城」 | 改成「高速列车上的 CTS 团」（图确实是火车） |
| 隐藏预览文字 | 「I've put together everything you need…」（指手册） | 与预览文字一致 |
| 页脚来由句 | 你是通过我们的咨询表单联系的 | 你联系过 CTS 或订阅了我们的更新（新流程会覆盖官网订阅来路） |
| 链接统计 | 无 | 官网链接统一带 utm_source=mailchimp、utm_campaign=welcome_v2 |

## 四、官网对账（10/28 下载页面文字；价格、出发日来自团页 meta 与正文）

| 团 | 官网页（标题 / 一级标题对得上） | 天数 | 起价 | 本信用的出发日 |
|---|---|---|---|---|
| Best of China | /tours/china/discovery/essentials | 15 | NZD $4,080 | 11 Mar 2027（页面 meta 写明） |
| A Tale of Two Cities | /tours/china/discovery/beijing-xian | 10 | NZD $3,480 | 18 Mar 2027 |
| China Unveiled | /tours/china/discovery/china-unveiled | 14 | NZD $4,999 | 22 Mar 2027 |
| Shanghai & Surroundings | /tours/china/discovery/shanghai-surroundings | 10 | NZD $2,699 | 25 Mar 2027 |
| Silk Road | /tours/china/signature/silk-road | 18 | NZD $7,999 | 13 May 2027 |
| Legacy of China | /tours/china/signature/imperial-heritage | 17 | NZD $9,999 | 28 May 2027 |
过境游 from NZ$875（官网过境游页最低起价 875）、定制游页、/china-tours 全部 200，标题均为对应页面。签证说法沿用「30 天免签，政策公布至 12/31」，官网各页均有同一句。

## 五、没做 / 没核实 / 风险

- 新流程（Mailchimp Customer Journey）还没建；没停每天 8:01 批次，没停 E2/E3/E4（它们已在上午被拆雷）；没给官网订阅的 3 位补发。
- 沿用旧信、这次没有重新核对的说法：两条客人评价原话、「25 years」「no compulsory shopping stops」、办公室地址电话。
- 纯文本版是 Mailchimp 自动生成的，没人工逐句校对。
- 只看了 Mailchimp 桌面预览和 hello@ 收到的测试信文字；手机和 Outlook 等客户端里的样子没测。
- 官网各团出发日、价格会变；上线前要再对一次。

## 六、下一步（等 PM）

1. PM 看测试信 / 预览，说内容行不行。
2. 内容定了以后，PM 决定怎么上线：先让每天 8:01 的批次直接换用新版（马上生效，只覆盖 Facebook 来路），还是搭新流程（覆盖官网订阅等所有来路，上线同一刻停批次）。上线动作都要 PM 说「开」。
