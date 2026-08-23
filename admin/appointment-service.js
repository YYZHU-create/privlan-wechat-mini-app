const crypto = require("node:crypto");
const { DateTime, assertTimezone, businessWindow, isSlotAligned, overlaps, storeDay, storeWeekday, utcInstant } = require("./appointment-time");
const { createCustomerService } = require("./customer-service");

class AppointmentError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const ACTIVE_STATUSES = ["pending", "confirmed"];
const TRANSITIONS = {
  pending: new Set(["confirmed", "cancelled", "no_show"]),
  confirmed: new Set(["completed", "cancelled", "no_show"]),
  completed: new Set(), cancelled: new Set(), no_show: new Set()
};

function uuid() { return crypto.randomUUID(); }
function json(value) { return JSON.stringify(value ?? {}); }
function maskPhone(value) { const phone = String(value || ""); return phone.length >= 7 ? `${phone.slice(0,3)}****${phone.slice(-4)}` : phone; }
function int(value, min, max, fallback) { const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : fallback; }
function rowScope(scope) { return [scope.tenantId, scope.workspaceId, scope.storeId]; }
function publicStatus(status) { return ({ pending: "待确认", confirmed: "已确认", completed: "已完成", cancelled: "已取消", no_show: "未到店" })[status] || status; }

function createAppointmentService({ db, openIdHashKey = process.env.ATELIER_OPENID_HASH_KEY || "", customerService = null, now = () => DateTime.utc() }) {
  if (!db) throw new Error("database is required");
  const identityService = customerService || createCustomerService({ db, openIdHashKey });

  function hashOpenId(openid) {
    if (Buffer.byteLength(openIdHashKey) < 32) throw new AppointmentError(503, "OPENID_HASH_KEY_MISSING", "预约身份服务尚未配置");
    return crypto.createHmac("sha256", openIdHashKey).update(String(openid || "")).digest("hex");
  }

  function assertWritable(scope) {
    if (scope?.subscription?.status !== "active") throw new AppointmentError(403, "SUBSCRIPTION_REQUIRED", "订阅已到期，请兑换后继续使用");
  }

  async function audit(tx, scope, action, resourceType, resourceId, metadata = {}) {
    await tx.query(`insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`, [uuid(), scope.tenantId, scope.workspaceId, scope.actorType || "system", scope.actorId || "system", action, resourceType, resourceId || null, scope.requestId || uuid(), json(metadata)]);
  }

  async function ensureDefaults(tx, scope, durationMinutes = 60) {
    const [tenantId, workspaceId, storeId] = rowScope(scope);
    await tx.query(`insert into appointment_settings(tenant_id,workspace_id,store_id) values($1,$2,$3) on conflict(workspace_id,store_id) do nothing`, [tenantId, workspaceId, storeId]);
    let service = (await tx.query("select id from appointment_services where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by sort_order,id limit 1", rowScope(scope))).rows[0];
    if (!service) {
      service = { id: uuid() };
      await tx.query(`insert into appointment_services(id,tenant_id,workspace_id,store_id,name,description,duration_minutes) values($1,$2,$3,$4,'预约服务','', $5)`, [service.id, tenantId, workspaceId, storeId, durationMinutes]);
    }
    let advisor = (await tx.query("select id from appointment_advisors where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by sort_order,id limit 1", rowScope(scope))).rows[0];
    if (!advisor) {
      advisor = { id: uuid() };
      await tx.query(`insert into appointment_advisors(id,tenant_id,workspace_id,store_id,name) values($1,$2,$3,$4,'默认服务人员')`, [advisor.id, tenantId, workspaceId, storeId]);
    }
    await tx.query(`insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id) values($1,$2,$3,$4,$5) on conflict(advisor_id,service_id) do nothing`, [tenantId, workspaceId, storeId, advisor.id, service.id]);
    const count = Number((await tx.query("select count(*)::int count from appointment_business_hours where store_id=$1", [storeId])).rows[0]?.count || 0);
    if (!count) for (let weekday = 0; weekday < 7; weekday += 1) await tx.query(`insert into appointment_business_hours(id,tenant_id,workspace_id,store_id,weekday,start_time,end_time) values($1,$2,$3,$4,$5,'09:00','18:00')`, [uuid(), tenantId, workspaceId, storeId, weekday]);
    return { serviceId: service.id, advisorId: advisor.id };
  }

  async function publicScope(publicStoreId, { requireBooking = false } = {}) {
    const row = (await db.query(`select st.id store_id,st.tenant_id,st.workspace_id,st.name store_name,st.public_store_id,
      sub.status subscription_status,sub.expires_at,aset.timezone,aset.slot_interval_minutes,aset.default_buffer_minutes,
      aset.max_advance_days,aset.booking_enabled
      from stores st join appointment_settings aset on aset.store_id=st.id
      left join subscriptions sub on sub.workspace_id=st.workspace_id where st.public_store_id=$1 limit 1`, [String(publicStoreId || "")])).rows[0];
    if (!row) throw new AppointmentError(404, "STORE_NOT_FOUND", "未找到预约门店");
    const active = row.subscription_status === "active" && (!row.expires_at || new Date(row.expires_at) > new Date());
    if (requireBooking && (!active || !row.booking_enabled)) throw new AppointmentError(403, "STORE_BOOKING_UNAVAILABLE", "该门店暂时不接受新预约");
    return { tenantId: row.tenant_id, workspaceId: row.workspace_id, storeId: row.store_id, storeName: row.store_name, publicStoreId: row.public_store_id, active, settings: row };
  }

  async function scopedResources(scope, { enabledOnly = false } = {}) {
    const enabled = enabledOnly ? " and enabled=true" : "";
    const services = (await db.query(`select * from appointment_services where tenant_id=$1 and workspace_id=$2 and store_id=$3${enabled} order by sort_order,name`, rowScope(scope))).rows;
    const advisors = (await db.query(`select * from appointment_advisors where tenant_id=$1 and workspace_id=$2 and store_id=$3${enabled} order by sort_order,name`, rowScope(scope))).rows;
    return { services, advisors };
  }

  async function availableOptions(input) {
    const scope = await publicScope(input.publicStoreId, { requireBooking: true });
    const settings = scope.settings;
    if (!assertTimezone(settings.timezone)) throw new AppointmentError(500, "TIMEZONE_INVALID", "门店时区配置无效");
    const { services, advisors } = await scopedResources(scope, { enabledOnly: true });
    const service = input.serviceId ? services.find(item => item.id === input.serviceId) : services[0];
    if (input.serviceId && !service) throw new AppointmentError(400, "INVALID_INPUT", "预约服务无效");
    if (!service) return { services: [], advisors: [], dates: [], slots: [], store: { publicStoreId: scope.publicStoreId, name: scope.storeName } };
    const mappings = (await db.query("select advisor_id from appointment_advisor_services where tenant_id=$1 and workspace_id=$2 and store_id=$3 and service_id=$4", [...rowScope(scope), service.id])).rows.map(row => row.advisor_id);
    const eligibleAdvisors = advisors.filter(item => mappings.includes(item.id));
    const current = now().setZone(settings.timezone);
    const hours = (await db.query("select * from appointment_business_hours where tenant_id=$1 and workspace_id=$2 and store_id=$3 and enabled=true order by weekday,start_time", rowScope(scope))).rows;
    const dates = [];
    for (let offset = 0; offset <= Number(settings.max_advance_days); offset += 1) {
      const day = current.startOf("day").plus({ days: offset });
      if (hours.some(item => Number(item.weekday) === storeWeekday(day))) dates.push({ value: day.toISODate(), day: day.toFormat("dd"), month: `${Number(day.toFormat("MM"))}月`, weekday: day.setLocale("zh-CN").toFormat("ccc") });
    }
    const selectedDate = String(input.date || dates[0]?.value || "");
    const day = storeDay(selectedDate, settings.timezone);
    if (!day.isValid || !dates.some(item => item.value === selectedDate)) return { services: services.map(serviceView), advisors: eligibleAdvisors.map(advisorView), dates, slots: [], store: { publicStoreId: scope.publicStoreId, name: scope.storeName } };
    const dayHours = hours.filter(item => Number(item.weekday) === storeWeekday(day));
    const rangeStart = day.startOf("day").toUTC().toJSDate(); const rangeEnd = day.plus({ days: 1 }).startOf("day").toUTC().toJSDate();
    const existing = (await db.query(`select advisor_id,start_at,occupied_until from appointments where tenant_id=$1 and workspace_id=$2 and store_id=$3 and status=any($4) and start_at<$6 and occupied_until>$5`, [...rowScope(scope), ACTIVE_STATUSES, rangeStart, rangeEnd])).rows;
    const buffer = service.buffer_minutes_override === null || service.buffer_minutes_override === undefined ? Number(settings.default_buffer_minutes) : Number(service.buffer_minutes_override);
    const chosen = String(input.advisorId || "");
    const candidates = chosen ? eligibleAdvisors.filter(item => item.id === chosen) : eligibleAdvisors;
    const slots = [];
    for (const interval of dayHours) {
      const startText = String(interval.start_time).slice(0,5); const endText = String(interval.end_time).slice(0,5);
      const { start: windowStart, end: windowEnd } = businessWindow(selectedDate, startText, endText, settings.timezone);
      for (let candidate = windowStart; candidate.plus({ minutes: Number(service.duration_minutes) + buffer }) <= windowEnd; candidate = candidate.plus({ minutes: Number(settings.slot_interval_minutes) })) {
        if (candidate < current) continue;
        const occupiedUntil = candidate.plus({ minutes: Number(service.duration_minutes) + buffer });
        const availableAdvisorIds = candidates.filter(advisor => !existing.some(item => item.advisor_id === advisor.id && overlaps(DateTime.fromJSDate(new Date(item.start_at)), DateTime.fromJSDate(new Date(item.occupied_until)), candidate, occupiedUntil))).map(item => item.id);
        slots.push({ id: candidate.toUTC().toISO(), startAt: candidate.toUTC().toISO(), label: `${candidate.toFormat("HH:mm")}–${candidate.plus({ minutes: Number(service.duration_minutes) }).toFormat("HH:mm")}`, available: availableAdvisorIds.length > 0, availableAdvisorIds });
      }
    }
    return { store: { publicStoreId: scope.publicStoreId, name: scope.storeName }, services: services.map(serviceView), advisors: eligibleAdvisors.map(advisorView), dates, slots, durationMinutes: Number(service.duration_minutes), effectiveBufferMinutes: buffer, selectedDate };
  }

  function serviceView(row) { return { id: row.id, name: row.name, description: row.description || "", durationMinutes: Number(row.duration_minutes), bufferMinutesOverride: row.buffer_minutes_override === null ? null : Number(row.buffer_minutes_override), enabled: row.enabled, sortOrder: Number(row.sort_order) }; }
  function advisorView(row) { return { id: row.id, name: row.name, enabled: row.enabled, sortOrder: Number(row.sort_order) }; }

  async function validateCreate(tx, scope, input) {
    const settings = (await tx.query("select * from appointment_settings where tenant_id=$1 and workspace_id=$2 and store_id=$3", rowScope(scope))).rows[0];
    const service = (await tx.query("select * from appointment_services where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 and enabled=true", [input.serviceId, ...rowScope(scope)])).rows[0];
    const advisor = (await tx.query("select * from appointment_advisors where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 and enabled=true", [input.advisorId, ...rowScope(scope)])).rows[0];
    if (!service || !advisor) throw new AppointmentError(400, "INVALID_INPUT", "预约服务或顾问无效");
    const related = (await tx.query("select 1 from appointment_advisor_services where tenant_id=$1 and workspace_id=$2 and store_id=$3 and advisor_id=$4 and service_id=$5", [...rowScope(scope), advisor.id, service.id])).rows[0];
    if (!related) throw new AppointmentError(400, "INVALID_INPUT", "该顾问暂不提供所选服务");
    if (!settings || !assertTimezone(settings.timezone)) throw new AppointmentError(500, "TIMEZONE_INVALID", "门店时区配置无效");
    const start = utcInstant(input.startAt);
    if (!start.isValid) throw new AppointmentError(400, "INVALID_INPUT", "预约时间无效");
    const local = start.setZone(settings.timezone); const current = now().setZone(settings.timezone);
    if (local < current || local > current.endOf("day").plus({ days: Number(settings.max_advance_days) })) throw new AppointmentError(409, "SLOT_UNAVAILABLE", "预约时间不在可预约范围内");
    const buffer = service.buffer_minutes_override === null ? Number(settings.default_buffer_minutes) : Number(service.buffer_minutes_override);
    const serviceEnd = start.plus({ minutes: Number(service.duration_minutes) }); const occupiedUntil = serviceEnd.plus({ minutes: buffer });
    const hours = (await tx.query("select * from appointment_business_hours where tenant_id=$1 and workspace_id=$2 and store_id=$3 and weekday=$4 and enabled=true", [...rowScope(scope), storeWeekday(local)])).rows;
    const validWindow = hours.some(item => {
      const { start: windowStart, end: windowEnd } = businessWindow(local.toISODate(), item.start_time, item.end_time, settings.timezone);
      return isSlotAligned(local, windowStart, settings.slot_interval_minutes) && occupiedUntil.setZone(settings.timezone) <= windowEnd;
    });
    if (!validWindow) throw new AppointmentError(409, "SLOT_UNAVAILABLE", "该时间不在营业或可预约时段内");
    return { settings, service, advisor, start, serviceEnd, occupiedUntil, buffer };
  }

  async function createAppointment(input, context = {}) {
    const publicData = await publicScope(input.publicStoreId, { requireBooking: true });
    const name = String(input.customerName || "").trim().slice(0,64); const phone = String(input.customerPhone || "").trim(); const openid = String(input.openid || ""); const idempotencyKey = String(input.idempotencyKey || "").trim().slice(0,128);
    if (!openid || !idempotencyKey || (phone && !/^1\d{10}$/.test(phone))) throw new AppointmentError(400, "INVALID_INPUT", "预约身份或幂等信息无效");
    const scope = { ...publicData, actorType: "mini_program", actorId: "wechat_customer", requestId: context.requestId };
    return db.transaction(async tx => {
      let prior = (await tx.query("select * from appointments where workspace_id=$1 and idempotency_key=$2", [scope.workspaceId, idempotencyKey])).rows[0];
      if (prior) return appointmentPublicView(prior, scope.storeName, true);
      const validated = await validateCreate(tx, scope, input);
      await tx.query("select id from appointment_advisors where id=$1 for update", [validated.advisor.id]);
      prior = (await tx.query("select * from appointments where workspace_id=$1 and idempotency_key=$2", [scope.workspaceId, idempotencyKey])).rows[0];
      if (prior) return appointmentPublicView(prior, scope.storeName, true);
      const customer = await identityService.findOrCreateCustomer(tx, scope, { openid, name, phone, source: "appointment" });
      const conflict = (await tx.query(`select id from appointments where tenant_id=$1 and workspace_id=$2 and store_id=$3 and advisor_id=$4 and status=any($5) and start_at<$7 and occupied_until>$6 limit 1`, [...rowScope(scope), validated.advisor.id, ACTIVE_STATUSES, validated.start.toJSDate(), validated.occupiedUntil.toJSDate()])).rows[0];
      if (conflict) throw new AppointmentError(409, "APPOINTMENT_CONFLICT", "该时间刚刚被预约，请选择其他时间");
      const appointmentId = uuid(); const appointmentNumber = `AT${validated.start.toFormat("yyLLdd")}${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
      const appointment = (await tx.query(`insert into appointments(id,tenant_id,workspace_id,store_id,customer_id,service_id,advisor_id,appointment_number,status,start_at,service_end_at,occupied_until,duration_minutes_snapshot,buffer_minutes_snapshot,timezone_snapshot,customer_name_snapshot,customer_phone_snapshot,service_name_snapshot,advisor_name_snapshot,notes,source,idempotency_key)
        values($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'mini_program',$20) returning *`, [appointmentId, ...rowScope(scope), customer.id, validated.service.id, validated.advisor.id, appointmentNumber, validated.start.toJSDate(), validated.serviceEnd.toJSDate(), validated.occupiedUntil.toJSDate(), validated.service.duration_minutes, validated.buffer, validated.settings.timezone, name, phone, validated.service.name, validated.advisor.name, String(input.notes || "").trim().slice(0,1000), idempotencyKey])).rows[0];
      await tx.query("update customers set appointment_count=appointment_count+1,last_seen_at=now(),updated_at=now() where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [customer.id, ...rowScope(scope)]);
      await identityService.appendEvent(tx, scope, customer.id, "appointment_created", "appointment", "appointment", appointment.id);
      await audit(tx, scope, "appointment.create", "appointment", appointment.id, { source: "mini_program", status: "pending" });
      return appointmentPublicView(appointment, scope.storeName, false);
    });
  }

  function appointmentPublicView(row, storeName, idempotent = false) {
    const start = DateTime.fromJSDate(new Date(row.start_at), { zone: row.timezone_snapshot }); const end = DateTime.fromJSDate(new Date(row.service_end_at), { zone: row.timezone_snapshot });
    return { number: row.appointment_number, storeName, serviceName: row.service_name_snapshot, advisorName: row.advisor_name_snapshot, date: start.toISODate(), slotLabel: `${start.toFormat("HH:mm")}–${end.toFormat("HH:mm")}`, startAt: new Date(row.start_at).toISOString(), endAt: new Date(row.service_end_at).toISOString(), durationMinutes: Number(row.duration_minutes_snapshot), status: publicStatus(row.status), idempotent };
  }

  async function listPublicAppointments(input) {
    const scope = await publicScope(input.publicStoreId); const openid = String(input.openid || "");
    if (!openid) throw new AppointmentError(401, "AUTH_REQUIRED", "请先在微信中登录");
    const rows = (await db.query(`select a.* from appointments a join customers c on c.id=a.customer_id and c.tenant_id=a.tenant_id and c.workspace_id=a.workspace_id and c.store_id=a.store_id
      where a.tenant_id=$1 and a.workspace_id=$2 and a.store_id=$3 and c.wechat_openid_hash=$4 order by a.start_at desc limit 100`, [...rowScope(scope), hashOpenId(openid)])).rows;
    return rows.map(row => appointmentPublicView(row, scope.storeName));
  }

  async function stats(scope) {
    const settings = await getSettings(scope); const zone = settings.timezone; const current = now().setZone(zone); const weekEnd = current.endOf("week").toUTC().toJSDate();
    const row = (await db.query(`select count(*) filter(where start_at>=$4 and start_at<$5)::int today,
      count(*) filter(where start_at>=$4 and start_at<$6)::int week,
      count(*) filter(where status='pending')::int pending from appointments where tenant_id=$1 and workspace_id=$2 and store_id=$3`, [...rowScope(scope), current.startOf("day").toUTC().toJSDate(), current.plus({ days: 1 }).startOf("day").toUTC().toJSDate(), weekEnd])).rows[0];
    row.customers = Number((await db.query("select count(*)::int count from customers where tenant_id=$1 and workspace_id=$2 and store_id=$3", rowScope(scope))).rows[0]?.count || 0); return row;
  }

  async function listAppointments(scope, filters = {}) {
    const values = [...rowScope(scope)]; const where = ["a.tenant_id=$1", "a.workspace_id=$2", "a.store_id=$3"];
    for (const [field, column] of [["status","a.status"],["serviceId","a.service_id"],["advisorId","a.advisor_id"]]) if (filters[field]) { values.push(filters[field]); where.push(`${column}=$${values.length}`); }
    if (filters.q) { values.push(`%${String(filters.q).slice(0,80)}%`); where.push(`(a.customer_name_snapshot ilike $${values.length} or a.customer_phone_snapshot ilike $${values.length} or a.appointment_number ilike $${values.length})`); }
    if (filters.dateFrom) { values.push(filters.dateFrom); where.push(`a.start_at >= $${values.length}::date`); }
    if (filters.dateTo) { values.push(filters.dateTo); where.push(`a.start_at < ($${values.length}::date + interval '1 day')`); }
    const rows = (await db.query(`select a.* from appointments a where ${where.join(" and ")} order by a.start_at desc limit 250`, values)).rows;
    return rows.map(row => ({ id: row.id, number: row.appointment_number, startAt: row.start_at, customerName: row.customer_name_snapshot, customerPhoneMasked: maskPhone(row.customer_phone_snapshot), serviceName: row.service_name_snapshot, advisorName: row.advisor_name_snapshot, status: row.status, statusLabel: publicStatus(row.status), source: row.source }));
  }

  async function getAppointment(scope, id) {
    const row = (await db.query("select a.*,st.name store_name from appointments a join stores st on st.id=a.store_id and st.tenant_id=a.tenant_id and st.workspace_id=a.workspace_id where a.id=$1 and a.tenant_id=$2 and a.workspace_id=$3 and a.store_id=$4", [id, ...rowScope(scope)])).rows[0];
    if (!row) throw new AppointmentError(404, "APPOINTMENT_NOT_FOUND", "预约不存在");
    return { id: row.id, number: row.appointment_number, customerId: row.customer_id, customerName: row.customer_name_snapshot, customerPhone: maskPhone(row.customer_phone_snapshot), storeName: row.store_name, storeId: row.store_id, serviceName: row.service_name_snapshot, advisorName: row.advisor_name_snapshot, startAt: row.start_at, serviceEndAt: row.service_end_at, occupiedUntil: row.occupied_until, durationMinutes: Number(row.duration_minutes_snapshot), bufferMinutes: Number(row.buffer_minutes_snapshot), timezone: row.timezone_snapshot, notes: row.notes, source: row.source, status: row.status, statusLabel: publicStatus(row.status), createdAt: row.created_at };
  }

  async function merchantAvailability(scope, input = {}) {
    if (input.storeId && String(input.storeId) !== String(scope.storeId)) throw new AppointmentError(403, "APPOINTMENT_SCOPE_INVALID", "不能读取其他门店的预约时间");
    const publicStoreId = scope.workspace?.publicStoreId || (await db.query("select public_store_id from stores where id=$1 and tenant_id=$2 and workspace_id=$3", [scope.storeId, scope.tenantId, scope.workspaceId])).rows[0]?.public_store_id;
    if (!publicStoreId) throw new AppointmentError(404, "STORE_NOT_FOUND", "预约门店不存在");
    return availableOptions({ ...input, publicStoreId });
  }

  async function timeline(scope, id) {
    const appointment = (await db.query("select id,customer_id from appointments where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [id, ...rowScope(scope)])).rows[0];
    if (!appointment) throw new AppointmentError(404, "APPOINTMENT_NOT_FOUND", "预约不存在");
    const [events, auditEvents] = await Promise.all([
      db.query("select event_type,source,resource_type,resource_id,metadata,occurred_at from customer_events where tenant_id=$1 and workspace_id=$2 and store_id=$3 and customer_id=$4 and (resource_id=$5 or (resource_type='appointment_follow_up' and resource_id like $6)) order by occurred_at desc limit 200", [...rowScope(scope), appointment.customer_id, id, `${id}:%`]),
      db.query("select action,resource_type,resource_id,metadata,created_at occurred_at,actor_type from audit_events where tenant_id=$1 and workspace_id=$2 and resource_type='appointment' and resource_id=$3 order by created_at desc limit 200", [scope.tenantId, scope.workspaceId, id])
    ]);
    return [...events.rows.map(row => ({ type: row.event_type, source: row.source, resourceType: row.resource_type, resourceId: row.resource_id, metadata: row.metadata || {}, occurredAt: row.occurred_at })), ...auditEvents.rows.map(row => ({ type: row.action, source: row.actor_type, resourceType: row.resource_type, resourceId: row.resource_id, metadata: row.metadata || {}, occurredAt: row.occurred_at }))].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  }

  async function createFollowUp(scope, id, input = {}) {
    assertWritable(scope);
    const note = String(input.note || input.content || "").trim().slice(0, 1000);
    const key = String(input.idempotencyKey || `follow-up-${id}-${note}`).trim().slice(0, 180);
    if (!key) throw new AppointmentError(400, "FOLLOW_UP_INVALID", "跟进记录缺少幂等键");
    return db.transaction(async tx => {
      const appointment = (await tx.query("select id,customer_id from appointments where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 for update", [id, ...rowScope(scope)])).rows[0];
      if (!appointment) throw new AppointmentError(404, "APPOINTMENT_NOT_FOUND", "预约不存在");
      const resourceId = `${id}:${key}`;
      const inserted = await tx.query("insert into customer_events(id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id,metadata) values($1,$2,$3,$4,$5,'follow_up_created','merchant','appointment_follow_up',$6,$7::jsonb) on conflict do nothing returning id,occurred_at", [uuid(), ...rowScope(scope), appointment.customer_id, resourceId, json({ note })]);
      if (!inserted.rows[0]) return { duplicate: true, appointmentId: id, idempotencyKey: key };
      await audit(tx, { ...scope, actorType: "merchant", actorId: scope.userId }, "appointment.follow_up.create", "appointment", id, { idempotencyKey: key });
      return { duplicate: false, appointmentId: id, customerId: appointment.customer_id, idempotencyKey: key, occurredAt: inserted.rows[0].occurred_at };
    });
  }

  async function updateStatus(scope, id, status) {
    assertWritable(scope); const target = String(status || "");
    await db.transaction(async tx => {
      const row = (await tx.query("select * from appointments where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 for update", [id, ...rowScope(scope)])).rows[0];
      if (!row) throw new AppointmentError(404, "APPOINTMENT_NOT_FOUND", "预约不存在");
      if (!TRANSITIONS[row.status]?.has(target)) throw new AppointmentError(409, "APPOINTMENT_STATUS_INVALID", "当前预约状态不能执行该操作");
      await tx.query("update appointments set status=$1,updated_at=now() where id=$2", [target, id]);
      const eventType = target === "completed" ? "appointment_completed" : target === "cancelled" ? "appointment_cancelled" : null;
      if (eventType) await identityService.appendEvent(tx, scope, row.customer_id, eventType, "merchant", "appointment", id);
      await audit(tx, { ...scope, actorType: "merchant", actorId: scope.userId }, `appointment.${target === "confirmed" ? "confirm" : target === "completed" ? "complete" : target}`, "appointment", id, { from: row.status, to: target });
    });
    return getAppointment(scope, id);
  }

  async function listCustomers(scope, q = "") {
    const values = [...rowScope(scope)]; let search = ""; if (q) { values.push(`%${String(q).slice(0,80)}%`); search = ` and (c.name ilike $4 or c.phone ilike $4)`; }
    const rows = (await db.query(`select c.id,c.name,c.phone,c.source,c.created_at,count(a.id)::int appointment_count,min(a.start_at) first_appointment,max(a.start_at) last_appointment
      from customers c left join appointments a on a.customer_id=c.id where c.tenant_id=$1 and c.workspace_id=$2 and c.store_id=$3${search}
      group by c.id order by last_appointment desc nulls last,c.created_at desc limit 250`, values)).rows;
    return rows.map(row => ({ id: row.id, name: row.name, phoneMasked: maskPhone(row.phone), source: row.source, appointmentCount: Number(row.appointment_count), firstAppointment: row.first_appointment, lastAppointment: row.last_appointment }));
  }

  async function getCustomer(scope, id) {
    const row = (await db.query("select id,name,phone,source,created_at from customers where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [id, ...rowScope(scope)])).rows[0];
    if (!row) throw new AppointmentError(404, "CUSTOMER_NOT_FOUND", "客户不存在");
    const history = (await db.query("select id,appointment_number,start_at,service_name_snapshot,advisor_name_snapshot,status from appointments where customer_id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 order by start_at desc", [id, ...rowScope(scope)])).rows;
    return { id: row.id, name: row.name, phone: row.phone, source: row.source, firstAppointment: history.at(-1)?.start_at || null, lastAppointment: history[0]?.start_at || null, appointmentCount: history.length, appointments: history.map(item => ({ id: item.id, number: item.appointment_number, startAt: item.start_at, serviceName: item.service_name_snapshot, advisorName: item.advisor_name_snapshot, status: item.status, statusLabel: publicStatus(item.status) })) };
  }

  async function getSettings(scope) {
    const row = (await db.query("select * from appointment_settings where tenant_id=$1 and workspace_id=$2 and store_id=$3", rowScope(scope))).rows[0];
    if (!row) throw new AppointmentError(404, "APPOINTMENT_SETTINGS_NOT_FOUND", "预约设置不存在");
    return { timezone: row.timezone, slotIntervalMinutes: Number(row.slot_interval_minutes), defaultBufferMinutes: Number(row.default_buffer_minutes), maxAdvanceDays: Number(row.max_advance_days), bookingEnabled: row.booking_enabled };
  }

  async function updateSettings(scope, input) {
    assertWritable(scope); const timezone = String(input.timezone || ""); const slot = int(input.slotIntervalMinutes,5,300,-1); const buffer = int(input.defaultBufferMinutes,1,30,-1); const days = int(input.maxAdvanceDays,1,365,-1);
    if (!assertTimezone(timezone) || slot < 0 || slot % 5 || buffer < 0 || days < 0) throw new AppointmentError(400, "APPOINTMENT_SETTINGS_INVALID", "预约规则设置无效");
    await db.transaction(async tx => { await tx.query("update appointment_settings set timezone=$1,slot_interval_minutes=$2,default_buffer_minutes=$3,min_advance_minutes=0,max_advance_days=$4,booking_enabled=$5,updated_at=now() where tenant_id=$6 and workspace_id=$7 and store_id=$8", [timezone,slot,buffer,days,input.bookingEnabled !== false,...rowScope(scope)]); await audit(tx,{...scope,actorType:"merchant",actorId:scope.userId},"appointment.settings.update","appointment_settings",scope.storeId,{ bookingEnabled: input.bookingEnabled !== false }); });
    return getSettings(scope);
  }

  async function listServices(scope) { return (await scopedResources(scope)).services.map(serviceView); }
  async function saveService(scope, input, id = null) {
    assertWritable(scope); const name = String(input.name || "").trim().slice(0,80); const duration = int(input.durationMinutes,5,1440,-1); const override = input.bufferMinutesOverride === null || input.bufferMinutesOverride === "" ? null : int(input.bufferMinutesOverride,0,480,-1);
    if (!name || duration < 0 || override === -1) throw new AppointmentError(400,"APPOINTMENT_SERVICE_INVALID","服务设置无效");
    return db.transaction(async tx => {
      const serviceId = id || uuid();
      if (id) { const result = await tx.query("update appointment_services set name=$1,description=$2,duration_minutes=$3,buffer_minutes_override=$4,enabled=$5,sort_order=$6,updated_at=now() where id=$7 and tenant_id=$8 and workspace_id=$9 and store_id=$10 returning *", [name,String(input.description||"").slice(0,500),duration,override,input.enabled!==false,int(input.sortOrder,-10000,10000,0),id,...rowScope(scope)]); if (!result.rows[0]) throw new AppointmentError(404,"APPOINTMENT_SERVICE_NOT_FOUND","服务不存在"); }
      else { await tx.query("insert into appointment_services(id,tenant_id,workspace_id,store_id,name,description,duration_minutes,buffer_minutes_override,enabled,sort_order) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [serviceId,...rowScope(scope),name,String(input.description||"").slice(0,500),duration,override,input.enabled!==false,int(input.sortOrder,-10000,10000,0)]); await tx.query("insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id) select tenant_id,workspace_id,store_id,id,$1 from appointment_advisors where tenant_id=$2 and workspace_id=$3 and store_id=$4 on conflict(advisor_id,service_id) do nothing", [serviceId,...rowScope(scope)]); }
      await audit(tx,{...scope,actorType:"merchant",actorId:scope.userId},id?"appointment.service.update":"appointment.service.create","appointment_service",serviceId,{ enabled: input.enabled!==false });
      return serviceView((await tx.query("select * from appointment_services where id=$1",[serviceId])).rows[0]);
    });
  }
  async function removeService(scope, id) {
    assertWritable(scope);
    return db.transaction(async tx => {
      const row = (await tx.query("select * from appointment_services where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 for update", [id, ...rowScope(scope)])).rows[0];
      if (!row) throw new AppointmentError(404, "APPOINTMENT_SERVICE_NOT_FOUND", "服务不存在");
      if ((await tx.query("select 1 from appointments where service_id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 limit 1", [id, ...rowScope(scope)])).rows[0]) throw new AppointmentError(409, "APPOINTMENT_RESOURCE_IN_USE", "该服务已有预约记录，请停用以保留历史数据");
      await tx.query("delete from appointment_advisor_services where tenant_id=$1 and workspace_id=$2 and store_id=$3 and service_id=$4", [...rowScope(scope), id]);
      await tx.query("delete from appointment_services where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [id, ...rowScope(scope)]);
      await audit(tx, { ...scope, actorType: "merchant", actorId: scope.userId }, "appointment.service.delete", "appointment_service", id);
      return { id, deleted: true };
    });
  }

  async function listAdvisors(scope) { return (await scopedResources(scope)).advisors.map(advisorView); }
  async function saveAdvisor(scope, input, id = null) {
    assertWritable(scope); const name=String(input.name||"").trim().slice(0,80); if(!name) throw new AppointmentError(400,"APPOINTMENT_ADVISOR_INVALID","请输入服务人员姓名");
    return db.transaction(async tx => { const advisorId=id||uuid(); if(id){const result=await tx.query("update appointment_advisors set name=$1,enabled=$2,sort_order=$3,updated_at=now() where id=$4 and tenant_id=$5 and workspace_id=$6 and store_id=$7 returning *",[name,input.enabled!==false,int(input.sortOrder,-10000,10000,0),id,...rowScope(scope)]);if(!result.rows[0])throw new AppointmentError(404,"APPOINTMENT_ADVISOR_NOT_FOUND","服务人员不存在");}else{await tx.query("insert into appointment_advisors(id,tenant_id,workspace_id,store_id,name,enabled,sort_order) values($1,$2,$3,$4,$5,$6,$7)",[advisorId,...rowScope(scope),name,input.enabled!==false,int(input.sortOrder,-10000,10000,0)]);await tx.query("insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id) select tenant_id,workspace_id,store_id,$1,id from appointment_services where tenant_id=$2 and workspace_id=$3 and store_id=$4 on conflict(advisor_id,service_id) do nothing",[advisorId,...rowScope(scope)]);}await audit(tx,{...scope,actorType:"merchant",actorId:scope.userId},id?"appointment.advisor.update":"appointment.advisor.create","appointment_advisor",advisorId,{enabled:input.enabled!==false});return advisorView((await tx.query("select * from appointment_advisors where id=$1",[advisorId])).rows[0]);});
  }
  async function removeAdvisor(scope, id) {
    assertWritable(scope);
    return db.transaction(async tx => {
      const row = (await tx.query("select * from appointment_advisors where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 for update", [id, ...rowScope(scope)])).rows[0];
      if (!row) throw new AppointmentError(404, "APPOINTMENT_ADVISOR_NOT_FOUND", "服务人员不存在");
      if ((await tx.query("select 1 from appointments where advisor_id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4 limit 1", [id, ...rowScope(scope)])).rows[0]) throw new AppointmentError(409, "APPOINTMENT_RESOURCE_IN_USE", "该服务人员已有预约记录，请停用以保留历史数据");
      await tx.query("delete from appointment_advisor_services where tenant_id=$1 and workspace_id=$2 and store_id=$3 and advisor_id=$4", [...rowScope(scope), id]);
      await tx.query("delete from appointment_advisors where id=$1 and tenant_id=$2 and workspace_id=$3 and store_id=$4", [id, ...rowScope(scope)]);
      await audit(tx, { ...scope, actorType: "merchant", actorId: scope.userId }, "appointment.advisor.delete", "appointment_advisor", id);
      return { id, deleted: true };
    });
  }

  async function listHours(scope) { return (await db.query("select id,weekday,start_time,end_time,enabled from appointment_business_hours where tenant_id=$1 and workspace_id=$2 and store_id=$3 order by weekday,start_time",rowScope(scope))).rows.map(row=>({id:row.id,weekday:Number(row.weekday),startTime:String(row.start_time).slice(0,5),endTime:String(row.end_time).slice(0,5),enabled:row.enabled})); }
  async function replaceHours(scope, input) {
    assertWritable(scope); const hours=Array.isArray(input.hours)?input.hours:[]; if(hours.some(item=>!Number.isInteger(Number(item.weekday))||Number(item.weekday)<0||Number(item.weekday)>6||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.startTime)||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.endTime)||item.endTime<=item.startTime)) throw new AppointmentError(400,"BUSINESS_HOURS_INVALID","营业时间设置无效");
    await db.transaction(async tx=>{await tx.query("delete from appointment_business_hours where tenant_id=$1 and workspace_id=$2 and store_id=$3",rowScope(scope));for(const item of hours)await tx.query("insert into appointment_business_hours(id,tenant_id,workspace_id,store_id,weekday,start_time,end_time,enabled) values($1,$2,$3,$4,$5,$6,$7,$8)",[uuid(),...rowScope(scope),Number(item.weekday),item.startTime,item.endTime,item.enabled!==false]);await audit(tx,{...scope,actorType:"merchant",actorId:scope.userId},"appointment.business_hours.update","appointment_business_hours",scope.storeId,{windowCount:hours.length});});return listHours(scope);
  }

  return { ensureDefaults, availableOptions, merchantAvailability, createAppointment, listPublicAppointments, stats, listAppointments, getAppointment, timeline, createFollowUp, updateStatus, listCustomers, getCustomer, getSettings, updateSettings, listServices, saveService, removeService, listAdvisors, saveAdvisor, removeAdvisor, listHours, replaceHours, hashOpenId, assertWritable, AppointmentError };
}

module.exports = { createAppointmentService, AppointmentError, maskPhone, publicStatus, ACTIVE_STATUSES };
