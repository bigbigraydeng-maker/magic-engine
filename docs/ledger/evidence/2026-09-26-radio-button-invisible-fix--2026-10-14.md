# 证据 · 2026-09-26-radio-button-invisible-fix · 2026-10-14
fetched_at: 2026-10-14T21:40:59+13:00

查了什么：修复有没有真的上到生产（线上那份样式表里，两处改动是否都在）。

数字（带样本量、两边取数状态）：
- 线上样式表：https://app.magicengine.com.au/login 引用的唯一一份
  /_next/static/css/b4c429f3ce10bab9.css，取回 144,271 字节（今晚抓的）。
- 第一处改动（globals.css 把 radio/checkbox 从「所有 input 一律白底」里排除）：
  该样式表里 ':not([type=checkbox])' 出现 1 次、':not([type=radio])' 出现 1 次；
  同时搜不到任何 'input,select,textarea{...background-color:#fff}' 形态的裸规则（命中 0）。
  → 排除选择器已上线，radio 不再被刷成白底。
- 第二处改动（autonomy-settings 的 radio 加 accent-me-ochre）：
  该样式表里 accent-color 共 5 个取值，其中包含 #c4912e；
  仓库 tailwind.config.ts:31 里 me-ochre = '#C4912E' —— 完全对上。
  → 金色 accent 已上线，radio 圈有可见颜色。
- 样本 = 线上登录页引用的全部样式表（1 份，Next.js 把 globals.css 打进同一份）。

判据替代说明：verify_how 原文要求登录后打开 /dashboard/clients/<id>/ads-health 看渲染结果。
夜巡没有登录态，开不了那个页面。改用「线上样式表里两处改动都在、且造成 bug 的那条裸规则已不存在」
作为实证 —— 这两条样式是全局的，设置页其他 radio（客户状态、GBP 选点）吃的是同一份样式表。
没有今晚的页面截图，视觉观感这一步没人眼复核过。

来源/命令：
- curl -s https://app.magicengine.com.au/login | grep -oE '/_next/static/css/[a-z0-9]+\.css'
- curl -s https://app.magicengine.com.au/_next/static/css/b4c429f3ce10bab9.css，再 grep
  ':not(\[type=radio\])' / ':not(\[type=checkbox\])' / 'input,select,textarea\{[^}]*background-color:#fff' / 'accent-color:[^;}]*'
- 仓库：src/app/globals.css:18、tailwind.config.ts:31

结论：成。修复的两处改动都在生产样式表里，引发 bug 的裸规则已不存在。
