"use strict";
function collectManagedAuthRequirements({ identitySql, sessionSql, provisioningSql }) {
  const required = new Map();
  function add(table, column) {
    if (table === "managed_auth_identity_links") return; // Created by 017.
    if (!required.has(table)) required.set(table, new Set());
    required.get(table).add(column);
  }
  for (const match of provisioningSql.matchAll(/insert\s+into\s+([a-z_]+)\s*\(([^)]+)\)/gi)) {
    for (const column of match[2].split(",")) add(match[1], column.trim());
  }
  for (const match of identitySql.matchAll(/references\s+([a-z_]+)\s*\(([a-z_]+)\)/gi)) add(match[1], match[2]);
  for (const match of sessionSql.matchAll(/alter\s+table\s+([a-z_]+)\s+add\s+column\s+auth_provider/gi)) add(match[1], "id");
  for (const column of ["id", "login_identifier", "status", "password_hash"]) add("users", column);
  for (const column of ["id", "email", "status", "role", "password_hash"]) add("operator_users", column);
  if (required.size < 10) throw new Error("AUTH_SCHEMA_REQUIREMENTS_INCOMPLETE");
  return Object.fromEntries([...required].sort().map(([table, columns]) => [table, [...columns].sort()]));
}
function evaluateManagedAuthSchema(requirements, columns) {
  if (!Array.isArray(columns)) throw new Error("AUTH_SCHEMA_CATALOG_NOT_VERIFIED");
  const found = new Set(columns.map(c => `${c.table_name}.${c.column_name}`));
  const missing = [];
  for (const [table, names] of Object.entries(requirements)) {
    for (const name of names) if (!found.has(`${table}.${name}`)) missing.push(`${table}.${name}`);
  }
  return { requiredTableCount: Object.keys(requirements).length,
    requiredColumnCount: Object.values(requirements).reduce((sum, names) => sum + names.length, 0),
    missingColumns: missing, requiredColumnsPresent: missing.length === 0,
    constraintCompatibility: "NOT_VERIFIED", defaultsCompatibility: "NOT_VERIFIED" };
}
module.exports = { collectManagedAuthRequirements, evaluateManagedAuthSchema };
