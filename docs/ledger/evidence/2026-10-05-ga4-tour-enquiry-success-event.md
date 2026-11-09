# GA4 事件 tour_enquiry_success 创建与当场验证（2026-10-05，CTS 属性 532503727）

- 路径：GA4 管理 → 数据流 → 网站数据流 → 创建自定义事件 → 创建
- 规则：event_name 等于 page_view，且 page_location 包含 /thank-you（不区分大小写）；标为关键事件；不设默认价值；每次访问只算一次
- 创建后自定义事件列表出现 tour_enquiry_success（与已有的 hero_search_submit、page_not_found 并列）
- 当场验证：访问 https://www.ctstours.co.nz/thank-you 一次后，GA4 实时报告 Event count 出现 tour_enquiry_success = 1，Key events 出现 tour_enquiry_success = 1（此前 Key events 为「No data available」）
- 验证自己造成 1 次计数，之后统计需扣除
