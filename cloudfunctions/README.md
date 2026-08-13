# PRIVLAN 云开发配置

部署前，在微信云开发中创建以下数据库集合：

- `privlan_customer_sessions`
- `privlan_rate_limits`
- `privlan_audit_logs`
- `privlan_slot_locks`
- `privlan_appointment_locks`
- `privlan_appointment_records`
- `privlan_appointment_reminders`

客服与预约云函数按各自职责配置以下环境变量：

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
- `ATELIER_AI_GATEWAY_URL`：ATELIER OS 服务端 AI 网关地址；未配置时自动使用飞书 FAQ 和内置知识
- `ATELIER_AI_GATEWAY_TOKEN`：云函数访问网关的服务凭证，只存放在云环境变量
- `ATELIER_TENANT_ID`、`ATELIER_STORE_ID`：当前小程序对应的租户和店铺作用域
- `ATELIER_AI_TIMEOUT_MS=15000`

模型供应商地址、模型名称和 API Key 由商户后台或平台运营后台配置。小程序与云函数不直接保存商户模型密钥。
- `APPOINTMENT_DURATION_MINUTES=135`
- `APPOINTMENT_REMINDER_TEMPLATE_ID`：微信订阅消息模板 ID
- `APPOINTMENT_REMINDER_LEAD_MINUTES=1440`：默认提前 24 小时提醒
- `REMINDER_FIELD_SUBJECT=thing1`
- `REMINDER_FIELD_TIME=time2`
- `REMINDER_FIELD_STORE=thing3`
- `MINIPROGRAM_STATE=formal`：测试阶段可设为 `developer` 或 `trial`

可选字段映射变量见各云函数使用的 `FEISHU_FIELD_*` 名称。未配置时使用中文默认列名。量体字段建议通过 `FEISHU_MEASUREMENT_FIELDS` 明确列出，使用英文逗号分隔。

飞书表至少需要以下列：

- Customers：会员号、手机号、姓名及量体字段。
- FAQ：问题、回答、关键词、启用。
- Stores：门店ID、门店名称、地址、启用。
- Advisors：顾问ID、姓名、职位、头像、门店ID。
- ScheduleSlots：时段ID、门店ID、日期、时间、容量、已预约、顾问ID、状态。
- Appointments：预约编号、姓名、手机号、服务、门店ID、日期、时段ID、开始时间、结束时间、服务时长、顾问ID、备注、状态、来源。

微信公众平台还需创建预约提醒订阅消息模板，并将模板 ID 同时写入 `app.js` 的 `appointmentReminderTemplateId` 和云函数环境变量 `APPOINTMENT_REMINDER_TEMPLATE_ID`。部署 `appointmentReminder` 云函数时启用其 15 分钟定时触发器；用户授权后，系统会登记预约并在默认提前 24 小时发送一次提醒。模板字段名不同时，通过 `REMINDER_FIELD_*` 环境变量映射。

正式认证后将 `AUTH_MODE` 改为 `wechat`，删除 `TEST_AUTH_CODE`，并在微信公众平台开通手机号授权和小程序客服，再将 `HUMAN_SERVICE_ENABLED` 改为 `true`。
