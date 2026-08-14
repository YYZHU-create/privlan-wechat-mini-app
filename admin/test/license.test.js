const test = require("node:test");
const assert = require("node:assert/strict");
const { createPortableTestDatabase } = require("../database");
const { createSaasService } = require("../saas-service");

process.env.NODE_ENV = "test";

test("redeems trial once, extends PRO from the current expiry and never stores plaintext codes", async () => {
  const db = await createPortableTestDatabase();
  const service = createSaasService({ db, licensePepper: "license-test-pepper" });
  try {
    const account = await service.register({ login: "license@example.com", password: "license-password", storeName: "License Store", template: "blank" });
    const scope = await service.resolveSession(account.session.token);
    const [trialA, trialB] = await service.generateLicenses({ planId: "TRIAL", durationHours: 24, count: 2 }, { id: "ops", requestId: "trial_batch" });
    const first = await service.redeemLicense(scope, trialA.code);
    assert.equal(first.planId, "TRIAL");
    await assert.rejects(() => service.redeemLicense(scope, trialB.code), error => error.code === "TRIAL_ALREADY_USED");
    const [proA, proB] = await service.generateLicenses({ planId: "PRO", durationHours: 720, count: 2 }, { id: "ops", requestId: "pro_batch" });
    const proFirst = await service.redeemLicense(scope, proA.code);
    const proSecond = await service.redeemLicense(scope, proB.code);
    assert.ok(new Date(proSecond.expiresAt) - new Date(proFirst.expiresAt) >= 719 * 3600000);
    const stored = JSON.stringify((await db.query("select * from license_codes")).rows);
    assert.doesNotMatch(stored, new RegExp(proA.code));
    assert.match((await service.listLicenses())[0].codeMasked, /^AT-\*{4}-\*{4}-/);
  } finally { await db.close(); }
});

test("allows only one concurrent redemption of a single-use code", async () => {
  const db = await createPortableTestDatabase();
  const service = createSaasService({ db, licensePepper: "concurrency-pepper" });
  try {
    const account = await service.register({ login: "race@example.com", password: "concurrent-password", storeName: "Race Store", template: "blank" });
    const scope = await service.resolveSession(account.session.token);
    const [license] = await service.generateLicenses({ planId: "PRO", durationHours: 720, count: 1 }, { id: "ops", requestId: "race_batch" });
    const results = await Promise.allSettled([service.redeemLicense(scope, license.code), service.redeemLicense(scope, license.code)]);
    assert.equal(results.filter(item => item.status === "fulfilled").length, 1);
    assert.equal(results.filter(item => item.status === "rejected").length, 1);
    assert.equal((await db.query("select count(*)::int count from license_redemptions where license_id=$1", [license.id])).rows[0].count, 1);
  } finally { await db.close(); }
});
