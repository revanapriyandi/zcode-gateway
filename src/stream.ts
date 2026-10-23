import { randomUUID } from 'node:crypto';
import { toChat, toResponses } from './protocols.ts';

export async function write(res: any, value: string | Uint8Array) {
  if(res.destroyed) throw new Error('Client disconnected');
  if(!res.write(value)) await new Promise<void>((resolve,reject)=>{
    const cleanup=()=>{res.off('drain',drain);res.off('close',close);res.off('error',error);};
    const drain=()=>{cleanup();resolve();};const close=()=>{cleanup();reject(new Error('Client disconnected'));};const error=(e:Error)=>{cleanup();reject(e);};
    res.once('drain',drain);res.once('close',close);res.once('error',error);
  });
}
export async function* readEvents(body: ReadableStream) {
  const reader=body.getReader(),decoder=new TextDecoder();let pending='';
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;pending=(pending+decoder.decode(value,{stream:true})).replace(/\r\n/g,'\n');
      if(pending.length>8*1024*1024)throw new Error('Upstream SSE event too large');
      let split;while((split=pending.indexOf('\n\n'))>=0){const frame=pending.slice(0,split);pending=pending.slice(split+2);const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(data&&data!=='[DONE]')yield JSON.parse(data);}
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function relay(response: Response, format: string, res: any, onComplete: (r:any)=>void, responseId='resp_'+randomUUID()) {
  let aggregate: any={id:'chatcmpl_'+randomUUID(),model:'',content:[],usage:{},stop_reason:null};
  let sequence=0,complete=false,started=false;
  const entries=new Map<number,any>(), outputIndices=new Map<number,number>();let nextOutput=0;
  const emit=async(type: string,data: any)=>{await write(res,(format==='responses'?'event: '+type+'\n':'')+'data: '+JSON.stringify(format==='responses'?{...data,type,sequence_number:sequence++}:data)+'\n\n');};
  const chunk=async(delta: any, finish: any=null, u?: any)=>emit('',{id:aggregate.id,object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:aggregate.model,choices:u?[]:[{index:0,delta,finish_reason:finish}],...(u?{usage:u}:{})});
  const itemFor=(block: any,index: number)=>block.type==='tool_use'?{id:'fc_'+responseId+'_'+index,type:'function_call',call_id:block.id,name:block.name,arguments:block.args || '',status:'in_progress'}:block.type==='thinking'?{id:'rs_'+responseId+'_'+index,type:'reasoning',summary:[]}: {id:'msg_'+responseId+'_'+index,type:'message',role:'assistant',status:'in_progress',content:[]};
  for await(const e of readEvents(response.body!)) {
    if(e.type==='error')throw new Error('Upstream stream failed');
    if(!started){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'});started=true;}
    if(format==='messages')await write(res,'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n');
    if(e.type==='message_start'){
      aggregate={...e.message,content:[],usage:e.message.usage || {}};
      if(format==='chat')await chunk({role:'assistant',content:''});
      if(format==='responses'){const r={...toResponses(aggregate,responseId),status:'in_progress'};await emit('response.created',{response:r});await emit('response.in_progress',{response:r});}
    }
    if(e.type==='content_block_start'){
      const block={...e.content_block};if(block.type==='tool_use')block.args='';
      entries.set(e.index,block);aggregate.content[e.index]=block;outputIndices.set(e.index,nextOutput++);
      if(format==='chat'&&block.type==='tool_use')await chunk({tool_calls:[{index:[...entries.values()].filter(x=>x.type==='tool_use').length-1,id:block.id,type:'function',function:{name:block.name,arguments:''}}]});
      if(format==='responses'){
        const output_index=outputIndices.get(e.index),item=itemFor(block,e.index);
        await emit('response.output_item.added',{output_index,item});
        if(block.type==='text')await emit('response.content_part.added',{output_index,item_id:item.id,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
        if(block.type==='thinking')await emit('response.reasoning_summary_part.added',{output_index,item_id:item.id,summary_index:0,part:{type:'summary_text',text:''}});
      }
    }
    if(e.type==='content_block_delta'){
      const b=entries.get(e.index);if(!b)throw new Error('Delta without a content block');
      const d=e.delta;const item=itemFor(b,e.index),output_index=outputIndices.get(e.index);
      if(d.type==='text_delta'){
        b.text=(b.text || '')+d.text;
        if(format==='chat')await chunk({content:d.text});
        if(format==='responses')await emit('response.output_text.delta',{output_index,item_id:item.id,content_index:0,delta:d.text,logprobs:[]});
      }
      if(d.type==='thinking_delta'){
        b.thinking=(b.thinking || '')+d.thinking;
        if(format==='chat')await chunk({reasoning_content:d.thinking});
        if(format==='responses')await emit('response.reasoning_summary_text.delta',{output_index,item_id:item.id,summary_index:0,delta:d.thinking});
      }
      if(d.type==='signature_delta')b.signature=d.signature;
      if(d.type==='input_json_delta'){
        b.args+=d.partial_json;
        if(format==='chat')await chunk({tool_calls:[{index:[...entries.entries()].filter(([i,v])=>v.type==='tool_use').findIndex(([i])=>i===e.index),function:{arguments:d.partial_json}}]});
        if(format==='responses')await emit('response.function_call_arguments.delta',{output_index,item_id:item.id,delta:d.partial_json});
      }
    }
    if(e.type==='content_block_stop'){
      const b=entries.get(e.index);if(b?.type==='tool_use'){b.input=b.args?JSON.parse(b.args):b.input || {};delete b.args;}
      if(format==='responses'&&b){
        const item=itemFor(b,e.index),output_index=outputIndices.get(e.index);
        if(b.type==='text'){
          await emit('response.output_text.done',{item_id:item.id,output_index,content_index:0,text:b.text,logprobs:[]});
          await emit('response.content_part.done',{item_id:item.id,output_index,content_index:0,part:{type:'output_text',text:b.text,annotations:[]}});
        }
        if(b.type==='tool_use')await emit('response.function_call_arguments.done',{item_id:item.id,output_index,name:b.name,arguments:JSON.stringify(b.input)});
        if(b.type==='thinking'){
          await emit('response.reasoning_summary_text.done',{item_id:item.id,output_index,summary_index:0,text:b.thinking});
          await emit('response.reasoning_summary_part.done',{item_id:item.id,output_index,summary_index:0,part:{type:'summary_text',text:b.thinking}});
        }
        const final=toResponses({content:[b]},responseId).output[0];if(final)await emit('response.output_item.done',{output_index,item:{...final,id:item.id}});
      }
    }
    if(e.type==='message_delta'){Object.assign(aggregate,e.delta);Object.assign(aggregate.usage,e.usage || {});}
    if(e.type==='message_stop'){complete=true;break;}
  }
  if(!complete)throw new Error('Upstream stream ended before message_stop');
  onComplete(aggregate);
  if(format==='chat'){const r=toChat(aggregate);await chunk({},r.choices[0].finish_reason);await chunk({},null,r.usage);await write(res,'data: [DONE]\n\n');}
  if(format==='responses'){const response=toResponses(aggregate,responseId);await emit(response.status==='incomplete'?'response.incomplete':'response.completed',{response});}
  res.end();return aggregate;
}
