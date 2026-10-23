import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const key=process.env.TEST_API_KEY || process.env.ZCODE_API_KEYS?.split(',')[0];
if(!key)throw new Error('Set TEST_API_KEY');
const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
const model=process.env.TEST_MODEL || 'glm-5.3-flash';
const call=async(path,body)=>{
 body.max_tokens ??= 2048;
 const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});
 if(!r.ok)throw new Error(path+' HTTP '+r.status+' '+await r.text());return r;
};
const rows=[];
const passed=(test)=>{rows.push({test,passed:true});console.error('PASS '+test);};
for(const format of ['chat','messages','responses']){
 const path=format==='chat'?'/v1/chat/completions':format==='messages'?'/v1/messages':'/v1/responses';
 const request=format==='responses'?{model,instructions:'Answer exactly as requested.',input:'Hitung 17 kali 23. Jawab HASIL=391.'}:format==='chat'?{model,messages:[{role:'system',content:'Answer exactly as requested.'},{role:'user',content:'Hitung 17 kali 23. Jawab HASIL=391.'}]}:{model,system:'Answer exactly as requested.',messages:[{role:'user',content:'Hitung 17 kali 23. Jawab HASIL=391.'}]};
 const r=await (await call(path,request)).json();
 const answer=format==='chat'?r.choices[0].message.content:format==='messages'?r.content.filter(p=>p.type==='text').map(p=>p.text).join(''):r.output_text;
 assert.match(answer,/391/);passed(format+' JSON');
 const stream=await (await call(path,{...request,stream:true})).text();
 assert.match(stream,format==='chat'?/\[DONE\]/:format==='messages'?/message_stop/:/response.completed/);
 passed(format+' SSE');
 if(format==='responses'){
  const follow=await(await call(path,{model,previous_response_id:r.id,input:'Apa angka hasil perhitungan sebelumnya? Jawab angkanya saja.'})).json();assert.match(follow.output_text,/391/);passed('Responses previous_response_id');
 }
}
const tool={type:'function',function:{name:'get_test_weather',description:'Read synthetic test weather.',parameters:{type:'object',properties:{city:{type:'string'}},required:['city']}}};
const messages=[{role:'system',content:'Use the provided tool. Never invent tool results.'},{role:'user',content:'Use get_test_weather for Jakarta, then report its exact test_marker.'}];
const first=await(await call('/v1/chat/completions',{model,messages,tools:[tool],max_tokens:2048})).json();
const assistant=first.choices[0].message;
assert.ok(assistant.tool_calls?.some(c=>c.function.name==='get_test_weather'));
messages.push(assistant);
for(const c of assistant.tool_calls)messages.push({role:'tool',tool_call_id:c.id,content:JSON.stringify({city:'Jakarta',test_marker:'ZCODE_TOOL_CONTINUATION_742'})});
const last=await(await call('/v1/chat/completions',{model,messages,tools:[tool],max_tokens:2048})).json();
assert.match(last.choices[0].message.content,/ZCODE_TOOL_CONTINUATION_742/);
passed('Chat function call + synthetic result continuation');
console.log(JSON.stringify({base,model,checks:rows},null,2));
