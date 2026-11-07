import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractTemplate, prepareRequest } from '../src/templates.ts';
import { refreshAccount, createQuotaReader } from '../src/upstream.ts';

// Small synthetic prompt, with intentionally unrelated minified identifiers.
const bundle = `var boot=()=>{throw Error('application entrypoint executed')};
var init=()=>{abc="You are ZCode, an interactive agent",def="You are an agent working with the user toward their goals, fixture.",sec="IMPORTANT: Assist with authorized security testing, fixture.",style='You are an interactive agent that helps users according to your "Output Style", fixture.'};
function harness(flag=!0){return["# Harness"," - Fixture terminal guidance.",\` - \${flag?"System turns.":"Reminder tags."} Hook guidance.\`].join("\\n")}
var dyn=()=>{a="Write code that reads like the surrounding code: fixture.",b="When you use a pronoun for someone, fixture.",c="For actions that are hard to reverse or outward-facing, fixture.",d=["# Context management","When the conversation grows long, fixture."].join("\\n"),e="When you have enough information to act, act. Fixture."};`;

test('modern extraction discovers renamed prompt symbols and reads adjacent application metadata',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zc-modern-'));
 try {
  mkdirSync(join(dir,'glm'));writeFileSync(join(dir,'package.json'),JSON.stringify({version:'3.17.2'}));
  const file=join(dir,'glm','zcode.cjs');writeFileSync(file,bundle);
  const t=extractTemplate(file);
  assert.equal(t.appVersion,'3.17.2');assert.equal(t.version,2);
  assert.match(t.stable,/# Harness/);assert.match(t.stable,/Reminder tags/);
  assert.match(t.before,/Write code/);assert.match(t.after,/# Context management/);
  assert.doesNotMatch(JSON.stringify(t),/entrypoint executed/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('provision accepts an explicit version for a standalone official bundle',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zc-version-'));
 try {
  const file=join(dir,'zcode.cjs');writeFileSync(file,bundle);
  assert.equal(extractTemplate(file,{appVersion:'3.17.2'}).appVersion,'3.17.2');
  assert.throws(()=>extractTemplate(file,{appVersion:'latest\r\nInjected: value'}),/version/i);
  assert.throws(()=>extractTemplate(file),/version|metadata/i);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('modern extraction rejects executable template interpolation',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zc-literal-'));
 try {
  const file=join(dir,'zcode.cjs');
  writeFileSync(file,bundle.replace('fixture.\",b=', 'fixture ${globalThis.process.exit()}.\",b='));
  assert.throws(()=>extractTemplate(file,{appVersion:'3.17.2'}),/interpolated/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('application version can be read from an adjacent ASAR without loading its code',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zc-asar-'));
 try {
  const file=join(dir,'zcode.cjs');writeFileSync(file,bundle);
  const metadata=Buffer.from(JSON.stringify({version:'3.17.2'}));
  const header=Buffer.from(JSON.stringify({files:{'package.json':{size:metadata.length,offset:'0'}}}));
  const prefix=Buffer.alloc(16);prefix.writeUInt32LE(4,0);prefix.writeUInt32LE(header.length+8,4);prefix.writeUInt32LE(header.length+4,8);prefix.writeUInt32LE(header.length,12);
  writeFileSync(join(dir,'app.asar'),Buffer.concat([prefix,header,metadata]));
  assert.equal(extractTemplate(file).appVersion,'3.17.2');
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('modern request preserves application instructions and sends environment as user context',()=>{
 const t={version:2,prefix:'prefix',stable:'static',before:'behavior',after:'context',context:{platform:'win32',arch:'x64',timezone:'UTC',cwd:'fixture',shell:'pwsh',release:'test'}};
 const r=prepareRequest({model:'glm-fixture',system:'caller rules',messages:[{role:'user',content:[{type:'text',text:'hello'}]}]},t);
 assert.match(r.system[1].text,/caller rules/);
 assert.doesNotMatch(r.system[2].text,/# Environment/);
 assert.match(r.messages[0].content[0].text,/# Environment/);
 assert.match(r.messages[0].content[0].text,/glm-fixture/);
 assert.equal(r.messages.at(-1).content[0].text,'hello');
});

test('billing and balance requests carry the provisioned version and platform',async()=>{
 const calls=[];const template={appVersion:'3.17.2',context:{platform:'darwin',arch:'arm64'}};
 const fetcher=async(url,init)=>{calls.push({url,init});return Response.json({code:0,data:{plans:[],balances:[]}});};
 await refreshAccount({token:'fixture'},fetcher,template);
 assert.equal(calls[0].init.headers['X-ZCode-App-Version'],'3.17.2');
 assert.equal(calls[0].init.headers['X-Platform'],'darwin-arm64');
 assert.match(calls[0].url,/app_version=3.17.2/);
 calls.length=0;
 await createQuotaReader({accounts:[{enabled:true,token:'fixture'}],save(){}},{fetcher,template})();
 assert.equal(calls[0].init.headers['X-ZCode-App-Version'],'3.17.2');
});

test('current billing discovers models from authoritative balance buckets without calling retired current endpoint',async()=>{
 const calls=[];
 const r=await refreshAccount({token:'fixture'},async url=>{
  calls.push(url);
  if(url.includes('/billing/current'))return Response.json({code:0});
  return Response.json({code:0,data:{server_time:1800000000,plans:[{user_plan_id:'instance',plan_id:'promo',status:'active',ends_at:1800003600,entitlements:[{entitlement_id:'e'}]}],balances:[
   {user_plan_id:'instance',entitlement_id:'e',capabilities:['model:glm-next'],remaining_units:100,expires_at:1800003600},
  ]}});
 });
 assert.deepEqual(r.models,['glm-next']);assert.equal(calls.length,1);assert.match(calls[0],/billing\/balance/);
});

test('balance model discovery excludes inactive, future and expired buckets and respects selected plan',async()=>{
 const r=await refreshAccount({token:'fixture',selectedPlanId:'selected'},async()=>Response.json({code:0,data:{server_time:1800000000,
  plans:[{plan_id:'selected',status:'active',entitlements:[{entitlement_id:'future',effective_at:1800003600}]},{plan_id:'other',status:'active'},{plan_id:'old',status:'expired'}],
  balances:[{plan_id:'selected',capabilities:['model:good']},{plan_id:'other',capabilities:['model:other']},{plan_id:'old',capabilities:['model:old']},{plan_id:'selected',capabilities:['model:expired'],expires_at:1799999999},{plan_id:'selected',entitlement_id:'future',capabilities:['model:future']}],
 }}));
 assert.deepEqual(r.models,['good']);
});
