import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGateway } from '../src/server.ts';

const model='glm-5.3-flash';
const headers={Authorization:'Bearer test-client-secret','Content-Type':'application/json'};
const output={id:'msg_test',model,content:[{type:'text',text:'OK'}],stop_reason:'end_turn',usage:{input_tokens:1,output_tokens:1}};

async function serve(t,options){
 const server=createGateway({keys:['test-client-secret'],...options});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
 return 'http://127.0.0.1:'+server.address().port;
}

for(const [endpoint,body] of [
 ['chat/completions',{model,messages:[{role:'user',content:'hi'}]}],
 ['responses',{model,input:'hi'}],
 ['messages',{model,max_tokens:16,messages:[{role:'user',content:'hi'}]}],
])test(endpoint+' refreshes missing model entitlements before rejecting the request',async t=>{
 let models=[],refreshes=0,generated=0;
 const url=await serve(t,{models:()=>models,quota:async()=>{refreshes++;models=[model];},generate:async()=>{generated++;return Response.json(output);}});
 const r=await fetch(url+'/v1/'+endpoint,{method:'POST',headers,body:JSON.stringify(body)});
 assert.equal(r.status,200);assert.equal(refreshes,1);assert.equal(generated,1);
});

test('model listing refreshes entitlements before publishing the catalog',async t=>{
 let models=[];
 const url=await serve(t,{models:()=>models,quota:async()=>{models=[model];},generate:()=>{throw Error('unexpected inference');}});
 const r=await fetch(url+'/v1/models',{headers});
 assert.deepEqual((await r.json()).data.map(m=>m.id),[model]);
});

test('a missing entitlement remains rejected after refresh without inference',async t=>{
 let refreshes=0;
 const url=await serve(t,{models:()=>[],quota:async()=>{refreshes++;},generate:()=>{throw Error('unexpected inference');}});
 const r=await fetch(url+'/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model,messages:[{role:'user',content:'hi'}]})});
 assert.equal(r.status,400);assert.equal(refreshes,1);
 assert.match((await r.json()).error.message,/not enabled/);
});

test('a known model does not refresh billing on every inference request',async t=>{
 const url=await serve(t,{models:()=>[model],quota:async()=>{throw Error('unnecessary refresh');},generate:async()=>Response.json(output)});
 const r=await fetch(url+'/v1/chat/completions',{method:'POST',headers,body:JSON.stringify({model,messages:[{role:'user',content:'hi'}]})});
 assert.equal(r.status,200);
});
