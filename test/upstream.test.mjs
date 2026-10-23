import test from 'node:test';
import assert from 'node:assert/strict';
import { createUpstream } from '../src/upstream.ts';

const template={version:1,appVersion:'test',prefix:'fixture',stable:'fixture',before:'fixture',after:'fixture'};
const request={model:'glm-5.3',messages:[{role:'user',content:[{type:'text',text:'hi'}]}],max_tokens:64};
const vault=()=>({accounts:[{id:'one',enabled:true,token:'secret-one',models:['glm-5.3']},{id:'two',enabled:true,token:'secret-two',models:['glm-5.3']}],save(){}});
test('quota/rate failure moves to another account before returning output',async()=>{
 const credentials=[];
 const generate=createUpstream(vault(),template,{fetcher:async(url,init)=>{
   credentials.push(init.headers.Authorization);
   return credentials.length===1?Response.json({error:{code:'rate_limit'}},{status:429}):Response.json({type:'message',content:[]});
 }});
 const r=await generate(request,false,new AbortController().signal);assert.equal(r.status,200);await r.text();
 assert.deepEqual(credentials,['Bearer secret-one','Bearer secret-two']);
});
test('risk-control rejection is returned without rotating around the account block',async()=>{
 let calls=0;
 const generate=createUpstream(vault(),template,{fetcher:async()=>{calls++;return Response.json({code:3012},{status:405});}});
 await assert.rejects(generate(request,false,new AbortController().signal),/3012/);assert.equal(calls,1);
});
test('a returned stream retains its lease until consumed or cancelled',async()=>{
 const v=vault();v.accounts.pop();let calls=0;
 const generate=createUpstream(v,template,{fetcher:async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data'));}}));}});
 const first=await generate(request,true,new AbortController().signal);
 await assert.rejects(generate(request,true,new AbortController().signal),/available/);
 assert.equal(calls,1);await first.body.cancel();
 const second=await generate(request,true,new AbortController().signal);assert.equal(calls,2);await second.body.cancel();
});
