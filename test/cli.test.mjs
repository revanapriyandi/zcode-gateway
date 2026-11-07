import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Vault } from '../src/accounts.ts';

const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));

test('init refuses to generate unrelated keys over an existing vault', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zc-init-'));
  try {
    const data = join(dir, 'data'), file = join(data, 'accounts.enc');
    new Vault(file, 'a'.repeat(64)).upsert({ identity: 'one', token: 'private-token', models: ['glm-5.3'] });
    const before = readFileSync(file);
    const env = { ...process.env, ZCODE_DATA_DIR: data };
    const result = spawnSync(process.execPath, [cli, 'init'], { cwd: dir, env, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /existing account vault/i);
    assert.equal(existsSync(join(dir, '.env')), false);
    assert.deepEqual(readFileSync(file), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fresh installations enable automatic promotion checks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zc-auto-init-'));
 try {
  const result=spawnSync(process.execPath,[cli,'init'],{cwd:dir,env:{...process.env,ZCODE_DATA_DIR:join(dir,'data')},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(readFileSync(join(dir,'.env'),'utf8'),/ZCODE_AUTO_CLAIM=true/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

for(const command of ['promos','claim'])test(command+' discovers real endpoint offers with the provisioned version',()=>{
 const dir=mkdtempSync(join(tmpdir(),'zc-cli-offers-')),key='k'.repeat(64);
 try {
  const file=join(dir,'accounts.enc');new Vault(file,key).upsert({identity:'fixture',token:'secret-fixture',deviceId:'fixture-device',models:[]});
  writeFileSync(join(dir,'template.json'),JSON.stringify({appVersion:'3.17.2',context:{platform:'darwin',arch:'arm64'}}));
  const preload=join(dir,'fetch.mjs');
  writeFileSync(preload,`globalThis.fetch=async(url,init)=>{
    if(init.headers['X-ZCode-App-Version']!=='3.17.2')throw Error('wrong version');
    if(url.includes('/preview?'))return Response.json({code:0,data:{plans:[{plan_id:'fixture-free',entitlements:[{grant_units:10,capabilities:['model:fixture']}]}]}});
    if(url.includes('/marketing/touch?'))return Response.json({code:0,data:{deliveries:[]}});
    if(url.endsWith('/claim'))return Response.json({code:0,data:{plan:{plan_id:'fixture-free',ends_at:Date.now()/1000+3600}}});
    return Response.json({code:0,data:{plans:[],balances:[]}});
  };`);
  const result=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,cli,command],{cwd:dir,env:{...process.env,ZCODE_DATA_DIR:dir,ZCODE_MASTER_KEY:key},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const state=new Vault(file,key).accounts[0].autoClaim;
  assert.equal(state.offeredPlans,1);assert.equal(state.offers[0].planId,'fixture-free');
  assert.equal(state.plans.length,command==='claim'?1:0);
  assert.equal(existsSync(join(dir,'vault.lock')),false);
  assert.doesNotMatch(result.stdout,/secret-fixture|fixture-device/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
