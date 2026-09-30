const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { hashPassword, verifyPassword, verifyOperatorPassword } = require("../platform-store");
const { createSaasService } = require("../saas-service");

function legacyOperatorHash(password, overrides = {}) {
  const salt = overrides.salt || Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const params = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024, ...(overrides.params || {}) };
  const derivedKey = crypto.scryptSync(String(password), salt, overrides.derivedKeyBytes || 32, params);
  return `$scrypt$N=${params.N},r=${params.r},p=${params.p}$${salt.toString("base64url")}$${derivedKey.toString("base64url")}`;
}

test("operator password verifier preserves the current two-part format", () => {
  const stored = hashPassword("current-operator-password");
  assert.equal(verifyOperatorPassword("current-operator-password", stored), true);
  assert.equal(verifyOperatorPassword("wrong-password", stored), false);
  assert.equal(verifyPassword("current-operator-password", stored), true);
});

test("operator password verifier accepts the fixed legacy five-part format", () => {
  const stored = legacyOperatorHash("legacy-operator-password");
  assert.equal(verifyOperatorPassword("legacy-operator-password", stored), true);
  assert.equal(verifyOperatorPassword("wrong-password", stored), false);
  assert.equal(verifyPassword("legacy-operator-password", stored), false);
});

test("operator password verifier rejects non-canonical or unsupported formats", () => {
  const valid = legacyOperatorHash("legacy-operator-password");
  const current = hashPassword("current-operator-password");
  const [currentSalt, currentHash] = current.split(".");
  const malformed = [
    "",
    "salt.hash.extra",
    "not-a-password-hash",
    `${currentSalt.slice(0, -2)}.${currentHash}`,
    `${currentSalt}.${currentHash.slice(0, -2)}`,
    `${currentSalt.replace(/=$/, "A")}.${currentHash}`,
    valid.replace("N=16384", "N=32768"),
    valid.replace("r=8", "r=4"),
    valid.replace("p=1", "p=2"),
    valid.replace(/\$[A-Za-z0-9_-]{22}\$/, "$short$"),
    `${valid}x`,
    valid.replace(/.$/, "="),
    "$scrypt$N=16384,r=8,p=1$______________________$___________________________________________"
  ];
  for (const stored of malformed) assert.equal(verifyOperatorPassword("legacy-operator-password", stored), false, stored);
});

test("operator service uses legacy compatibility only for operator credentials", async () => {
  const sessions = [];
  const audits = [];
  const operatorRepository = {
    async findOperatorByEmail(email) {
      return {
        id: "operator-legacy",
        email,
        display_name: "Legacy Operator",
        password_hash: legacyOperatorHash("legacy-operator-password"),
        role: "owner",
        status: "active"
      };
    },
    async createSession(session) { sessions.push(session); },
    async audit(event) { audits.push(event); }
  };
  const service = createSaasService({ db: {}, operatorRepository });

  const result = await service.operatorLogin("operator@example.com", "legacy-operator-password", { requestId: "compat-test" });
  assert.equal(result.user.role, "owner");
  assert.equal(sessions.length, 1);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "operator.login");

  await assert.rejects(
    service.operatorLogin("operator@example.com", "wrong-password", { requestId: "compat-test-wrong" }),
    error => error?.status === 401 && error?.code === "OPS_INVALID_CREDENTIALS"
  );
  assert.equal(sessions.length, 1);
  assert.equal(audits.length, 1);
});
