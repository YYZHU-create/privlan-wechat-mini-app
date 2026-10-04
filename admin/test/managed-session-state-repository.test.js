"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createPortableTestDatabase}=require("../database");
const {createSaasService}=require("../saas-service");
const {createManagedSessionLifetime}=require("../managed-session-lifetime");
const {createManagedSessionStateRepository}=require("../managed-session-state-repository");
process.env.NODE_ENV="test";
const projectId="asmhysidbg5g",providerOrigin="https://provider.example.test",subject="00000000-0000-4000-8000-000000000001",sessionId="00000000-0000-4000-8000-000000000002";
async function fixture(t){
  const db=await createPortableTestDatabase();t.after(()=>db.close());
  const original=await createSaasService({db}).register({login:"fixture@example.test",password:"synthetic-password",storeName:"Store"});
  await db.query("insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id) values($1,$2,'merchant',$3,$4)",[projectId,providerOrigin,subject,original.user.id]);
  await db.query("insert into merchant_sessions(id,user_id,workspace_id,token_hash,csrf_token_hash,expires_at,auth_provider) values($1,$2,$3,'synthetic-token','synthetic-csrf',now()+interval '7 days','supabase')",[sessionId,original.user.id,original.workspace.id]);
  let now=Date.now(),refreshes=0;
  const identity={surface:"merchant",businessUserId:original.user.id,providerUserId:subject,principal:{id:original.user.id,status:"active"}};
  const session=()=>({accessToken:"synthetic-private-access",refreshToken:"synthetic-private-refresh",expiresAt:(now+3600000)/1000});
  const managedAuth={resolve:async()=>identity,refresh:async()=>{refreshes++;return {identity,session:session()}}};
  const repository=createManagedSessionStateRepository({db,projectId,providerOrigin});
  const config={projectId,providerOrigin,key:Buffer.alloc(32,3),repository,managedAuth,now:()=>now};
  const request={sessionId,surface:"merchant",businessUserId:original.user.id};
  return {db,original,request,config,identity,session,repository,coordinator:createManagedSessionLifetime(config),advance:ms=>{now+=ms},refreshes:()=>refreshes};
}
test("encrypted provider state survives coordinator reconstruction with unchanged business identity",async t=>{
  const f=await fixture(t);const tables=["users","operator_users","tenants","workspaces","memberships","subscriptions","stores"];
  const snapshot=async()=>{const rows=[];for(const name of tables)rows.push((await f.db.query(`select * from ${name}`)).rows.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));return rows;};
  const before=await snapshot();await f.coordinator.issue({...f.request,providerResult:{identity:f.identity,session:f.session()}});
  const persisted=(await f.db.query("select * from managed_auth_session_state")).rows;
  assert.equal(persisted.length,1);assert.doesNotMatch(JSON.stringify(persisted),/synthetic-private/);
  const restored=createManagedSessionLifetime(f.config);const r=await restored.resolve(f.request);
  assert.equal(r.identity.businessUserId,f.original.user.id);
  assert.deepEqual(await snapshot(),before);
});
test("ordinary database roles cannot read ciphertext and fixed deadline constraint cannot be extended",async t=>{
  const f=await fixture(t);await f.coordinator.issue({...f.request,providerResult:{identity:f.identity,session:f.session()}});
  await assert.rejects(f.db.query("update managed_auth_session_state set deadline_ms=deadline_ms+1 where session_id=$1",[sessionId]));
  await assert.rejects(f.db.query("update managed_auth_session_state set merchant_session_id=null where session_id=$1",[sessionId]));
  await f.db.exec("create role session_client; set role session_client");
  try{await assert.rejects(f.db.query("select encrypted_state from managed_auth_session_state"));}
  finally{await f.db.exec("reset role");}
});
test("two repository/coordinator instances serialize a single refresh on database transaction",async t=>{
  const f=await fixture(t);await f.coordinator.issue({...f.request,providerResult:{identity:f.identity,session:f.session()}});f.advance(3600000);
  const other=createManagedSessionLifetime({...f.config,repository:createManagedSessionStateRepository({db:f.db,projectId,providerOrigin})});
  await Promise.all([f.coordinator.resolve(f.request),other.resolve(f.request)]);assert.equal(f.refreshes(),1);
});
test("revoked original application session rejects persisted provider state",async t=>{
  const f=await fixture(t);await f.coordinator.issue({...f.request,providerResult:{identity:f.identity,session:f.session()}});
  await f.db.query("update merchant_sessions set revoked_at=now() where id=$1",[sessionId]);
  assert.equal(await f.coordinator.resolve(f.request),null);assert.equal(f.refreshes(),0);
});
test("wrong binding and duplicate state cannot change existing provider row",async t=>{
  const f=await fixture(t);await f.coordinator.issue({...f.request,providerResult:{identity:f.identity,session:f.session()}});
  const before=(await f.db.query("select * from managed_auth_session_state")).rows;
  await assert.rejects(f.repository.withLockedSession({projectId:"g8o5cv1om41o",providerOrigin,sessionId,surface:"merchant"},()=>{}),{code:"MANAGED_SESSION_BINDING_INVALID"});
  await assert.rejects(f.coordinator.issue({...f.request,providerResult:{identity:f.identity,session:f.session()}}));
  assert.deepEqual((await f.db.query("select * from managed_auth_session_state")).rows,before);
});


test("login caller transaction owns application session and encrypted state atomically", {timeout:15000}, async t=>{
  const f=await fixture(t);
  await f.db.query("delete from merchant_sessions where id=$1",[sessionId]);
  const originalTransaction=f.db.transaction.bind(f.db);let nestedCalls=0;
  const repository=createManagedSessionStateRepository({db:{query:f.db.query.bind(f.db),transaction:()=>{nestedCalls++;throw new Error("nested transaction");}},projectId,providerOrigin});
  const coordinator=createManagedSessionLifetime({...f.config,repository});
  async function login(tx){
    await tx.query("insert into merchant_sessions(id,user_id,workspace_id,token_hash,csrf_token_hash,expires_at,auth_provider) values($1,$2,$3,'joined-token','joined-csrf',now()+interval '7 days','supabase')",[sessionId,f.original.user.id,f.original.workspace.id]);
    await coordinator.issue({...f.request,providerResult:{identity:f.identity,session:f.session()},transaction:tx});
  }
  await assert.rejects(originalTransaction(async tx=>{await login(tx);throw new Error("later login failure");}),/later login failure/);
  assert.equal((await f.db.query("select * from merchant_sessions where id=$1",[sessionId])).rows.length,0);
  assert.equal((await f.db.query("select * from managed_auth_session_state where session_id=$1",[sessionId])).rows.length,0);
  await originalTransaction(login);
  assert.equal(nestedCalls,0);
  assert.equal((await f.db.query("select * from managed_auth_session_state where session_id=$1",[sessionId])).rows.length,1);
  assert.equal((await f.coordinator.resolve(f.request)).identity.businessUserId,f.original.user.id);
});
