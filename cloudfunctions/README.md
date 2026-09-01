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

- `ATELIER_API_BASE_URL`：ATELIER OS 的公网 HTTPS 地址
- `ATELIER_APPOINTMENT_GATEWAY_TOKEN`：至少 32 字符的预约 S2S 凭证，只保存在服务端与预约云函数环境
- `ATELIER_APPOINTMENT_BACKEND=postgres`：默认且推荐；只有显式设置为 `feishu` 才运行 legacy adapter，不自动降级
- `ATELIER_FEISHU_APPOINTMENT_MIRROR=0`：设为 `1` 时在 PostgreSQL 成功后尝试飞书镜像，镜像失败不改变预约结果

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
- `APPOINTMENT_DURATION_MINUTES=135`：仅供显式 `feishu` legacy adapter 使用；PostgreSQL 模式从店铺服务快照读取时长
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

## 生产部署检查

- 部署 `appointmentCreate`、`appointmentOptions`、`appointmentList`、`customerTouch`，并确认 `privlan_appointment_records` 仅用于提醒通知镜像。客户触达、预约列表与商户后台均从 PostgreSQL 读取，客户端提交的 `openId` 会被忽略，身份只取 `cloud.getWXContext().OPENID`。
- 未配置 `AUTH_MODE` 时系统默认使用 `wechat`。测试认证只有在同时设置 `AUTH_MODE=test` 和 `TEST_AUTH_CODE` 时才会启用。
- 正式环境必须设置 `AUTH_MODE=wechat` 并删除 `TEST_AUTH_CODE`，避免测试验证码入口继续存在。
- 三个预约云函数必须使用相同的 `ATELIER_API_BASE_URL`、gateway token 和 backend 配置。Gateway token 不得写入 `utils/appointment-runtime.js`、其他前端源码或 Git。
- `privlan_appointment_locks` 同时保存顾问时间桶和预约请求幂等锁；不要从客户端直接读写该集合。
- 关注 `appointment_reconciliation_required` 审计事件。该事件表示飞书预约已经创建，但时段计数或镜像数据需要人工对账。

## WebView 业务域名

生成器会登记 `pages/webview/webview`，页面只接受 `https://` 地址。上线前仍需在微信公众平台配置对应的业务域名并完成域名校验；开发工具中的 `urlCheck=false` 不能替代正式业务域名配置。

后台的“生成小程序”和“真机预览”只生成开发项目或开发版二维码，不代表已经完成微信上传、审核或线上发布。
