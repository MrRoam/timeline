import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Worker} from 'node:worker_threads';
import {Resvg} from '@resvg/resvg-js';
import {font} from './fonts.mjs';
import {ffmpeg,runFFmpeg,prepareAudio,verifyVideo} from './runtime.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const arg=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1]};
const sceneUrl=new URL(arg('--scene')||'./scene.mjs',import.meta.url);
const {render,width,height,fps,duration,stillTimes}=await import(sceneUrl.href);
const output=path.resolve(dir,arg('--output')||'renders');
const settings=JSON.parse(await readFile(path.resolve(dir,arg('--settings')||'settings.json'),'utf8'));
const limit=arg('--limit-seconds'),seconds=limit===undefined?duration:Number(limit);
if(!Number.isFinite(seconds)||seconds<=0||seconds>duration)throw Error('limit-seconds须介于0与场景时长之间');
if(![width,height,fps,duration].every(x=>Number.isFinite(x)&&x>0)||width%2||height%2)throw Error('画幅、帧率或时长无效');
const frames=Math.round(seconds*fps);
for(let i=0;i<=frames;i++)if(/(?:NaN|Infinity|undefined)(?=[\s"<])/u.test(render(i/fps)))throw Error(`SVG包含无效值：${i/fps}`);
await mkdir(output,{recursive:true});
for(const t of stillTimes.filter(x=>x<seconds)){
  await writeFile(path.join(output,`frame-${t.toFixed(2)}.png`),new Resvg(render(t),{font}).render().asPng());
}
if(process.argv.includes('--stills')){console.log(`静帧：${output}`);process.exit(0)}
await runFFmpeg(['-hide_banner','-version']);
const sound=await prepareAudio(output,settings.audioStyle,duration);
const video=path.join(output,'full.mp4'),partial=path.join(output,'full.partial.mp4');
const child=spawn(ffmpeg,['-hide_banner','-loglevel','warning','-y','-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-i',sound,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',String(seconds),'-movflags','+faststart',partial],{windowsHide:true});
let stderr='';child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});
const done=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error(stderr)))});
done.catch(()=>{});
const workers=Array.from({length:Math.max(1,Math.min(3,Math.floor(settings.workers)||2))},()=>new Worker(new URL('./worker.mjs',import.meta.url),{workerData:{sceneUrl:sceneUrl.href}}));
const task=(worker,index)=>new Promise((resolve,reject)=>{
  const onMessage=data=>{worker.off('error',onError);data.error?reject(Error(data.error)):resolve(Buffer.from(data.pixels.buffer,data.pixels.byteOffset,data.pixels.byteLength))};
  const onError=e=>{worker.off('message',onMessage);reject(e)};
  worker.once('message',onMessage);worker.once('error',onError);worker.postMessage({index,t:index/fps});
});
try{
  for(let i=0;i<frames;i+=workers.length){
    const batch=await Promise.all(workers.map((worker,j)=>i+j<frames?task(worker,i+j):null));
    for(const pixels of batch)if(pixels&&!child.stdin.write(pixels))await once(child.stdin,'drain');
    if(i%120===0)console.log(`${i}/${frames}帧`);
  }
  child.stdin.end();await done;await rename(partial,video);
}finally{await Promise.all(workers.map(w=>w.terminate()));if(child.exitCode===null)child.kill()}
const report={...await verifyVideo(video,{duration:seconds,fps}),width,height,audioStyle:settings.audioStyle,video};
await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2));
console.log(`完成：${video}`);
