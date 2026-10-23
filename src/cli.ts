import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';
import { randomBytes, createHash, createDecipheriv } from 'node:crypto';
import { Vault } from './accounts.ts';
import { beginLogin, finishLogin } from './oauth.ts';
import { provision } from './templates.ts';
import { createUpstream, refreshAccount, createQuotaReader } from './upstream.ts';
import { quotaSummary, planSelection } from './plans.ts';
import { createGateway } from './server.ts';
import { openLoginBrowser, loginLink } from './browser.ts';

const args=process.argv.slice(2),command=args[0] || 'help';
const dir=resolve(process.env.ZCODE_DATA_DIR || './data');
function envSecret(name: string){return process.env[name+'_FILE']?readFileSync(process.env[name+'_FILE']!,'utf8').trim():process.env[name] || '';}
function vault(){return new Vault(join(dir,'accounts.enc'),envSecret('ZCODE_MASTER_KEY'));}
function usage(){console.log(`ZCode Gateway\n\nnode src/cli.ts <command>\n\n  init                         Create local .env and data directory\n  provision <zcode.cjs>         Extract private templates from ZCode 3.16.3\n  login [zai|bigmodel] [label]  Authorize and add/update one account\n  import-desktop [label]        Import this user's existing ZCode login\n  accounts                     List account IDs and enabled models\n  quota / plans                Refresh account entitlements and balance\n  plan <id> start-plan         Select the default promotional/trial route\n  plan <id> coding-plan --key-file PATH --models MODEL,MODEL\n                               Select a subscription with its own key\n  enable <id> / disable <id>    Change account eligibility\n  remove <id>                  Delete this local login (does not revoke upstream)\n  serve                        Run authenticated HTTP service\n\nRun with node --env-file=.env src/cli.ts after init.\n`);}
async function main(){
  if(command==='help'){usage();console.log('Login opens your default browser; append --no-browser for SSH or manual authorization.');return;}
  if(command==='init'){
    mkdirSync(dir,{recursive:true,mode:0o700});
    if(existsSync('.env'))throw new Error('.env already exists');
    if(existsSync(join(dir,'accounts.enc')))throw new Error('Found an existing account vault at '+join(dir,'accounts.enc')+'. Restore its original .env / ZCODE_MASTER_KEY instead of generating unrelated keys. No files were changed.');
    writeFileSync('.env',`ZCODE_MASTER_KEY=${randomBytes(32).toString('hex')}\nZCODE_API_KEYS=${randomBytes(32).toString('hex')}\nZCODE_DATA_DIR=./data\nHOST=127.0.0.1\nPORT=8080\n`,{mode:0o600,flag:'wx'});
    console.log('Created .env with private random keys. Keep it outside Git.');return;
  }
  mkdirSync(dir,{recursive:true,mode:0o700});
  // CLI mutations and the server cannot race against the same account file.
  const lock=join(dir,'vault.lock');let fd;
  try{fd=openSync(lock,'wx',0o600);writeFileSync(fd,String(process.pid));}catch{throw new Error('Vault is in use. Stop its service before an account-management command. After a crash, verify its process is gone before removing data/vault.lock.');}
  const unlock=()=>{if(fd!==undefined){closeSync(fd);fd=undefined;unlinkSync(lock);}};
  try{
    if(command==='provision'){
      if(!args[1])throw new Error('Provide an installed official zcode.cjs path');
      console.log(JSON.stringify(provision(resolve(args[1]),join(dir,'template.json'))));return;
    }
    const v=vault();
    if(command==='login'){
      const loginArgs=args.slice(1).filter(arg=>arg!=='--no-browser');
      const flow=await beginLogin(loginArgs[0] || 'zai');
      const cancel=new AbortController();process.once('SIGINT',()=>cancel.abort());
      console.log('Open this one-time OAuth URL in your browser. Choose the ZCode account to add:\n'+flow.authorizeUrl);
      if(process.stdout.isTTY&&process.env.TERM!=='dumb')console.log(loginLink(flow.authorizeUrl,true));
      if(!args.includes('--no-browser'))console.log(await openLoginBrowser(flow.authorizeUrl)?'Opened the default browser. Complete authorization there; this terminal is waiting.':'Could not open a browser automatically. Copy the complete URL above into your browser; this terminal is waiting.');
      const account:any={...await finishLogin(flow,{signal:cancel.signal}),needsLogin:false};
      const context=JSON.parse(readFileSync(join(dir,'template.json'),'utf8')).context;
      account.deviceId=context?.deviceId || randomBytes(16).toString('hex');
      const previous=v.accounts.find(a=>a.identity===account.identity);
      const ready=await refreshAccount({...previous,...account});ready.label=loginArgs[1] || previous?.label || 'ZCode account';
      const saved=v.upsert(ready);console.log(JSON.stringify({id:saved.id,label:saved.label,models:saved.models}));return;
    }
    if(command==='import-desktop'){
      const profile=join(os.homedir(),'.zcode','v2');const records=JSON.parse(readFileSync(join(profile,'credentials.json'),'utf8'));
      let token=records.zcodejwttoken;if(typeof token!=='string')throw new Error('No desktop login found');
      if(token.startsWith('enc:v1:')){
        const key=createHash('sha256').update(process.env.ZCODE_CREDENTIAL_SECRET?.trim() || `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${os.userInfo().username}`).digest();
        const [iv,tag,ct]=token.slice(7).split('.').map(x=>Buffer.from(x,'base64url'));
        const d=createDecipheriv('aes-256-gcm',key,iv);d.setAuthTag(tag);token=Buffer.concat([d.update(ct),d.final()]).toString();
      }
      const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
      if(!claims.user_id)throw new Error('Desktop login omitted identity');
      const context=JSON.parse(readFileSync(join(dir,'template.json'),'utf8')).context;
      const previous=v.accounts.find(a=>a.identity==='zai:'+claims.user_id);
      const ready=await refreshAccount({...previous,identity:'zai:'+claims.user_id,token,needsLogin:false,provider:'zai',deviceId:context?.deviceId,models:[],label:args[1] || 'Desktop account'});
      const saved=v.upsert(ready);console.log(JSON.stringify({id:saved.id,label:saved.label,models:saved.models}));return;
    }
    if(command==='accounts'){console.log(JSON.stringify(v.publicAccounts(),null,2));return;}
    if(command==='plan'){
      const a=v.accounts.find(x=>x.id===args[1]);if(!a)throw new Error('Account not found');
      const next={...a,plan:args[2],needsLogin:false};
      if(args[2]==='coding-plan'){
        const keyIndex=args.indexOf('--key-file'),modelsIndex=args.indexOf('--models');
        if(keyIndex>=0&&args[keyIndex+1])next.codingKey=readFileSync(resolve(args[keyIndex+1]),'utf8').trim();
        if(modelsIndex>=0&&args[modelsIndex+1])next.codingModels=args[modelsIndex+1].split(',').map(x=>x.trim().toLowerCase());
        if(!next.codingModels?.length)throw new Error('Set the subscription model IDs with --models');
      }
      planSelection(next);v.upsert(await refreshAccount(next));console.log(JSON.stringify(v.publicAccounts(),null,2));return;
    }
    if(command==='quota'||command==='plans'){
      for(const a of [...v.accounts]){
        try{v.upsert(await refreshAccount(a));}catch{a.needsLogin=true;v.save();console.log('Account '+a.id+' needs reauthorization or quota refresh failed');}
      }
      console.log(JSON.stringify(quotaSummary(v.accounts),null,2));return;
    }
    if(['enable','disable','remove'].includes(command)){
      const a=v.accounts.find(x=>x.id===args[1]);if(!a)throw new Error('Account not found');
      if(command==='remove')v.accounts.splice(v.accounts.indexOf(a),1);else a.enabled=command==='enable';
      v.save();console.log('Account '+command+' completed');return;
    }
    if(command!=='serve')throw new Error('Unknown command');
    const template=JSON.parse(readFileSync(join(dir,'template.json'),'utf8'));
    for(const a of v.accounts)if(!a.deviceId&&template.context?.deviceId)a.deviceId=template.context.deviceId;
    v.save();
    const keys=envSecret('ZCODE_API_KEYS').split(',').map(x=>x.trim()).filter(Boolean);
    if(keys.some(k=>k.length<24))throw new Error('Every API key must contain at least 24 characters');
    const server=createGateway({keys,models:()=>[...new Set(v.accounts.filter(a=>a.enabled&&!a.needsLogin).flatMap(a=>a.models))],generate:createUpstream(v,template),quota:createQuotaReader(v)});
    const host=process.env.HOST || '127.0.0.1',port=Number(process.env.PORT || 8080);
    server.listen(port,host,()=>console.log(JSON.stringify({event:'listening',host,port,accounts:v.accounts.length})));
    let stopping=false;
    const stop=()=>{if(stopping)return;stopping=true;server.close(()=>{unlock();process.exit(0);});setTimeout(()=>{server.closeAllConnections();unlock();process.exit(0);},15000).unref();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    server.on('error',()=>{unlock();process.exitCode=1;});
    await new Promise<void>(resolve=>server.once('close',resolve));
  }finally{unlock();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Command failed');process.exitCode=1;});
