import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';

export function clientContext() {
  return { platform:process.platform,arch:os.arch(),release:os.release(),cwd:process.cwd(),shell:process.platform==='win32'?'pwsh.exe':path.basename(process.env.SHELL || 'sh'),locale:Intl.DateTimeFormat().resolvedOptions().locale,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone };
}

// Only supported prompt-only functions are evaluated, in an empty VM. The
// installed application entrypoint and its initialization code never execute.
export function extractTemplate(file: string) {
  const s = readFileSync(file, 'utf8');
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
  return { version: 1, appVersion: '3.16.3', sourceSha256: createHash('sha256').update(s).digest('hex'), context:clientContext(), ...result };
}
export function provision(source: string, destination: string) {
  const template = extractTemplate(source);
  writeFileSync(destination, JSON.stringify(template,null,2), { mode: 0o600 });
  return { appVersion: template.appVersion, sourceSha256: template.sourceSha256 };
}
export function prepareRequest(request: any, template: any) {
  if (template.version !== 1 || !template.prefix || !template.stable) throw new Error('Missing or invalid private ZCode prompt template');
  const b = structuredClone(request);
  const caller = typeof b.system === 'string' ? b.system : '';
  const context=template.context || clientContext();
  const env = ['# Environment','You have been invoked in the following environment:', '- Primary working directory: '+context.cwd, '- Is a git repository: no','- Platform: '+context.platform, '- Shell: '+context.shell, '- OS Version: '+context.platform+' '+context.release+' '+context.arch, '- You are powered by the model named zai-api/'+b.model+'.'].join('\n');
  b.system = [
    { type:'text', text:template.prefix },
    { type:'text', text:template.stable+(caller?'\n\n# Application Instructions\n'+caller:''), cache_control:{type:'ephemeral'} },
    { type:'text', text:'\n\n'+[template.before,env,template.after].join('\n\n'), cache_control:{type:'ephemeral'} },
  ];
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  b.messages.unshift({role:'user',content:[{type:'text',text:"<system-reminder>As you answer the user's questions, you can use the following context:\n# currentDate\nToday's date is "+date+".\n\n      IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.</system-reminder>"}]});
  for (const m of b.messages) for (const c of m.content || []) delete c.cache_control;
  const last = b.messages.at(-1)?.content?.at(-1); if(last && ['text','image','tool_result'].includes(last.type)) last.cache_control={type:'ephemeral'};
  for (const t of b.tools || []) delete t.cache_control;
  return b;
}
