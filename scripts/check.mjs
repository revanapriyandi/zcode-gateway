import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files=readdirSync('src').filter(f=>f.endsWith('.ts')).sort();
for(const file of files)execFileSync(process.execPath,['--check','src/'+file],{stdio:'inherit'});
console.log('Syntax checked '+files.length+' source modules.');
