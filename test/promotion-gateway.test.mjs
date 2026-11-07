import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createAutoClaim } from '../src/claims.ts';
import { createQuotaReader, createUpstream } from '../src/upstream.ts';
import { createGateway } from '../src/server.ts';

test('background claim activates balance models and all three HTTP protocols use the modern template',async t=>{
 const template={version:2,appVersion:'3.17.2',prefix:'fixture prefix',stable:'fixture stable',before:'fixture behavior',after:'fixture context',context:{platform:'win32',arch:'x64',timezone:'UTC',cwd:'fixture',shell:'pwsh',release:'fixture'}};
 const a={id:'a',enabled:true,token:'private-upstream',deviceId:'private-device',models:[]};
 const vault={accounts:[a],save(){}};let claimed=false,posts=0;const inference=[];
 const expiry=Date.now()/1000+3600;
 const fetcher=async(url,init)=>{
  assert.equal(init.headers['X-ZCode-App-Version'],'3.17.2');
  if(url.includes('/billing/balance?'))return Response.json({code:0,data:{plans:claimed?[{plan_id:'event',user_plan_id:'event-instance',status:'active',ends_at:expiry}]:[],balances:claimed?[{user_plan_id:'event-instance',capabilities:['model:glm-5.3-flash'],expires_at:expiry,total_units:100,used_units:0,remaining_units:100}]:[]}});
  if(url.includes('/billing/preview?'))return Response.json({code:0,data:{plans:[]}});
  if(url.includes('/marketing/touch?'))return Response.json({code:0,data:{deliveries:[{campaign_id:'event',resource_position:'banner',banner:{buttons:[{action:{type:'claim_zcode_plan',args:{plan_id:'event'}}}]}}]}});
  if(url.endsWith('/billing/claim')){claimed=true;posts++;return Response.json({code:0,data:{plan:{plan_id:'event',ends_at:expiry}}});}
  if(url.endsWith('/messages')) {
   const body=JSON.parse(init.body);inference.push(body);
   return Response.json({id:'msg_fixture',type:'message',role:'assistant',model:body.model,content:[{type:'text',text:'fixture answer'}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:3}});
  }
  throw Error('Unexpected endpoint');
 };
 const quota=createQuotaReader(vault,{template,fetcher});
 const runner=createAutoClaim(vault,template,quota,{fetcher});t.after(()=>runner.stop());
 runner.start();await runner.run();assert.equal(posts,1);assert.deepEqual(a.models,['glm-5.3-flash']);
 const key='fixture-client-key-24-characters';
 const server=createGateway({keys:[key],models:()=>a.models,quota,generate:createUpstream(vault,template,{fetcher})});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
 const catalog=await(await fetch(base+'/v1/models',{headers})).json();assert.equal(catalog.data[0].id,'glm-5.3-flash');
 for(const path of ['/v1/chat/completions','/v1/responses','/v1/messages']) {
  const body={model:'glm-5.3-flash',max_tokens:32,...path.endsWith('/responses')?{input:'hello'}:{messages:[{role:'user',content:'hello'}]}};
  const response=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal(response.status,200,await response.clone().text());assert.match(await response.text(),/fixture answer/);
 }
 assert.equal(inference.length,3);
 for(const body of inference){assert.doesNotMatch(body.system[2].text,/# Environment/);assert.match(body.messages[0].content[0].text,/# Environment/);}
 assert.equal(posts,1);
});
