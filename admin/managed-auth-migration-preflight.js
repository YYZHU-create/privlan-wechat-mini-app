"use strict";
const { verifyPassword, verifyOperatorPassword } = require("./platform-store");

function reject(code) { const error = new Error(code); error.code = code; throw error; }

// Inputs are private server/local data. Return only the authorized identity plan.
// No provider writes, password export or email-only identity association occurs.
function verifyExistingAccountMigration({ projectId, providerOrigin, targetEmail,
  password, merchant, operator, providerAccountExists }) {
  if (!projectId || typeof projectId !== "string" || !providerOrigin ||
      typeof targetEmail !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail) ||
      typeof password !== "string" || !password) reject("AUTH_MIGRATION_INPUT_REQUIRED");
  let origin;
  try { origin = new URL(providerOrigin); } catch { reject("AUTH_MIGRATION_INVALID_PROVIDER"); }
  if (origin.protocol !== "https:" || origin.origin !== providerOrigin) reject("AUTH_MIGRATION_INVALID_PROVIDER");
  if (providerAccountExists !== false) reject("AUTH_MIGRATION_PROVIDER_ACCOUNT_NOT_CLEAR");
  if (!merchant?.id || !operator?.id || merchant.id === operator.id ||
      merchant.status !== "active" || operator.status !== "active" || operator.role !== "super_admin") {
    reject("AUTH_MIGRATION_BUSINESS_IDENTITIES_INVALID");
  }
  if (merchant.login_identifier?.trim().toLowerCase() !== targetEmail.trim().toLowerCase()) {
    reject("AUTH_MIGRATION_MERCHANT_IDENTIFIER_MISMATCH");
  }
  // Verify both privileged and merchant accounts independently. Never accept
  // one successful check as proof of ownership of the other business identity.
  let merchantVerified = false;
  try { merchantVerified = verifyPassword(password, merchant.password_hash); } catch { /* generic rejection */ }
  if (!merchantVerified) reject("AUTH_MIGRATION_ORIGINAL_PASSWORD_INVALID");
  if (!verifyOperatorPassword(password, operator.password_hash)) reject("AUTH_MIGRATION_ORIGINAL_PASSWORD_INVALID");
  return Object.freeze({ projectId, providerOrigin, email: targetEmail.trim().toLowerCase(),
    identities: Object.freeze([
      Object.freeze({ surface: "merchant", businessUserId: merchant.id }),
      Object.freeze({ surface: "operator", businessUserId: operator.id })
    ]), originalPasswordsVerified: true });
}

module.exports = { verifyExistingAccountMigration };
