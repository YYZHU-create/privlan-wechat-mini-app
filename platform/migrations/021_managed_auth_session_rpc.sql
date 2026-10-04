-- Lease fencing for REST requests which do not share a PostgreSQL connection.
alter table managed_auth_session_state add column lease_token uuid;
alter table managed_auth_session_state add column lease_until timestamptz;
alter table managed_auth_session_state add column rotation_pending boolean not null default false;
alter table managed_auth_session_state add column revoked boolean not null default false;

create function managed_session_state_operation(p_action text,p_doc jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare r managed_auth_session_state%rowtype;
  v_id uuid := (p_doc->>'sessionId')::uuid;
  v_project text := p_doc->>'projectId'; v_origin text := p_doc->>'providerOrigin';
  v_surface text := p_doc->>'surface'; v_lease uuid := (p_doc->>'leaseToken')::uuid;
  v_business uuid; v_subject uuid;
begin
  if v_project is null or v_project not in ('asmhysidbg5g','g8o5cv1om41o') or v_id is null
    or v_surface is null or v_surface not in ('merchant','operator') then raise exception 'MANAGED_SESSION_BINDING_INVALID'; end if;
  if p_action='insert' then
    v_business:=(p_doc->>'businessUserId')::uuid; v_subject:=(p_doc->>'providerUserId')::uuid;
    if not exists(select 1 from managed_auth_identity_links l where l.project_id=v_project and l.provider_origin=v_origin
      and l.surface=v_surface and l.provider_user_id=v_subject and
      ((v_surface='merchant' and l.merchant_user_id=v_business and exists(select 1 from merchant_sessions s where s.id=v_id and s.user_id=v_business and s.auth_provider='supabase' and s.revoked_at is null and s.expires_at>clock_timestamp()))
       or(v_surface='operator' and l.operator_user_id=v_business and exists(select 1 from operator_sessions s where s.id=v_id and s.operator_id=v_business and s.auth_provider='supabase' and s.revoked_at is null and s.expires_at>clock_timestamp()))))
      then raise exception 'MANAGED_SESSION_BINDING_INVALID'; end if;
    insert into managed_auth_session_state(session_id,project_id,provider_origin,surface,provider_user_id,business_user_id,
      merchant_session_id,operator_session_id,issued_at_ms,deadline_ms,encrypted_state)
      values(v_id,v_project,v_origin,v_surface,v_subject,v_business,
        case when v_surface='merchant' then v_id end,case when v_surface='operator' then v_id end,
        (p_doc->>'issuedAt')::bigint,(p_doc->>'deadline')::bigint,p_doc->>'encryptedState');
    return jsonb_build_object('saved',true);
  end if;
  select * into r from managed_auth_session_state where session_id=v_id and project_id=v_project
    and provider_origin=v_origin and surface=v_surface for update;
  if not found or r.revoked or r.deadline_ms<=floor(extract(epoch from clock_timestamp())*1000)::bigint then return null; end if;
  if (v_surface='merchant' and not exists(select 1 from merchant_sessions s where s.id=v_id and s.user_id=r.business_user_id and s.auth_provider='supabase' and s.revoked_at is null and s.expires_at>clock_timestamp()))
    or(v_surface='operator' and not exists(select 1 from operator_sessions s where s.id=v_id and s.operator_id=r.business_user_id and s.auth_provider='supabase' and s.revoked_at is null and s.expires_at>clock_timestamp())) then return null; end if;
  if p_action='claim' then
    if v_lease is null then raise exception 'MANAGED_SESSION_LOCK_NOT_OWNED'; end if;
    if r.lease_token is not null and r.lease_until>clock_timestamp() then raise exception 'MANAGED_SESSION_BUSY'; end if;
    if r.rotation_pending then
      update managed_auth_session_state set revoked=true where session_id=v_id; return null;
    end if;
    update managed_auth_session_state set lease_token=v_lease,lease_until=clock_timestamp()+interval '60 seconds' where session_id=v_id;
    return jsonb_build_object('projectId',r.project_id,'providerOrigin',r.provider_origin,'sessionId',r.session_id,'surface',r.surface,
      'businessUserId',r.business_user_id,'providerUserId',r.provider_user_id,'issuedAt',r.issued_at_ms,'deadline',r.deadline_ms,'encryptedState',r.encrypted_state);
  end if;
  if v_lease is null or r.lease_token is distinct from v_lease or r.lease_until<=clock_timestamp() then raise exception 'MANAGED_SESSION_LOCK_NOT_OWNED'; end if;
  if p_action='begin_rotation' then
    update managed_auth_session_state set rotation_pending=true where session_id=v_id;
  elsif p_action='save' then
    if not r.rotation_pending then raise exception 'MANAGED_SESSION_ROTATION_NOT_STARTED'; end if;
    update managed_auth_session_state set encrypted_state=p_doc->>'encryptedState',rotation_pending=false where session_id=v_id;
  elsif p_action='release' then
    update managed_auth_session_state set revoked=rotation_pending,lease_token=null,lease_until=null where session_id=v_id;
  else raise exception 'MANAGED_SESSION_OPERATION_INVALID'; end if;
  return jsonb_build_object('saved',true);
end $$;
revoke all on function managed_session_state_operation(text,jsonb) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then revoke all on function managed_session_state_operation(text,jsonb) from anon; end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then revoke all on function managed_session_state_operation(text,jsonb) from authenticated; end if;
  if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function managed_session_state_operation(text,jsonb) to service_role; end if;
end $$;
