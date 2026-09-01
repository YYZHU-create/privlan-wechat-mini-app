const DEFAULT_WORKFLOW_MAPPINGS = Object.freeze({
  "appointment.completed": Object.freeze({ workflowKey: "appointment-completion", consumerKey: "runtime" })
});

module.exports = { DEFAULT_WORKFLOW_MAPPINGS };
