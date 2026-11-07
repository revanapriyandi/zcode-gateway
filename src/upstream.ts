import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { prepareRequest } from './templates.ts';
import { Pool } from './accounts.ts';
import { planSelection, quotaSummary } from './plans.ts';

const base = 'https://zcode.z.ai';
export function headers(token: string, version = '3.17.2', context: any = {}): Record<string,string> {
  const platform=context.platform || process.platform;
  return { Authorization:'Bearer '+token,'Content-Type':'application/json','anthropic-version':'2023-06-01','HTTP-Referer':base,'User-Agent':'ZCode/'+version,'X-ZCode-App-Version':version,'X-Title':'Z Code@electron','X-Release-Channel':'production','X-Client-Language':context.locale || Intl.DateTimeFormat().resolvedOptions().locale,'X-Client-Timezone':context.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,'X-ZCode-Agent':'glm','X-Platform':platform+'-'+(context.arch || os.arch()),'X-Os-Category':platform==='win32'?'windows':platform==='darwin'?'macos':'linux','X-Os-Version':context.release || os.release() };
}
export async function refreshAccount(account: any, fetcher: any = fetch, template: any = {}) {
  if(account.plan==='coding-plan')return {...account,models:account.codingModels || [],quota:{checkedAt:Date.now(),reported:null,error:'Subscription quota requires its separate billing API; Start Plan balances are not subscription balances'}};
  const version=template.appVersion || '3.17.2';
  const options = {headers:{...headers(account.token,version,template.context),...account.deviceId?{'X-Device-Mid':account.deviceId}:{}},redirect:'error',signal:AbortSignal.timeout(30000)};
  const response=await fetcher(base+'/api/v1/zcode-plan/billing/balance?app_version='+encodeURIComponent(version),options);
  const data=await response.json();
  if(!response.ok || ![0,'0'].includes(data.code)||!Array.isArray(data.data?.plans)||!Array.isArray(data.data?.balances))throw new Error('Unable to read account balance: '+response.status);
  const reported=data.data,time=Number.isFinite(reported.server_time)?reported.server_time*1000:Date.now();
  const active=(p:any)=>p.status==='active'&&(!p.starts_at||Number(p.starts_at)*1000<=time)&&(!p.ends_at||Number(p.ends_at)*1000>time)&&(!account.selectedPlanId||p.plan_id===account.selectedPlanId);
  const plans=reported.plans.filter(active);
  const models=new Set<string>();
  const add=(capabilities:any)=>{for(const c of capabilities || [])if(typeof c==='string'&&c.toLowerCase().startsWith('model:')&&c.slice(6).trim())models.add(c.slice(6).trim().toLowerCase());};
  for(const plan of plans)for(const e of plan.entitlements || [])if(!e.effective_at||Number(e.effective_at)*1000<=time)add(e.capabilities);
  for(const b of reported.balances) {
    if((b.expires_at&&Number(b.expires_at)*1000<=time)||(b.period_start&&Number(b.period_start)*1000>time))continue;
    const plan=plans.find((p:any)=>b.user_plan_id?p.user_plan_id===b.user_plan_id:b.plan_id?p.plan_id===b.plan_id:false);
    if(!plan)continue;
    const entitlement=(plan.entitlements || []).find((e:any)=>e.entitlement_id===b.entitlement_id);
    if(entitlement?.effective_at&&Number(entitlement.effective_at)*1000>time)continue;
    add(b.capabilities);
    if(!b.capabilities?.length&&typeof b.show_name==='string'&&/^glm-[a-z0-9.-]+$/i.test(b.show_name.trim()))models.add(b.show_name.trim().toLowerCase());
  }
  return {...account,models:[...models],plans:reported.plans,plan:account.plan || 'start-plan',quota:{checkedAt:Date.now(),reported,error:null}};
}
export function createQuotaReader(vault: any, options: any = {}) {
  let expires=0,pending: Promise<any> | undefined;
  return async({force=false}:any={})=>{
    if(force&&pending)await pending;
    if(!force&&Date.now()<expires)return quotaSummary(vault.accounts);
    if(!pending)pending=(async()=>{
      for(const a of vault.accounts.filter(x=>x.enabled)){
        try{Object.assign(a,await refreshAccount(a,options.fetcher || fetch,options.template));}catch{a.quota={checkedAt:Date.now(),reported:null,error:'Quota refresh failed'};}
      }
      vault.save();expires=Date.now()+60000;return quotaSummary(vault.accounts);
    })().finally(()=>{pending=undefined;});
    return pending;
  };
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
        const selection=planSelection(a);
        const body=selection.kind==='start-plan'?prepareRequest(request,template):structuredClone(request);body.stream=stream;
        body.metadata={user_id:JSON.stringify({device_id:a.deviceId || a.id,account_uuid:'',session_id:randomUUID()})};
        const authHeaders=headers(selection.token,template.appVersion,template.context);
        if(selection.kind==='coding-plan')authHeaders['x-api-key']=selection.token;
        const response=await fetcher(selection.url,{method:'POST',headers:authHeaders,body:JSON.stringify(body),redirect:'error',signal});
        if(!response.ok){
          const raw=await response.text();let e;try{e=JSON.parse(raw)}catch{}
          const status=response.status;
          const code=e?.code || e?.error?.code;
          if([401,403].includes(status)){a.needsLogin=true;vault.save();}
          lastError=Object.assign(new Error('ZCode upstream rejected request'+(code?' (code '+code+')':'')),{status:status>=500?502:status,code});
          let cooldownMs=0;
          if(status===429 || status>=500 || code===3012)cooldownMs=code===3012?900000:Math.min(300000,Math.max(1000,Number(response.headers.get('retry-after') || 30)*1000));
          if(status===402)cooldownMs=300000;
          if(cooldownMs){lastError.retryAfter=Math.ceil(cooldownMs/1000);pool.cooldown(a.id,cooldownMs,{status:lastError.status,code,message:lastError.message});}
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
