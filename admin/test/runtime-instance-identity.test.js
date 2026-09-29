const assert = require("node:assert/strict");
const test = require("node:test");
const { createRuntimeInstanceIdentity, RUNTIME_INSTANCE_IDENTITY } = require("../runtime-instance-identity");

test("runtime process identity returns only an ephemeral fingerprint", () => {
  assert.equal(RUNTIME_INSTANCE_IDENTITY.instanceIdAvailable, false);
  assert.match(RUNTIME_INSTANCE_IDENTITY.instanceFingerprint, /^[0-9a-f]{16}$/);
  const first = createRuntimeInstanceIdentity({ bootId: "boot-one" });
  const same = createRuntimeInstanceIdentity({ bootId: "boot-one" });
  const other = createRuntimeInstanceIdentity({ bootId: "boot-two" });
  assert.equal(first.instanceIdAvailable, false);
  assert.equal(first.instanceFingerprint, same.instanceFingerprint);
  assert.notEqual(first.instanceFingerprint, other.instanceFingerprint);
  assert.doesNotMatch(JSON.stringify(first), /boot-one/);
});