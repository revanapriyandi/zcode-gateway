import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoClaim } from '../src/claims.ts';

const now=1800000000000;
const offer={plan_id:'free-new',starts_at:now/1000-60,ends_at:now/1000+3600,entitlements:[{capabilities:['model:glm-5.3-flash'],grant_units:300000000}]};
const template={appVersion:'3.16.3',context:{platform:'win32',arch:'x64'}};
function fixture(extra={},offers=[offer],config={enabled:false},claimCode=0){
 const a={id:'a',enabled:true,token:'private-token',deviceId:'private-device',models:[],...extra};
 const calls=[],refreshes=[],logs=[];let saves=0;
 const vault={accounts:[a],save(){saves++;}};
 const fetcher=async(url,init)=>{
  calls.push({url,init});
  if(url.includes('/preview?'))return Response.json({code:0,data:{plans:offers}});
  if(url.endsWith('/agent/configs'))return Response.json({code:0,data:{configs:config===null?{}:{captcha:config}}});
  if(url.endsWith('/claim'))return Response.json({code:claimCode,data:claimCode===0?{plan:{plan_id:JSON.parse(init.body).plan_id}}:{}});
  throw Error('Unexpected endpoint');
 };
 const refresh=async(options)=>{refreshes.push(options);};
 const runner=createAutoClaim(vault,template,refresh,{fetcher,now:()=>now,log:e=>logs.push(e)});
 return {a,vault,runner,calls,refreshes,logs,saves:()=>saves,posts:()=>calls.filter(c=>c.init.method==='POST')};
}

test('auto claim uses the previewed grant, original device and a forced entitlement refresh',async()=>{
 const f=fixture();await f.runner.run();
 assert.equal(f.posts().length,1);
 assert.deepEqual(JSON.parse(f.posts()[0].init.body),{plan_id:'free-new'});
 assert.equal(f.posts()[0].init.headers['X-Device-Mid'],'private-device');
 assert.equal(f.posts()[0].init.headers['X-Platform'],'win32-x64');
 assert.ok(f.refreshes.some(r=>r?.force===true));
 assert.equal(f.a.autoClaim.plans[0].status,'claimed');
 assert.ok(f.saves()>0);
 assert.doesNotMatch(JSON.stringify(f.logs),/private-token|private-device/);
});

test('successful claim is persisted and not repeated across runner restarts',async()=>{
 const f=fixture();await f.runner.run();
 const g=fixture({autoClaim:structuredClone(f.a.autoClaim)});await g.runner.run();
 assert.equal(g.posts().length,0);
});

test('disabled, reauthentication and subscription accounts are skipped',async()=>{
 for(const extra of [{enabled:false},{needsLogin:true},{plan:'coding-plan'}]){
  const f=fixture(extra);await f.runner.run();assert.equal(f.calls.length,0);
 }
});

test('empty previews, paid and expired offers cause no claim',async()=>{
 for(const offers of [[],[{...offer,price:9}],[{...offer,requires_payment:true}],[{...offer,ends_at:now/1000-1}]]){
  const f=fixture({},offers);await f.runner.run();assert.equal(f.posts().length,0);
 }
});

test('previewed grants can be claimed before their future activation time',async()=>{
 const f=fixture({},[{...offer,starts_at:now/1000+600}]);await f.runner.run();
 assert.equal(f.posts().length,1);assert.equal(f.a.autoClaim.plans[0].status,'claimed');
});

test('successful claim need not echo the requested plan ID',async()=>{
 const f=fixture();
 const original=async(url,init)=>{
  if(url.endsWith('/preview?app_version=3.16.3&platform=win32-x64'))return Response.json({code:0,data:{plans:[offer]}});
  if(url.endsWith('/agent/configs'))return Response.json({code:0,data:{configs:{captcha:{enabled:false}}}});
  return Response.json({code:0,data:{plan:{starts_at:offer.starts_at,ends_at:offer.ends_at}}});
 };
 const refreshes=[];const runner=createAutoClaim(f.vault,template,async options=>{refreshes.push(options);},{fetcher:original,now:()=>now});
 await runner.run();assert.equal(f.a.autoClaim.plans[0].status,'claimed');assert.ok(refreshes.some(o=>o?.force));
});

test('already active account plans are not claimed again',async()=>{
 const f=fixture({plans:[offer]});await f.runner.run();assert.equal(f.posts().length,0);
});

test('CAPTCHA enabled or unknown requires manual action without a claim request',async()=>{
 for(const config of [{enabled:true},null]){
  const f=fixture({},[offer],config);await f.runner.run();
  assert.equal(f.posts().length,0);assert.equal(f.a.autoClaim.plans[0].status,'captcha_required');
 }
});

test('provider CAPTCHA and ineligibility responses are recorded with a retry hold',async()=>{
 for(const [code,status] of [[3007,'captcha_required'],[1004,'ineligible'],[1003,'already_claimed']]){
  const f=fixture({},[offer],{enabled:false},code);await f.runner.run();await f.runner.run();
  assert.equal(f.posts().length,1);assert.equal(f.a.autoClaim.plans[0].status,status);
  assert.ok(f.a.autoClaim.plans[0].retryAt>now);
 }
});

test('concurrent maintenance requests share one claim operation',async()=>{
 const f=fixture();await Promise.all([f.runner.run(),f.runner.run(),f.runner.run()]);
 assert.equal(f.posts().length,1);
});

test('failed preview leaves current models intact and stores no raw error or credential',async()=>{
 const f=fixture({models:['glm-5.3-flash']});
 const runner=createAutoClaim(f.vault,template,async()=>{}, {now:()=>now,fetcher:async()=>{throw Error('private-token');},log:()=>{}});
 await runner.run();assert.deepEqual(f.a.models,['glm-5.3-flash']);
 assert.equal(f.a.autoClaim.status,'preview_failed');assert.doesNotMatch(JSON.stringify(f.a.autoClaim),/private-token/);
});

test('stopped runner does not perform further network operations',async()=>{
 const f=fixture();await f.runner.stop();await f.runner.run();assert.equal(f.calls.length,0);
});

test('next daily offer reusing a plan ID is claimed after the old grant expires',async()=>{
 const old={...offer,ends_at:now/1000-1,status:'expired'};
 const f=fixture({plans:[old],autoClaim:{plans:[{key:offer.plan_id+':'+old.ends_at,status:'claimed'}]}});
 await f.runner.run();assert.equal(f.posts().length,1);assert.equal(f.a.autoClaim.plans.at(-1).status,'claimed');
});

test('five-minute maintenance discovers daily offers without inbound HTTP traffic',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const f=fixture();f.runner.start();await f.runner.run();
 const previews=()=>f.calls.filter(c=>c.url.includes('/preview?')).length;
 assert.equal(previews(),1);
 t.mock.timers.tick(300000);await f.runner.run();
 assert.equal(previews(),2);assert.equal(f.posts().length,1);
 await f.runner.stop();
});
