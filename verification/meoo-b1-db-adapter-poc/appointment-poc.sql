create table if not exists b1_appointment_bookings (
  id uuid primary key,
  tenant_id uuid not null,
  workspace_id uuid not null,
  store_id uuid not null,
  slot_key text not null,
  customer_id uuid not null,
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (tenant_id, workspace_id, store_id, slot_key)
);

create or replace function b1_try_book(p_id uuid, p_tenant_id uuid, p_workspace_id uuid, p_store_id uuid, p_slot_key text, p_customer_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
begin
  insert into b1_appointment_bookings(id, tenant_id, workspace_id, store_id, slot_key, customer_id)
  values (p_id, p_tenant_id, p_workspace_id, p_store_id, p_slot_key, p_customer_id);
  return jsonb_build_object('ok', true, 'id', p_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'code', 'APPOINTMENT_CONFLICT');
end;
$$;
