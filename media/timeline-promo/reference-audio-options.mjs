import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {prepareAudio,runFFmpeg,verifyVideo} from './runtime.mjs';
import {duration,fps} from './reference-scene.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const arg=name=>{const index=process.argv.indexOf(name);return index<0?undefined:process.argv[index+1]};
const source=path.resolve(root,arg('--video')||'renders/reference-v2/full.mp4');
const output=path.resolve(root,arg('--output')||'renders/reference-v2/audio-options');
const variants=[{key:'a',label:'A-干净点击'},{key:'b',label:'B-柔和轻触'},{key:'c',label:'C-轻电子声'}];
await mkdir(output,{recursive:true});
async function measure(file){
  const result=await runFFmpeg(['-hide_banner','-i',file,'-vn','-af','loudnorm=I=-21:TP=-3:LRA=7:print_format=json','-f','null','-']);
  const matches=[...result.matchAll(/\{[^{}]*"input_i"[^{}]*\}/g)];
  const data=JSON.parse(matches.at(-1)?.[0]||'null');
  if(!data||!Number.isFinite(Number(data.input_i)))throw Error('音量测量无效');
  return {lufs:Number(data.input_i),peak:Number(data.input_tp)};
}
// 先分别做峰值安全归一化，再把三个版本对齐到共同的实际响度。
const prepared=await Promise.all(variants.map(async variant=>{
  const dir=path.join(output,'.audio-'+variant.key);await mkdir(dir,{recursive:true});
  const sound=await prepareAudio(dir,'reference-'+variant.key,duration);
  return {...variant,dir,sound,measure:await measure(sound)};
}));
const targetLufs=Math.min(-21,...prepared.map(v=>v.measure.lufs));
const start=12.9,length=9.4,previewBase=path.join(output,'preview-picture.mp4');
// 试听只渲染一次9.4秒截段，随后三版均复制同一个视频流。
await runFFmpeg(['-hide_banner','-loglevel','error','-y','-ss',String(start),'-i',source,'-t',String(length),
  '-map','0:v:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',previewBase]);
const hash=file=>runFFmpeg(['-hide_banner','-loglevel','error','-i',file,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-']);
const sourceHash=(await hash(source)).trim(),previewHash=(await hash(previewBase)).trim();
const reports=[];
for(const variant of prepared){
  const matched=path.join(variant.dir,'matched.wav');
  await runFFmpeg(['-hide_banner','-loglevel','error','-y','-i',variant.sound,'-af',`volume=${(targetLufs-variant.measure.lufs).toFixed(4)}dB`,
    '-ar','48000','-ac','2','-c:a','pcm_s16le',matched]);
  const full=path.join(output,variant.label+'.mp4'),preview=path.join(output,variant.label+'-试听.mp4');
  for(const [picture,target,offset,seconds] of [[source,full,0,duration],[previewBase,preview,start,length]]){
    await runFFmpeg(['-hide_banner','-loglevel','error','-y','-i',picture,'-ss',String(offset),'-i',matched,
      '-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','192k','-t',String(seconds),'-movflags','+faststart',target]);
  }
  const report=await verifyVideo(full,{duration,fps});
  const previewReport=await verifyVideo(preview,{duration:length,fps});
  if(Math.abs(report.encodedLufs-targetLufs)>.3)throw Error(`${variant.label}实际响度未对齐`);
  if((await hash(full)).trim()!==sourceHash||(await hash(preview)).trim()!==previewHash)throw Error('不同音效版本的视频流不一致');
  reports.push({key:variant.key,label:variant.label,...report,preview:previewReport,
    full,previewFile:preview,videoStreamIdentical:true});
  console.log(`${variant.label}：${report.encodedLufs} LUFS，${report.encodedTruePeakDb} dBTP`);
}
if(Math.max(...reports.map(v=>v.encodedLufs))-Math.min(...reports.map(v=>v.encodedLufs))>.3)throw Error('三版音量差过大');
// 截段的动作密度不同，完整成片同响度不代表试听片也同响度。
const previewTargetLufs=Math.min(-22.5,...reports.map(v=>v.preview.encodedLufs));
for(const report of reports){
  const variant=prepared.find(v=>v.key===report.key),matched=path.join(variant.dir,'matched.wav');
  const correction=previewTargetLufs-report.preview.encodedLufs;
  await runFFmpeg(['-hide_banner','-loglevel','error','-y','-i',previewBase,'-ss',String(start),'-i',matched,
    '-map','0:v:0','-map','1:a:0','-af',`volume=${correction.toFixed(4)}dB`,'-c:v','copy',
    '-c:a','aac','-b:a','192k','-t',String(length),'-movflags','+faststart',report.previewFile]);
  report.preview=await verifyVideo(report.previewFile,{duration:length,fps});
  if(Math.abs(report.preview.encodedLufs-previewTargetLufs)>.3)throw Error('试听片音量未对齐');
  if((await hash(report.previewFile)).trim()!==previewHash)throw Error('试听画面流不一致');
}
if(Math.max(...reports.map(v=>v.preview.encodedLufs))-Math.min(...reports.map(v=>v.preview.encodedLufs))>.3)throw Error('试听片音量差过大');
await writeFile(path.join(output,'verification.json'),JSON.stringify({targetLufs,previewTargetLufs,previewStart:start,previewDuration:length,reports},null,2));
console.log(`完成：${output}`);
