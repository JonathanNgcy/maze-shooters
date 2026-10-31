import {spawn} from 'node:child_process';
const children=[];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');process.exitCode=code;}
for(const args of [['--import','./tools/ts-loader.mjs','server/index.ts'],['./node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5173']]){
 const child=spawn(process.execPath,args,{stdio:'inherit'});children.push(child);
 child.on('error',error=>{console.error(error.message);stop(1);});
 child.on('exit',code=>{if(!stopping)stop(code??1);});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop());
