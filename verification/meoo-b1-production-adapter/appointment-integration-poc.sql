create table if not exists b1_appointment_bookings (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  slot_key text not null,
  customer_id uuid not null,
  appointment_number text not null,
  idempotency_key text not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, store_id, slot_key)
  ,unique (tenant_id, workspace_id, idempotency_key)
);

create or replace function atelier_create_appointment(
  p_tenant_id uuid, p_workspace_id uuid, p_store_id uuid, p_public_store_id text,
  p_customer_name text, p_customer_phone text, p_openid text, p_service_id text,
  p_advisor_id text, p_resource_id text, p_start_at timestamptz, p_slot_key text,
  p_notes text, p_idempotency_key text, p_request_id text
) returns jsonb language plpgsql security invoker as $$
declare booking_id uuid := gen_random_uuid(); existing_number text;
begin
  select appointment_number into existing_number from b1_appointment_bookings where tenant_id=p_tenant_id and workspace_id=p_workspace_id and idempotency_key=p_idempotency_key;
  if existing_number is not null then return jsonb_build_object('ok',true,'data',jsonb_build_object('number',existing_number,'status','待确认','idempotent',true)); end if;
  insert into b1_appointment_bookings(id,tenant_id,workspace_id,store_id,slot_key,customer_id,appointment_number,idempotency_key)
  values (booking_id,p_tenant_id,p_workspace_id,p_store_id,coalesce(p_slot_key,p_start_at::text),gen_random_uuid(),'pending',p_idempotency_key)
  returning id into booking_id;
  update b1_appointment_bookings set appointment_number='AT-' || left(replace(booking_id::text,'-',''),8), idempotency_key=p_idempotency_key where id=booking_id;
  if p_notes = 'B1_FORCE_ROLLBACK' then raise exception 'forced rollback'; end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('number','AT-' || left(replace(booking_id::text,'-',''),8),'status','待确认','idempotent',false));
exception when unique_violation then
  return jsonb_build_object('code','APPOINTMENT_CONFLICT');
end;
$$;
