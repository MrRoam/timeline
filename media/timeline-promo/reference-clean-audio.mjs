import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createAudio,AUDIO_CUES} from './audio/reference-clean.mjs';
import {runFFmpeg,verifyVideo} from './runtime.mjs';
import {duration,fps} from './reference-scene.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const output=path.join(root,'renders/reference-v2/clean');
const source=path.join(root,'renders/reference-v2/full.mp4');
const picture=path.join(root,'renders/reference-v2/audio-options/preview-picture.mp4');
await mkdir(output,{recursive:true});
const sound=path.join(output,'clean.wav');
const masterGainDb=12;
const wav=createAudio({duration,sampleRate:48000});
// 无动作时PCM样本必须为零，防止再次混入底噪。
for(let i=0;i<duration*48000;i++){
  if(AUDIO_CUES.some(cue=>i/48000>=cue.at&&i/48000<cue.at+(cue.kind==='result' ? 0.13 : 0.075)))continue;
  if(wav.readInt16LE(44+i*4)!==0||wav.readInt16LE(46+i*4)!==0)throw Error('静音区存在非零样本');
}
await writeFile(sound,wav);
const reports=[];
for(const [name,video,start,seconds] of [['纯净短音版',source,0,duration],['纯净短音-试听',picture,12.9,9.4]]){
  const target=path.join(output,name+'.mp4');
  // 固定增益让短音可听清；保留余量，不按稀疏音轨整体响度强行拉高。
  await runFFmpeg(['-hide_banner','-loglevel','error','-y','-i',video,'-ss',String(start),'-i',sound,
    '-map','0:v:0','-map','1:a:0','-af',`volume=${masterGainDb}dB`,'-c:v','copy','-c:a','aac','-b:a','192k','-t',String(seconds),'-movflags','+faststart',target]);
  const report=await verifyVideo(target,{duration:seconds,fps});
  const hash=file=>runFFmpeg(['-hide_banner','-loglevel','error','-i',file,'-map','0:v:0','-c:v','copy','-f','hash','-hash','sha256','-']);
  if((await hash(video)).trim()!==(await hash(target)).trim())throw Error('视频流改变');
  reports.push({name,...report,videoStreamIdentical:true});
}
await writeFile(path.join(output,'verification.json'),JSON.stringify({noRandomNoise:true,noFrequencySweeps:true,silentBetweenActions:true,masterGainDb,reports},null,2));
console.log(JSON.stringify(reports,null,2));
