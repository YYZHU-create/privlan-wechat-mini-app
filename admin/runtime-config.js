const { resolveDatabaseBackend } = require("./database-adapter");

function validBase64Key(value) {
  try { return Buffer.from(String(value || ""), "base64").length === 32; }
  catch (error) { return false; }
}

function validateProductionEnvironment(env = process.env) {
  if (env.NODE_ENV !== "production") return { ok: true, mode: env.NODE_ENV || "development" };
  const missing = [];
  if (!/^postgres(?:ql)?:\/\//i.test(String(env.DATABASE_URL || ""))) missing.push("DATABASE_URL");
  if (String(env.ATELIER_LICENSE_PEPPER || "").length < 32) missing.push("ATELIER_LICENSE_PEPPER");
  if (!validBase64Key(env.ATELIER_MASTER_KEY)) missing.push("ATELIER_MASTER_KEY");
  if (!String(env.ATELIER_OPS_EMAIL || "").includes("@")) missing.push("ATELIER_OPS_EMAIL");
  if (String(env.ATELIER_OPS_PASSWORD || "").length < 12) missing.push("ATELIER_OPS_PASSWORD");
  if (String(env.ATELIER_APPOINTMENT_GATEWAY_TOKEN || "").length < 32) missing.push("ATELIER_APPOINTMENT_GATEWAY_TOKEN");
  if (Buffer.byteLength(String(env.ATELIER_OPENID_HASH_KEY || "")) < 32) missing.push("ATELIER_OPENID_HASH_KEY");
  if (missing.length) throw new Error(`生产环境缺少或错误配置：${missing.join("、")}`);
  return { ok: true, mode: "production" };
}

function validateDatabaseBackend(env = process.env) {
  let backend;
  try { backend = resolveDatabaseBackend(env); }
  catch (error) { throw new Error(error.message); }
  if (backend === "meoo") {
    if (!/^postgres(?:ql)?:\/\//i.test(String(env.DATABASE_URL || ""))) throw new Error("DATABASE_URL is required for ATELIER Auth and Session");
    if (!/^https:\/\//i.test(String(env.SUPABASE_URL || ""))) throw new Error("SUPABASE_URL is required for Meoo backend");
    if (!String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for Meoo backend");
  }
  return backend;
}

module.exports = { validateProductionEnvironment, validateDatabaseBackend, validBase64Key };
