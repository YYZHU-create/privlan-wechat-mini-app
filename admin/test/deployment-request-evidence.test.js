const test = require('node:test'), assert = require('node:assert/strict');
const { wrapDeploymentFetch } = require('../../scripts/deployment-request-evidence');
const endpoint='https://meoo.com/open/v1/cli-compat/projects/asmhysidbg5g/cloud/functions/deploy';
test('captures real response status without reading body; blocks SDK auth retry', async()=>{
 const saved=[];let calls=0;
 const fetch=wrapDeploymentFetch({save:r=>saved.push(r),fetchImpl:async(url,opts)=>{calls++;assert.equal(opts.redirect,'error');return {status:401,body:{private:'secret'},clone:()=>assert.fail()};}});
 await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer synthetic-private'}});
 await assert.rejects(fetch(endpoint,{method:'POST'}),/HTTP_RETRY_BLOCKED/);
 assert.equal(calls,1);assert.equal(saved.at(-1).HTTP_STATUS,401);assert.ok(!JSON.stringify(saved).includes('synthetic-private'));
});
test('transport uncertainty recorded, never called twice', async()=>{
 const saved=[];let calls=0;const fetch=wrapDeploymentFetch({save:r=>saved.push(r),fetchImpl:async()=>{calls++;throw Error('private');}});
 await assert.rejects(fetch(endpoint,{method:'POST'}),/TRANSPORT_RESULT_UNKNOWN/);
 await assert.rejects(fetch(endpoint,{method:'POST'}),/HTTP_RETRY_BLOCKED/);
 assert.equal(calls,1);assert.equal(saved.at(-1).HTTP_RESPONSE_RECEIVED,false);
});
test('wrong origin or method blocked before network', async()=>{
 const fetch=wrapDeploymentFetch({save:()=>assert.fail(),fetchImpl:()=>assert.fail()});
 await assert.rejects(fetch(endpoint.replace('meoo.com','example.invalid'),{method:'POST'}),/REQUEST_REJECTED/);
 await assert.rejects(fetch(endpoint,{method:'GET'}),/REQUEST_REJECTED/);
 await assert.rejects(fetch(endpoint.replace('asmhysidbg5g','g8o5cv1om41o'),{method:'POST'}),/TARGET_REJECTED/);
});
test('read-only requests remain unchanged', async()=>{
 const fetch=wrapDeploymentFetch({save:()=>assert.fail(),fetchImpl:async()=>({status:200})});
 assert.equal((await fetch('https://meoo.com/open/v1/cli-compat/projects/asmhysidbg5g/cloud/functions')).status,200);
});
