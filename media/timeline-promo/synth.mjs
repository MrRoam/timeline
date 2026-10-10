/** 用于本片原创界面音效的原生 PCM 合成工具。 */
export const TAU=Math.PI*2;
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const smooth=v=>{v=clamp(v);return v*v*(3-2*v)};
export function createTrack({duration=26,sampleRate=48000,seed=84173}={}){
  if(!Number.isFinite(duration)||duration<=0||sampleRate!==48000)throw Error('时长须为正数，采样率须为48kHz');
  const count=Math.round(duration*sampleRate),left=new Float64Array(count),right=new Float64Array(count);
  let rng=seed>>>0;
  const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return(rng>>>0)/2147483648-1};
  const cues=[];
  function add(at,len,fn,{gain=1,pan=0,attack=.003,release=.025,kind='effect'}={}){
    cues.push({at,len,kind});
    const offset=Math.round(at*sampleRate),frames=Math.round(len*sampleRate),state={};
    for(let n=0;n<frames;n++){
      const index=offset+n;if(index<0||index>=count)continue;
      const t=n/sampleRate,p=n/frames;
      const value=fn(t,p,random,state)*gain*smooth(t/attack)*smooth((len-t)/release);
      if(!Number.isFinite(value))throw Error(`Non-finite sample: ${kind}, ${at}`);
      const balance=clamp(typeof pan==='function'?pan(p):pan,-1,1),angle=(balance+1)*Math.PI/4;
      left[index]+=value*Math.cos(angle);right[index]+=value*Math.sin(angle);
    }
  }
  function wav(){
    let peak=0;for(let n=0;n<count;n++)peak=Math.max(peak,Math.abs(left[n]),Math.abs(right[n]));
    const gain=peak>.85?.85/peak:1;
    const out=Buffer.alloc(44+count*4);
    out.write('RIFF');out.writeUInt32LE(out.length-8,4);out.write('WAVE',8);
    out.write('fmt ',12);out.writeUInt32LE(16,16);out.writeUInt16LE(1,20);out.writeUInt16LE(2,22);
    out.writeUInt32LE(sampleRate,24);out.writeUInt32LE(sampleRate*4,28);out.writeUInt16LE(4,32);out.writeUInt16LE(16,34);
    out.write('data',36);out.writeUInt32LE(count*4,40);
    for(let n=0;n<count;n++){
      const fade=Math.min(smooth(n/(sampleRate*.01)),smooth((count-1-n)/(sampleRate*.04)));
      out.writeInt16LE(Math.round(clamp(left[n]*gain*fade,-1,1)*32767),44+n*4);
      out.writeInt16LE(Math.round(clamp(right[n]*gain*fade,-1,1)*32767),46+n*4);
    }
    return out;
  }
  return{add,wav,cues,sampleRate};
}
