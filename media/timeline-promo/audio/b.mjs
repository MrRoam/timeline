import {createTrack,TAU,smooth} from '../synth.mjs';
import {audioCues} from '../timing.mjs';
export const STYLE_NAME='克制的界面音效';
export const AUDIO_CUES=audioCues;
export function createAudio(options={}){
  const track=createTrack({...options,seed:413018});
  const {add}=track;
  const click=(at,pan=.55)=>add(at,.09,(t,p,noise)=>
    Math.sin(TAU*390*t)*Math.exp(-65*t)*.6+noise()*Math.exp(-240*t)*.2,
    {gain:.18,pan,attack:.0006,release:.018,kind:'短触控'});
  const slide=(at,len=.42,pan=.35)=>add(at,len,(t,p,noise,state)=>{
    state.low=(state.low||0)+.14*(noise()-(state.low||0));
    return state.low*Math.sin(Math.PI*p)+.15*Math.sin(TAU*(145+22*smooth(p))*t)*Math.sin(Math.PI*p);
  },{gain:.09,pan,attack:.02,release:.06,kind:'轻滑动'});
  const warm=(at,len=.22,pitch=235,pan=.4)=>add(at,len,(t,p)=>
    (Math.sin(TAU*(pitch*t+18*.027*(1-Math.exp(-t/.027))))+.05*Math.sin(TAU*pitch*2*t))*Math.exp(-t*18),
    {gain:.13,pan,attack:.004,release:.07,kind:'柔和落定'});
  for(const cue of audioCues){
    if(cue.kind==='click')click(cue.at);
    else if(cue.kind==='slide')slide(cue.at,.46);
    else if(cue.kind==='grow'){slide(cue.at,.56,0);warm(cue.at+.52,.18,185,0);}
    else if(cue.kind==='close')slide(cue.at,.48,0);
    else if(cue.kind==='mark')warm(cue.at,.24,260,.65);
    else if(cue.kind==='result')warm(cue.at,.32,190,.1);
    else if(cue.kind==='hover')slide(cue.at,.2,.65);
    else warm(cue.at,.32,170,0);
  }
  return track.wav();
}
