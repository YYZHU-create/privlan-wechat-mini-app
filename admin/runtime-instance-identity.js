const crypto = require("node:crypto");

function createRuntimeInstanceIdentity({ bootId = crypto.randomUUID() } = {}) {
  const value = String(bootId || "").trim();
  if (!value) throw new Error("RUNTIME_BOOT_ID_REQUIRED");
  const instanceFingerprint = crypto.createHash("sha256").update(`feeldao-process-boot-v1\0${value}`).digest("hex").slice(0, 16);
  return { instanceIdAvailable: false, instanceFingerprint };
}

const RUNTIME_INSTANCE_IDENTITY = createRuntimeInstanceIdentity();

module.exports = { createRuntimeInstanceIdentity, RUNTIME_INSTANCE_IDENTITY };
