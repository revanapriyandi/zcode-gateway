import assert from 'node:assert/strict';
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const key=process.env.TEST_API_KEY || process.env.ZCODE_API_KEYS?.split(',')[0];
const model=process.env.TEST_MODEL || 'glm-5.3-flash';
const headers={Authorization:'Bearer '+key,'Content-Type':'application/json'};
const call=async(path,body)=>{
 const r=await fetch(base+path,{method:'POST',headers,body:JSON.stringify({...body,max_tokens:2048}),signal:AbortSignal.timeout(180000)});
 if(!r.ok)throw new Error(path+' HTTP '+r.status+' '+await r.text());return r;
};
const schema={type:'object',properties:{city:{type:'string'}},required:['city']};
const prompt='Call get_test_weather for Jakarta. After receiving its result, report the exact test_marker.';
const fake=JSON.stringify({city:'Jakarta',test_marker:'ZCODE_PROTOCOL_TOOL_913'});
const checks=[];
{
 const tools=[{name:'get_test_weather',description:'Synthetic weather test.',input_schema:schema}];
 const messages=[{role:'user',content:prompt}];
 const first=await(await call('/v1/messages',{model,system:'Use tools as requested.',messages,tools})).json();
 const calls=first.content.filter(p=>p.type==='tool_use');assert.ok(calls.length);
 messages.push({role:'assistant',content:first.content},{role:'user',content:calls.map(c=>({type:'tool_result',tool_use_id:c.id,content:fake}))});
 const last=await(await call('/v1/messages',{model,system:'Use tools as requested.',messages,tools})).json();
 assert.match(last.content.filter(p=>p.type==='text').map(p=>p.text).join(''),/ZCODE_PROTOCOL_TOOL_913/);
 checks.push('Anthropic tool_use/tool_result continuation');console.error('PASS '+checks.at(-1));
}
{
 const tools=[{type:'function',name:'get_test_weather',description:'Synthetic weather test.',parameters:schema}];
 const first=await(await call('/v1/responses',{model,instructions:'Use tools as requested.',input:prompt,tools})).json();
 const calls=first.output.filter(p=>p.type==='function_call');assert.ok(calls.length);
 const last=await(await call('/v1/responses',{model,...(process.env.TEST_STATELESS==='1'?{input:[{role:'user',content:prompt},...first.output.filter(p=>p.type==='message'||p.type==='function_call'),...calls.map(c=>({type:'function_call_output',call_id:c.call_id,output:fake}))]}:{previous_response_id:first.id,input:calls.map(c=>({type:'function_call_output',call_id:c.call_id,output:fake}))}),tools})).json();
 assert.match(last.output_text,/ZCODE_PROTOCOL_TOOL_913/);
 checks.push('Responses function_call/function_call_output continuation ('+(process.env.TEST_STATELESS==='1'?'full history':'previous_response_id')+')');console.error('PASS '+checks.at(-1));
}
{
 const tools=[{type:'function',function:{name:'get_test_weather',description:'Synthetic weather test.',parameters:schema}}];
 const r=await call('/v1/chat/completions',{model,stream:true,messages:[{role:'user',content:prompt}],tools});
 const frames=(await r.text()).split('\n').filter(l=>l.startsWith('data: ')&&!l.includes('[DONE]')).map(l=>JSON.parse(l.slice(6)));
 const calls=frames.flatMap(f=>f.choices?.[0]?.delta?.tool_calls || []);
 assert.ok(calls.some(c=>c.function?.name==='get_test_weather'));
 assert.ok(frames.some(f=>f.choices?.[0]?.finish_reason==='tool_calls'));
 checks.push('Streamed OpenAI tool-call deltas and finish reason');console.error('PASS '+checks.at(-1));
}
console.log(JSON.stringify({base,model,checks},null,2));
