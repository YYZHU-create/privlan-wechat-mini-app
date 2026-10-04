"use strict";
const { randomUUID } = require("node:crypto");

// Authentication proves a provider identity. Business authorization remains
// attached to an explicitly provisioned, pre-existing business identity.
function denied(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createManagedAuth({ projectId, supabaseUrl, anonKey, createClient, applicationOrigin,
  resolveIdentityLink, loadBusinessPrincipal }) {
  if (!projectId || !supabaseUrl || !anonKey ||
      typeof resolveIdentityLink !== "function" ||
      typeof loadBusinessPrincipal !== "function") {
    throw denied("MANAGED_AUTH_NOT_CONFIGURED");
  }
  const url = new URL(supabaseUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw denied("MANAGED_AUTH_INVALID_PROVIDER_URL");
  }
  const factory = createClient || require("@supabase/supabase-js").createClient;
  const client = () => factory(url.origin, anonKey, { auth: {
    persistSession: false, autoRefreshToken: false, detectSessionInUrl: false
  } });

  async function beginRegistration({ email, password }) {
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254 ||
        typeof password !== "string" || password.length < 8 || password.length > 128) {
      throw denied("MANAGED_AUTH_INVALID_REGISTRATION");
    }
    let callback;
    try {
      const origin = new URL(applicationOrigin);
      if (origin.protocol !== "https:" || origin.username || origin.password ||
          origin.pathname !== "/" || origin.search || origin.hash) throw new Error();
      callback = new URL("/auth/confirmation", origin).href;
    } catch { throw denied("MANAGED_AUTH_REGISTRATION_NOT_CONFIGURED"); }
    const scopedClient = client();
    let response;
    try { response = await scopedClient.auth.signUp({ email: normalizedEmail, password,
      // Provider profile label only; roles and business scope never come from metadata.
      options: { emailRedirectTo: callback, data: { username: `managed_${randomUUID().replace(/-/g, "")}` } } }); }
    catch { throw denied("MANAGED_AUTH_PROVIDER_UNAVAILABLE"); }
    // Existing-account replies remain indistinguishable from a confirmation request.
    if (response?.error && response.error.code !== "user_already_exists") {
      throw denied("MANAGED_AUTH_REGISTRATION_REJECTED");
    }
    if (response?.data?.session) {
      try { await scopedClient.auth.signOut({ scope: "local" }); } catch { /* No application session was issued. */ }
      throw denied("MANAGED_AUTH_EMAIL_CONFIRMATION_NOT_REQUIRED");
    }
    if (!response?.error && !response?.data?.user) throw denied("MANAGED_AUTH_REGISTRATION_REJECTED");
    return { emailVerificationRequired: true };
  }

  async function verifyRegistration(accessToken) {
    if (typeof accessToken !== "string" || !accessToken) throw denied("MANAGED_AUTH_INVALID_SESSION");
    let response;
    try { response = await client().auth.getUser(accessToken); }
    catch { throw denied("MANAGED_AUTH_PROVIDER_UNAVAILABLE"); }
    const user = response?.data?.user;
    if (response?.error || !user?.id) throw denied("MANAGED_AUTH_INVALID_SESSION");
    if (!user.email_confirmed_at || !Number.isFinite(Date.parse(user.email_confirmed_at)) ||
        typeof user.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) {
      throw denied("MANAGED_AUTH_EMAIL_NOT_VERIFIED");
    }
    // Private provisioning proof; no role, business ID or client metadata is trusted.
    return { projectId, providerOrigin: url.origin, providerUserId: user.id,
      email: user.email.trim().toLowerCase(), emailVerified: true };
  }

  async function resolve(accessToken, surface) {
    if (!["merchant", "operator"].includes(surface) ||
        typeof accessToken !== "string" || !accessToken) {
      throw denied("MANAGED_AUTH_INVALID_SESSION");
    }
    let response;
    try { response = await client().auth.getUser(accessToken); }
    catch { throw denied("MANAGED_AUTH_PROVIDER_UNAVAILABLE"); }
    const user = response?.data?.user;
    if (response?.error || !user?.id) throw denied("MANAGED_AUTH_INVALID_SESSION");
    const link = await resolveIdentityLink({ projectId, providerOrigin: url.origin, surface, providerUserId: user.id });
    if (!link || link.projectId !== projectId || link.providerOrigin !== url.origin || link.surface !== surface ||
        link.providerUserId !== user.id || !link.businessUserId) {
      throw denied("MANAGED_AUTH_IDENTITY_NOT_LINKED");
    }
    const principal = await loadBusinessPrincipal({ surface, businessUserId: link.businessUserId });
    if (!principal || principal.id !== link.businessUserId || principal.status !== "active") {
      throw denied("MANAGED_AUTH_BUSINESS_ACCOUNT_INACTIVE");
    }
    // Provider email and user_metadata never grant a role or tenant membership.
    return { surface, businessUserId: principal.id, principal, providerUserId: user.id };
  }

  async function login({ email, password, surface }) {
    if (!["merchant", "operator"].includes(surface) || typeof email !== "string" ||
        !email.trim() || typeof password !== "string" || !password) {
      throw denied("MANAGED_AUTH_INVALID_CREDENTIALS");
    }
    let response;
    try {
      response = await client().auth.signInWithPassword({ email: email.trim(), password });
    } catch { throw denied("MANAGED_AUTH_PROVIDER_UNAVAILABLE"); }
    const session = response?.data?.session;
    if (response?.error || !session?.access_token || !session?.refresh_token) {
      throw denied("MANAGED_AUTH_INVALID_CREDENTIALS");
    }
    const identity = await resolve(session.access_token, surface);
    // Private return value for the future server cookie layer, never API JSON/logs.
    return { identity, session: {
      accessToken: session.access_token, refreshToken: session.refresh_token,
      expiresAt: session.expires_at
    } };
  }
  async function refresh({ refreshToken, surface, businessUserId }) {
    if (!refreshToken || !businessUserId || !["merchant", "operator"].includes(surface)) {
      throw denied("MANAGED_AUTH_INVALID_SESSION");
    }
    let response;
    try { response = await client().auth.refreshSession({ refresh_token: refreshToken }); }
    catch { throw denied("MANAGED_AUTH_PROVIDER_UNAVAILABLE"); }
    const session = response?.data?.session;
    if (response?.error || !session?.access_token || !session?.refresh_token) {
      throw denied("MANAGED_AUTH_INVALID_SESSION");
    }
    const identity = await resolve(session.access_token, surface);
    if (identity.businessUserId !== businessUserId) throw denied("MANAGED_AUTH_IDENTITY_NOT_LINKED");
    return { identity, session: { accessToken: session.access_token,
      refreshToken: session.refresh_token, expiresAt: session.expires_at } };
  }

  async function authenticatedClient({ accessToken, refreshToken, surface, businessUserId }) {
    const identity = await resolve(accessToken, surface);
    if (!businessUserId || identity.businessUserId !== businessUserId || !refreshToken) {
      throw denied("MANAGED_AUTH_IDENTITY_NOT_LINKED");
    }
    const scopedClient = client();
    let response;
    try { response = await scopedClient.auth.setSession({ access_token: accessToken, refresh_token: refreshToken }); }
    catch { throw denied("MANAGED_AUTH_PROVIDER_UNAVAILABLE"); }
    if (response?.error || !response?.data?.session?.access_token) throw denied("MANAGED_AUTH_INVALID_SESSION");
    const actual = await resolve(response.data.session.access_token, surface);
    if (actual.businessUserId !== businessUserId) throw denied("MANAGED_AUTH_IDENTITY_NOT_LINKED");
    return scopedClient;
  }

  async function logout(input) {
    const scopedClient = await authenticatedClient(input);
    let response;
    try { response = await scopedClient.auth.signOut({ scope: "local" }); }
    catch { throw denied("MANAGED_AUTH_PROVIDER_UNAVAILABLE"); }
    if (response?.error) throw denied("MANAGED_AUTH_LOGOUT_FAILED");
    return { signedOut: true };
  }

  async function changePassword({ email, currentPassword, newPassword, surface, businessUserId }) {
    if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128 ||
        newPassword === currentPassword || !businessUserId) throw denied("MANAGED_AUTH_INVALID_PASSWORD");
    const verified = await login({ email, password: currentPassword, surface });
    const scopedClient = await authenticatedClient({ ...verified.session, surface, businessUserId: verified.identity.businessUserId });
    let proofSessionRevoked = false;
    const affectedBusinessIdentities = [{ surface, businessUserId }];
    try {
      if (verified.identity.businessUserId !== businessUserId) throw denied("MANAGED_AUTH_IDENTITY_NOT_LINKED");
      // Read the other explicit link before changing the shared provider password.
      // Inactive linked principals still need their outstanding sessions revoked.
      const otherSurface = surface === "merchant" ? "operator" : "merchant";
      const other = await resolveIdentityLink({ projectId, providerOrigin: url.origin,
        surface: otherSurface, providerUserId: verified.identity.providerUserId });
      if (other) {
        if (other.projectId !== projectId || other.providerOrigin !== url.origin ||
            other.surface !== otherSurface || other.providerUserId !== verified.identity.providerUserId ||
            !other.businessUserId) throw denied("MANAGED_AUTH_IDENTITY_NOT_LINKED");
        affectedBusinessIdentities.push({ surface: otherSurface, businessUserId: other.businessUserId });
      }
      let response;
      try { response = await scopedClient.auth.updateUser({ password: newPassword, current_password: currentPassword }); }
      catch { throw denied("MANAGED_AUTH_PROVIDER_UNAVAILABLE"); }
      if (response?.error) throw denied("MANAGED_AUTH_PASSWORD_CHANGE_FAILED");
    } finally {
      // Attempt cleanup on success and rejection, without replacing the first error.
      try { proofSessionRevoked = !(await scopedClient.auth.signOut({ scope: "local" }))?.error; }
      catch { proofSessionRevoked = false; }
    }
    return { passwordChanged: true, proofSessionRevoked, affectedBusinessIdentities };
  }
  return { login, resolve, refresh, logout, changePassword, beginRegistration, verifyRegistration };
}

module.exports = { createManagedAuth };
