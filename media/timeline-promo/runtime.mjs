import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import path from 'node:path';
const require=createRequire(import.meta.url);
let bundled;try{bundled=require('ffmpeg-static')}catch{}
export const ffmpeg=process.env.FFMPEG_PATH||bundled||'ffmpeg';
export function runFFmpeg(args){
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg,args,{windowsHide:true});let output='';
    child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
    child.on('error',e=>reject(Error(`FFmpeg无法启动；请设置FFMPEG_PATH或配置PATH。${e.message}`)));
    child.on('close',code=>code===0?resolve(output):reject(Error(output)));
  });
}
function loudness(text){
  const matches=[...text.matchAll(/\{[^{}]*"input_i"[^{}]*\}/g)];
  if(!matches.length)throw Error('无法读取音量测量');
  const m=JSON.parse(matches.at(-1)[0]);
  for(const key of ['input_i','input_tp','input_lra','input_thresh','target_offset'])if(!Number.isFinite(Number(m[key])))throw Error('音轨为空或测量无效');
  return m;
}
export async function prepareAudio(dir,style,duration){
  if(!['b','reference'].includes(style))throw Error('请选择已与画面对齐的音效：b 或 reference');
  const audio=await import(`./audio/${style}.mjs`);
  const raw=path.join(dir,'raw.wav'),sound=path.join(dir,'sound.wav');
  const wav=audio.createAudio({duration,sampleRate:48000});
  if(!Buffer.isBuffer(wav)||wav.length!==44+Math.round(duration*48000)*4||wav.toString('ascii',0,4)!=='RIFF')throw Error('音效模块必须返回匹配时长的48k双声道PCM WAV Buffer');
  await writeFile(raw,wav);
  const m=loudness(await runFFmpeg(['-hide_banner','-i',raw,'-af','loudnorm=I=-20:TP=-3:LRA=7:print_format=json','-f','null','-']));
  const filter=`loudnorm=I=-20:TP=-3:LRA=7:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  await runFFmpeg(['-hide_banner','-loglevel','error','-y','-i',raw,'-af',filter,'-ar','48000','-ac','2','-c:a','pcm_s16le',sound]);
  return sound;
}
export async function verifyVideo(video,{duration,fps}){
  const decode=await runFFmpeg(['-hide_banner','-loglevel','error','-nostats','-i',video,'-map','0:v:0','-map','0:a:0','-f','null','-','-progress','pipe:1']);
  const decodedFrames=Number([...decode.matchAll(/frame=(\d+)/g)].at(-1)?.[1]);
  if(decodedFrames!==Math.round(duration*fps))throw Error(`完整解码帧数错误：${decodedFrames}`);
  const info=loudness(await runFFmpeg(['-hide_banner','-i',video,'-vn','-af','loudnorm=I=-20:TP=-3:LRA=7:print_format=json','-f','null','-']));
  if(Number(info.input_tp)>-1.5)throw Error('编码后的音效峰值过高');
  return {duration,fps,decodedFrames,decode:'passed',encodedLufs:Number(info.input_i),encodedTruePeakDb:Number(info.input_tp)};
}
