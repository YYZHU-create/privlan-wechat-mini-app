'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createNativeMigrationRepository}=require('../managed-existing-account-migration');
test('owner selection uses a bound exact email and performs only original-account reads',async()=>{
 const calls=[];const db={transaction:async()=>assert.fail('no write'),query:async(sql,params)=>{calls.push({sql,params});return{rows:[sql.includes('operator_users')?{id:'original-owner',email:'owner@example.test',role:'owner'}:{id:'original-merchant'}]}}};
 const repo=createNativeMigrationRepository({db,projectId:'g8o5cv1om41o',expectedDatabase:'synthetic'});
 const r=await repo.loadOriginalAccounts('owner@example.test','same-email-owner');
 assert.equal(r.operator.id,'original-owner');assert.equal(calls.length,2);assert.deepEqual(calls[1].params,['owner@example.test']);
 assert.ok(calls.every(c=>c.sql.startsWith('select ')));assert.ok(calls.every(c=>!c.sql.includes('ops-admin@localhost')));
});
test('legacy selection remains explicit and unsupported owner targets stop before query',async()=>{
 const calls=[];const db={transaction:async()=>{},query:async(sql,params)=>{calls.push({sql,params});return{rows:[{id:'synthetic'}]}}};
 const repo=createNativeMigrationRepository({db,projectId:'asmhysidbg5g',expectedDatabase:'synthetic'});
 await repo.loadOriginalAccounts('merchant@example.test');assert.deepEqual(calls[1].params,['ops-admin@localhost']);
 calls.length=0;await assert.rejects(repo.loadOriginalAccounts('owner@example.test','same-email-owner'));assert.equal(calls.length,0);
});
