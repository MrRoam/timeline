import {createTrack,TAU,smooth} from '../synth.mjs';
import {audioCues} from '../reference-timing.mjs';

// 三版使用同一操作时间。改变材质与包络，不只改变频率或音量。
export function createOption(style,options={}){
  const track=createTrack({...options,seed:{a:101031,b:101032,c:101033}[style]});
  const {add,sampleRate}=track;
  function click(at,pan=.35,gain=.22){
    if(style==='a'){
      add(at,.057,(t,p,n,s)=>{
        const noise=n();s.low=(s.low||0)+.22*(noise-(s.low||0));
        return (noise-s.low)*.65*Math.exp(-165*t)+.23*Math.sin(TAU*320*t)*Math.exp(-95*t);
      },{gain,pan,attack:.0003,release:.009,kind:'干燥按键'});
      add(at+.026,.028,(t,p,n)=>n()*Math.exp(-145*t),
        {gain:gain*.08,pan,attack:.001,release:.007,kind:'轻释放'});
    }else if(style==='b'){
      add(at,.12,(t,p,n,s)=>{
        s.low=(s.low||0)+.13*(n()-(s.low||0));
        const wood=Math.sin(TAU*215*t)*Math.exp(-68*t)+.13*Math.sin(TAU*497*t)*Math.exp(-95*t);
        return .52*s.low*Math.exp(-64*t)+.28*wood;
      },{gain:gain*.9,pan,attack:.0025,release:.035,kind:'柔软轻触'});
    }else{
      add(at,.095,(t,p)=>{
        const phase=TAU*485*(t-.22*t*t/.19);
        return Math.sin(phase+.35*Math.sin(phase*2.02))*Math.exp(-58*t);
      },{gain:gain*.72,pan,attack:.002,release:.018,kind:'电子轻点'});
    }
  }
  function glide(at,len,reverse=false,pan=0,gain=.10){
    if(style==='c'){
      add(at,len,(t,p,n,s)=>{
        const hz=reverse?510-290*smooth(p):250+290*smooth(p);
        s.phase=(s.phase||0)+TAU*hz/sampleRate;
        return Math.sin(s.phase+.12*Math.sin(s.phase*3))*Math.sin(Math.PI*p)**1.7;
      },{gain:gain*.68,pan,attack:.012,release:.04,kind:'电子展开'});
    }else{
      add(at,len,(t,p,n,s)=>{
        const noise=n();s.mid=(s.mid||0)+(style==='a'?.19:.08)*(noise-(s.mid||0));
        s.low=(s.low||0)+.028*(noise-(s.low||0));
        return (s.mid-s.low)*Math.sin(Math.PI*p)**1.1;
      },{gain:style==='a'?gain:gain*.78,pan,attack:.022,release:.05,
        kind:style==='a'?'纸面短滑':'柔和气流'});
    }
  }
  function settle(at,pan=0,gain=.14){
    if(style==='c'){
      add(at,.16,(t,p)=>Math.sin(TAU*590*t+.10*Math.sin(TAU*1180*t))*Math.exp(-33*t),
        {gain:gain*.62,pan,attack:.006,release:.04,kind:'清亮确认'});
      add(at+.11,.21,(t,p)=>Math.sin(TAU*442*t)*Math.exp(-29*t),
        {gain:gain*.48,pan,attack:.006,release:.05,kind:'低处落定'});
    }else{
      click(at,pan,gain*(style==='a'?.62:.83));
    }
  }
  for(const cue of audioCues){
    const at=cue.at;
    if(cue.kind==='click')click(at);
    else if(cue.kind==='hover')glide(at,.13,false,.4,.055);
    else if(cue.kind==='grow'){glide(at,style==='c'?.46:.38,false,p=>-.1+.2*smooth(p));settle(at+.6,0,.10);}
    else if(cue.kind==='close'){glide(at,.36,true,p=>.25*(1-p));settle(at+.52,0,.055);}
    else if(cue.kind==='slide')glide(at,.39,false,p=>-.08+.43*smooth(p),.08);
    else if(cue.kind==='ticks'){
      for(let i=0;i<3;i++)click(at+i*.075,.4,.048);
    }
    else if(cue.kind==='mark')settle(at,.4,.19);
    else if(cue.kind==='result')settle(at,.15,.12);
    else{glide(at,.19,false,0,.055);settle(at+.15,0,.10);}
  }
  return track.wav();
}
