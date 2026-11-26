# 证据 · 2026-10-14-east-inter-english-only · 2026-11-23
fetched_at: 2026-11-23T08:15:49+1300
查了什么：101 号英文文案稿、英文卡片、成片字幕数据里有没有中文字。
数字：英文稿 docs/clients/east-inter/2026-10-14-d1-d7-copy-en-draft.md 含中文字的行 0 行（首评相关提到 8 处，全英文）；cards-draft 下 5 个英文卡（card1/card2/d1/d2/d4 -en.html）中文字各 0 个（对应 -zh 版 50–108 个，已标搁置）；成片字幕数据 2026-10-15-east-montage-preview.props.json 中文字 0 个。生产库 East 的 5 张内容工单全部 superseded（已作废）。
来源/命令：grep 中文字符计数；只读 REST content_work_orders?client_id=eq.<East>。
结论：成。在用的文案、卡片角标和成片字幕全英文；中文旧稿仍留在仓库但已标搁置、没进在用版本。
