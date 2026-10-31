# 每天 8:01 欢迎信底稿换成 v2 · 证据（2026-10-28 NZ 22:40–23:10，PM 回「开」之后）

取数方式：Mailchimp 网页后台（PM 已登录的 Chrome）、hello@ 邮箱（Gmail 连接器）读测试信。没有客人邮箱、姓名落盘。
**没发给任何客人；没碰 Apps Script、旧欢迎流程、E2–E4。**

## 一、授权

PM 被问「新人欢迎信 v2（已是新团名）可以换到明早 8:01 的自动批次吗？」，回「开」。授权范围 = 把每天批次用的底稿换成 v2。不含：搭新流程、停批次、给官网订阅的 3 位补发（这三件还要 PM 另说）。

## 二、换了什么（底稿 15909753，名称「Email 1 · T+0 Welcome · Baker · CTS Reborn」，仍是 Draft，收件人仍是 INTERNAL TEST ONLY）

| 项 | 换前 | 换后 |
|---|---|---|
| 正文 | 旧 E1：2026–2027 手册 + 下载按钮；16 Nov 金色中国、22 Dec 两个圣诞团（已下架）、3 月三团、5 月两团；上海团旧价与旧名 | 与新人欢迎信 v2（15910789）逐字一致：6 个 2027 春季团，上海团新名 Shanghai & Beyond，起价 NZ$2,699 |
| 主题行 | Your China itinerary inside · Baker from CTS Tours | Your China tour options for 2027 · Baker from CTS Tours |
| 预览文字 | I've put together your 2026-2027 China Brochure with 4 hand-crafted tours. | Small-group departures from March 2027, and a personal note from me. |
| 纯文字版 | 旧文（Christmas 3、Golden China 2、Brochure 3、Surroundings 1） | 从新网页版重新生成（上述词全为 0，Beyond 1） |

旧版存档：已发出的 10/27 批次（Mailchimp 15910752，名称 auto_e1_batch_20261026）就是旧底稿的内容与主题，要退回可从它复制。

## 三、读回与当场试跑

- 底稿网页版代码与 v2 逐字相同（长度 18873，校验值相同）；预览里 Christmas / Golden China / Brochure / Surroundings 均为 0，Beyond 为 1，标题含「options for 2027」。
- 纯文字版：同上词汇均为 0，Beyond 为 1。
- 测试信：从底稿发到内部测试邮箱 1 封（NZ 22:59），收到。主题「[Test] Your China tour options for 2027 · Baker from CTS Tours」；预览文字行「Small-group departures from March 2027, and a personal note from me.」；正文是 v2；链接里的退订等是测试占位。**发测试信前对话框里默认收件人是公司邮箱 info@，已改成内部测试地址再发，没有发到公司邮箱。**
- 10/27 批次（auto_e1_batch_20261026）的主题与当时底稿的主题相同 → 脚本复制底稿时沿用底稿主题，所以主题行也必须换（已换）。
- 底稿里没有脚本替换用的占位符（查了 {{ 、%%、[[ 、@@）。

## 四、没跑 / 没核实 / 风险

- **每天 8:01 批次脚本本身没跑**：跑它会真发给客人。明早 8:01 若有新 Facebook 客人，会第一次真发新版；没有新客人就不会生成批次（10/11–10/26 没有新客人，10/27 有 1 位）。
- 邮件里团页链接仍指向 /tours/china/discovery/shanghai-surroundings（官网今晚没改）；官网改名后要核对旧网址跳转与新页面。
- 沿用旧信、没用官网重新核对：两条客人评价原话、「25 years」「no compulsory shopping stops」、办公室地址电话；签证句写「政策公布到 2026 年 12 月 31 日」，而信里的团都是 2027 年出发。
- 手机和 Outlook 等客户端里的样子没测。
- 没做：给官网订阅的 3 位补发；新流程（覆盖官网订阅等所有来路）；E2–E4 仍拆雷中。

## 五、做法与坑（Mailchimp）

- 把一份草稿的代码换进另一份：在源草稿的代码编辑器里 getValue 存进 sessionStorage，到目标草稿的代码编辑器 setValue 后点 Save；重新打开目标页，逐字比较（相等）再算完成。
- 主题行、预览文字在草稿总览页展开「Subject」编辑；纯文字版在 Content 区「Edit」→「Regenerate From HTML」→ Save。
- 「Send a Test Email」对话框里默认收件人是发件人地址（公司邮箱），发之前必须改成内部测试地址并核对。
