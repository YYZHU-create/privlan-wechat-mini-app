const crypto = require("node:crypto");

function scopeQuery(scope, extra = []) {
  const values = [["tenant_id", scope?.tenantId], ["workspace_id", scope?.workspaceId], ["store_id", scope?.storeId]];
  return [...values, ...extra].filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=eq.${encodeURIComponent(String(value))}`).join("&");
}

function maskPhone(phone) {
  const value = String(phone || "");
  return value.length >= 7 ? `${value.slice(0, 3)}****${value.slice(-4)}` : value;
}

function anonymousName(id) { return `微信用户 ${String(id || "").replace(/-/g, "").slice(0, 4).toUpperCase()}`; }
function publicStatus(status) { return ({ pending: "待确认", confirmed: "已确认", completed: "已完成", cancelled: "已取消", no_show: "未到店" })[status] || status; }

function createMeooCustomerRepository({ adapter } = {}) {
  if (!adapter || typeof adapter.readResource !== "function") throw new TypeError("Meoo customer repository requires a resource adapter");
  async function rows(table, scope, query = "") { const result = await adapter.readResource(table, query || scopeQuery(scope)); return Array.isArray(result) ? result : []; }

  async function list(scope, query = {}) {
    const all = await rows("customers", scope);
    const tags = await rows("customer_memberships", scope, `${scopeQuery(scope)}&status=eq.active&select=customer_id`);
    const memberIds = new Set(tags.map(row => String(row.customer_id)));
    const q = String(query.q || "").trim().slice(0, 80).toLowerCase();
    let filtered = all.filter(row => (!q || [row.display_name, row.name, row.phone, row.id].some(value => String(value || "").toLowerCase().includes(q))) && (!query.source || row.source === query.source) && (query.identity !== "member" || memberIds.has(String(row.id))) && (query.identity !== "customer" || Number(row.order_count) > 0));
    const sort = String(query.sort || "activity");
    filtered.sort((a, b) => {
      const av = sort === "spend" ? Number(a.total_spend_fen) : sort === "orders" ? Number(a.order_count) : sort === "newest" ? new Date(a.created_at).getTime() : new Date(a.last_seen_at || a.created_at).getTime();
      const bv = sort === "spend" ? Number(b.total_spend_fen) : sort === "orders" ? Number(b.order_count) : sort === "newest" ? new Date(b.created_at).getTime() : new Date(b.last_seen_at || b.created_at).getTime();
      return bv - av;
    });
    const page = Math.max(1, Number(query.page) || 1); const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25));
    return { items: filtered.slice((page - 1) * pageSize, page * pageSize).map(row => ({ id: row.id, name: row.display_name || row.name || anonymousName(row.id), phoneMasked: maskPhone(row.phone), source: row.source, isMember: memberIds.has(String(row.id)), orderCount: Number(row.order_count || 0), totalSpendFen: Number(row.total_spend_fen || 0), appointmentCount: Number(row.appointment_count || 0), createdAt: row.created_at, lastSeenAt: row.last_seen_at })), page, pageSize, total: filtered.length };
  }

  async function stats(scope) {
    const [customers, memberships] = await Promise.all([rows("customers", scope), rows("customer_memberships", scope, `${scopeQuery(scope)}&status=eq.active&select=customer_id`)]);
    const cutoff = Date.now() - 30 * 86400000;
    return { total: customers.length, customers: customers.filter(row => Number(row.order_count) > 0).length, members: memberships.length, new30Days: customers.filter(row => new Date(row.created_at).getTime() >= cutoff).length };
  }

  async function get360(scope, customerId) {
    const customer = (await rows("customers", scope, `${scopeQuery(scope, [["id", customerId]])}&limit=1`)).find(row => String(row.id) === String(customerId));
    if (!customer) throw Object.assign(new Error("客户不存在"), { status: 404, code: "CUSTOMER_NOT_FOUND" });
    const appointments = await rows("appointments", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&order=start_at.desc&limit=200`);
    const orders = await rows("orders", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&order=created_at.desc&limit=200`);
    const events = await rows("customer_events", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&order=occurred_at.desc&limit=200`);
    const links = await rows("customer_tag_links", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&select=tag_id`);
    const notes = await rows("customer_notes", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&order=created_at.desc&limit=200`);
    const memberships = await rows("customer_memberships", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&status=eq.active&limit=1`);
    const points = await rows("customer_points_accounts", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&limit=1`);
    const pointLedger = await rows("customer_points_ledger", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&order=created_at.desc&limit=200`);
    const tagIds = links.map(row => row.tag_id).filter(Boolean); const tagRows = tagIds.length ? await rows("customer_tags", scope, `${scopeQuery(scope)}&id=in.(${tagIds.map(value => encodeURIComponent(String(value))).join(",")})`) : [];
    const levelIds = memberships.map(row => row.level_id).filter(Boolean); const levels = levelIds.length ? await rows("membership_levels", scope, `${scopeQuery(scope)}&id=in.(${levelIds.map(value => encodeURIComponent(String(value))).join(",")})`) : [];
    const level = levels.find(row => String(row.id) === String(memberships[0]?.level_id));
    const membership = memberships[0] ? { ...memberships[0], level_id: memberships[0].level_id, level_name: level?.name || null, level_order: level?.level_order || null } : null;
    const appointmentViews = appointments.map(row => ({ id: row.id, number: row.appointment_number, startAt: row.start_at, serviceName: row.service_name_snapshot, advisorName: row.advisor_name_snapshot, status: row.status, statusLabel: publicStatus(row.status) }));
    const orderViews = orders.map(row => ({ id: row.id, orderNo: row.order_no, status: row.status, paymentStatus: row.payment_status, amountFen: Number(row.amount_fen || 0), createdAt: row.created_at }));
    const eventViews = events.map(row => ({ type: row.event_type, source: row.source, resourceType: row.resource_type, resourceId: row.resource_id, occurredAt: row.occurred_at }));
    const noteViews = notes.map(row => ({ id: row.id, authorUserId: row.author_user_id, content: row.content, createdAt: row.created_at }));
    const pointsData = { balance: Number(points[0]?.balance || 0), ledger: pointLedger };
    const view = { id: customer.id, name: customer.display_name || customer.name || anonymousName(customer.id), source: customer.source, createdAt: customer.created_at, firstSeenAt: customer.first_seen_at, lastSeenAt: customer.last_seen_at, orderCount: Number(customer.order_count || 0), totalSpendFen: Number(customer.total_spend_fen || 0), appointmentCount: Number(customer.appointment_count || 0), phoneMasked: maskPhone(customer.phone), tags: tagRows, notes: noteViews, events: eventViews, orders: orderViews, appointments: appointmentViews, membership, points: pointsData.balance };
    return { ...view, customer: view, timeline: eventViews, summary: { appointmentCount: view.appointmentCount, orderCount: view.orderCount, membershipStatus: membership?.status || null, pointsBalance: pointsData.balance, lastActivityAt: eventViews[0]?.occurredAt || customer.last_seen_at || null } };
  }

  async function get(scope, customerId) {
    const view = await get360(scope, customerId);
    return { ...view.customer, customer: undefined, timeline: undefined, summary: undefined };
  }

  async function membership(scope, customerId) {
    const row = (await rows("customer_memberships", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&status=eq.active&limit=1`))[0];
    if (!row) return null;
    const level = row.level_id ? (await rows("membership_levels", scope, `${scopeQuery(scope, [["id", row.level_id]])}&limit=1`))[0] : null;
    return { id: row.id, status: row.status, joined_at: row.joined_at, updated_at: row.updated_at, level_id: row.level_id, level_name: level?.name || null, level_order: level?.level_order || null, growth_threshold: level?.growth_threshold || null };
  }

  async function levels(scope) {
    const values = await rows("membership_levels", scope, `${scopeQuery(scope)}&order=level_order.asc`);
    return values.map(row => ({ id: row.id, name: row.name, level_order: Number(row.level_order), growth_threshold: Number(row.growth_threshold || 0), enabled: row.enabled, benefits: row.benefits || {} }));
  }

  async function program(scope) {
    const row = (await rows("membership_programs", scope, `${scopeQuery(scope)}&limit=1`))[0];
    return row ? { id: row.id, enabled: row.enabled, points_enabled: row.points_enabled, created_at: row.created_at, updated_at: row.updated_at } : null;
  }

  async function points(scope, customerId) {
    const [accounts, ledger] = await Promise.all([
      rows("customer_points_accounts", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&limit=1`),
      rows("customer_points_ledger", scope, `${scopeQuery(scope, [["customer_id", customerId]])}&order=created_at.desc&limit=200`)
    ]);
    return { balance: Number(accounts[0]?.balance || 0), ledger };
  }

  return { list, stats, get, get360, membership, levels, program, points };
}

function createMeooAppointmentReadRepository({ adapter } = {}) {
  if (!adapter || typeof adapter.readResource !== "function") throw new TypeError("Meoo appointment repository requires a resource adapter");
  async function rows(table, scope, query = "") { const result = await adapter.readResource(table, query || scopeQuery(scope)); return Array.isArray(result) ? result : []; }
  async function stats(scope) { const [appointments, customers] = await Promise.all([rows("appointments", scope), rows("customers", scope)]); const now = new Date(); const day = new Date(now); day.setHours(0, 0, 0, 0); const week = new Date(day); week.setDate(week.getDate() + (7 - week.getDay())); return { today: appointments.filter(row => new Date(row.start_at) >= day && new Date(row.start_at) < new Date(day.getTime() + 86400000)).length, week: appointments.filter(row => new Date(row.start_at) >= day && new Date(row.start_at) < week).length, pending: appointments.filter(row => row.status === "pending").length, customers: customers.length }; }
  async function listAppointments(scope, filters = {}) { const all = await rows("appointments", scope); const filtered = all.filter(row => (!filters.status || row.status === filters.status) && (!filters.serviceId || row.service_id === filters.serviceId) && (!filters.advisorId || row.advisor_id === filters.advisorId) && (!filters.q || [row.customer_name_snapshot, row.customer_phone_snapshot, row.appointment_number].some(value => String(value || "").toLowerCase().includes(String(filters.q).toLowerCase()))) && (!filters.dateFrom || new Date(row.start_at) >= new Date(filters.dateFrom)) && (!filters.dateTo || new Date(row.start_at) < new Date(`${filters.dateTo}T23:59:59.999Z`))); filtered.sort((a, b) => new Date(b.start_at) - new Date(a.start_at)); return filtered.slice(0, 250).map(row => ({ id: row.id, number: row.appointment_number, startAt: row.start_at, customerName: row.customer_name_snapshot, customerPhoneMasked: maskPhone(row.customer_phone_snapshot), serviceName: row.service_name_snapshot, advisorName: row.advisor_name_snapshot, status: row.status, statusLabel: publicStatus(row.status), source: row.source })); }
  async function listServices(scope) { const rowsData = await rows("appointment_services", scope, `${scopeQuery(scope)}&order=sort_order.asc`); return rowsData.map(row => ({ id: row.id, name: row.name, description: row.description || "", durationMinutes: Number(row.duration_minutes), bufferMinutesOverride: row.buffer_minutes_override === null ? null : Number(row.buffer_minutes_override), enabled: row.enabled, sortOrder: Number(row.sort_order || 0) })); }
  async function listAdvisors(scope) { const rowsData = await rows("appointment_advisors", scope, `${scopeQuery(scope)}&order=sort_order.asc`); return rowsData.map(row => ({ id: row.id, staffId: row.staff_id || null, name: row.name, enabled: row.enabled, sortOrder: Number(row.sort_order || 0) })); }
  async function getSettings(scope) {
    const row = (await rows("appointment_settings", scope, `${scopeQuery(scope)}&limit=1`))[0];
    return row ? { timezone: row.timezone, slotIntervalMinutes: Number(row.slot_interval_minutes), defaultBufferMinutes: Number(row.default_buffer_minutes), maxAdvanceDays: Number(row.max_advance_days), bookingEnabled: row.booking_enabled } : null;
  }
  async function listHours(scope) {
    const rowsData = await rows("appointment_business_hours", scope, `${scopeQuery(scope)}&order=weekday.asc,start_time.asc`);
    return rowsData.map(row => ({ id: row.id, weekday: Number(row.weekday), startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5), enabled: row.enabled }));
  }
  async function listStaff(scope) {
    const tenantWorkspace = `tenant_id=eq.${encodeURIComponent(String(scope.tenantId))}&workspace_id=eq.${encodeURIComponent(String(scope.workspaceId))}`;
    const staffRows = await adapter.readResource("staff_members", tenantWorkspace);
    const assignments = await rows("staff_store_assignments", scope);
    const advisors = await rows("appointment_advisors", scope);
    const mappings = await rows("appointment_advisor_services", scope);
    const services = await rows("appointment_services", scope);
    const assignmentByStaffId = new Map((assignments || []).map(row => [String(row.staff_id), row]));
    const advisorByStaffId = new Map((advisors || []).filter(row => row.staff_id).map(row => [String(row.staff_id), row]));
    const serviceById = new Map((services || []).map(row => [String(row.id), row]));
    return (staffRows || []).filter(row => assignmentByStaffId.has(String(row.id))).map(row => {
      const assignment = assignmentByStaffId.get(String(row.id));
      const advisor = advisorByStaffId.get(String(row.id));
      const staffServices = advisor ? (mappings || []).filter(item => String(item.advisor_id) === String(advisor.id)).map(item => serviceById.get(String(item.service_id))).filter(Boolean).map(item => ({ id: item.id, name: item.name })) : [];
      return { id: row.id, displayName: row.display_name, avatarUrl: row.avatar_url || "", title: row.title || "", status: row.status, publicVisible: row.public_visible, advisorId: advisor?.id || null, assignmentStatus: assignment?.status || null, services: staffServices };
    }).sort((left, right) => `${left.status || ""}:${left.displayName || ""}`.localeCompare(`${right.status || ""}:${right.displayName || ""}`));
  }
  async function requireStaff(scope, staffId) {
    const staff = (await listStaff(scope)).find(item => String(item.id) === String(staffId));
    if (!staff) throw Object.assign(new Error("员工不存在"), { status: 404, code: "STAFF_NOT_FOUND" });
    return staff;
  }
  async function requireStaffAssignment(scope, staffId) {
    const assignment = (await rows("staff_store_assignments", scope, `${scopeQuery(scope, [["staff_id", staffId]])}&limit=1`))[0];
    if (!assignment) throw Object.assign(new Error("员工不存在"), { status: 404, code: "STAFF_NOT_FOUND" });
    return assignment;
  }
  async function listStaffSchedules(scope, staffId) {
    await requireStaffAssignment(scope, staffId);
    const rowsData = await rows("staff_schedules", scope, `${scopeQuery(scope, [["staff_id", staffId]])}&order=weekday.asc,start_time.asc`);
    return rowsData.map(row => ({ id: row.id, storeId: row.store_id, staffId: row.staff_id, weekday: Number(row.weekday), startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5), enabled: row.enabled }));
  }
  async function listStaffLeaves(scope, staffId) {
    await requireStaffAssignment(scope, staffId);
    const rowsData = await rows("staff_leaves", scope, `${scopeQuery(scope, [["staff_id", staffId]])}&order=start_at.desc`);
    return rowsData.map(row => ({ id: row.id, storeId: row.store_id, staffId: row.staff_id, startAt: row.start_at, endAt: row.end_at, reason: row.reason || "" }));
  }
  async function getStaff(scope, staffId) {
    const staff = await requireStaff(scope, staffId);
    return { ...staff, schedules: await listStaffSchedules(scope, staffId), leaves: await listStaffLeaves(scope, staffId) };
  }
  async function getAppointment(scope, id) {
    const row = (await rows("appointments", scope, `${scopeQuery(scope, [["id", id]])}&limit=1`))[0];
    if (!row) throw Object.assign(new Error("预约不存在"), { status: 404, code: "APPOINTMENT_NOT_FOUND" });
    return { id: row.id, number: row.appointment_number, customerId: row.customer_id, customerName: row.customer_name_snapshot, customerPhone: maskPhone(row.customer_phone_snapshot), storeName: row.store_name || scope.storeName || scope.workspace?.storeName || null, storeId: row.store_id, serviceName: row.service_name_snapshot, advisorName: row.advisor_name_snapshot, startAt: row.start_at, serviceEndAt: row.service_end_at, occupiedUntil: row.occupied_until, durationMinutes: Number(row.duration_minutes_snapshot), bufferMinutes: Number(row.buffer_minutes_snapshot), timezone: row.timezone_snapshot, notes: row.notes, source: row.source, status: row.status, statusLabel: publicStatus(row.status), createdAt: row.created_at };
  }
  async function timeline(scope, id) {
    const appointment = (await rows("appointments", scope, `${scopeQuery(scope, [["id", id]])}&select=id,customer_id&limit=1`))[0];
    if (!appointment) throw Object.assign(new Error("预约不存在"), { status: 404, code: "APPOINTMENT_NOT_FOUND" });
    const [events, audits] = await Promise.all([
      rows("customer_events", scope, `${scopeQuery(scope, [["customer_id", appointment.customer_id]])}&order=occurred_at.desc&limit=200`),
      rows("audit_events", scope, `${scopeQuery(scope, [["resource_id", id]])}&resource_type=eq.appointment&order=created_at.desc&limit=200`)
    ]);
    return [...events.map(row => ({ type: row.event_type, source: row.source, resourceType: row.resource_type, resourceId: row.resource_id, metadata: row.metadata || {}, occurredAt: row.occurred_at })), ...audits.map(row => ({ type: row.action, source: row.actor_type, resourceType: row.resource_type, resourceId: row.resource_id, metadata: row.metadata || {}, occurredAt: row.created_at }))].sort((a, b) => new Date(b.occurredAt) - new Date(a.occurredAt));
  }
  return { stats, listAppointments, listServices, listAdvisors, getSettings, listHours, listStaff, getStaff, listStaffSchedules, listStaffLeaves, getAppointment, timeline };
}

module.exports = { createMeooCustomerRepository, createMeooAppointmentReadRepository };
