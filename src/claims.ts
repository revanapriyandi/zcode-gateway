import { headers } from './upstream.ts';

const validId=(value:any)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=200;
const seconds=(value:any)=>typeof value==='number'&&Number.isFinite(value)&&value>0?value*1000:undefined;
function freeOffer(plan:any) {
  if(!validId(plan?.plan_id)||plan.requires_payment||plan.paid||plan.is_free===false)return false;
  return [plan.price,plan.cost,plan.amount].every(value=>value==null||(typeof value==='number'&&value===0));
}
function modelGrant(plan:any) {
  return Array.isArray(plan.entitlements)&&plan.entitlements.some((e:any)=>Number(e?.grant_units)>0&&Array.isArray(e.capabilities)&&e.capabilities.some((c:any)=>typeof c==='string'&&c.startsWith('model:')));
}

export function createAutoClaim(vault: any, template: any, refresh: any, options: any = {}) {
  const fetcher=options.fetcher || fetch,now=options.now || Date.now;
  const intervalMs=options.intervalMs ?? 300000;
  if(!Number.isFinite(intervalMs)||intervalMs<60000)throw new Error('Auto claim interval must be at least 60000 ms');
  const log=options.log || (()=>{}),control=new AbortController();
  let pending:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined,stopped=false,sequence=0;
  const version=template.appVersion,platform=(template.context?.platform || process.platform)+'-'+(template.context?.arch || process.arch);
  async function request(path:string,auth:any,body?:any) {
    try {
      const response=await fetcher('https://zcode.z.ai'+path,{method:body?'POST':'GET',headers:auth,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.any([control.signal,AbortSignal.timeout(15000)])});
      const data=await response.json().catch(()=>undefined);
      const raw=data?.code,code=typeof raw==='number'&&Number.isFinite(raw)?raw:typeof raw==='string'&&/^\d+$/.test(raw)?Number(raw):-1;
      const retry=response.headers.get('retry-after');
      const delay=retry&&/^\d+$/.test(retry)?Number(retry)*1000:retry?Date.parse(retry)-now():0;
      const effectiveCode=response.ok||[3007,3012].includes(code)?code:response.status;
      return {ok:response.ok&&code===0,code:effectiveCode,data:data?.data,retryMs:Number.isFinite(delay)?Math.min(86400000,Math.max(0,delay)):0};
    } catch {return {ok:false,code:-1,data:undefined,retryMs:0};}
  }
  const statusFor=(code:number)=>({1003:'already_claimed',1004:'ineligible',1005:'quota_exhausted',3007:'captcha_required',401:'login_required',403:'login_required',3012:'risk_blocked',429:'rate_limited',503:'provider_unavailable'}[code] || 'failed');
  async function cycle() {
    try {await refresh();}catch {log({event:'auto_claim',status:'entitlement_refresh_failed'});}
    for(const a of vault.accounts) {
      if(stopped)break;
      if(!a.enabled||a.needsLogin||a.plan==='coding-plan')continue;
      const time=now(),state=a.autoClaim ||= {plans:[]};
      if(state.retryAt>time)continue;
      state.checkedAt=time;state.nextCheckAt=time+intervalMs;state.status='checking';delete state.retryAt;
      state.plans ||= [];state.sources={};state.campaigns=[];state.offers=[];state.offeredPlans=0;
      const auth={...headers(a.token,version,template.context),...(a.deviceId?{'X-Device-Mid':a.deviceId}:{})};
      const candidates=new Map<string,any>(),blocked=new Set<string>();
      let changed=false;
      function hold(code:number,retryMs=0) {
        const status=statusFor(code);
        if(['login_required','risk_blocked','captcha_required','rate_limited','provider_unavailable'].includes(status)) {
          state.status=status;state.code=code;
          state.retryAt=time+Math.max(retryMs,status==='risk_blocked'?900000:status==='captcha_required'?3600000:intervalMs);
          state.nextCheckAt=state.retryAt;
          if(status==='login_required')a.needsLogin=true;
          return true;
        }
        return false;
      }
      try {
        const preview=await request('/api/v1/zcode-plan/billing/preview?app_version='+encodeURIComponent(version)+'&platform='+encodeURIComponent(platform),auth);
        const previewOk=preview.ok&&Array.isArray(preview.data?.plans);
        state.sources.preview={status:previewOk?'ok':'failed',code:preview.code,...preview.ok&&!previewOk?{reason:'missing_data'}:{}};
        if(!previewOk&&[401,403,3007,3012,429].includes(preview.code)&&hold(preview.code,preview.retryMs))continue;
        const providerTime=seconds(preview.data?.server_time) ?? time;
        for(const p of previewOk?preview.data.plans:[]) {
          if(!freeOffer(p)){if(validId(p?.plan_id))blocked.add(p.plan_id);continue;}
          if(p.ends_at!=null&&!seconds(p.ends_at)){blocked.add(p.plan_id);continue;}
          if(p.ends_at&&seconds(p.ends_at)!<=providerTime){blocked.add(p.plan_id);continue;}
          if(modelGrant(p))candidates.set(p.plan_id,{...p,source:'preview',providerTime});
        }
        if(!stopped&&a.deviceId) {
          const marketing=await request('/api/v1/marketing/touch?seq='+sequence++,{...auth,'X-Client-Language':template.context?.locale==='zh-CN'?'zh-CN':'en-US'});
          const marketingOk=marketing.ok&&Array.isArray(marketing.data?.deliveries);
          state.sources.marketing={status:marketingOk?'ok':'failed',code:marketing.code,...marketing.ok&&!marketingOk?{reason:'missing_data'}:{}};
          if(!marketingOk&&[401,403,3007,3012,429].includes(marketing.code)&&hold(marketing.code,marketing.retryMs))continue;
          const marketingTime=seconds(marketing.data?.server_time) ?? providerTime;
          for(const d of marketingOk?marketing.data.deliveries.slice(0,32):[]) {
            if(!validId(d?.campaign_id)||!['banner','popup'].includes(d.resource_position))continue;
            const content=d[d.resource_position];if(!Array.isArray(content?.buttons))continue;
            const actions=content.buttons.slice(0,4).map((b:any)=>b?.action).filter((x:any)=>x&&typeof x.type==='string');
            const planIds=actions.filter((x:any)=>x.type==='claim_zcode_plan'&&validId(x.args?.plan_id)).map((x:any)=>x.args.plan_id);
            state.campaigns.push({campaignId:d.campaign_id,position:d.resource_position,title:typeof content.title?.content==='string'?content.title.content.slice(0,500):undefined,planIds,actionTypes:[...new Set(actions.map((x:any)=>['claim_zcode_plan','close','open_url','navigate','copy_text'].includes(x.type)?x.type:'unsupported'))],status:planIds.length?'claimable':'manual_action'});
            for(const id of planIds)if(!blocked.has(id)&&!candidates.has(id))candidates.set(id,{plan_id:id,source:'marketing',providerTime:marketingTime});
          }
        } else state.sources.marketing={status:a.deviceId?'stopped':'device_required'};
        const marketingOk=state.sources.marketing.status==='ok';
        state.status=previewOk&&marketingOk?'idle':previewOk||marketingOk?'discovery_partial':'discovery_failed';
        state.offeredPlans=candidates.size;delete state.code;delete state.refreshFailed;
        state.offers=[...candidates.values()].map(p=>({planId:p.plan_id,source:p.source,endsAt:seconds(p.ends_at)}));
        if(options.discoverOnly)continue;
        for(const p of candidates.values()) {
          if(stopped)break;
          if((a.plans||[]).some((q:any)=>q.plan_id===p.plan_id&&q.status!=='expired'&&(!q.ends_at||seconds(q.ends_at)!>p.providerTime)&&(!p.ends_at||q.ends_at===p.ends_at)))continue;
          const key=p.plan_id+':'+(p.ends_at || 0),previous=state.plans.find((r:any)=>r.key===key);
          if(previous) {
            const activeUntil=previous.endsAt;
            if(previous.retryAt>time)continue;
            if(['claimed','already_claimed'].includes(previous.status)&&((activeUntil&&activeUntil>p.providerTime)||(p.ends_at&&seconds(p.ends_at)!>p.providerTime)))continue;
          }
          const response=await request('/api/v1/zcode-plan/billing/claim',auth,{plan_id:p.plan_id});
          const claimed=response.data?.plan;
          const status=response.ok&&claimed&&typeof claimed==='object'&&!Array.isArray(claimed)&&(!claimed.plan_id||claimed.plan_id===p.plan_id)?'claimed':statusFor(response.code);
          const endsAt=seconds(claimed?.ends_at),claimTime=seconds(response.data?.server_time) ?? p.providerTime;
          const retryMs=status==='claimed'&&endsAt?Math.max(0,Math.min(3600000,endsAt-claimTime)):Math.max(3600000,response.retryMs);
          const record={key,planId:p.plan_id,source:p.source,checkedAt:time,retryAt:time+retryMs,endsAt,status,code:response.code};
          state.plans=[...state.plans.filter((r:any)=>r.key!==key),record].slice(-200);
          state.status=status;changed ||= status==='claimed'||status==='already_claimed';
          vault.save();log({event:'auto_claim',accountId:a.id,planId:p.plan_id,source:p.source,status,code:record.code});
          if(hold(response.code,response.retryMs))break;
        }
      } finally {
        if(changed&&!stopped)try {await refresh({force:true});}catch {state.refreshFailed=true;}
        vault.save();
      }
    }
  }
  function run():Promise<void> {
    if(stopped)return Promise.resolve();
    if(!pending)pending=cycle().catch(()=>{log({event:'auto_claim',status:'maintenance_failed'});}).finally(()=>{pending=undefined;});
    return pending;
  }
  function start() {
    if(stopped||timer||pending)return;
    const tick=()=>{void run().finally(()=>{if(!stopped){timer=setTimeout(()=>{timer=undefined;tick();},intervalMs);timer.unref();}});};
    tick();
  }
  async function stop(){stopped=true;if(timer)clearTimeout(timer);control.abort();await pending;}
  return {run,start,stop};
}
