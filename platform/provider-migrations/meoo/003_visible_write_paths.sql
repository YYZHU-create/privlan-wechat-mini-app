-- Explicit provider RPCs for merchant-visible writes. Core migrations stay unchanged.
set search_path = pg_catalog, public;

create or replace function public.atelier_customer_add_note(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_customer_id uuid,p_content text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_row customer_notes%rowtype;
begin
  if p_tenant_id is null or p_workspace_id is null or p_store_id is null or nullif(btrim(p_content),'') is null then return jsonb_build_object('code','NOTE_INVALID'); end if;
  if not exists(select 1 from customers where id=p_customer_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id) then return jsonb_build_object('code','CUSTOMER_SCOPE_INVALID'); end if;
  insert into customer_notes(id,tenant_id,workspace_id,store_id,customer_id,author_user_id,content) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,p_customer_id,p_actor_id,left(btrim(p_content),5000)) returning * into v_row;
  insert into customer_events(id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,p_customer_id,'profile_updated','merchant','customer_note',v_row.id::text) on conflict do nothing;
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,'merchant',coalesce(p_actor_id,'00000000-0000-0000-0000-000000000000'::uuid),'customer.note.create','customer_note',v_row.id,coalesce(nullif(p_request_id,''),gen_random_uuid()::text),jsonb_build_object('customerId',p_customer_id));
  return jsonb_build_object('ok',true,'data',to_jsonb(v_row));
end; $$;

create or replace function public.atelier_customer_adjust_points(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_customer_id uuid,p_points bigint,p_reason text,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_balance bigint; v_existing customer_points_ledger%rowtype; v_row customer_points_ledger%rowtype; v_new bigint;
begin
  if p_points is null or p_points=0 or abs(p_points)>1000000 or nullif(btrim(p_idempotency_key),'') is null then return jsonb_build_object('code',case when nullif(btrim(p_idempotency_key),'') is null then 'IDEMPOTENCY_REQUIRED' else 'POINTS_INVALID' end); end if;
  if not exists(select 1 from customers where id=p_customer_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id) then return jsonb_build_object('code','CUSTOMER_SCOPE_INVALID'); end if;
  select * into v_existing from customer_points_ledger where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and idempotency_key=left(btrim(p_idempotency_key),180);
  if found then return jsonb_build_object('ok',true,'data',jsonb_build_object('duplicate',true,'balance',v_existing.balance_after)); end if;
  insert into customer_points_accounts(tenant_id,workspace_id,store_id,customer_id) values(p_tenant_id,p_workspace_id,p_store_id,p_customer_id) on conflict do nothing;
  select balance into v_balance from customer_points_accounts where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and customer_id=p_customer_id for update;
  v_new := v_balance + p_points;
  if v_new < 0 then return jsonb_build_object('code','POINTS_INSUFFICIENT'); end if;
  insert into customer_points_ledger(id,tenant_id,workspace_id,store_id,customer_id,type,points,balance_after,reason,source_type,operator_id,idempotency_key) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,p_customer_id,'adjust',p_points,v_new,left(coalesce(p_reason,'人工调整'),200),'merchant',p_actor_id,left(btrim(p_idempotency_key),180)) returning * into v_row;
  update customer_points_accounts set balance=v_new,updated_at=now() where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and customer_id=p_customer_id;
  insert into customer_events(id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,p_customer_id,case when p_points>0 then 'points_earned' else 'points_spent' end,'merchant','customer_points_ledger',v_row.id::text) on conflict do nothing;
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,'merchant',coalesce(p_actor_id,'00000000-0000-0000-0000-000000000000'::uuid),'customer.points.adjust','customer_points_ledger',v_row.id,coalesce(nullif(p_request_id,''),gen_random_uuid()::text),jsonb_build_object('customerId',p_customer_id,'points',p_points));
  return jsonb_build_object('ok',true,'data',jsonb_build_object('duplicate',false,'balance',v_new));
exception when unique_violation then
  select balance_after into v_balance from customer_points_ledger where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and idempotency_key=left(btrim(p_idempotency_key),180);
  return jsonb_build_object('ok',true,'data',jsonb_build_object('duplicate',true,'balance',v_balance));
end; $$;

create or replace function public.atelier_membership_program_update(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_enabled boolean,p_points_enabled boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_row membership_programs%rowtype; begin
  update membership_programs set enabled=coalesce(p_enabled,false),points_enabled=coalesce(p_points_enabled,false),updated_at=now() where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id returning * into v_row;
  if not found then return jsonb_build_object('code','MEMBERSHIP_PROGRAM_NOT_FOUND'); end if;
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,'merchant',coalesce(p_actor_id,'00000000-0000-0000-0000-000000000000'::uuid),'customer.membership_program.update','membership_program',v_row.id,coalesce(nullif(p_request_id,''),gen_random_uuid()::text),jsonb_build_object('enabled',v_row.enabled,'pointsEnabled',v_row.points_enabled));
  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',v_row.id,'enabled',v_row.enabled,'points_enabled',v_row.points_enabled,'updated_at',v_row.updated_at));
end; $$;

create or replace function public.atelier_membership_level_save(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_level_id uuid,p_name text,p_level_order integer,p_growth_threshold bigint,p_enabled boolean,p_benefits jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_row membership_levels%rowtype; begin
  if nullif(btrim(p_name),'') is null or p_level_order is null or p_level_order<1 or p_growth_threshold is null or p_growth_threshold<0 then return jsonb_build_object('code','MEMBERSHIP_LEVEL_INVALID'); end if;
  if p_level_id is null then insert into membership_levels(id,tenant_id,workspace_id,store_id,name,level_order,growth_threshold,enabled,benefits) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,left(btrim(p_name),80),p_level_order,p_growth_threshold,coalesce(p_enabled,true),coalesce(p_benefits,'{}'::jsonb)) returning * into v_row;
  else update membership_levels set name=left(btrim(p_name),80),level_order=p_level_order,growth_threshold=p_growth_threshold,enabled=coalesce(p_enabled,true),benefits=coalesce(p_benefits,'{}'::jsonb),updated_at=now() where id=p_level_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id returning * into v_row; if not found then return jsonb_build_object('code','MEMBERSHIP_LEVEL_NOT_FOUND'); end if; end if;
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,'merchant',coalesce(p_actor_id,'00000000-0000-0000-0000-000000000000'::uuid),case when p_level_id is null then 'customer.membership_level.create' else 'customer.membership_level.update' end,'membership_level',v_row.id,coalesce(nullif(p_request_id,''),gen_random_uuid()::text),'{}'::jsonb);
  return jsonb_build_object('ok',true,'data',to_jsonb(v_row));
exception when unique_violation then return jsonb_build_object('code','MEMBERSHIP_LEVEL_INVALID'); end; $$;

create or replace function public.atelier_appointment_status_update(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_appointment_id uuid,p_status text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_row appointments%rowtype; v_from_status text; begin
  select * into v_row from appointments where id=p_appointment_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id for update;
  if not found then return jsonb_build_object('code','APPOINTMENT_SCOPE_INVALID'); end if;
  v_from_status := v_row.status;
  if not ((v_from_status='pending' and p_status in('confirmed','cancelled','no_show')) or (v_from_status='confirmed' and p_status in('completed','cancelled','no_show'))) then return jsonb_build_object('code','APPOINTMENT_STATUS_INVALID'); end if;
  update appointments set status=p_status,updated_at=now() where id=v_row.id returning * into v_row;
  insert into customer_events(id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,v_row.customer_id,'appointment_'||p_status,'merchant','appointment',v_row.id::text,jsonb_build_object('fromStatus',v_from_status,'toStatus',p_status)) on conflict do nothing;
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,'merchant',coalesce(p_actor_id,'00000000-0000-0000-0000-000000000000'::uuid),'appointment.'||p_status,'appointment',v_row.id,coalesce(nullif(p_request_id,''),gen_random_uuid()::text),jsonb_build_object('to',p_status));
  return jsonb_build_object('ok',true,'data',to_jsonb(v_row));
end; $$;

create or replace function public.atelier_appointment_follow_up(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_appointment_id uuid,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_customer uuid; v_resource text; v_id uuid; begin
  if nullif(btrim(p_note),'') is null or nullif(btrim(p_idempotency_key),'') is null then return jsonb_build_object('code','IDEMPOTENCY_REQUIRED'); end if;
  select customer_id into v_customer from appointments where id=p_appointment_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id for update;
  if not found then return jsonb_build_object('code','APPOINTMENT_SCOPE_INVALID'); end if;
  v_resource:=p_appointment_id::text||':'||left(btrim(p_idempotency_key),180);
  insert into customer_events(id,tenant_id,workspace_id,store_id,customer_id,event_type,source,resource_type,resource_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,v_customer,'follow_up_created','merchant','appointment_follow_up',v_resource,jsonb_build_object('note',left(btrim(p_note),1000))) on conflict do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('ok',true,'data',jsonb_build_object('duplicate',true,'appointmentId',p_appointment_id,'idempotencyKey',left(btrim(p_idempotency_key),180))); end if;
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,'merchant',coalesce(p_actor_id,'00000000-0000-0000-0000-000000000000'::uuid),'appointment.follow_up.create','appointment',p_appointment_id,coalesce(nullif(p_request_id,''),gen_random_uuid()::text),jsonb_build_object('idempotencyKey',left(btrim(p_idempotency_key),180)));
  return jsonb_build_object('ok',true,'data',jsonb_build_object('duplicate',false,'appointmentId',p_appointment_id,'customerId',v_customer,'idempotencyKey',left(btrim(p_idempotency_key),180)));
end; $$;

create or replace function public.atelier_appointment_settings_update(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_timezone text,p_slot_interval_minutes integer,p_default_buffer_minutes integer,p_max_advance_days integer,p_booking_enabled boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ begin
  if p_timezone is null or p_slot_interval_minutes<5 or p_slot_interval_minutes>300 or mod(p_slot_interval_minutes,5)<>0 or p_default_buffer_minutes<1 or p_default_buffer_minutes>30 or p_max_advance_days<1 or p_max_advance_days>365 then return jsonb_build_object('code','APPOINTMENT_SETTINGS_INVALID'); end if;
  insert into appointment_settings(tenant_id,workspace_id,store_id,timezone,slot_interval_minutes,default_buffer_minutes,min_advance_minutes,max_advance_days,booking_enabled) values(p_tenant_id,p_workspace_id,p_store_id,p_timezone,p_slot_interval_minutes,p_default_buffer_minutes,0,p_max_advance_days,coalesce(p_booking_enabled,true)) on conflict(workspace_id,store_id) do update set timezone=excluded.timezone,slot_interval_minutes=excluded.slot_interval_minutes,default_buffer_minutes=excluded.default_buffer_minutes,max_advance_days=excluded.max_advance_days,booking_enabled=excluded.booking_enabled,updated_at=now() where appointment_settings.tenant_id=excluded.tenant_id;
  insert into audit_events(id,tenant_id,workspace_id,actor_type,actor_id,action,resource_type,resource_id,request_id,metadata) values(gen_random_uuid(),p_tenant_id,p_workspace_id,'merchant',coalesce(p_actor_id,'00000000-0000-0000-0000-000000000000'::uuid),'appointment.settings.update','appointment_settings',p_store_id,coalesce(nullif(p_request_id,''),gen_random_uuid()::text),'{}'::jsonb);
  return jsonb_build_object('ok',true,'data',jsonb_build_object('timezone',p_timezone,'slotIntervalMinutes',p_slot_interval_minutes,'defaultBufferMinutes',p_default_buffer_minutes,'maxAdvanceDays',p_max_advance_days,'bookingEnabled',coalesce(p_booking_enabled,true)));
end; $$;

create or replace function public.atelier_appointment_hours_replace(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_hours jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_item jsonb; begin
  if jsonb_typeof(coalesce(p_hours,'[]'::jsonb))<>'array' then return jsonb_build_object('code','APPOINTMENT_SETTINGS_INVALID'); end if;
  delete from appointment_business_hours where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id;
  for v_item in select value from jsonb_array_elements(p_hours) loop
    insert into appointment_business_hours(id,tenant_id,workspace_id,store_id,weekday,start_time,end_time,enabled) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,(v_item->>'weekday')::integer,(v_item->>'startTime')::time,(v_item->>'endTime')::time,coalesce((v_item->>'enabled')::boolean,true));
  end loop;
  return jsonb_build_object('ok',true,'data',p_hours);
exception when others then return jsonb_build_object('code','APPOINTMENT_SETTINGS_INVALID'); end; $$;

create or replace function public.atelier_appointment_service_save(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_service_id uuid,p_name text,p_description text,p_duration_minutes integer,p_buffer_minutes_override integer,p_enabled boolean,p_sort_order integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_id uuid:=coalesce(p_service_id,gen_random_uuid()); v_row appointment_services%rowtype; begin
  if nullif(btrim(p_name),'') is null or p_duration_minutes<5 or p_duration_minutes>1440 or (p_buffer_minutes_override is not null and (p_buffer_minutes_override<0 or p_buffer_minutes_override>480)) then return jsonb_build_object('code','APPOINTMENT_SERVICE_INVALID'); end if;
  if p_service_id is null then insert into appointment_services(id,tenant_id,workspace_id,store_id,name,description,duration_minutes,buffer_minutes_override,enabled,sort_order) values(v_id,p_tenant_id,p_workspace_id,p_store_id,left(btrim(p_name),80),left(coalesce(p_description,''),500),p_duration_minutes,p_buffer_minutes_override,coalesce(p_enabled,true),coalesce(p_sort_order,0)); insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id) select p_tenant_id,p_workspace_id,p_store_id,id,v_id from appointment_advisors where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id on conflict do nothing;
  else update appointment_services set name=left(btrim(p_name),80),description=left(coalesce(p_description,''),500),duration_minutes=p_duration_minutes,buffer_minutes_override=p_buffer_minutes_override,enabled=coalesce(p_enabled,true),sort_order=coalesce(p_sort_order,0),updated_at=now() where id=p_service_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id; if not found then return jsonb_build_object('code','APPOINTMENT_SERVICE_NOT_FOUND'); end if; end if;
  select * into v_row from appointment_services where id=v_id; return jsonb_build_object('ok',true,'data',to_jsonb(v_row));
end; $$;

create or replace function public.atelier_appointment_advisor_save(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_advisor_id uuid,p_staff_id uuid,p_name text,p_enabled boolean,p_sort_order integer)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_id uuid:=coalesce(p_advisor_id,gen_random_uuid()); v_staff uuid:=coalesce(p_staff_id,gen_random_uuid()); v_row appointment_advisors%rowtype;
begin
  if nullif(btrim(p_name),'') is null then return jsonb_build_object('code','APPOINTMENT_ADVISOR_INVALID'); end if;
  if p_advisor_id is null then
    if exists(select 1 from staff_members where id=v_staff and (tenant_id<>p_tenant_id or workspace_id<>p_workspace_id)) then return jsonb_build_object('code','APPOINTMENT_SCOPE_INVALID'); end if;
    insert into staff_members(id,tenant_id,workspace_id,display_name,status,public_visible) values(v_staff,p_tenant_id,p_workspace_id,left(btrim(p_name),80),case when coalesce(p_enabled,true) then 'active' else 'inactive' end,coalesce(p_enabled,true)) on conflict(id) do update set display_name=excluded.display_name,status=excluded.status,public_visible=excluded.public_visible,updated_at=now() where staff_members.tenant_id=excluded.tenant_id and staff_members.workspace_id=excluded.workspace_id;
    if not exists(select 1 from staff_members where id=v_staff and tenant_id=p_tenant_id and workspace_id=p_workspace_id) then return jsonb_build_object('code','APPOINTMENT_SCOPE_INVALID'); end if;
    insert into staff_store_assignments(id,tenant_id,workspace_id,store_id,staff_id,status) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,v_staff,case when coalesce(p_enabled,true) then 'active' else 'inactive' end) on conflict(store_id,staff_id) do update set status=excluded.status,updated_at=now();
    insert into appointment_advisors(id,tenant_id,workspace_id,store_id,staff_id,name,enabled,sort_order) values(v_id,p_tenant_id,p_workspace_id,p_store_id,v_staff,left(btrim(p_name),80),coalesce(p_enabled,true),coalesce(p_sort_order,0));
    insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id) select p_tenant_id,p_workspace_id,p_store_id,v_id,id from appointment_services where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id on conflict do nothing;
    insert into staff_schedules(id,tenant_id,workspace_id,store_id,staff_id,weekday,start_time,end_time,enabled) select gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,v_staff,weekday,start_time,end_time,enabled from appointment_business_hours where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id on conflict(store_id,staff_id,weekday,start_time,end_time) do nothing;
  else
    update appointment_advisors set name=left(btrim(p_name),80),enabled=coalesce(p_enabled,true),sort_order=coalesce(p_sort_order,0),updated_at=now() where id=p_advisor_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id returning staff_id into v_staff;
    if not found then return jsonb_build_object('code','APPOINTMENT_ADVISOR_NOT_FOUND'); end if;
    update staff_members set display_name=left(btrim(p_name),80),status=case when coalesce(p_enabled,true) then 'active' else 'inactive' end,public_visible=coalesce(p_enabled,true),updated_at=now() where id=v_staff and tenant_id=p_tenant_id and workspace_id=p_workspace_id;
  end if;
  select * into v_row from appointment_advisors where id=v_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id; return jsonb_build_object('ok',true,'data',to_jsonb(v_row));
end; $$;

create or replace function public.atelier_staff_save(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_staff_id uuid,p_display_name text,p_title text,p_status text,p_public_visible boolean)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
declare v_id uuid:=coalesce(p_staff_id,gen_random_uuid()); v_advisor uuid:=gen_random_uuid(); v_active boolean:=case when p_status='inactive' then false else true end;
begin
  if nullif(btrim(p_display_name),'') is null then return jsonb_build_object('code','STAFF_INVALID'); end if;
  if p_staff_id is null then
    insert into staff_members(id,tenant_id,workspace_id,display_name,title,status,public_visible) values(v_id,p_tenant_id,p_workspace_id,left(btrim(p_display_name),80),left(coalesce(p_title,''),80),case when v_active then 'active' else 'inactive' end,coalesce(p_public_visible,true));
    insert into staff_store_assignments(id,tenant_id,workspace_id,store_id,staff_id,status) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,v_id,case when v_active then 'active' else 'inactive' end) on conflict(store_id,staff_id) do update set status=excluded.status,updated_at=now();
    insert into appointment_advisors(id,tenant_id,workspace_id,store_id,staff_id,name,enabled,sort_order) values(v_advisor,p_tenant_id,p_workspace_id,p_store_id,v_id,left(btrim(p_display_name),80),v_active,0);
    insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id) select p_tenant_id,p_workspace_id,p_store_id,v_advisor,id from appointment_services where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id on conflict do nothing;
    insert into staff_schedules(id,tenant_id,workspace_id,store_id,staff_id,weekday,start_time,end_time,enabled) select gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,v_id,weekday,start_time,end_time,enabled from appointment_business_hours where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id on conflict(store_id,staff_id,weekday,start_time,end_time) do nothing;
  else
    update staff_members set display_name=left(btrim(p_display_name),80),title=left(coalesce(p_title,''),80),status=case when v_active then 'active' else 'inactive' end,public_visible=coalesce(p_public_visible,true),updated_at=now() where id=p_staff_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id;
    if not found then return jsonb_build_object('code','STAFF_NOT_FOUND'); end if;
    update staff_store_assignments set status=case when v_active then 'active' else 'inactive' end,updated_at=now() where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and staff_id=v_id;
    update appointment_advisors set name=left(btrim(p_display_name),80),enabled=v_active,updated_at=now() where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and staff_id=v_id;
  end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',v_id));
end; $$;

create or replace function public.atelier_staff_capabilities_replace(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_staff_id uuid,p_service_ids jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if jsonb_typeof(coalesce(p_service_ids,'[]'::jsonb))<>'array' then return jsonb_build_object('code','APPOINTMENT_SCOPE_INVALID'); end if;
  if not exists(select 1 from appointment_advisors where staff_id=p_staff_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id) then return jsonb_build_object('code','STAFF_NOT_FOUND'); end if;
  if exists(select 1 from jsonb_array_elements_text(p_service_ids) x(value) where not exists(select 1 from appointment_services where id=x.value::uuid and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and enabled=true)) then return jsonb_build_object('code','APPOINTMENT_SCOPE_INVALID'); end if;
  delete from appointment_advisor_services aas using appointment_advisors aa where aas.tenant_id=p_tenant_id and aas.workspace_id=p_workspace_id and aas.store_id=p_store_id and aa.id=aas.advisor_id and aa.tenant_id=p_tenant_id and aa.workspace_id=p_workspace_id and aa.store_id=p_store_id and aa.staff_id=p_staff_id;
  insert into appointment_advisor_services(tenant_id,workspace_id,store_id,advisor_id,service_id)
    select p_tenant_id,p_workspace_id,p_store_id,aa.id,value::uuid from appointment_advisors aa cross join lateral jsonb_array_elements_text(p_service_ids) x(value)
    where aa.tenant_id=p_tenant_id and aa.workspace_id=p_workspace_id and aa.store_id=p_store_id and aa.staff_id=p_staff_id
      and exists(select 1 from appointment_services s where s.id=value::uuid and s.tenant_id=p_tenant_id and s.workspace_id=p_workspace_id and s.store_id=p_store_id and s.enabled=true)
    on conflict do nothing;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('staffId',p_staff_id));
end; $$;

create or replace function public.atelier_staff_schedules_replace(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_staff_id uuid,p_schedules jsonb)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_item jsonb; begin
  if not exists(select 1 from staff_store_assignments where staff_id=p_staff_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id) then return jsonb_build_object('code','STAFF_NOT_FOUND'); end if;
  delete from staff_schedules where tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and staff_id=p_staff_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_schedules,'[]'::jsonb)) loop insert into staff_schedules(id,tenant_id,workspace_id,store_id,staff_id,weekday,start_time,end_time,enabled) values(gen_random_uuid(),p_tenant_id,p_workspace_id,p_store_id,p_staff_id,(v_item->>'weekday')::integer,(v_item->>'startTime')::time,(v_item->>'endTime')::time,coalesce((v_item->>'enabled')::boolean,true)); end loop;
  return jsonb_build_object('ok',true,'data',p_schedules);
exception when others then return jsonb_build_object('code','STAFF_SCHEDULE_INVALID'); end; $$;

create or replace function public.atelier_staff_leave_create(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_staff_id uuid,p_start_at timestamptz,p_end_at timestamptz,p_reason text)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_id uuid:=gen_random_uuid(); begin
  if p_start_at is null or p_end_at is null or p_end_at<=p_start_at or not exists(select 1 from staff_store_assignments where staff_id=p_staff_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id) then return jsonb_build_object('code','STAFF_NOT_FOUND'); end if;
  insert into staff_leaves(id,tenant_id,workspace_id,store_id,staff_id,start_at,end_at,reason) values(v_id,p_tenant_id,p_workspace_id,p_store_id,p_staff_id,p_start_at,p_end_at,left(coalesce(p_reason,''),500)); return jsonb_build_object('ok',true,'data',jsonb_build_object('id',v_id,'deleted',false));
end; $$;

create or replace function public.atelier_staff_leave_delete(p_tenant_id uuid,p_workspace_id uuid,p_store_id uuid,p_actor_id uuid,p_request_id text,p_staff_id uuid,p_leave_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog,public as $$ declare v_id uuid; begin
  delete from staff_leaves where id=p_leave_id and tenant_id=p_tenant_id and workspace_id=p_workspace_id and store_id=p_store_id and staff_id=p_staff_id returning id into v_id;
  if v_id is null then return jsonb_build_object('code','STAFF_NOT_FOUND'); end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('id',v_id,'deleted',true));
end; $$;

revoke all on function public.atelier_customer_add_note(uuid,uuid,uuid,uuid,text,uuid,text) from public;
revoke all on function public.atelier_customer_adjust_points(uuid,uuid,uuid,uuid,text,uuid,bigint,text,text) from public;
revoke all on function public.atelier_membership_program_update(uuid,uuid,uuid,uuid,text,boolean,boolean) from public;
revoke all on function public.atelier_membership_level_save(uuid,uuid,uuid,uuid,text,uuid,text,integer,bigint,boolean,jsonb) from public;
revoke all on function public.atelier_appointment_status_update(uuid,uuid,uuid,uuid,text,uuid,text) from public;
revoke all on function public.atelier_appointment_follow_up(uuid,uuid,uuid,uuid,text,uuid,text,text) from public;
revoke all on function public.atelier_appointment_settings_update(uuid,uuid,uuid,uuid,text,text,integer,integer,integer,boolean) from public;
revoke all on function public.atelier_appointment_hours_replace(uuid,uuid,uuid,uuid,text,jsonb) from public;
revoke all on function public.atelier_appointment_service_save(uuid,uuid,uuid,uuid,text,uuid,text,text,integer,integer,boolean,integer) from public;
revoke all on function public.atelier_appointment_advisor_save(uuid,uuid,uuid,uuid,text,uuid,uuid,text,boolean,integer) from public;
revoke all on function public.atelier_staff_save(uuid,uuid,uuid,uuid,text,uuid,text,text,text,boolean) from public;
revoke all on function public.atelier_staff_capabilities_replace(uuid,uuid,uuid,uuid,text,uuid,jsonb) from public;
revoke all on function public.atelier_staff_schedules_replace(uuid,uuid,uuid,uuid,text,uuid,jsonb) from public;
revoke all on function public.atelier_staff_leave_create(uuid,uuid,uuid,uuid,text,uuid,timestamptz,timestamptz,text) from public;
revoke all on function public.atelier_staff_leave_delete(uuid,uuid,uuid,uuid,text,uuid,uuid) from public;
revoke execute on function public.atelier_customer_add_note(uuid,uuid,uuid,uuid,text,uuid,text) from anon, authenticated;
revoke execute on function public.atelier_customer_adjust_points(uuid,uuid,uuid,uuid,text,uuid,bigint,text,text) from anon, authenticated;
revoke execute on function public.atelier_membership_program_update(uuid,uuid,uuid,uuid,text,boolean,boolean) from anon, authenticated;
revoke execute on function public.atelier_membership_level_save(uuid,uuid,uuid,uuid,text,uuid,text,integer,bigint,boolean,jsonb) from anon, authenticated;
revoke execute on function public.atelier_appointment_status_update(uuid,uuid,uuid,uuid,text,uuid,text) from anon, authenticated;
revoke execute on function public.atelier_appointment_follow_up(uuid,uuid,uuid,uuid,text,uuid,text,text) from anon, authenticated;
revoke execute on function public.atelier_appointment_settings_update(uuid,uuid,uuid,uuid,text,text,integer,integer,integer,boolean) from anon, authenticated;
revoke execute on function public.atelier_appointment_hours_replace(uuid,uuid,uuid,uuid,text,jsonb) from anon, authenticated;
revoke execute on function public.atelier_appointment_service_save(uuid,uuid,uuid,uuid,text,uuid,text,text,integer,integer,boolean,integer) from anon, authenticated;
revoke execute on function public.atelier_appointment_advisor_save(uuid,uuid,uuid,uuid,text,uuid,uuid,text,boolean,integer) from anon, authenticated;
revoke execute on function public.atelier_staff_save(uuid,uuid,uuid,uuid,text,uuid,text,text,text,boolean) from anon, authenticated;
revoke execute on function public.atelier_staff_capabilities_replace(uuid,uuid,uuid,uuid,text,uuid,jsonb) from anon, authenticated;
revoke execute on function public.atelier_staff_schedules_replace(uuid,uuid,uuid,uuid,text,uuid,jsonb) from anon, authenticated;
revoke execute on function public.atelier_staff_leave_create(uuid,uuid,uuid,uuid,text,uuid,timestamptz,timestamptz,text) from anon, authenticated;
revoke execute on function public.atelier_staff_leave_delete(uuid,uuid,uuid,uuid,text,uuid,uuid) from anon, authenticated;
grant execute on all functions in schema public to service_role;
