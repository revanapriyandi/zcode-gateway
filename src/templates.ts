import { readFileSync, writeFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';

export function clientContext() {
  const telemetry=path.join(os.homedir(),'.zcode/v2/telemetry-state.json');let deviceId;
  if(existsSync(telemetry)){try{deviceId=JSON.parse(readFileSync(telemetry,'utf8')).deviceMid;}catch{}}
  return { platform:process.platform,arch:os.arch(),release:os.release(),cwd:process.cwd(),shell:process.platform==='win32'?'pwsh.exe':path.basename(process.env.SHELL || 'sh'),locale:Intl.DateTimeFormat().resolvedOptions().locale,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,...deviceId?{deviceId}:{} };
}

function appVersion(file: string, explicit?: string) {
  let version=explicit;
  for(const root of [path.dirname(file),path.dirname(path.dirname(file))]) {
    if(version)break;
    const metadata=path.join(root,'package.json'),asar=path.join(root,'app.asar');
    if(existsSync(metadata))version=JSON.parse(readFileSync(metadata,'utf8')).version;
    if(!version&&existsSync(asar)) {
      const fd=openSync(asar,'r');
      try {
        const prefix=Buffer.alloc(16);if(readSync(fd,prefix,0,16,0)!==16)throw Error('Invalid ASAR metadata');
        const size=prefix.readUInt32LE(12),offset=8+prefix.readUInt32LE(4);
        if(size>32*1024*1024)throw Error('ASAR metadata is too large');
        const buffer=Buffer.alloc(size);readSync(fd,buffer,0,size,16);
        const item=JSON.parse(buffer.toString()).files?.['package.json'];
        if(!item||item.size>1024*1024)throw Error('Missing ASAR package metadata');
        const data=Buffer.alloc(item.size);readSync(fd,data,0,data.length,offset+Number(item.offset));
        version=JSON.parse(data.toString()).version;
      } finally {closeSync(fd);}
    }
  }
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(version))throw Error('Cannot determine ZCode app version; supply provision --app-version X.Y.Z or keep adjacent application metadata');
  return version;
}

function modernTemplate(s: string) {
  function stringAt(source: string, start: number): {value:string,end:number} {
    const quote=source[start];if(!['"',"'",'`'].includes(quote))throw Error('Unsupported prompt string');
    let end=start+1;
    for(;end<source.length&&end-start<64000;end++) {
      if(source[end]==='\\'){end++;continue;}
      if(source[end]===quote)break;
    }
    const literal=source.slice(start,end+1);
    if(source[end]!==quote||literal.includes('${'))throw Error('Unsupported interpolated prompt string');
    return {value:vm.runInNewContext(literal,Object.create(null),{timeout:100,contextCodeGeneration:{strings:false,wasm:false}}),end:end+1};
  }
  function text(marker: string) {
    const start=s.indexOf(marker);if(start<1)throw Error('Unsupported ZCode prompt section: '+marker);
    return stringAt(s,start-1).value;
  }
  function array(marker: string, harness=false) {
    const start=s.indexOf(marker);if(start<1)throw Error('Missing prompt array: '+marker);
    let source=s.slice(start-1,start+16000);
    if(harness) {
      // The only supported interpolation selects the non-MCS reminder wording.
      source=source.replace(/\$\{[\w$]+\?("(?:[^"\\]|\\.)*"):("(?:[^"\\]|\\.)*")\}/g,(_all,_yes,no)=>{
        return stringAt(no,0).value.replace(/\\/g,'\\\\').replace(/`/g,'\\`').replace(/\$/g,'\\$');
      });
    }
    const values=[];let cursor=0;
    while(cursor<source.length) {
      const item=stringAt(source,cursor);values.push(item.value);cursor=item.end;
      while(/\s/.test(source[cursor]||'!'))cursor++;
      if(source[cursor]===']')return values.join('\n');
      if(source[cursor++]!==',')break;
      while(/\s/.test(source[cursor]||'!'))cursor++;
    }
    throw Error('Unsupported prompt array layout');
  }
  return {
    version:2,prefix:text('You are ZCode, an interactive agent'),
    stable:['',text('You are an agent working with the user toward their goals'),'',text('IMPORTANT: Assist with authorized security testing'),'',array('# Harness',true)].join('\n'),
    before:['Write code that reads like the surrounding code:','When you use a pronoun for someone','For actions that are hard to reverse or outward-facing'].map(text).join('\n\n'),
    after:[array('# Context management'),text('When you have enough information to act, act.')].join('\n\n'),
  };
}

// Modern builds decode only prompt literals. Legacy builds evaluate isolated
// prompt builders; neither path loads or initializes the installed application.
export function extractTemplate(file: string, options: any = {}) {
  const s = readFileSync(file, 'utf8');
  if(s.includes('You are an agent working with the user toward their goals')) {
    return {...modernTemplate(s),appVersion:appVersion(file,options.appVersion),sourceSha256:createHash('sha256').update(s).digest('hex'),context:clientContext()};
  }
  function fn(name: string, next: string) {
    const start = s.indexOf('function '+name+'('), end = s.indexOf('function '+next+'(', start+1);
    if (start < 0 || end < 0) throw new Error('Unsupported ZCode prompt build: '+name);
    return s.slice(start, end);
  }
  function literal(name: string) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const m = new RegExp('(?:[;,])'+escaped+'=("(?:[^"\\\\]|\\\\.)*"|`(?:[^`\\\\]|\\\\.)*`)').exec(s);
    if (!m || m[1].includes('${')) throw new Error('Unsupported prompt literal: '+name);
    return vm.runInNewContext(m[1], Object.create(null), { timeout: 100 });
  }
  const objectStart = s.indexOf('Pkn={'), objectEnd = s.indexOf(';r(', objectStart);
  if (objectStart < 0 || objectEnd < 0 || objectEnd-objectStart > 30000) throw new Error('Unsupported dynamic prompt source');
  const context: any = Object.create(null);
  context.qf = (x: string) => x.length;
  context.Pda = (_a: any,_b: any,content: any) => ({ content });
  context.g0t = context.Pda;
  const code = [
    'var d0o='+JSON.stringify(literal('d0o'))+';',
    fn('okn','iua'), fn('iua','ikn'), fn('Ekn','Pda'),
    fn('N0o','L0o'), fn('F0o','g0t'), s.slice(objectStart,objectEnd)+';',
    'result={prefix:'+JSON.stringify(literal('oua'))+',stable:[iua(false),Ekn(undefined).content].join("\\n\\n"),before:N0o().content,after:F0o().content};',
  ].join('\n');
  if (code.includes('require(') || code.includes('process.') || code.includes('import(')) throw new Error('Prompt extractor rejected unexpected executable dependencies');
  vm.runInNewContext(code,context,{timeout:100});
  const result = context.result;
  if (!result?.prefix || result.stable.length < 1000 || result.before.length < 1000) throw new Error('Prompt extraction incomplete');
  return { version: 1, appVersion: options.appVersion?appVersion(file,options.appVersion):'3.16.3', sourceSha256: createHash('sha256').update(s).digest('hex'), context:clientContext(), ...result };
}
export function provision(source: string, destination: string, options: any = {}) {
  const template = extractTemplate(source,options);
  writeFileSync(destination, JSON.stringify(template,null,2), { mode: 0o600 });
  return { appVersion: template.appVersion, sourceSha256: template.sourceSha256 };
}
export function prepareRequest(request: any, template: any) {
  if (![1,2].includes(template.version) || !template.prefix || !template.stable) throw new Error('Missing or invalid private ZCode prompt template');
  const b = structuredClone(request);
  const caller = typeof b.system === 'string' ? b.system : '';
  const context=template.context || clientContext();
  const env = ['# Environment','You have been invoked in the following environment:', '- Primary working directory: '+context.cwd, '- Is a git repository: no','- Platform: '+context.platform, '- Shell: '+context.shell, '- OS Version: '+context.platform+' '+context.release+' '+context.arch, '- You are powered by the model named zai-api/'+b.model+'.'].join('\n');
  b.system = [
    { type:'text', text:template.prefix },
    { type:'text', text:template.stable+(caller?'\n\n# Application Instructions\n'+caller:''), cache_control:{type:'ephemeral'} },
    { type:'text', text:'\n\n'+(template.version===2?[template.before,template.after]:[template.before,env,template.after]).join('\n\n'), cache_control:{type:'ephemeral'} },
  ];
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:context.timezone || 'UTC',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  b.messages.unshift({role:'user',content:[{type:'text',text:"<system-reminder>As you answer the user's questions, you can use the following context:\n# currentDate\nToday's date is "+date+".\n\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.</system-reminder>"}]});
  if(template.version===2)b.messages[0].content.unshift({type:'text',text:'<system-reminder>\n'+env+'\n</system-reminder>'});
  for (const m of b.messages) for (const c of m.content || []) delete c.cache_control;
  const last = b.messages.at(-1)?.content?.at(-1); if(last && ['text','image','tool_result'].includes(last.type)) last.cache_control={type:'ephemeral'};
  for (const t of b.tools || []) delete t.cache_control;
  return b;
}
