const crypto = require("node:crypto");
const { DateTime } = require("luxon");

const STATUSES = new Set(["pending", "confirmed", "completed", "cancelled", "no_show"]);

function sourceHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function integer(value, min, max, fallback = null) {
  const result = Number(value);
  return Number.isInteger(result) && result >= min && result <= max ? result : fallback;
}

function normalizeDocument(value) {
  if (!value || Number(value.version) !== 1) throw new Error("Legacy appointment export version must be 1");
  const sourceKind = value.sourceKind === "feishu_export" ? "feishu_export" : "normalized_json";
  const services = Array.isArray(value.services) ? value.services : [];
  const advisors = Array.isArray(value.advisors) ? value.advisors : [];
  const businessHours = Array.isArray(value.businessHours) ? value.businessHours : [];
  const appointments = Array.isArray(value.appointments) ? value.appointments : [];
  const errors = [];
  const ids = (rows, type) => {
    const seen = new Set();
    rows.forEach((row, index) => {
      const id = String(row?.sourceId || "").trim();
      if (!id) errors.push(`${type}[${index}] is missing sourceId`);
      else if (seen.has(id)) errors.push(`${type} contains duplicate sourceId ${id}`);
      seen.add(id);
    });
  };
  ids(services, "services"); ids(advisors, "advisors"); ids(appointments, "appointments");
  const serviceIds = new Set(services.map(item => String(item.sourceId || "")));
  const advisorIds = new Set(advisors.map(item => String(item.sourceId || "")));
  services.forEach(item => {
    if (!String(item.name || "").trim() || integer(item.durationMinutes, 5, 1440) === null) errors.push(`service ${item.sourceId || "?"} has invalid name or durationMinutes`);
    if (item.bufferMinutesOverride !== null && item.bufferMinutesOverride !== undefined && integer(item.bufferMinutesOverride, 0, 480) === null) errors.push(`service ${item.sourceId || "?"} has invalid bufferMinutesOverride`);
  });
  advisors.forEach(item => {
    if (!String(item.name || "").trim()) errors.push(`advisor ${item.sourceId || "?"} has an invalid name`);
    (item.serviceSourceIds || []).forEach(id => { if (!serviceIds.has(String(id))) errors.push(`advisor ${item.sourceId || "?"} references unknown service ${id}`); });
  });
  businessHours.forEach((item, index) => {
    if (integer(item.weekday, 0, 6) === null || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.startTime || "")) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(item.endTime || "")) || item.endTime <= item.startTime) errors.push(`businessHours[${index}] is invalid`);
  });
  appointments.forEach(item => {
    const start = DateTime.fromISO(String(item.startAt || ""), { setZone: true });
    if (!String(item.customerName || "").trim() || !/^1\d{10}$/.test(String(item.customerPhone || ""))) errors.push(`appointment ${item.sourceId || "?"} has invalid customer fields`);
    if (!serviceIds.has(String(item.serviceSourceId || ""))) errors.push(`appointment ${item.sourceId || "?"} references an unknown service`);
    if (!advisorIds.has(String(item.advisorSourceId || ""))) errors.push(`appointment ${item.sourceId || "?"} references an unknown advisor`);
    if (!start.isValid) errors.push(`appointment ${item.sourceId || "?"} has invalid startAt`);
    if (!STATUSES.has(String(item.status || "pending"))) errors.push(`appointment ${item.sourceId || "?"} has invalid status`);
  });
  return { sourceKind, services, advisors, businessHours, appointments, errors };
}

async function inspectImport({ db, publicStoreId, document, hash }) {
  const normalized = normalizeDocument(document);
  const store = (await db.query("select id,tenant_id,workspace_id,name from stores where public_store_id=$1", [String(publicStoreId || "")])).rows[0];
  if (!store) throw new Error("Target publicStoreId was not found");
  const prior = (await db.query("select id,created_at,report from appointment_import_runs where workspace_id=$1 and source_hash=$2 and dry_run=false", [store.workspace_id, hash])).rows[0];
  return {
    store,
    normalized,
    report: {
      sourceHash: hash,
      sourceKind: normalized.sourceKind,
      dryRun: true,
      alreadyImported: Boolean(prior),
      counts: { services: normalized.services.length, advisors: normalized.advisors.length, businessHours: normalized.businessHours.length, appointments: normalized.appointments.length },
      errors: normalized.errors,
      status: normalized.errors.length ? "invalid" : prior ? "already_imported" : "ready"
    }
  };
}

async function applyImport({ db, publicStoreId, document, hash }) {
  const inspected = await inspectImport({ db, publicStoreId, document, hash });
  if (inspected.normalized.errors.length) throw new Error(`Legacy appointment export is invalid: ${inspected.normalized.errors.join("; ")}`);
  if (inspected.report.alreadyImported) return { ...inspected.report, dryRun: false, status: "already_imported" };
  const { store, normalized } = inspected;
  return db.transaction(async tx => {
    await tx.query("select id from stores where id=$1 and tenant_id=$2 and workspace_id=$3 for update", [store.id, store.tenant_id, store.workspace_id]);
    const prior = (await tx.query("select id from appointment_import_runs where workspace_id=$1 and source_hash=$2 and dry_run=false", [store.workspace_id, hash])).rows[0];
    if (prior) return { ...inspected.report, dryRun: false, alreadyImported: true, status: "already_imported" };
    const scope = [store.tenant_id, store.workspace_id, store.id];
    const settings = (await tx.query("select timezone,default_buffer_minutes from appointment_settings where tenant_id=$1 and workspace_id=$2 and store_id=$3", scope)).rows[0];
    if (!settings) throw new Error("Target store has no appointment settings");
    const serviceMap = new Map(); const advisorMap = new Map();
    for (const item of normalized.services) {
      const name = String(item.name).trim().slice(0, 80);
      let row = (await tx.query("select * from appointment_services where tenant_id=$1 and workspace_id=$2 and store_id=$3 and name=$4 order by created_at limit 1", [...scope, name])).rows[0];
      if (!row) row = (await tx.query(`insert into appointment_services(id,tenant_id,workspace_id,store_id,name,description,duration_minutes,buffer_minutes_override,enabled,sort_order)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [crypto.randomUUID(), ...scope, name, String(item.description || "").slice(0, 500), Number(item.durationMinutes), item.bufferMinutesOverride ?? null, item.enabled !== false, integer(item.sortOrder, -10000, 10000, 0)])).rows[0];
      serviceMap.set(String(item.sourceId), row);
    }
    for (const item of normalized.advisors) {
      const name = String(item.name).trim().slice(0, 80);
      let row = (await tx.query("select * from appointment_advisors where tenant_id=$1 and workspace_id=$2 and store_id=$3 and name=$4 order by created_at limit 1", [...scope, name])).rows[0];
      if (!row) row = (await tx.query("insert into appointment_advisors(id,tenant_id,workspace_id,store_id,name,enabled,sort_order) values($1,$2,$3,$4,$5,$6,$7) returning *", [crypto.randomUUID(), ...scope, name, item.enabled !== false, integer(item.sortOrder, -10000, 10000, 0)])).rows[0];
      advisorMap.set(String(item.sourceId), row);
      const mappedServices = Array.isArray(item.serviceSourceIds) && item.serviceSourceIds.length ? item.serviceSourceIds : normalized.services.map(service => service.sourceId);
      for (const serviceSourceId of mappedServices) {
        const service = serviceMap.get(String(serviceSourceId));
        await tx.query("insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id) values($1,$2,$3,$4,$5) on conflict(advisor_id,service_id) do nothing", [...scope, row.id, service.id]);
      }
    }
    if (normalized.businessHours.length) {
      await tx.query("delete from appointment_business_hours where tenant_id=$1 and workspace_id=$2 and store_id=$3", scope);
      for (const item of normalized.businessHours) await tx.query("insert into appointment_business_hours(id,tenant_id,workspace_id,store_id,weekday,start_time,end_time,enabled) values($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), ...scope, Number(item.weekday), item.startTime, item.endTime, item.enabled !== false]);
    }
    let importedCustomers = 0; let importedAppointments = 0;
    for (const item of normalized.appointments) {
      const service = serviceMap.get(String(item.serviceSourceId)); const advisor = advisorMap.get(String(item.advisorSourceId));
      let customer = (await tx.query("select * from customers where tenant_id=$1 and workspace_id=$2 and store_id=$3 and source='import' and phone=$4 order by created_at limit 1", [...scope, String(item.customerPhone)])).rows[0];
      if (!customer) {
        customer = (await tx.query("insert into customers(id,tenant_id,workspace_id,store_id,source,name,phone,wechat_openid_hash) values($1,$2,$3,$4,'import',$5,$6,null) returning *", [crypto.randomUUID(), ...scope, String(item.customerName).trim().slice(0, 64), String(item.customerPhone)])).rows[0];
        importedCustomers += 1;
      }
      const start = DateTime.fromISO(String(item.startAt), { setZone: true }).toUTC();
      const duration = Number(service.duration_minutes); const buffer = service.buffer_minutes_override === null ? Number(settings.default_buffer_minutes) : Number(service.buffer_minutes_override);
      const serviceEnd = start.plus({ minutes: duration }); const occupiedUntil = serviceEnd.plus({ minutes: buffer });
      const idempotencyKey = `legacy:${hash.slice(0, 24)}:${String(item.sourceId).slice(0, 80)}`;
      const number = String(item.appointmentNumber || `IM${start.toFormat("yyLLdd")}${crypto.createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 8).toUpperCase()}`).slice(0, 80);
      const result = await tx.query(`insert into appointments(id,tenant_id,workspace_id,store_id,customer_id,service_id,advisor_id,appointment_number,status,start_at,service_end_at,occupied_until,duration_minutes_snapshot,buffer_minutes_snapshot,timezone_snapshot,customer_name_snapshot,customer_phone_snapshot,service_name_snapshot,advisor_name_snapshot,notes,source,idempotency_key)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'import',$21) on conflict(workspace_id,idempotency_key) do nothing returning id`, [crypto.randomUUID(), ...scope, customer.id, service.id, advisor.id, number, String(item.status || "pending"), start.toJSDate(), serviceEnd.toJSDate(), occupiedUntil.toJSDate(), duration, buffer, settings.timezone, String(item.customerName).trim().slice(0, 64), String(item.customerPhone), service.name, advisor.name, String(item.notes || "").slice(0, 1000), idempotencyKey]);
      importedAppointments += result.rows.length;
    }
    const report = { ...inspected.report, dryRun: false, alreadyImported: false, status: "completed", importedCustomers, importedAppointments };
    await tx.query(`insert into appointment_import_runs(id,tenant_id,workspace_id,store_id,source_kind,source_hash,dry_run,status,imported_customers,imported_appointments,report)
      values($1,$2,$3,$4,$5,$6,false,'completed',$7,$8,$9::jsonb)`, [crypto.randomUUID(), ...scope, normalized.sourceKind, hash, importedCustomers, importedAppointments, JSON.stringify(report)]);
    await tx.query(`insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata)
      values($1,$2,$3,'system','appointment_import','appointment.legacy_import','appointment_import',$4,$5,$6::jsonb)`, [crypto.randomUUID(), store.tenant_id, store.workspace_id, store.id, `appointment_import_${hash.slice(0, 12)}`, JSON.stringify({ sourceHash: hash, sourceKind: normalized.sourceKind, importedCustomers, importedAppointments })]);
    return report;
  });
}

module.exports = { applyImport, inspectImport, normalizeDocument, sourceHash };
