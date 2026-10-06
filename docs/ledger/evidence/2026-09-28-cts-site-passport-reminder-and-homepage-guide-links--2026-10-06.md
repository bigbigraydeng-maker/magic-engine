# 证据 · 2026-09-28-cts-site-passport-reminder-and-homepage-guide-links · 2026-10-06
fetched_at: 2026-10-06T21:34:34+1300
查了什么：线上抓 CTS 网站两个页面的 HTML
数字：traveller-details 返回 200，含 "check your passport before you travel" 和 "own responsibility"；首页返回 200，含 "zhangjiajie-travel-guide"
命令：curl -sL https://www.ctstours.co.nz/traveller-details ；curl -sL https://www.ctstours.co.nz/ ，再 grep
结论：成，两处都已上线
