create table if not exists b1_auth_schema_probe (
  user_id uuid primary key,
  login_identifier text not null,
  password_hash text not null,
  tenant_id uuid not null,
  workspace_id uuid not null,
  token_hash text not null,
  csrf_token_hash text not null,
  expires_at timestamptz not null,
  constraint b1_auth_hashes_nonempty check (length(password_hash) > 0 and length(token_hash) > 0 and length(csrf_token_hash) > 0)
);
insert into b1_auth_schema_probe(user_id,login_identifier,password_hash,tenant_id,workspace_id,token_hash,csrf_token_hash,expires_at)
values(gen_random_uuid(),'b1-synthetic@example.com','scrypt$N=16384$r=8$p=1$synthetic','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','token-hash','csrf-hash',now()+interval '1 day');
