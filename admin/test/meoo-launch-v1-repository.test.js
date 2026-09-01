'use strict';
const test=require('node:test'); const assert=require('node:assert/strict'); const {createMeooLaunchV1Repository}=require('../meoo-launch-v1-repository'); const {SupabaseAdapterError}=require('../meoo-supabase-adapter');

test('membership evaluation converges when active membership appears after a unique conflict', async()=>{
  const scope={tenantId:'t',workspaceId:'w',storeId:'s',userId:'u'}; const customerId='c', basic='basic', gold='gold', membership={id:'m',tenant_id:'t',workspace_id:'w',store_id:'s',customer_id:customerId,level_id:gold,status:'active'}; let membershipReads=0;
  const adapter={
    async readResource(table){
      if(table==='customers') return [{id:customerId,total_spend_fen:10}];
      if(table==='membership_overrides'||table==='customer_points_accounts') return [];
      if(table==='membership_levels') return [{id:basic,name:'Basic',level_order:1,enabled:true},{id:gold,name:'Gold',level_order:2,enabled:true}];
      if(table==='membership_level_rules') return [{level_id:gold,spend_threshold_fen:1,enabled:true}];
      if(table==='customer_memberships') return membershipReads++===0?[]:[membership];
      throw new Error(`unexpected read ${table}`);
    },
    async insertResource(table){ if(table==='customer_memberships') throw new SupabaseAdapterError('RESOURCE_CONFLICT_UNIQUE','resource conflict',409); throw new Error(`unexpected insert ${table}`); },
    async updateResource(){ throw new Error('update should not be needed after same-level conflict'); }
  };
  const result=await createMeooLaunchV1Repository({adapter}).membershipEvaluate(scope,customerId);
  assert.deepEqual(result,{changed:false,levelId:gold,levelName:'Gold',levelOrder:2});
});
