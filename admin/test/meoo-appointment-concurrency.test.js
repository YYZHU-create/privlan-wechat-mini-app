const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createAppointmentService } = require("../appointment-service");
const { createMeooAppointmentRepository } = require("../meoo-appointment-repository");
const { createSupabaseAdapter } = require("../meoo-supabase-adapter");
const { createAppointmentFixture, cleanupFixture, scopedDatabase } = require("./meoo-live-fixtures");

if (process.env.MEOO_B1_LIVE) test("live Meoo booking uses the production AppointmentService path", async () => {
  const fixture = await createAppointmentFixture();
  const adapter = createSupabaseAdapter();
  const service = createAppointmentService({
    db: scopedDatabase(fixture),
    openIdHashKey: "b1-live-openid-hash-key-32-bytes!!",
    appointmentRepository: createMeooAppointmentRepository({ adapter })
  });
  const start = new Date(Date.now() + 86400000);
  start.setUTCMinutes(Math.ceil(start.getUTCMinutes() / 15) * 15, 0, 0);
  const input = phone => ({ publicStoreId: fixture.publicStoreId, customerName: "B1 synthetic customer", customerPhone: phone, openid: `b1-openid-${phone}`, serviceId: fixture.serviceId, advisorId: fixture.advisorId, startAt: start.toISOString(), idempotencyKey: crypto.randomUUID() });
  try {
    const results = await Promise.all([input("13900139000"), input("13700137000")].map(value => service.createAppointment(value).catch(error => error)));
    assert.equal(results.filter(result => result.number).length, 1);
    assert.equal(results.filter(result => result.code === "APPOINTMENT_CONFLICT").length, 1);
  } finally {
    await cleanupFixture(fixture);
  }
});
