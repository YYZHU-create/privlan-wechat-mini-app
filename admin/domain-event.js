const EVENT_SCHEMA_VERSIONS = Object.freeze({
  "appointment.created": 1,
  "appointment.confirmed": 1,
  "appointment.completed": 1,
  "appointment.cancelled": 1,
  "appointment.no_show": 1,
  "customer.follow_up.created": 1
});

function bounded(value, limit = 8000) {
  const normalized = value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : {};
  if (JSON.stringify(normalized).length > limit) throw new Error("DOMAIN_EVENT_PAYLOAD_TOO_LARGE");
  return normalized;
}

function createDomainEventMetadata({ eventType, aggregateType, aggregateId, references = {}, data = {}, idempotencyKey, actorType = "system", actorId = "system" }) {
  const schemaVersion = EVENT_SCHEMA_VERSIONS[eventType];
  if (!schemaVersion) throw new Error(`DOMAIN_EVENT_SCHEMA_UNREGISTERED:${eventType}`);
  if (!aggregateType || !aggregateId || !idempotencyKey) throw new Error("DOMAIN_EVENT_ENVELOPE_INVALID");
  return {
    integration: {
      eventType,
      schemaVersion,
      aggregate: { type: String(aggregateType), id: String(aggregateId) },
      references: bounded(references, 2000),
      data: bounded(data),
      idempotencyKey: String(idempotencyKey).slice(0, 180),
      actor: { type: String(actorType || "system"), id: String(actorId || "system") }
    }
  };
}

module.exports = { EVENT_SCHEMA_VERSIONS, createDomainEventMetadata };
