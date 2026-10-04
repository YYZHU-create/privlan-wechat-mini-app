"use strict";
const {randomUUID}=require("node:crypto");
function failure(code){const e=new Error(code);e.code=code;return e;}
function createMeooSessionStateRepository({projectId,providerOrigin,serviceRoleKey,fetchImpl=globalThis.fetch}){
  let origin;try{origin=new URL(providerOrigin);}catch{throw failure("MANAGED_SESSION_STORE_NOT_CONFIGURED");}
  if(!["asmhysidbg5g","g8o5cv1om41o"].includes(projectId)||origin.protocol!=="https:"||origin.origin!==providerOrigin||typeof serviceRoleKey!=="string"||!serviceRoleKey.trim()||typeof fetchImpl!=="function")throw failure("MANAGED_SESSION_STORE_NOT_CONFIGURED");
  function bound(input){
    if(input.projectId!==projectId||input.providerOrigin!==providerOrigin||!["merchant","operator"].includes(input.surface))throw failure("MANAGED_SESSION_BINDING_INVALID");
  }
  async function rpc(action,doc){
    try{
      const r=await fetchImpl(`${providerOrigin}/rest/v1/rpc/managed_session_state_operation`,{
        method:"POST",redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000),
        headers:{apikey:serviceRoleKey,Authorization:`Bearer ${serviceRoleKey}`,"Content-Type":"application/json",Accept:"application/json"},
        body:JSON.stringify({p_action:action,p_doc:doc})});
      if(!r.ok)throw new Error();return await r.json();
    }catch{throw failure("MANAGED_SESSION_STORE_UNAVAILABLE");}
  }
  async function insert(row){bound(row);if((await rpc("insert",row))?.saved!==true)throw failure("MANAGED_SESSION_STORE_WRITE_NOT_CONFIRMED");}
  async function withLockedSession(input,callback){
    bound(input);const doc={projectId,providerOrigin,sessionId:input.sessionId,surface:input.surface,leaseToken:randomUUID()};
    const row=await rpc("claim",doc);if(!row)return null;
    let result,originalError;
    try{result=await callback({row,
      markRefreshStarted:async()=>{if((await rpc("begin_rotation",doc))?.saved!==true)throw failure("MANAGED_SESSION_STORE_WRITE_NOT_CONFIRMED");},
      updateEncryptedState:async encryptedState=>{if((await rpc("save",{...doc,encryptedState}))?.saved!==true)throw failure("MANAGED_SESSION_STORE_WRITE_NOT_CONFIRMED");}
    });}catch(e){originalError=e;}
    try{if((await rpc("release",doc))?.saved!==true)throw failure("MANAGED_SESSION_STORE_WRITE_NOT_CONFIRMED");}
    catch(e){if(!originalError)throw e;}
    if(originalError)throw originalError;return result;
  }
  return {insert,withLockedSession};
}
module.exports={createMeooSessionStateRepository};
