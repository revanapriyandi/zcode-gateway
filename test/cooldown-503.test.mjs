import test from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from '../src/accounts.ts';
import { createUpstream } from '../src/upstream.ts';
import { createGateway } from '../src/server.ts';

const template={version:1,appVersion:'test',prefix:'fixture',stable:'fixture',before:'fixture',after:'fixture'};
const request={model:'glm-5.3-flash',messages:[{role:'user',content:[{type:'text',text:'hi'}]}],max_tokens:8};
const account=()=>({id:'eligible',enabled:true,token:'fixture',models:['glm-5.3-flash']});

test('subsequent calls retain upstream rate limit during cooldown without calling upstream',async()=>{
 let calls=0;
 const generate=createUpstream({accounts:[account()],save(){}},template,{fetcher:async()=>{calls++;return Response.json({code:1302},{status:429,headers:{'retry-after':'30'}});}});
 for(let i=0;i<2;i++)await assert.rejects(generate(request,false,new AbortController().signal),e=>e.status===429&&e.code===1302&&e.retryAfter>0&&e.retryAfter<=30);
 assert.equal(calls,1);
});

test('pool preserves cooldown reason until expiration and keeps ineligible accounts excluded',()=>{
 let now=1000;
 const p=new Pool([{...account(),id:'disabled',enabled:false},account()],()=>now);
 p.cooldown('eligible',30000,{status:429,code:1302,message:'ZCode upstream rejected request (code 1302)'});
 assert.throws(()=>p.acquire(request.model),e=>e.status===429&&e.code===1302&&e.retryAfter===30);
 now+=30000;
 const lease=p.acquire(request.model);assert.equal(lease.account.id,'eligible');lease.release();
});

test('HTTP rate-limit response includes retry-after on the initial and cooldown rejection',async(t)=>{
 let calls=0;
 const generate=createUpstream({accounts:[account()],save(){}},template,{fetcher:async()=>{calls++;return Response.json({code:1302},{status:429,headers:{'retry-after':'30'}});}});
 const server=createGateway({keys:['fixture-client'],models:()=>[request.model],generate});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 for(let i=0;i<2;i++){
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/v1/messages',{method:'POST',headers:{authorization:'Bearer fixture-client','content-type':'application/json'},body:JSON.stringify(request)});
  assert.equal(response.status,429);assert.ok(Number(response.headers.get('retry-after'))>0);
  assert.match((await response.json()).error.message,/1302/);
 }
 assert.equal(calls,1);
});
