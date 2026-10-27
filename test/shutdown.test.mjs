import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync,writeFileSync,existsSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Vault } from '../src/accounts.ts';

test('shutdown retains the vault lock until background quota refresh settles',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'zcode-shutdown-')),key='x'.repeat(64);
 const vault=new Vault(join(dir,'accounts.enc'),key);
 vault.upsert({identity:'fixture',token:'fixture',models:[],enabled:true});
 writeFileSync(join(dir,'template.json'),JSON.stringify({appVersion:'test'}));
 const preload=join(dir,'preload.mjs');
 writeFileSync(preload,`globalThis.fetch=async url=>{if(url.includes('/billing/current')){process.stdout.write('refresh-start\\n');await new Promise(r=>setTimeout(r,1800));}return Response.json({code:0,data:{plans:[],balances:[]}});};process.stdin.on('data',()=>{process.emit('SIGTERM');process.stdout.write('signal-seen\\n');});`);
 const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,resolve('src/cli.ts'),'serve'],{env:{...process.env,ZCODE_DATA_DIR:dir,ZCODE_MASTER_KEY:key,ZCODE_API_KEYS:'fixture-client-key-24-characters',ZCODE_AUTO_CLAIM:'true',HOST:'127.0.0.1',PORT:'0'},stdio:['pipe','pipe','pipe']});
 let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.resume();
 const exited=once(child,'exit');
 t.after(async()=>{if(child.exitCode===null)child.kill();await exited;rmSync(dir,{recursive:true,force:true});});
 async function waitFor(text){const deadline=Date.now()+5000;while(!output.includes(text)){if(Date.now()>deadline)throw Error('Child did not reach '+text);await new Promise(r=>setTimeout(r,10));}}
 await waitFor('refresh-start');child.stdin.write('stop');await waitFor('signal-seen');
 await new Promise(r=>setTimeout(r,100));
 assert.equal(existsSync(join(dir,'vault.lock')),true,'maintenance still owns the vault');
 await exited;assert.equal(existsSync(join(dir,'vault.lock')),false);
});
