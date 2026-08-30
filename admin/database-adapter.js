class DatabaseBackendError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = 500;
  }
}

function resolveDatabaseBackend(env = process.env) {
  const backend = String(env.ATELIER_DB_BACKEND || "native").trim().toLowerCase();
  if (backend !== "native" && backend !== "meoo") throw new DatabaseBackendError("DATABASE_BACKEND_INVALID", "ATELIER_DB_BACKEND must be native or meoo");
  return backend;
}

function createNativeDatabaseAdapter(db) {
  if (!db || typeof db.query !== "function" || typeof db.transaction !== "function") throw new TypeError("native database adapter requires query and transaction");
  return {
    kind: "native",
    query: db.query.bind(db),
    exec: typeof db.exec === "function" ? db.exec.bind(db) : undefined,
    transaction: db.transaction.bind(db),
    close: typeof db.close === "function" ? db.close.bind(db) : async () => {},
    health: typeof db.health === "function" ? db.health.bind(db) : async () => true
  };
}

module.exports = { DatabaseBackendError, resolveDatabaseBackend, createNativeDatabaseAdapter };
