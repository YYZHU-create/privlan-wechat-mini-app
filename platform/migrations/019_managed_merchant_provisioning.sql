-- Server-only atomic registration. The application verifies provider email first.
create function provision_managed_merchant(
  p_project text, p_origin text, p_subject uuid, p_email text,
  p_store_name text, p_contact text, p_document jsonb, p_template text, p_request_id text
) returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_user uuid := gen_random_uuid(); v_tenant uuid := gen_random_uuid();
  v_workspace uuid := gen_random_uuid(); v_store uuid := gen_random_uuid();
  v_subscription uuid := gen_random_uuid(); v_service uuid := gen_random_uuid();
  v_advisor uuid := gen_random_uuid(); v_staff uuid := gen_random_uuid();
  v_public text := 'store_public_' || replace(gen_random_uuid()::text,'-','');
begin
  if p_project is null or length(p_project) not between 1 and 100
     or p_origin is null or p_origin !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
     or p_subject is null or p_email is null or length(p_email) > 64
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_store_name is null or length(p_store_name) not between 2 and 64
     or p_document is null or jsonb_typeof(p_document) <> 'object'
     or p_template is null or p_template not in ('retail','service','restaurant','education','studio','blank')
     or p_request_id is null or length(p_request_id) not between 1 and 200 then
    raise exception using errcode='22023', message='Invalid provisioning input';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_project || '|' || p_origin || '|' || p_subject::text,0));
  if exists(select 1 from managed_auth_identity_links where project_id=p_project and provider_origin=p_origin
      and surface='merchant' and provider_user_id=p_subject) then
    return jsonb_build_object('alreadyProvisioned',true);
  end if;
  if exists(select 1 from users where login_identifier=lower(trim(p_email))) then
    raise exception using errcode='23505', message='Existing business account requires explicit migration';
  end if;
  insert into tenants(id,name,status) values(v_tenant,p_store_name,'trial');
  insert into users(id,login_identifier,password_hash,display_name)
    values(v_user,lower(trim(p_email)),'!managed-auth',nullif(p_contact,''));
  insert into workspaces(id,tenant_id,name,plan_id) values(v_workspace,v_tenant,p_store_name,'TRIAL');
  insert into stores(id,tenant_id,workspace_id,name,channel_mode,status,public_store_id)
    values(v_store,v_tenant,v_workspace,p_store_name,'shared','draft',v_public);
  insert into memberships(tenant_id,workspace_id,user_id,role) values(v_tenant,v_workspace,v_user,'owner');
  insert into workspace_configs(workspace_id,tenant_id,store_id,document) values(v_workspace,v_tenant,v_store,p_document);
  insert into subscriptions(id,tenant_id,workspace_id,plan_id,status,source,metadata)
    values(v_subscription,v_tenant,v_workspace,'TRIAL','inactive','registration','{"trialUsed":false}'::jsonb);
  insert into appointment_settings(tenant_id,workspace_id,store_id) values(v_tenant,v_workspace,v_store);
  insert into appointment_services(id,tenant_id,workspace_id,store_id,name,description,duration_minutes)
    values(v_service,v_tenant,v_workspace,v_store,'预约服务','',60);
  insert into staff_members(id,tenant_id,workspace_id,display_name) values(v_staff,v_tenant,v_workspace,'默认服务人员');
  insert into staff_store_assignments(id,tenant_id,workspace_id,store_id,staff_id)
    values(gen_random_uuid(),v_tenant,v_workspace,v_store,v_staff);
  insert into appointment_advisors(id,tenant_id,workspace_id,store_id,staff_id,name)
    values(v_advisor,v_tenant,v_workspace,v_store,v_staff,'默认服务人员');
  insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id)
    values(v_tenant,v_workspace,v_store,v_advisor,v_service);
  insert into appointment_business_hours(id,tenant_id,workspace_id,store_id,weekday,start_time,end_time)
    select gen_random_uuid(),v_tenant,v_workspace,v_store,day,'09:00'::time,'18:00'::time from generate_series(0,6) day;
  insert into staff_schedules(id,tenant_id,workspace_id,store_id,staff_id,weekday,start_time,end_time,enabled)
    select gen_random_uuid(),v_tenant,v_workspace,v_store,v_staff,day,'09:00'::time,'18:00'::time,true from generate_series(0,6) day;
  insert into membership_programs(id,tenant_id,workspace_id,store_id,enabled,points_enabled)
    values(gen_random_uuid(),v_tenant,v_workspace,v_store,false,false);
  insert into membership_levels(id,tenant_id,workspace_id,store_id,name,level_order,growth_threshold,enabled)
    values(gen_random_uuid(),v_tenant,v_workspace,v_store,'普通会员',1,0,true);
  insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id)
    values(p_project,p_origin,'merchant',p_subject,v_user);
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata)
    values(gen_random_uuid(),v_tenant,v_workspace,'merchant',v_user::text,'workspace.register','workspace',v_workspace::text,p_request_id,
      jsonb_build_object('template',p_template,'authentication','supabase'));
  return jsonb_build_object('user',jsonb_build_object('id',v_user,'login',lower(trim(p_email)),'displayName',coalesce(p_contact,'')),
    'workspace',jsonb_build_object('id',v_workspace,'tenantId',v_tenant,'storeId',v_store,'publicStoreId',v_public,'name',p_store_name),
    'subscription',jsonb_build_object('id',v_subscription,'planId','TRIAL','status','inactive','expiresAt',null));
end $$;

revoke all on function provision_managed_merchant(text,text,uuid,text,text,text,jsonb,text,text) from public;
do $$ begin
  if exists(select 1 from pg_roles where rolname='anon') then
    revoke all on function provision_managed_merchant(text,text,uuid,text,text,text,jsonb,text,text) from anon;
  end if;
  if exists(select 1 from pg_roles where rolname='authenticated') then
    revoke all on function provision_managed_merchant(text,text,uuid,text,text,text,jsonb,text,text) from authenticated;
  end if;
  if exists(select 1 from pg_roles where rolname='service_role') then
    grant execute on function provision_managed_merchant(text,text,uuid,text,text,text,jsonb,text,text) to service_role;
  end if;
end $$;
