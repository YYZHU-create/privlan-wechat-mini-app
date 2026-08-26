-- ATELIER OS Sprint 3B: immutable integration event contract. Additive only.
-- Only customer_events rows that carry integration metadata are protected.

create or replace function customer_events_reject_integration_contract_mutation() returns trigger language plpgsql as $$
begin
  if old.metadata ? 'integration' then
    if new.id is distinct from old.id
      or new.tenant_id is distinct from old.tenant_id
      or new.workspace_id is distinct from old.workspace_id
      or new.store_id is distinct from old.store_id
      or new.customer_id is distinct from old.customer_id
      or new.event_type is distinct from old.event_type
      or new.resource_type is distinct from old.resource_type
      or new.resource_id is distinct from old.resource_id
      or not (new.metadata ? 'integration')
      or (old.metadata #>> '{integration,eventType}') is distinct from (new.metadata #>> '{integration,eventType}')
      or (old.metadata #>> '{integration,schemaVersion}') is distinct from (new.metadata #>> '{integration,schemaVersion}')
      or (old.metadata #>> '{integration,aggregate,type}') is distinct from (new.metadata #>> '{integration,aggregate,type}')
      or (old.metadata #>> '{integration,aggregate,id}') is distinct from (new.metadata #>> '{integration,aggregate,id}')
      or (old.metadata #>> '{integration,references,appointmentId}') is distinct from (new.metadata #>> '{integration,references,appointmentId}')
      or (old.metadata #>> '{integration,references,customerId}') is distinct from (new.metadata #>> '{integration,references,customerId}')
      or (old.metadata #>> '{integration,references,storeId}') is distinct from (new.metadata #>> '{integration,references,storeId}')
      or (old.metadata #>> '{integration,idempotencyKey}') is distinct from (new.metadata #>> '{integration,idempotencyKey}') then
      raise exception 'WORKFLOW_EVENT_CONTRACT_IMMUTABLE' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

create trigger customer_events_integration_contract_immutable_trigger
before update on customer_events
for each row execute function customer_events_reject_integration_contract_mutation();
