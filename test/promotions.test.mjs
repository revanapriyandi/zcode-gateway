import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoClaim } from '../src/claims.ts';
import { quotaSummary } from '../src/plans.ts';

const time=1800000000000;
const grant={plan_id:'weekend',entitlements:[{capabilities:['model:glm-next'],grant_units:100}]};
const action={type:'claim_zcode_plan',args:{plan_id:'event-grant'}};
const delivery=(buttons=[action])=>({campaign_id:'weekend-event',priority:1,resource_position:'popup',popup:{title:{format:'plaintext',content:'Weekend event'},buttons:buttons.map(action=>({action}))}});
function fixture(options={}) {
 let clock=time,seq=0;const calls=[];
 const account={id:'a',token:'secret-token',deviceId:'original-device',enabled:true,models:[],...options.account};
 const fetcher=async(url,init)=>{
  calls.push({url,init});
  if(url.includes('/preview?'))return options.preview?.() || Response.json({code:0,data:{server_time:clock/1000,plans:options.offers??[grant]}});
  if(url.includes('/marketing/touch?'))return options.marketing?.() || Response.json({code:0,data:{server_time:clock/1000,deliveries:options.deliveries??[]}});
  if(url.endsWith('/claim'))return options.claim?.(++seq,init) || Response.json({code:'0',data:{plan:{plan_id:JSON.parse(init.body).plan_id,ends_at:clock/1000+3600}}});
  throw Error('Unexpected obsolete endpoint: '+url);
 };
 const runner=createAutoClaim({accounts:[account],save(){}},{appVersion:'3.17.2',context:{platform:'win32',arch:'x64',locale:'id-ID'}},async()=>{}, {fetcher,now:()=>clock});
 return {runner,account,calls,advance(ms){clock+=ms;},posts:()=>calls.filter(c=>c.init.method==='POST')};
}

test('current official claim flow does not require the removed agent CAPTCHA configuration',async()=>{
 const f=fixture();await f.runner.run();
 assert.equal(f.posts().length,1);assert.equal(f.account.autoClaim.plans[0].status,'claimed');
 assert.equal(f.calls.some(c=>c.url.includes('/agent/configs')),false);
});

test('marketing popup and banner claim actions are discovered even without preview entitlements',async()=>{
 const banner={campaign_id:'banner',resource_position:'banner',banner:{buttons:[{action:{type:'claim_zcode_plan',args:{plan_id:'banner-grant'}}}]}};
 const f=fixture({offers:[],deliveries:[delivery(),banner]});await f.runner.run();
 assert.deepEqual(f.posts().map(c=>JSON.parse(c.init.body).plan_id),['event-grant','banner-grant']);
 const query=f.calls.find(c=>c.url.includes('/marketing/touch?'));
 assert.equal(query.init.headers['X-Device-Mid'],'original-device');assert.equal(query.init.headers['X-Client-Language'],'en-US');
 assert.equal(f.account.autoClaim.campaigns[0].title,'Weekend event');
});

test('preview and marketing duplicates claim once; paid offers and unrelated actions never claim',async()=>{
 const paid={...grant,plan_id:'paid',price:5};
 const f=fixture({offers:[grant,paid],deliveries:[delivery([
  {type:'claim_zcode_plan',args:{plan_id:'weekend'}},{type:'claim_zcode_plan',args:{plan_id:'paid'}},
  {type:'open_url',args:{url:'https://example.com'}},{type:'navigate',args:{page:'rewards'}},
 ])]});await f.runner.run();
 assert.deepEqual(f.posts().map(c=>JSON.parse(c.init.body).plan_id),['weekend']);
});

test('undated recurring previews are retried after the claimed grant actually expires',async()=>{
 const f=fixture();await f.runner.run();await f.runner.run();assert.equal(f.posts().length,1);
 f.advance(3600001);await f.runner.run();assert.equal(f.posts().length,2);
});

test('already-claimed response without grant dates does not suppress future periods forever',async()=>{
 const f=fixture({claim:()=>Response.json({code:1003,data:{}})});
 await f.runner.run();await f.runner.run();assert.equal(f.posts().length,1);
 f.advance(3600001);await f.runner.run();assert.equal(f.posts().length,2);
});

test('HTTP failures cannot be mistaken for successful claims and Retry-After gates the whole account',async()=>{
 const f=fixture({offers:[grant,{...grant,plan_id:'second'}],claim:()=>Response.json({code:0,data:{plan:{}}},{status:429,headers:{'Retry-After':'7200'}})});
 await f.runner.run();assert.equal(f.posts().length,1);assert.equal(f.account.autoClaim.status,'rate_limited');
 await f.runner.run();assert.equal(f.posts().length,1);
 f.advance(7200001);await f.runner.run();assert.equal(f.posts().length,2);
});

test('plain-text provider rate limits preserve HTTP status and Retry-After',async()=>{
 const f=fixture({claim:()=>new Response('Too many requests',{status:429,headers:{'Retry-After':'7200'}})});
 await f.runner.run();assert.equal(f.account.autoClaim.status,'rate_limited');
 assert.equal(f.account.autoClaim.retryAt,time+7200000);
});

test('missing preview data is reported as incomplete discovery rather than an empty success',async()=>{
 const f=fixture({preview:()=>Response.json({code:0})});await f.runner.run();
 assert.equal(f.account.autoClaim.sources.preview.reason,'missing_data');
 assert.equal(f.account.autoClaim.status,'discovery_partial');
});

test('a successful short-lived grant is eligible again when its actual period ends',async()=>{
 const f=fixture({claim:()=>Response.json({code:0,data:{server_time:time/1000,plan:{plan_id:'weekend',ends_at:time/1000+120}}})});
 await f.runner.run();f.advance(120001);await f.runner.run();assert.equal(f.posts().length,2);
});

test('a failing preview does not hide marketing offers, and a failing marketing channel does not hide previews',async()=>{
 const f=fixture({preview:()=>Response.json({code:900},{status:503}),deliveries:[delivery()]});await f.runner.run();
 assert.equal(f.posts().length,1);assert.equal(f.account.autoClaim.sources.preview.status,'failed');
 const g=fixture({marketing:()=>Response.json({code:900},{status:503})});await g.runner.run();assert.equal(g.posts().length,1);
 assert.equal(g.account.autoClaim.sources.marketing.status,'failed');
});

test('provider server time, rather than a fast local clock, determines offer expiry',async()=>{
 const f=fixture({offers:[],preview:()=>Response.json({code:0,data:{server_time:time/1000-7200,plans:[{...grant,ends_at:time/1000-3600}]}})});
 await f.runner.run();assert.equal(f.posts().length,1);
});

test('provider verification, login and risk responses stop additional claims for that account',async()=>{
 for(const [code,status] of [[3007,'captcha_required'],[401,'login_required'],[403,'login_required'],[3012,'risk_blocked']]) {
  const f=fixture({offers:[grant,{...grant,plan_id:'second'}],claim:()=>Response.json({code,data:{}})});await f.runner.run();
  assert.equal(f.posts().length,1);assert.equal(f.account.autoClaim.status,status);
 }
});

test('risk and CAPTCHA business errors retain their meaning on non-success HTTP responses',async()=>{
 for(const [code,http,status] of [[3012,405,'risk_blocked'],[3007,400,'captcha_required']]) {
  const f=fixture({offers:[grant,{...grant,plan_id:'second'}],claim:()=>Response.json({code,data:{}},{status:http})});
  await f.runner.run();assert.equal(f.posts().length,1);assert.equal(f.account.autoClaim.status,status);
 }
});

test('malformed marketing deliveries do not abort remaining discovery or other accounts',async()=>{
 const f=fixture({offers:[],deliveries:[null,{},delivery()]});await f.runner.run();
 assert.equal(f.posts().length,1);
});

test('authenticated status includes sanitized campaign/source diagnostics without arbitrary payloads',async()=>{
 const f=fixture({deliveries:[{...delivery([{type:'open_url',args:{url:'https://example.com/?token=secret'}}]),raw:'secret-token'}]});
 await f.runner.run();const status=quotaSummary([f.account]).accounts[0].autoClaim;
 assert.equal(status.campaigns[0].campaignId,'weekend-event');assert.equal(status.sources.marketing.status,'ok');
 assert.doesNotMatch(JSON.stringify(status),/secret-token|original-device|https:\/\//);
});
