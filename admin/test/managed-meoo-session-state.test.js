"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createPortableTestDatabase}=require("../database");
const {createSaasService}=require("../saas-service");
const {createManagedSessionLifetime}=require("../managed-session-lifetime");
const {createMeooSessionStateRepository}=require("../managed-meoo-session-state-repository");
process.env.NODE_ENV="test";
const projectId="asmhysidbg5g",providerOrigin="https://provider.example.test",subject="00000000-0000-4000-8000-000000000001",sessionId="00000000-0000-4000-8000-000000000002";
async function fixture(t){
 const db=await createPortableTestDatabase();t.after(()=>db.close());
 const original=await createSaasService({db}).register({login:"fixture@example.test",password:"synthetic-password",storeName:"Store"});
 await db.query("insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id) values($1,$2,'merchant',$3,$4)",[projectId,providerOrigin,subject,original.user.id]);
 await db.query("insert into merchant_sessions(id,user_id,workspace_id,token_hash,csrf_token_hash,expires_at,auth_provider) values($1,$2,$3,'synthetic-token','synthetic-csrf',now()+interval '7 days','supabase')",[sessionId,original.user.id,original.workspace.id]);
 let clock=Date.now(),refreshes=0;const actions=[];
 const identity={surface:"merchant",businessUserId:original.user.id,providerUserId:subject,principal:{id:original.user.id,status:"active"}};
 const session=()=>({accessToken:"private-access",refreshToken:"private-refresh",expiresAt:(clock+3600000)/1000});
 const fetchImpl=async(url,options)=>{
   assert.equal(url,providerOrigin+"/rest/v1/rpc/managed_session_state_operation");assert.equal(options.method,"POST");assert.equal(options.redirect,"error");assert.ok(options.signal);
   const b=JSON.parse(options.body);actions.push(b.p_action);assert.doesNotMatch(options.body,/private-access|private-refresh/);
   try{const r=await db.query("select managed_session_state_operation($1,$2::jsonb) result",[b.p_action,b.p_doc]);return {ok:true,json:async()=>r.rows[0].result};}
   catch{return {ok:false,json:async()=>({})};}
 };
 const repository=createMeooSessionStateRepository({projectId,providerOrigin,serviceRoleKey:"synthetic-server",fetchImpl});
 const managedAuth={resolve:async()=>identity,refresh:async()=>{refreshes++;return {identity,session:session()}}};
 const config={projectId,providerOrigin,key:Buffer.alloc(32,3),repository,managedAuth,now:()=>clock};
 const request={sessionId,surface:"merchant",businessUserId:original.user.id};
 const coordinator=createManagedSessionLifetime(config);await coordinator.issue({...request,providerResult:{identity,session:session()}});
 return {db,config,coordinator,request,repository,managedAuth,actions,advance:ms=>{clock+=ms},refreshes:()=>refreshes};
}
test("REST coordinator stores ciphertext and fences successful rotation before release",async t=>{
 const f=await fixture(t);f.advance(3600000);const r=await f.coordinator.resolve(f.request);assert.ok(r);assert.equal(f.refreshes(),1);
 assert.deepEqual(f.actions,["insert","claim","begin_rotation","save","release"]);
 const row=(await f.db.query("select * from managed_auth_session_state")).rows[0];assert.equal(row.rotation_pending,false);assert.equal(row.lease_token,null);assert.equal(row.revoked,false);
});
test("unknown refresh outcome requires fresh login instead of refreshing old token again",async t=>{
 const f=await fixture(t);f.advance(3600000);let calls=0;
 f.managedAuth.refresh=async()=>{calls++;throw Object.assign(new Error("unavailable"),{code:"MANAGED_AUTH_PROVIDER_UNAVAILABLE"});};
 await assert.rejects(f.coordinator.resolve(f.request),{code:"MANAGED_AUTH_PROVIDER_UNAVAILABLE"});
 assert.equal(await f.coordinator.resolve(f.request),null);assert.equal(calls,1);
 assert.equal((await f.db.query("select revoked from managed_auth_session_state")).rows[0].revoked,true);
});
test("an active lease rejects another process; abandoned rotation is fenced after expiry",async t=>{
 const f=await fixture(t),lease="00000000-0000-4000-8000-000000000003";
 const doc={...f.request,projectId,providerOrigin,leaseToken:lease};
 await f.db.query("select managed_session_state_operation('claim',$1::jsonb)",[doc]);
 await assert.rejects(f.coordinator.resolve(f.request),{code:"MANAGED_SESSION_STORE_UNAVAILABLE"});
 await f.db.query("select managed_session_state_operation('begin_rotation',$1::jsonb)",[doc]);
 await f.db.query("update managed_auth_session_state set lease_until=now()-interval '1 second' where session_id=$1",[sessionId]);
 assert.equal(await f.coordinator.resolve(f.request),null);assert.equal(f.refreshes(),0);
});
test("ordinary role cannot call provider-state RPC",async t=>{
 const f=await fixture(t);await f.db.exec("create role session_client; set role session_client");
 try{await assert.rejects(f.db.query("select managed_session_state_operation('claim',$1::jsonb)",[{...f.request,projectId,providerOrigin}]));}
 finally{await f.db.exec("reset role");}
});
test("transport timeout is one request and never retries or exposes server key",async()=>{
 let calls=0;const repo=createMeooSessionStateRepository({projectId,providerOrigin,serviceRoleKey:"synthetic-server",fetchImpl:async()=>{calls++;throw new Error("synthetic-server private failure");}});
 await assert.rejects(repo.withLockedSession({projectId,providerOrigin,sessionId,surface:"merchant"},()=>{}),e=>e.code==="MANAGED_SESSION_STORE_UNAVAILABLE"&&!e.message.includes("synthetic-server"));assert.equal(calls,1);
});
