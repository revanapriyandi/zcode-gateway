export function planSelection(account: any) {
  const kind=account.plan || 'start-plan';
  if(kind==='start-plan')return {kind,url:'https://zcode.z.ai/api/v1/zcode-plan/anthropic/v1/messages',token:account.token};
  if(kind==='coding-plan'){
    if(!account.codingKey)throw new Error('Coding Plan requires its own subscription API credential; set it with plan --key-file');
    return {kind,url:account.provider==='bigmodel'?'https://open.bigmodel.cn/api/anthropic/v1/messages':'https://api.z.ai/api/anthropic/v1/messages',token:account.codingKey};
  }
  throw new Error('Unknown plan kind');
}
export function quotaSummary(accounts: any[]) {
  const quotas: Record<string,any>={},names=new Set<string>();const now=Date.now();
  const publicAccounts=[];
  for(const a of accounts.filter(x=>x.enabled)){
    const plans=(a.plans || []).filter(p=>p.status==='active'&&(!p.ends_at||p.ends_at*1000>now));
    if(a.plan==='coding-plan')names.add('Coding Plan subscription');else for(const p of plans)names.add(p.name || p.plan_id);
    const buckets=a.quota?.reported?.balances || [];
    const accountQuotas:Record<string,any>={};
    for(const b of buckets){
      if(b.expires_at&&b.expires_at*1000<=now)continue;
      if(a.selectedPlanId&&b.plan_id!==a.selectedPlanId)continue;
      for(const capability of b.capabilities || []){
        if(!capability.startsWith('model:'))continue;
        const model=capability.slice(6).toLowerCase();
        const total=Number(b.total_units),used=Number(b.used_units),remaining=Number(b.remaining_units);
        if(b.total_units==null||b.used_units==null||b.remaining_units==null||![total,used,remaining].every(Number.isFinite))continue;
        for(const target of [quotas,accountQuotas]){
        const current=target[model] ||= {displayName:model+' · tokens',unit:'tokens',total:0,used:0,remaining:0,resetAt:null,expirySemantics:'expiry',source:'zcode-billing'};
        current.total+=total;current.used+=used;current.remaining+=remaining;
        if(b.expires_at){const expires=new Date(b.expires_at*1000).toISOString();if(!current.resetAt||expires<current.resetAt)current.resetAt=expires;}
        }
      }
    }
    publicAccounts.push({id:a.id,label:a.label,plan:a.plan || 'start-plan',selectedPlanId:a.selectedPlanId || null,plans,models:a.models,quotas:accountQuotas,quotaError:a.quota?.error || null,checkedAt:a.quota?.checkedAt || null,quotaKnown:buckets.length>0,needsLogin:!!a.needsLogin});
  }
  const quotaBuckets=Object.fromEntries(Object.entries(quotas).map(([model,bucket])=>[model.replace(/[^a-z0-9]/g,'_'),bucket]));
  return {plan:[...names].join(', ') || 'ZCode Start Plan',quotas,quotaBuckets,accounts:publicAccounts,generatedAt:new Date().toISOString(),message:Object.keys(quotas).length?null:'No provider-reported quota counters are available'};
}
