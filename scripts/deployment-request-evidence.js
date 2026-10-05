'use strict';
const fs = require('node:fs');
function wrapDeploymentFetch({ fetchImpl, save, projectId = 'asmhysidbg5g' }) {
  if (projectId !== 'asmhysidbg5g') throw new Error('DEPLOYMENT_EVIDENCE_TARGET_REJECTED');
  const route = `/open/v1/cli-compat/projects/${projectId}/cloud/functions/deploy`;
  let count = 0;
  return async (input, options = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!url.pathname.endsWith('/cloud/functions/deploy')) return fetchImpl(input, options);
    if (url.pathname !== route) throw new Error('DEPLOYMENT_EVIDENCE_TARGET_REJECTED');
    if (url.origin !== 'https://meoo.com' || options.method !== 'POST') throw new Error('DEPLOYMENT_EVIDENCE_REQUEST_REJECTED');
    if (count) throw new Error('DEPLOYMENT_HTTP_RETRY_BLOCKED');
    count++;
    save({ STATE: 'REQUEST_STARTING', PROJECT_ID: projectId, HTTP_INVOCATION_COUNT: count, HTTP_RESPONSE_RECEIVED: false });
    let response;
    try { response = await fetchImpl(input, { ...options, redirect: 'error' }); }
    catch {
      save({ STATE: 'TRANSPORT_RESULT_UNKNOWN', PROJECT_ID: projectId, HTTP_INVOCATION_COUNT: count, HTTP_RESPONSE_RECEIVED: false });
      throw new Error('DEPLOYMENT_TRANSPORT_RESULT_UNKNOWN');
    }
    // Do not consume, clone, or persist any response body or credential headers.
    save({ STATE: 'HTTP_RESPONSE_RECEIVED', PROJECT_ID: projectId, HTTP_INVOCATION_COUNT: count, HTTP_RESPONSE_RECEIVED: true, HTTP_STATUS: response.status });
    return response;
  };
}
if (process.env.FEELDAO_DEPLOY_EVIDENCE_PATH) {
  const output = process.env.FEELDAO_DEPLOY_EVIDENCE_PATH;
  let first = true;
  globalThis.fetch = wrapDeploymentFetch({ fetchImpl: globalThis.fetch, save: value => {
    const record = { ...value, COLLECTED_AT_UTC: new Date().toISOString(), SECRET_VALUES_SAVED: false };
    fs.writeFileSync(output, JSON.stringify(record, null, 2), { flag: first ? 'wx' : 'w' });
    first = false;
  } });
}
module.exports = { wrapDeploymentFetch };
