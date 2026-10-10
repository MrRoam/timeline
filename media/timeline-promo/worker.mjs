import { parentPort } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { render,motionWindows } from './scene.mjs';
import { font } from './fonts.mjs';
const require=createRequire(import.meta.url);
const {Resvg}=require('@resvg/resvg-js');
const raster=t=>new Resvg(render(t),{font}).render();
parentPort.on('message',({index,t})=>{
  try{
    const moving=motionWindows.some(([start,end])=>t>=start&&t<end);
    let pixels;
    if(moving){const a=raster(Math.max(0,t-.003)).pixels,b=raster(t+.003).pixels;pixels=new Uint8Array(a.length);for(let k=0;k<a.length;k++)pixels[k]=(a[k]+b[k]+1)>>1}
    else pixels=new Uint8Array(raster(t).pixels);
    parentPort.postMessage({index,pixels},[pixels.buffer]);
  }catch(e){parentPort.postMessage({index,error:e.stack})}
});
