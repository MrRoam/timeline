import {createTrack,TAU} from '../synth.mjs';
import {T} from '../reference-timing.mjs';
export const STYLE_NAME='纯净短音';
// 只使用稳定频率的正弦波与平滑包络，不调用随机噪声或扫频。
export const AUDIO_CUES=[
  {at:T.jump,kind:'click'},
  {at:T.send,kind:'click'},
  {at:T.answer,kind:'result'},
  {at:T.returnClick,kind:'click'}
];
export function createAudio(options={}){
  const track=createTrack(options);
  for(const cue of AUDIO_CUES){
    const result=cue.kind==='result',len=result ? 0.13 : 0.075,hz=result ? 523.25 : 392;
    track.add(cue.at,len,(t,p)=>{
      const envelope=Math.sin(Math.PI*p)**2*Math.exp(-2.2*p);
      return (Math.sin(TAU*hz*t)+.035*Math.sin(TAU*2*hz*t))*envelope;
    },{gain:result ? 0.16 : 0.14,pan:0,attack:.008,release:.012,kind:cue.kind});
  }
  return track.wav();
}
