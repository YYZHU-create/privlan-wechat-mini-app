'use strict';
const fs=require('fs');
for(const l of fs.readFileSync('.env','utf8').split(/\r?\n/)){const m=l.match(/^\s*([^=]+)=(.*)$/);if(m)process.env[m[1]]=m[2]}
const {createLiveClient,cleanupFixture}=require('../admin/test/meoo-live-fixtures');
const client=createLiveClient(); const base=process.env.SUPABASE_URL.replace(/\/$/,''); const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
async function get(path){const r=await fetch(base+path,{headers:{apikey:key,Authorization:`Bearer ${key}`}}); if(!r.ok) throw new Error(`GET ${path} ${r.status} ${await r.text()}`); return r.json();}
async function del(table,filter){try{await client.remove(table,filter); return true}catch(e){if(/23503/.test(e.message)) return false; throw e;}}
(async()=>{
 const tenants=await get('/rest/v1/tenants?name=like.B1%20synthetic%20tenant%20*&select=id,name&order=created_at.asc');
 const summary=[];
 for(const tenant of tenants){
  const workspaces=await get(`/rest/v1/workspaces?tenant_id=eq.${tenant.id}&select=id`);
  const users=await get(`/rest/v1/memberships?tenant_id=eq.${tenant.id}&select=user_id`);
  try { let last; for (let attempt=1; attempt<=4; attempt++) { try { for (const w of workspaces) await cleanupFixture({client,tenantId:tenant.id,workspaceId:w.id}); last=null; break; } catch (error) { last=error; if (attempt<4) await new Promise(r=>setTimeout(r,1000*attempt)); } } if(last) throw last; } catch (error) { console.log(`CLEANUP_FAIL ${tenant.id} ${error.message}`); continue; }
  for(const u of users){await del('users',{id:u.user_id});}
  const versions=await get(`/rest/v1/workflow_versions?tenant_id=eq.${tenant.id}&select=id`);
  if(versions.length===0){for(const w of workspaces){await del('workspaces',{id:w.id});} await del('tenants',{id:tenant.id}); summary.push({id:tenant.id,removed:true,protected:0});}
  else summary.push({id:tenant.id,removed:false,protected:versions.length});
 }
 console.log(JSON.stringify({tenants:tenants.length,summary},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1});
