import {createTrack,TAU,smooth} from '../synth.mjs';
import {audioCues} from '../reference-timing.mjs';
export const STYLE_NAME='轻触与组件展开';
export const AUDIO_CUES=audioCues;
export function createAudio(options={}){
  const track=createTrack({...options,seed:101024});
  const {add}=track;
  function tap(at,pan=.5){
    add(at,.075,(t,p,n)=>.65*Math.sin(TAU*510*t)*Math.exp(-80*t)+n()*.15*Math.exp(-190*t),
      {gain:.19,pan,attack:.0008,release:.012,kind:'轻触'});
  }
  function glide(at,len=.42,pan=0){
    add(at,len,(t,p,n,s)=>{
      s.low=(s.low||0)+.10*(n()-(s.low||0));
      return (s.low*.8+Math.sin(TAU*(110*t+32*t*t))*.07)*Math.sin(Math.PI*p);
    },{gain:.12,pan,attack:.024,release:.055,kind:'展开滑动'});
  }
  function settle(at,pitch=240,pan=0,len=.28){
    add(at,len,(t,p)=>Math.sin(TAU*(pitch*t+9*.025*(1-Math.exp(-t/.025))))*Math.exp(-18*t),
      {gain:.15,pan,attack:.004,release:.065,kind:'落定'});
  }
  for(const c of audioCues){
    if(c.kind==='click')tap(c.at);
    else if(c.kind==='grow'){glide(c.at,.65);settle(c.at+.59,180);}
    else if(c.kind==='slide')glide(c.at,.48,p=>-.25+.7*smooth(p));
    else if(c.kind==='hover')glide(c.at,.18,.55);
    else if(c.kind==='mark')settle(c.at,340,.6);
    else if(c.kind==='close')glide(c.at,.52,p=>.45-.65*p);
    else if(c.kind==='result'){settle(c.at,205,0);settle(c.at+.12,307,0,.25);}
    else if(c.kind==='ticks')for(let i=0;i<4;i++)settle(c.at+i*.065,320+i*35,.55,.09);
    else{settle(c.at,220);settle(c.at+.08,330,0,.22);}
  }
  return track.wav();
}
