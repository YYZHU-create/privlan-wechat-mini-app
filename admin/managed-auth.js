"use strict";

// Authentication proves a provider identity. Business authorization remains
// attached to an explicitly provisioned, pre-existing business identity.
function denied(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createManagedAuth({ projectId, supabaseUrl, anonKey, createClient,
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
    const link = await resolveIdentityLink({ projectId, surface, providerUserId: user.id });
    if (!link || link.projectId !== projectId || link.surface !== surface ||
        link.providerUserId !== user.id || !link.businessUserId) {
      throw denied("MANAGED_AUTH_IDENTITY_NOT_LINKED");
    }
    const principal = await loadBusinessPrincipal({ surface, businessUserId: link.businessUserId });
    if (!principal || principal.id !== link.businessUserId || principal.status !== "active") {
      throw denied("MANAGED_AUTH_BUSINESS_ACCOUNT_INACTIVE");
    }
    // Provider email and user_metadata never grant a role or tenant membership.
    return { surface, businessUserId: principal.id, principal };
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
  return { login, resolve };
}

module.exports = { createManagedAuth };
