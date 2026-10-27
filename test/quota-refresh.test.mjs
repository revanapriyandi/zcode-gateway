import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotaReader,refreshAccount } from '../src/upstream.ts';
import { quotaSummary } from '../src/plans.ts';

test('forced quota refresh discovers new grants despite the normal cache',async()=>{
 let calls=0,available=false;
 const a={id:'a',enabled:true,token:'fixture',models:[]};
 const quota=createQuotaReader({accounts:[a],save(){}},{fetcher:async()=>{
  calls++;
  return Response.json({code:0,data:{plans:available?[{status:'active',entitlements:[{capabilities:['model:glm-5.3-flash']}]}]:[],balances:[]}});
 }});
 await quota();assert.deepEqual(a.models,[]);assert.equal(calls,2);
 available=true;await quota();assert.deepEqual(a.models,[]);assert.equal(calls,2);
 await quota({force:true});assert.deepEqual(a.models,['glm-5.3-flash']);assert.equal(calls,4);
});

test('quota reports auto-claim status without account credentials',()=>{
 const a={id:'a',enabled:true,token:'never-publish',autoClaim:{checkedAt:1,status:'idle',plans:[]}};
 const q=quotaSummary([a]);
 assert.equal(q.accounts[0].autoClaim.status,'idle');assert.doesNotMatch(JSON.stringify(q),/never-publish/);
});

test('claimed future grants are discovered only after their activation time',async()=>{
 const later=Date.now()/1000+3600;
 const r=await refreshAccount({token:'fixture'},async()=>Response.json({code:0,data:{plans:[
  {status:'active',starts_at:later,entitlements:[{capabilities:['model:future-plan']}]},
  {status:'active',entitlements:[{effective_at:later,capabilities:['model:future-grant']},{capabilities:['model:active-grant']}]},
 ],balances:[]}}));
 assert.deepEqual(r.models,['active-grant']);
});
