import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createGateway } from '../src/server.ts';

const result = {id:'msg_test',model:'glm-5.3',content:[{type:'text',text:'answer'}],stop_reason:'end_turn',usage:{input_tokens:3,output_tokens:2}};
async function setup(fn) {
  const server = createGateway({keys:['test-client-secret','different-client-secret'],models:()=>['glm-5.3'],generate:fn});
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  return {server,url:'http://127.0.0.1:'+server.address().port};
}
test('HTTP authenticates requests and maintains client-scoped Responses continuation', async () => {
  const received=[];const {server,url}=await setup(async (b,stream)=>{received.push(b);return Response.json(result);});
  try {
    assert.equal((await fetch(url+'/v1/models')).status,401);
    const headers={Authorization:'Bearer test-client-secret','Content-Type':'application/json'};
    let r=await fetch(url+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'glm-5.3',input:'first'})});
    assert.equal(r.status,200);const first=await r.json();
    const denied=await fetch(url+'/v1/responses',{method:'POST',headers:{...headers,Authorization:'Bearer different-client-secret'},body:JSON.stringify({model:'glm-5.3',previous_response_id:first.id,input:'steal'})});
    assert.equal(denied.status,400);
    r=await fetch(url+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'glm-5.3',previous_response_id:first.id,input:'second'})});
    assert.equal(r.status,200);assert.equal(received[1].messages.length,3);
    r=await fetch(url+'/v1/responses',{method:'POST',headers,body:JSON.stringify({model:'glm-5.3',previous_response_id:'missing',input:'x'})});
    assert.equal(r.status,400);
  } finally {server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('chat streaming emits incremental chunks and terminal usage',async()=>{
  const events=[{type:'message_start',message:{...result,content:[],usage:{input_tokens:3,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'an'}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'swer'}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:2}},{type:'message_stop'}];
  const {server,url}=await setup(async()=>new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}}));
  try{
    const r=await fetch(url+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer test-client-secret','Content-Type':'application/json'},body:JSON.stringify({model:'glm-5.3',stream:true,messages:[{role:'user',content:'hi'}]})});
    const text=await r.text();assert.match(text,/"content":"an"/);assert.match(text,/"content":"swer"/);assert.match(text,/\[DONE\]/);assert.match(text,/"total_tokens":5/);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
