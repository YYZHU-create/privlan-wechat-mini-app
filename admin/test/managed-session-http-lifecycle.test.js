"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createPortableTestDatabase}=require("../database");
const {createSaasService}=require("../saas-service");
const {createManagedSessionLifetime}=require("../managed-session-lifetime");
const {createManagedSessionStateRepository}=require("../managed-session-state-repository");
const {registerMerchantRoutes,registerOpsAuthRoutes}=require("../merchant-routes");
process.env.NODE_ENV="test";
test("HTTP refresh preserves both fixed deadlines and password change rejects both old cookies",{timeout:20000},async t=>{
  const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),http=require("node:http"),express=require("express");
  const db=await createPortableTestDatabase();t.after(()=>db.close());
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"managed-session-lifecycle-"));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const original=await createSaasService({db}).register({login:"fixture@example.test",password:"original-synthetic-password",storeName:"Original Store"});
  const operator="00000000-0000-4000-8000-000000000003",subject="00000000-0000-4000-8000-000000000001",projectId="asmhysidbg5g",providerOrigin="https://provider.example.test";
  await db.query("insert into operator_users(id,email,display_name,password_hash,role,status) values($1,'ops-admin@localhost','Original Operator','unusable','super_admin','active')",[operator]);
  for(const [surface,merchant,ops] of [["merchant",original.user.id,null],["operator",null,operator]])await db.query("insert into managed_auth_identity_links(project_id,provider_origin,surface,provider_user_id,merchant_user_id,operator_user_id) values($1,$2,$3,$4,$5,$6)",[projectId,providerOrigin,surface,subject,merchant,ops]);
  const before=(await db.query("select id,password_hash from users union all select id,password_hash from operator_users order by id")).rows;
  let clock=Date.now(),refreshes=0,passwordChanges=0;
  const identity=surface=>({surface,businessUserId:surface==="merchant"?original.user.id:operator,providerUserId:subject,principal:surface==="merchant"?{id:original.user.id,status:"active",login_identifier:"fixture@example.test"}:{id:operator,status:"active",display_name:"Original Operator",role:"super_admin"}});
  const state=surface=>({accessToken:surface+"-private-access",refreshToken:surface+"-private-refresh",expiresAt:(clock+3600000)/1000});
  const managedAuth={login:async({surface})=>({identity:identity(surface),session:state(surface)}),resolve:async(_token,surface)=>identity(surface),refresh:async({surface,businessUserId})=>{assert.equal(businessUserId,identity(surface).businessUserId);refreshes++;return {identity:identity(surface),session:state(surface)};},changePassword:async()=>{passwordChanges++;return {passwordChanged:true,proofSessionRevoked:true,affectedBusinessIdentities:[{surface:"merchant",businessUserId:original.user.id},{surface:"operator",businessUserId:operator}]};}};
  const repository=createManagedSessionStateRepository({db,projectId,providerOrigin});
  const sessions=createManagedSessionLifetime({projectId,providerOrigin,key:Buffer.alloc(32,2),repository,managedAuth,now:()=>clock});
  const service=createSaasService({db,managedAuth,managedSessions:sessions});
  const app=express();app.use(express.json());registerMerchantRoutes(app,async()=>service,{dataRoot:directory});registerOpsAuthRoutes(app,async()=>service);
  const server=http.createServer(app);await new Promise(r=>server.listen(0,"127.0.0.1",r));t.after(()=>new Promise(r=>server.close(r)));const origin=`http://127.0.0.1:${server.address().port}`;
  async function login(operator){const response=await fetch(origin+(operator?"/ops/v1/auth/login":"/auth/login"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({login:"fixture@example.test",email:"fixture@example.test",password:"original-synthetic-password"})});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/private-access|private-refresh/);return response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");}
  const merchantCookie=await login(false),operatorCookie=await login(true);
  const persisted=()=>db.query("select session_id,deadline_ms,issued_at_ms,encrypted_state from managed_auth_session_state order by surface");
  const first=(await persisted()).rows;assert.equal(first.length,2);
  clock+=3600000;
  for(const [route,cookie] of [["/auth/session",merchantCookie],["/ops/v1/auth/session",operatorCookie]]){const response=await fetch(origin+route,{headers:{Cookie:cookie}});assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/private-access|private-refresh/);}
  assert.equal(refreshes,2);
  const refreshed=(await persisted()).rows;for(let i=0;i<2;i++){assert.equal(refreshed[i].deadline_ms,first[i].deadline_ms);assert.equal(refreshed[i].issued_at_ms,first[i].issued_at_ms);assert.notEqual(refreshed[i].encrypted_state,first[i].encrypted_state);}
  const csrf=merchantCookie.split("; ").find(c=>c.startsWith("atelier_csrf=")).split("=").slice(1).join("=");
  const changed=await fetch(origin+"/auth/change-password",{method:"POST",headers:{Cookie:merchantCookie,"Content-Type":"application/json","x-atelier-csrf":csrf},body:JSON.stringify({currentPassword:"original-synthetic-password",newPassword:"new-synthetic-password"})});assert.equal(changed.status,200);assert.equal((await changed.json()).ok,true);assert.equal((await db.query("select count(*)::int count from merchant_sessions where auth_provider='supabase' and revoked_at is not null")).rows[0].count,1);assert.equal((await db.query("select count(*)::int count from operator_sessions where revoked_at is not null")).rows[0].count,1);assert.equal(passwordChanges,1);
  for(const [route,cookie] of [["/auth/session",merchantCookie],["/ops/v1/auth/session",operatorCookie]]){const response=await fetch(origin+route,{headers:{Cookie:cookie}});const result=await response.json();assert.ok(response.status===401||result.data===null||result.data?.authenticated===false);}
  assert.equal(refreshes,2);
  assert.deepEqual((await db.query("select id,password_hash from users union all select id,password_hash from operator_users order by id")).rows,before);
  assert.equal((await db.query("select id from workspaces")).rows[0].id,original.workspace.id);
});
