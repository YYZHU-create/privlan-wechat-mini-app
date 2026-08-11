# PRIVLAN 云开发配置

部署前，在微信云开发中创建以下数据库集合：

- `privlan_customer_sessions`
- `privlan_rate_limits`
- `privlan_audit_logs`
- `privlan_slot_locks`

六个云函数均需配置：

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BITABLE_APP_TOKEN`
- `FEISHU_CUSTOMERS_TABLE_ID`
- `FEISHU_FAQ_TABLE_ID`
- `FEISHU_STORES_TABLE_ID`
- `FEISHU_ADVISORS_TABLE_ID`
- `FEISHU_SLOTS_TABLE_ID`
- `FEISHU_APPOINTMENTS_TABLE_ID`
- `AUTH_MODE=test`
- `TEST_AUTH_CODE`：仅测试环境设置，正式上线前删除
- `HUMAN_SERVICE_ENABLED=false`

可选字段映射变量见各云函数使用的 `FEISHU_FIELD_*` 名称。未配置时使用中文默认列名。量体字段建议通过 `FEISHU_MEASUREMENT_FIELDS` 明确列出，使用英文逗号分隔。

飞书表至少需要以下列：

- Customers：会员号、手机号、姓名及量体字段。
- FAQ：问题、回答、关键词、启用。
- Stores：门店ID、门店名称、地址、启用。
- Advisors：顾问ID、姓名、职位、头像、门店ID。
- ScheduleSlots：时段ID、门店ID、日期、时间、容量、已预约、顾问ID、状态。
- Appointments：预约编号、姓名、手机号、服务、门店ID、日期、时段ID、顾问ID、备注、状态、来源。

正式认证后将 `AUTH_MODE` 改为 `wechat`，删除 `TEST_AUTH_CODE`，并在微信公众平台开通手机号授权和小程序客服，再将 `HUMAN_SERVICE_ENABLED` 改为 `true`。
