-- Existing sessions remain distinguishable from sessions minted by managed Auth.
-- No identities, passwords or existing business rows are rewritten.
alter table merchant_sessions add column auth_provider text not null default 'legacy'
  check (auth_provider in ('legacy', 'supabase'));
alter table operator_sessions add column auth_provider text not null default 'legacy'
  check (auth_provider in ('legacy', 'supabase'));
