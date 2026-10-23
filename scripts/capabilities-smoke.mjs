import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:8080';
const key=process.env.TEST_API_KEY || process.env.ZCODE_API_KEYS?.split(',')[0];
const model=process.env.TEST_MODEL || 'glm-5.3-flash';
const width=240,height=120;
const chunk=(type,data)=>{const name=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([len,name,data,sum]);};
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
const pixels=Buffer.alloc(height*(1+width*3));
for(let y=0;y<height;y++)for(let x=0;x<width;x++){const at=y*(1+width*3)+1+x*3;pixels[at+(x<width/2?0:2)]=255;}
const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
const r=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:2048,reasoning_effort:'low',temperature:1,messages:[{role:'user',content:[{type:'text',text:'Identify the two solid colors in this image, from left to right. Reply with only their English names, separated by a comma.'},{type:'image_url',image_url:{url:'data:image/png;base64,'+png.toString('base64')}}]}]}),signal:AbortSignal.timeout(180000)});
if(!r.ok)throw new Error('HTTP '+r.status+' '+await r.text());
const output=await r.json(),text=output.choices?.[0]?.message?.content || '';
assert.match(text,/red.*blue/is);
console.log(JSON.stringify({base,model,check:'Vision colors with low reasoning effort and sampling parameter',answer:text,usage:output.usage},null,2));
