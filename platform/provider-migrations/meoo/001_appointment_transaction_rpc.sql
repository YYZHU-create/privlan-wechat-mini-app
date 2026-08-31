-- Meoo B1 provider extension. Core migrations 001-010 remain unchanged.
create or replace function public.atelier_create_appointment(
  p_tenant_id uuid, p_workspace_id uuid, p_store_id uuid, p_public_store_id text,
  p_customer_name text, p_customer_phone text, p_openid_hash text,
  p_service_id uuid, p_advisor_id uuid, p_resource_id uuid, p_start_at timestamptz,
  p_slot_key text, p_notes text, p_idempotency_key text, p_request_id text
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, public
as $$
declare
  v_store stores%rowtype; v_settings appointment_settings%rowtype; v_service appointment_services%rowtype;
  v_advisor appointment_advisors%rowtype; v_staff staff_members%rowtype; v_resource resources%rowtype;
  v_customer customers%rowtype; v_appointment appointments%rowtype; v_prior appointments%rowtype;
  v_service_end timestamptz; v_occupied_until timestamptz; v_buffer integer;
  v_local_start timestamp; v_local_end timestamp; v_weekday integer;
  v_hash text := nullif(btrim(p_openid_hash), ''); v_key text := nullif(left(btrim(p_idempotency_key), 128), '');
  v_phone text := left(btrim(coalesce(p_customer_phone, '')), 40); v_name text := nullif(left(btrim(coalesce(p_customer_name, '')), 64), '');
begin
  if p_tenant_id is null or p_workspace_id is null or p_store_id is null or v_hash is null or v_key is null or p_start_at is null then return jsonb_build_object('code','INVALID_INPUT'); end if;
  if v_phone <> '' and v_phone !~ '^1[0-9]{10}$' then return jsonb_build_object('code','INVALID_INPUT'); end if;
  select * into v_store from stores where id=p_store_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and (p_public_store_id is null or public_store_id=p_public_store_id) and status <> 'archived' for update;
  if not found then return jsonb_build_object('code','APPOINTMENT_SCOPE_INVALID'); end if;
  select * into v_settings from appointment_settings where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id for update;
  if not found or not v_settings.booking_enabled then return jsonb_build_object('code','SLOT_UNAVAILABLE'); end if;
  select * into v_service from appointment_services where id=p_service_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and enabled=true;
  select * into v_advisor from appointment_advisors where id=p_advisor_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and enabled=true for update;
  if not found or v_service.id is null or v_advisor.id is null then return jsonb_build_object('code','INVALID_INPUT'); end if;
  if not exists (select 1 from appointment_advisor_services where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and advisor_id=v_advisor.id and service_id=v_service.id) then return jsonb_build_object('code','INVALID_INPUT'); end if;
  if v_advisor.staff_id is not null then
    select sm.* into v_staff from staff_members sm join staff_store_assignments a on a.staff_id=sm.id and a.tenant_id=sm.tenant_id and a.workspace_id=sm.workspace_id and a.store_id=p_store_id where sm.id=v_advisor.staff_id and sm.tenant_id=p_tenant_id and sm.workspace_id=p_workspace_id and sm.status='active' and a.status='active' for update;
    if not found then return jsonb_build_object('code','SLOT_UNAVAILABLE'); end if;
  end if;
  if p_resource_id is not null then
    select r.* into v_resource from resources r join resource_store_assignments a on a.resource_id=r.id and a.tenant_id=r.tenant_id and a.workspace_id=r.workspace_id and a.store_id=p_store_id where r.id=p_resource_id and r.tenant_id=p_tenant_id and r.workspace_id=p_workspace_id and r.status='active' and a.status='active' for update;
    if not found then return jsonb_build_object('code','APPOINTMENT_SCOPE_INVALID'); end if;
  end if;
  select * into v_prior from appointments where workspace_id=p_workspace_id and idempotency_key=v_key;
  if found then return jsonb_build_object('ok',true,'data',jsonb_build_object('number',v_prior.appointment_number,'status','待确认','idempotent',true)); end if;
  v_buffer := coalesce(v_service.buffer_minutes_override, v_settings.default_buffer_minutes); v_service_end := p_start_at + make_interval(mins => v_service.duration_minutes); v_occupied_until := v_service_end + make_interval(mins => v_buffer);
  v_local_start := p_start_at at time zone v_settings.timezone; v_local_end := v_occupied_until at time zone v_settings.timezone;
  if v_local_start < (now() at time zone v_settings.timezone) or v_local_start > ((now() at time zone v_settings.timezone) + make_interval(days => v_settings.max_advance_days)) then return jsonb_build_object('code','SLOT_UNAVAILABLE'); end if;
  v_weekday := extract(isodow from v_local_start)::integer - 1;
  if not exists (select 1 from appointment_business_hours h where h.tenant_id=p_tenant_id and h.workspace_id=p_workspace_id and h.store_id=p_store_id and h.weekday=v_weekday and h.enabled=true and v_local_start::time >= h.start_time and v_local_end::time <= h.end_time and mod(extract(epoch from (v_local_start::time-h.start_time))/60, v_settings.slot_interval_minutes)=0) then return jsonb_build_object('code','SLOT_UNAVAILABLE'); end if;
  if v_staff.id is not null then
    if not exists (select 1 from staff_schedules s where s.tenant_id=p_tenant_id and s.workspace_id=p_workspace_id and s.store_id=p_store_id and s.staff_id=v_staff.id and s.weekday=v_weekday and s.enabled=true and v_local_start::time >= s.start_time and v_local_end::time <= s.end_time) then return jsonb_build_object('code','SLOT_UNAVAILABLE'); end if;
    if exists (select 1 from staff_leaves l where l.tenant_id=p_tenant_id and l.workspace_id=p_workspace_id and l.store_id=p_store_id and l.staff_id=v_staff.id and l.start_at<v_occupied_until and l.end_at>p_start_at) then return jsonb_build_object('code','SLOT_UNAVAILABLE'); end if;
  end if;
  if exists (select 1 from appointments where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and advisor_id=v_advisor.id and status in ('pending','confirmed') and start_at<v_occupied_until and occupied_until>p_start_at) then return jsonb_build_object('code','APPOINTMENT_CONFLICT'); end if;
  if v_resource.id is not null and exists (select 1 from appointments where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and resource_id=v_resource.id and status in ('pending','confirmed') and start_at<v_occupied_until and occupied_until>p_start_at) then return jsonb_build_object('code','APPOINTMENT_CONFLICT'); end if;
  select * into v_customer from customers where tenant_id=p_tenant_id and workspace_id=p_workspace_id and wechat_openid_hash=v_hash for update;
  if found and v_customer.store_id <> p_store_id then return jsonb_build_object('code','CUSTOMER_SCOPE_CONFLICT'); end if;
  if not found then insert into customers(id,tenant_id,workspace_id,store_id,source,name,phone,display_name,wechat_openid_hash,first_seen_at,last_seen_at) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,'appointment',v_name,v_phone,v_name,v_hash,now(),now()) returning * into v_customer;
  else update customers set name=coalesce(v_name,name),phone=coalesce(nullif(v_phone,''),phone),display_name=coalesce(v_name,display_name),last_seen_at=now(),updated_at=now() where id=v_customer.id returning * into v_customer; end if;
  insert into appointments(id,tenant_id,workspace_id,store_id,customer_id,service_id,advisor_id,resource_id,appointment_number,status,start_at,service_end_at,occupied_until,duration_minutes_snapshot,buffer_minutes_snapshot,timezone_snapshot,customer_name_snapshot,customer_phone_snapshot,service_name_snapshot,advisor_name_snapshot,notes,source,idempotency_key)
    values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,v_customer.id,v_service.id,v_advisor.id,v_resource.id,'AT'||to_char(p_start_at at time zone 'UTC','YYMMDD')||upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),'pending',p_start_at,v_service_end,v_occupied_until,v_service.duration_minutes,v_buffer,v_settings.timezone,coalesce(v_name,''),v_phone,v_service.name,v_advisor.name,left(btrim(coalesce(p_notes,'')),1000),'mini_program',v_key)
    on conflict(workspace_id,idempotency_key) do nothing returning * into v_appointment;
  if v_appointment.id is null then select * into v_prior from appointments where workspace_id=p_workspace_id and idempotency_key=v_key; return jsonb_build_object('ok',true,'data',jsonb_build_object('number',v_prior.appointment_number,'status','待确认','idempotent',true)); end if;
  update customers set appointment_count=appointment_count+1,last_seen_at=now(),updated_at=now() where id=v_customer.id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id;
  insert into customer_events(id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,v_customer.id,'appointment_created','appointment','appointment',v_appointment.id,jsonb_build_object('eventType','appointment.created','aggregateType','appointment','aggregateId',v_appointment.id,'references',jsonb_build_object('appointmentId',v_appointment.id,'customerId',v_customer.id,'storeId',p_store_id),'data',jsonb_build_object('status','pending','source','mini_program'),'idempotencyKey','appointment.created:'||v_appointment.id,'actorType','mini_program','actorId','wechat_customer')) on conflict do nothing;
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,'mini_program','wechat_customer','appointment.create','appointment',v_appointment.id,coalesce(nullif(p_request_id,''),gen_random_uuid()::text),jsonb_build_object('source','mini_program','status','pending'));
  return jsonb_build_object('ok',true,'data',jsonb_build_object('number',v_appointment.appointment_number,'status','待确认','idempotent',false));
exception when unique_violation then
  select * into v_prior from appointments where workspace_id=p_workspace_id and idempotency_key=v_key;
  if found then return jsonb_build_object('ok',true,'data',jsonb_build_object('number',v_prior.appointment_number,'status','待确认','idempotent',true)); end if;
  return jsonb_build_object('code','APPOINTMENT_CONFLICT');
end;
$$;
revoke all on function public.atelier_create_appointment(uuid,uuid,uuid,text,text,text,text,uuid,uuid,uuid,timestamptz,text,text,text,text) from public;
grant execute on function public.atelier_create_appointment(uuid,uuid,uuid,text,text,text,text,uuid,uuid,uuid,timestamptz,text,text,text,text) to anon, authenticated, service_role;
