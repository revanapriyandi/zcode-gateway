import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { prepareRequest } from './templates.ts';
import { Pool } from './accounts.ts';

const base = 'https://zcode.z.ai';
export function headers(token: string, version = '3.16.3'): Record<string,string> {
  return { Authorization:'Bearer '+token,'Content-Type':'application/json','anthropic-version':'2023-06-01','HTTP-Referer':base,'User-Agent':'ZCode/'+version,'X-ZCode-App-Version':version,'X-Title':'Z Code@electron','X-Release-Channel':'production','X-Client-Language':Intl.DateTimeFormat().resolvedOptions().locale,'X-Client-Timezone':Intl.DateTimeFormat().resolvedOptions().timeZone,'X-ZCode-Agent':'glm','X-Platform':process.platform+'-'+os.arch(),'X-Os-Category':process.platform==='win32'?'windows':process.platform==='darwin'?'macos':'linux','X-Os-Version':os.release() };
}
export async function refreshAccount(account: any, fetcher: any = fetch) {
  const options = {headers:headers(account.token),redirect:'error',signal:AbortSignal.timeout(30000)};
  const response=await fetcher(base+'/api/v1/zcode-plan/billing/current',options);
  const data=await response.json();
  if(!response.ok || data.code!==0) throw new Error('Unable to read account plan: '+response.status);
  const models=new Set<string>();
  for(const plan of data.data?.plans || []) if(plan.status==='active' && (!plan.ends_at || plan.ends_at*1000>Date.now())) for(const entitlement of plan.entitlements || []) for(const capability of entitlement.capabilities || []) if(capability.startsWith('model:')) models.add(capability.slice(6).toLowerCase());
  const updated={...account,models:[...models],needsLogin:false};
  try{
    const balance=await fetcher(base+'/api/v1/zcode-plan/billing/balance?app_version=3.16.3',options);
    const b=await balance.json();if(balance.ok&&b.code===0) updated.quota={checkedAt:Date.now(),reported:b.data};
  }catch{updated.quota={checkedAt:Date.now(),reported:null};}
  return updated;
}
export function createUpstream(vault: any, template: any, options: any = {}) {
  const pool=new Pool(vault.accounts);const fetcher=options.fetcher || fetch;
  return async (request: any, stream: boolean, signal: AbortSignal) => {
    const excluded=new Set<string>(); let lastError: any;
    for(let attempt=0;attempt<Math.min(3,vault.accounts.length);attempt++) {
      let lease;
      try { lease=pool.acquire(request.model,excluded); } catch(error) { throw lastError || error; }
      const a=lease.account;excluded.add(a.id);
      try{
        const body=prepareRequest(request,template);body.stream=stream;
        body.metadata={user_id:JSON.stringify({device_id:a.deviceId || a.id,account_uuid:'',session_id:randomUUID()})};
        const response=await fetcher(base+'/api/v1/zcode-plan/anthropic/v1/messages',{method:'POST',headers:headers(a.token,template.appVersion),body:JSON.stringify(body),redirect:'error',signal});
        if(!response.ok){
          const raw=await response.text();let e;try{e=JSON.parse(raw)}catch{}
          const status=response.status;
          const code=e?.code || e?.error?.code;
          if([401,403].includes(status)){a.needsLogin=true;vault.save();}
          if(status===429 || status>=500 || code===3012) pool.cooldown(a.id,code===3012?900000:Math.min(300000,Math.max(1000,Number(response.headers.get('retry-after') || 30)*1000)));
          if(status===402)pool.cooldown(a.id,300000);
          lastError=Object.assign(new Error('ZCode upstream rejected request'+(code?' (code '+code+')':'')),{status:status>=500?502:status,code});
          lease.release();
          if([401,402,403,429].includes(status)||status>=500)continue;
          throw lastError;
        }
        // A lease remains owned until the response body has ended or is cancelled.
        if(!response.body){lease.release();throw new Error('Upstream omitted response body');}
        const reader=response.body.getReader();let ended=false;
        const release=()=>{if(!ended){ended=true;lease.release();}};
        return new Response(new ReadableStream({
          async pull(controller){try{const r=await reader.read();if(r.done){release();controller.close();}else controller.enqueue(r.value);}catch(error){release();controller.error(error);}},
          async cancel(reason){release();await reader.cancel(reason);},
        }),{status:response.status,headers:response.headers});
      }catch(error){lease.release();if(error===lastError)throw error;throw Object.assign(new Error(signal.aborted?'Request cancelled':'Unable to reach ZCode upstream'),{status:signal.aborted?499:502});}
    }
    throw lastError || Object.assign(new Error('No eligible ZCode accounts'),{status:503});
  };
}
