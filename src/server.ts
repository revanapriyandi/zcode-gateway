import http from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { normalize, toChat, toResponses, invalid } from './protocols.ts';
import { relay } from './stream.ts';

function hash(s: string){return createHash('sha256').update(s).digest();}
export function createGateway(options: any) {
  if(!options.keys?.length)throw new Error('At least one client API key is required');
  const keys=options.keys.map(hash), history=new Map<string,any>();
  return http.createServer(async(req,res)=>{
    const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort();});
    let format='chat';
    try{
      const token=String(req.headers.authorization || '').replace(/^Bearer\s+/i,'') || String(req.headers['x-api-key'] || '');
      if(!keys.some(k=>timingSafeEqual(k,hash(token))))throw Object.assign(new Error('Invalid API key'),{status:401});
      const owner=hash(token).toString('hex');
      const url=new URL(req.url || '/', 'http://localhost');
      if(req.method==='GET'&&url.pathname==='/health'){
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status:'ok',models:options.models().length}));return;
      }
      if(req.method==='GET'&&url.pathname==='/v1/models'){
        res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({object:'list',data:options.models().map(id=>({id,object:'model',created:0,owned_by:'zcode'}))}));return;
      }
      const routes={'/v1/messages':'messages','/v1/chat/completions':'chat','/v1/responses':'responses'};
      format=routes[url.pathname];
      if(req.method!=='POST'||!format)throw Object.assign(new Error('Unknown endpoint'),{status:404});
      let size=0;const chunks=[];
      for await(const c of req){size+=c.length;if(size>8*1024*1024)throw Object.assign(new Error('Request body exceeds 8 MiB'),{status:413});chunks.push(c);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{invalid('Malformed JSON request');}
      for(const [id,entry] of history)if(entry.expires<Date.now())history.delete(id);
      if(format==='responses'&&body.previous_response_id){
        const prior=history.get(body.previous_response_id);
        if(!prior || prior.owner!==owner)invalid('Unknown or expired previous_response_id for this API key');
        const input=typeof body.input==='string'?[{role:'user',content:body.input}]:body.input;
        if(!Array.isArray(input))invalid('Invalid Responses input');
        body={...body,input:[...prior.input,...input]};
      }
      const request=normalize(format,body),id='resp_'+randomUUID();
      if(!options.models().includes(request.model))invalid('Model is not enabled for any connected account');
      const remember=(r: any)=>{
        if(format!=='responses'||body.store===false)return;
        const input=[...request.messages,{role:'assistant',content:r.content}];
        // Store protocol items so the next request can be normalized uniformly.
        const items=input.flatMap(m=>m.role==='assistant'?m.content.filter(c=>c.type==='text'||c.type==='tool_use').map(c=>c.type==='text'?{role:'assistant',content:c.text}:{type:'function_call',call_id:c.id,name:c.name,arguments:JSON.stringify(c.input)}):[{role:m.role,content:m.content}]);
        if(Buffer.byteLength(JSON.stringify(items))>512*1024)return;
        history.set(id,{owner,input:items,expires:Date.now()+3600000});
        while(history.size>100)history.delete(history.keys().next().value!);
      };
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
      const response=await options.generate(request,body.stream===true,signal);
      if(!response.ok)throw Object.assign(new Error('Upstream request failed'),{status:response.status});
      if(body.stream===true){await relay(response,format,res,remember,id);return;}
      const raw=await response.text();if(raw.length>8*1024*1024)throw new Error('Upstream response too large');
      const r=JSON.parse(raw);
      if(r.type==='error'||r.error||!Array.isArray(r.content))throw Object.assign(new Error('Upstream returned an invalid model response'),{status:502});
      remember(r);
      const output=format==='messages'?r:format==='chat'?toChat(r):toResponses(r,id);
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(output));
    }catch(error: any){
      if(controller.signal.aborted||res.destroyed)return;
      const message=error.status?error.message:'Gateway request failed';
      if(res.headersSent){res.write('event: error\ndata: '+JSON.stringify({type:'error',error:{type:'api_error',message}})+'\n\n');res.end();}
      else{const status=error.status>=400&&error.status<=599?error.status:502;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({...(format==='messages'?{type:'error'}:{}),error:{type:status===401?'authentication_error':status===400?'invalid_request_error':'api_error',message}}));}
    }
  });
}
