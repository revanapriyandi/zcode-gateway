export function createAutoClaim(vault: any, template: any, refresh: any, options: any = {}) {
  const fetcher=options.fetcher || fetch,now=options.now || Date.now;
  const intervalMs=options.intervalMs ?? 300000;
  if(!Number.isFinite(intervalMs)||intervalMs<60000)throw new Error('Auto claim interval must be at least 60000 ms');
  const log=options.log || (()=>{}),control=new AbortController();
  let pending:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined,stopped=false;
  const base='https://zcode.z.ai',version=template.appVersion;
  const platform=(template.context?.platform || process.platform)+'-'+(template.context?.arch || process.arch);
  async function request(path:string,headers:any,body?:any){
    const response=await fetcher(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.any([control.signal,AbortSignal.timeout(15000)])});
    const data=await response.json();
    return {ok:response.ok&&data.code===0,code:Number.isFinite(Number(data.code))?Number(data.code):response.status,data:data.data};
  }
  function offeredGrant(plan:any,time:number){
    if(typeof plan?.plan_id!=='string'||!plan.plan_id||plan.plan_id.length>200)return false;
    if(plan.requires_payment||plan.paid||plan.is_free===false)return false;
    for(const value of [plan.price,plan.cost,plan.amount])if(value!=null&&(typeof value!=='number'||value!==0))return false;
    if(plan.ends_at&&plan.ends_at*1000<=time)return false;
    return Array.isArray(plan.entitlements)&&plan.entitlements.some((e:any)=>Number(e.grant_units)>0&&Array.isArray(e.capabilities)&&e.capabilities.some((c:any)=>typeof c==='string'&&c.startsWith('model:')));
  }
  async function cycle(){
    await refresh();
    for(const a of vault.accounts){
      if(stopped)break;
      if(!a.enabled||a.needsLogin||a.plan==='coding-plan')continue;
      const time=now(),state=a.autoClaim ||= {plans:[]};
      state.checkedAt=time;state.nextCheckAt=time+intervalMs;state.status='checking';
      const auth={Authorization:'Bearer '+a.token,...(a.deviceId?{'X-Device-Mid':a.deviceId}:{})};
      try{
        const preview=await request('/api/v1/zcode-plan/billing/preview?app_version='+encodeURIComponent(version)+'&platform='+encodeURIComponent(platform),auth);
        if(!preview.ok||!Array.isArray(preview.data?.plans)){state.status=preview.code===401?'login_required':'preview_failed';state.code=preview.code;continue;}
        const candidates=preview.data.plans.filter((p:any)=>offeredGrant(p,time));
        state.status='idle';state.offeredPlans=candidates.length;delete state.code;
        let captchaAllowed:boolean|undefined,changed=false;
        for(const p of candidates){
          if(stopped)break;
          if((a.plans||[]).some((q:any)=>q.plan_id===p.plan_id&&q.status!=='expired'&&(!q.ends_at||q.ends_at*1000>time)&&q.ends_at===p.ends_at))continue;
          const key=p.plan_id+':'+(p.ends_at || 0),previous=state.plans.find((r:any)=>r.key===key);
          if(previous&&(previous.status==='claimed'||previous.status==='already_claimed'||previous.retryAt>time))continue;
          const record={key,planId:p.plan_id,checkedAt:time,retryAt:time+3600000,status:'failed',code:0};
          if(captchaAllowed===undefined){
            const config=await request('/api/v1/agent/configs',auth);
            const captcha=config.ok?config.data?.configs?.captcha:undefined;
            captchaAllowed=captcha?.enabled===false||captcha?.skip_model_request===true;
          }
          if(!captchaAllowed){record.status='captcha_required';}
          else{
            const response=await request('/api/v1/zcode-plan/billing/claim',{Authorization:auth.Authorization,'Content-Type':'application/json','X-ZCode-App-Version':version,'X-Platform':platform,...(a.deviceId?{'X-Device-Mid':a.deviceId}:{})},{plan_id:p.plan_id});
            record.code=response.code;
            const claimed=response.data?.plan;
            record.status=response.ok&&claimed&&typeof claimed==='object'&&(!claimed.plan_id||claimed.plan_id===p.plan_id)?'claimed':({1003:'already_claimed',1004:'ineligible',1005:'quota_exhausted',3007:'captcha_required',401:'login_required',403:'login_required',3012:'risk_blocked'}[response.code] || 'failed');
            changed ||= record.status==='claimed'||record.status==='already_claimed';
          }
          state.plans=[...state.plans.filter((r:any)=>r.key!==key),record].slice(-50);
          state.status=record.status;
          vault.save();
          log({event:'auto_claim',accountId:a.id,planId:p.plan_id,status:record.status,code:record.code});
          if(['login_required','risk_blocked'].includes(record.status))break;
        }
        if(changed)await refresh({force:true});
      }catch{state.status=stopped?'stopped':'preview_failed';}
      finally{vault.save();}
    }
  }
  function run():Promise<void>{
    if(stopped)return Promise.resolve();
    if(!pending)pending=cycle().catch(()=>{log({event:'auto_claim',status:'maintenance_failed'});}).finally(()=>{pending=undefined;});
    return pending;
  }
  function start(){
    if(stopped||timer||pending)return;
    const tick=()=>{void run().finally(()=>{if(!stopped){timer=setTimeout(()=>{timer=undefined;tick();},intervalMs);timer.unref();}});};
    tick();
  }
  async function stop(){stopped=true;if(timer)clearTimeout(timer);control.abort();await pending;}
  return {run,start,stop};
}
