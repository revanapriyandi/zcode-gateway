import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshAccount } from '../src/upstream.ts';
import { quotaSummary, planSelection } from '../src/plans.ts';

test('quota preserves reported token counts, expiry and unknown counters',()=>{
 const records=[{id:'a',enabled:true,plan:'start-plan',plans:[{plan_id:'promo',name:'Promotion',status:'active',ends_at:2000000000}],quota:{checkedAt:1000,reported:{balances:[{capabilities:['model:glm-5.3'],total_units:200,used_units:12,remaining_units:188,expires_at:2000000000}]}}}];
 const q=quotaSummary(records);assert.equal(q.quotaBuckets.glm_5_3.total,200);assert.equal(q.quotas['glm-5.3'].total,200);assert.equal(q.quotas['glm-5.3'].used,12);assert.equal(q.quotas['glm-5.3'].remaining,188);assert.equal(q.quotas['glm-5.3'].resetAt,'2033-05-18T03:33:20.000Z');
 assert.equal(quotaSummary([{id:'b',enabled:true,models:['glm-5.3']}]).quotas['glm-5.3'],undefined);
});
test('default plan is Start Plan and paid routes require their own credential',()=>{
 assert.equal(planSelection({}).kind,'start-plan');
 assert.throws(()=>planSelection({plan:'coding-plan'}),/credential/);
 const coding=planSelection({plan:'coding-plan',codingKey:'private',provider:'zai'});
 assert.equal(coding.url,'https://api.z.ai/api/anthropic/v1/messages');
 assert.throws(()=>planSelection({plan:'unknown'}),/Unknown/);
});

test('quota aggregates enabled accounts and ignores expired grants',()=>{
 const bucket={capabilities:['model:glm-5.3-flash'],total_units:100,used_units:30,remaining_units:70};
 const account={enabled:true,quota:{reported:{balances:[bucket,{...bucket,total_units:1000,expires_at:1}]}}};
 const q=quotaSummary([{...account,id:'a'},{...account,id:'b'},{...account,id:'c',enabled:false}]);
 assert.equal(q.quotaBuckets.glm_5_3_flash.total,200);assert.equal(q.quotaBuckets.glm_5_3_flash.remaining,140);assert.equal(q.accounts.length,2);assert.equal(q.accounts[0].quotas['glm-5.3-flash'].total,100);
});

test('subscription discovery is independent of an expired Start Plan JWT',async()=>{
 const r=await refreshAccount({plan:'coding-plan',codingKey:'separate',codingModels:['glm-5.3'],needsLogin:true},()=>{throw new Error('must not call Start Plan billing');});
 assert.deepEqual(r.models,['glm-5.3']);assert.equal(r.quota.reported,null);assert.equal(r.needsLogin,true);
});
test('billing success does not clear an inference authentication failure',async()=>{
 const r=await refreshAccount({token:'test',needsLogin:true},async()=>Response.json({code:0,data:{plans:[],balances:[]}}));
 assert.equal(r.needsLogin,true);
});
