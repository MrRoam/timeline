import copy from './copy.json' with {type:'json'};
import {audioCues} from './timing.mjs';

// 预览与离线导出共用确定性的时间入口。
export const width=1920,height=1080,fps=60,duration=36;
export const stillTimes=[0,1.5,3.8,5.4,7.7,8.5,10.5,13.6,14.6,16,18.1,19.9,21.8,23.1,24.4,25.2,27.7,29,31.5,34.5];
export const motionWindows=[[0,.8],[2.8,4.6],[5,5.8],[6.2,7.2],[8.1,9],[12,12.8],[13.5,14.3],[15.3,16.1],[17.6,18.2],[19.2,20],[21,21.8],[22.4,23.1],[24.1,25.1],[26.7,27.6],[28,28.6],[30.4,32]];
export {audioCues};
const C={bg:'#f4f3ef',ink:'#20211f',gray:'#7c7e79',line:'#d5d6d2',gold:'#f5b700',paper:'#ffffff'};
const clamp=v=>Math.max(0,Math.min(1,v));
const mix=(a,b,p)=>a+(b-a)*p;
const ease=p=>1-(1-clamp(p))**3;
const span=(t,a,b)=>ease((t-a)/(b-a));
const between=(t,a,b,c,d)=>span(t,a,b)*(1-span(t,c,d));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const rect=(x,y,w,h,r,fill,extra='')=>w<=0||h<=0?'':`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const txt=(x,y,s,size=20,color=C.ink,weight=400,extra='')=>`<text x="${x}" y="${y}" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${esc(s)}</text>`;
const group=(body,alpha=1,transform='')=>alpha<=0?'':`<g opacity="${clamp(alpha)}" transform="${transform}">${body}</g>`;
const path=(d,color=C.ink,sw=1.8,extra='')=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const logo=(x,y,size=32)=>`<g transform="translate(${x} ${y}) scale(${size/64})"><path d="M12 2h40a10 10 0 0 1 10 10v25a10 10 0 0 1-10 10H31L17 60V47h-5A10 10 0 0 1 2 37V12A10 10 0 0 1 12 2Z" fill="url(#brandGradient)"/><path d="M35 9 21 28h11l-5 15 18-23H34Z" fill="white"/></g>`;
const pin=(x,y,color=C.gray)=>`<g transform="translate(${x} ${y}) scale(.85)">${path('M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7l2-2V3H7v2l2 2z',color)}</g>`;
const cursor=(x,y,t,clicks,alpha=1)=>{
  const down=Math.max(0,...clicks.map(at=>Math.sin(Math.PI*clamp((t-at)/.18))));
  const pulse=clicks.map(at=>{const p=(t-at)/.38;return p>=0&&p<1?`<circle cx="${x}" cy="${y}" r="${4+17*p}" fill="none" stroke="${C.ink}" stroke-width="1" opacity="${.16*(1-p)}"/>`:''}).join('');
  return group(pulse+`<g transform="translate(${x} ${y}) scale(${1-.1*down})"><path d="M0 0v24l6-5 5 11 4-2-5-11h9z" fill="#20211f" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></g>`,alpha);
};
const targetY=505,pinY=517,railX=1483,pinButton={x:1482,y:784};
const tooltip=(s,y,alpha,x=1150,w=292)=>group(rect(x,y-26,w,52,12,'#f8fafc','stroke="#e2e8f0"')+txt(x+16,y+6,s,16,'#334155'),alpha,`translate(${12*(1-alpha)} 0)`);

function header(t){
  const content=t<12?copy.headings[0]:t<19.2?copy.headings[1]:copy.headings[2];
  const start=t<12?3.25:t<19.2?12:21.2;
  const alpha=t<19.2?span(t,start,start+.4):span(t,21.2,21.6)*(1-span(t,30.3,30.7));
  return group(txt(92,156,content,36,C.ink,600)+txt(94,192,t<12?copy.subheads[0]:t<19.2?copy.subheads[1]:copy.subheads[2],17,C.gray),alpha,`translate(0 ${12*(1-span(t,start,start+.4))})`);
}

function dialogue(index,t){
  const item=copy.turns[index];
  let content=rect(625,0,Math.min(616,58+item.q.length*17),48,22,'#f1f1ee')+txt(648,31,item.q,17);
  content+=txt(510,91,'ChatGPT',15,C.gray,600)+txt(510,128,item.a[0],18,C.ink);
  content+=item.a.slice(1).map((s,k)=>txt(510,171+k*34,s,17,'#555751')).join('');
  content+=path('M513 270h13m-10-5-5 5 5 5M550 265v10m-5-5h10','#9a9b96',1.4);
  if(index===3){
    // 标记落在回答中部，返回原段落，而非只返回提问顶部。
    const mark=between(t,13.6,14.05,15.3,15.6)+between(t,17.8,18.05,19.2,19.5)+between(t,28.1,28.4,30.4,30.7);
    if(mark>0)content+=rect(499,151,3,115,1.5,C.gold,`opacity="${clamp(mark*.85)}"`);
  }
  return group(content,1,`translate(0 ${index*335})`);
}

function sceneScroll(t){
  // 同一组对话始终存在，仅改变滚动偏移。
  let scroll=9*335;
  scroll=mix(scroll,10*335,span(t,5,5.7));
  scroll=mix(scroll,3*335,span(t,8.1,8.95));
  scroll=mix(scroll,3*335+65,span(t,12.5,13.15));
  scroll=mix(scroll,9*335,span(t,15.3,16.1));
  scroll=mix(scroll,3*335+65,span(t,17.8,18.1));
  if(t>=21)scroll=3*335+65;
  if(t>=24.1)scroll=mix(3*335+65,12*335,span(t,24.1,24.85));
  if(t>=28.1)scroll=mix(12*335,3*335+65,span(t,28.1,28.4));
  return scroll;
}

function rail(t){
  let hover=-1;
  if(t>=7&&t<8.45)hover=3;
  if(t>=15&&t<15.7)hover=9;
  const hasPin=t>=13.6&&t<19.4||t>=24.5;
  const active=Math.round(sceneScroll(t)/335);
  const count=t>=24.1?13:12;
  let body='';
  for(let i=0;i<count;i++){
    const growth=span(t,3+i*.036,3.8+i*.036);
    const y=469+i*12+(hasPin&&i>=4?12*span(t,t<20?13.6:24.5,t<20?14:24.9):0);
    const near=hover<0?100:Math.abs(i-hover);
    const w=(near===0?28:near===1?20:14)*growth;
    body+=rect(railX-w,y-1,w,i===active||near===0?3:2,1.5,i===active||near===0?C.ink:C.line);
  }
  if(hasPin){
    const growth=span(t,t<20?13.6:24.5,t<20?14:24.9);
    const activePin=t>=17.8&&t<19.4||t>=28.1;
    const hoverPin=t>=17.1&&t<18.1||t>=27.4&&t<28.4;
    const w=(activePin||hoverPin?28:10)*growth;
    body+=rect(railX-w,pinY-1,w,3,1.5,C.gold);
  }
  body+=pin(pinButton.x-10,pinButton.y-10);
  if(t>=7.2&&t<8.45)body+=tooltip(copy.turns[3].q,targetY,between(t,7.2,7.5,8.18,8.45));
  if(t>=13&&t<13.85)body+=tooltip(copy.pinLabel,pinButton.y,between(t,13,13.2,13.6,13.85),1318,130);
  if(t>=17.1&&t<18.2)body+=tooltip(copy.returnLabel,pinY,between(t,17.1,17.35,17.8,18.2),1276,166);
  if(t>=26&&t<28.4)body+=tooltip(copy.returnLabel,pinY,between(t,26,26.4,28.1,28.4),1276,166);
  return body;
}

function browser(t){
  const reveal=span(t,2.8,4),chapterOut=1-span(t,19.2,19.8),chapterIn=span(t,21,21.7),out=1-span(t,30.4,31.5);
  const alpha=reveal*Math.max(chapterOut,chapterIn)*out;
  const scale=mix(.97,1,reveal)*(1-.025*span(t,19.2,19.8)*(1-chapterIn));
  const scroll=sceneScroll(t);
  let shell=rect(90,226,1420,600,18,C.paper,'stroke="#e5e6df" stroke-width="1"');
  shell+=`<g clip-path="url(#appClip)">`;
  shell+=rect(90,226,1420,36,0,'#f9f9f7')+path('M90 262h1420','#e8e9e4',1);
  shell+=[0,1,2].map(i=>`<circle cx="${112+i*14}" cy="244" r="4" fill="#d7d8d3"/>`).join('');
  shell+=rect(698,234,223,21,6,'#eeefeb')+txt(767,250,'chatgpt.com',11,'#83857d');
  shell+=rect(90,263,190,563,0,'#f9f9f7');
  shell+=txt(112,300,'ChatGPT',19,C.ink,600)+txt(112,345,'新聊天',14,'#676963')+txt(112,380,'搜索聊天',14,'#676963');
  shell+=txt(112,453,'你的聊天',12,'#94968c');
  shell+=rect(102,468,166,35,7,'#edeee8')+txt(113,491,'把想法变成计划',13,'#40423b');
  shell+=['产品方案讨论','学习笔记整理','本周工作复盘'].map((s,i)=>txt(113,535+i*37,s,13,'#818379')).join('');
  shell+=txt(309,298,'ChatGPT',18,C.ink,500)+txt(1427,298,'分享',13,C.gray);
  shell+=`<g clip-path="url(#messages)"><g transform="translate(0 ${342-scroll})">${copy.turns.slice(0,12).map((_,i)=>{const y=342-scroll+i*335;return y<716&&y+290>326?dialogue(i,t):''}).join('')}`;
  if(t>=24.1){
    if(342-scroll+12*335<716)shell+=group(rect(662,0,575,48,22,'#f1f1ee')+txt(682,31,copy.followup,17)+txt(510,91,'ChatGPT',15,C.gray,600)+group(txt(510,131,copy.newAnswer[0],18)+txt(510,171,copy.newAnswer[1],17,'#555751'),span(t,25.1,25.7)),1,`translate(0 ${12*335})`);
  }
  shell+='</g></g>';
  shell+=rect(290,715,1210,105,0,'#fff')+rect(507,735,740,64,24,'#f6f6f3','stroke="#e6e7e1"');
  const typing=clamp((t-22.35)/.85),draft=t>=22.35&&t<24.12?copy.followup.slice(0,Math.floor(copy.followup.length*typing)):'';
  shell+=txt(534,766,draft||'询问任何问题',17,draft?C.ink:'#9a9c94');
  shell+=path('M536 780v10m-5-5h10','#95978e',1.6);
  shell+=`<circle cx="1217" cy="766" r="17" fill="${draft||t>=24.1&&t<26?'#252623':'#dedfd9'}"/>`;
  shell+=t>=24.1&&t<25.7?rect(1211,760,12,12,2,'#fff'):path('M1217 773v-14m-5 5 5-5 5 5','#fff',1.9);
  shell+=txt(846,816,'ChatGPT 也可能会犯错。请核查重要信息。',10,'#a4a59c',400,'text-anchor="middle"');
  shell+=rail(t)+'</g>';
  let x=1352,y=705;
  if(t<7.05){const p=span(t,6.25,7.05);x=mix(1352,1474,p);y=mix(705,targetY,p);}
  else if(t<12.8){x=1474;y=targetY;}
  else if(t<13.55){const p=span(t,12.8,13.2);x=mix(1474,pinButton.x,p);y=mix(targetY,pinButton.y,p);}
  else if(t<15.25){const p=span(t,14.65,15.2);x=mix(pinButton.x,1474,p);y=mix(pinButton.y,589,p);}
  else if(t<17.3){const p=span(t,16.65,17.3);x=1474;y=mix(589,pinY,p);}
  else if(t<19.2){x=1474;y=pinY;}
  else if(t<24.1){const p=span(t,23.2,23.85);x=mix(906,1217,p);y=mix(757,766,p);}
  else if(t<28.1){const p=span(t,26.7,27.5);x=mix(1217,1474,p);y=mix(766,pinY,p);}
  else{x=1474;y=pinY;}
  const curAlpha=span(t,6.2,6.45)*(1-span(t,18.7,19.2))+span(t,23.1,23.4)*(1-span(t,29.3,29.8));
  shell+=cursor(x,y,t,[8.1,13.6,15.3,17.8,24.1,28.1],curAlpha);
  return group(shell,alpha,`translate(800 526) scale(${scale}) translate(-800 -526)`);
}

function heroRail(t){
  const intro=1-span(t,3.45,3.85),out=span(t,30.5,31.25),converge=span(t,2.8,3.85);
  let lines='';
  for(let i=0;i<12;i++){
    const y=mix(286+i*25,469+i*12,converge),x=mix(1333,railX,converge);
    const w=mix([36,54,86,120,85,54,36,54,86,120,85,54][i],14,converge)*span(t,.05+i*.04,.75+i*.04);
    lines+=rect(x-w,y-1,w,i===3?4:3,2,i===3?C.ink:'#c5c7be');
  }
  let finalLines='';
  for(let i=0;i<7;i++){
    const p=span(t,30.5+i*.025,31.4+i*.025);
    finalLines+=rect(mix(railX-14,737,p),mix(469+i*12,310+i*11,p),mix(14,[32,43,54,66,54,43,32][i],p),3,2,i===3?C.gold:'#a6a99e');
  }
  return group(lines,intro)+group(finalLines,out);
}

export function render(time){
  const t=Math.max(0,Math.min(duration,time)),intro=1-span(t,2.75,3.4),closing=span(t,31.1,31.8);
  const introBody=txt(94,336,copy.opening[0],59,C.ink,600)+txt(94,419,copy.opening[1],59,C.ink,600)+txt(98,478,copy.introNote,20,C.gray);
  const chapter=between(t,19.55,19.9,20.85,21.2);
  const chapterBody=rect(768,330,64,3,1.5,C.gold)+txt(800,436,copy.chapter,48,C.ink,600,'text-anchor="middle"')+txt(800,487,copy.chapterNote,21,C.gray,400,'text-anchor="middle"');
  const end=txt(800,459,copy.closing,48,C.ink,600,'text-anchor="middle"')+txt(800,511,copy.endNote,20,C.gray,400,'text-anchor="middle"')+rect(668,553,264,53,26,C.ink)+txt(800,587,copy.cta,18,'#fff',500,'text-anchor="middle"')+txt(800,672,'github.com/MrRoam/chatgpt-gemini-timeline',15,C.gray,400,'text-anchor="middle"');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1600 900"><defs><linearGradient id="brandGradient" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#ff52bc"/><stop offset=".5" stop-color="#9c35ff"/><stop offset="1" stop-color="#00a9fa"/></linearGradient><filter id="paperShadow" x="-10%" y="-15%" width="120%" height="135%"><feDropShadow dx="0" dy="12" stdDeviation="15" flood-color="#222a12" flood-opacity=".06"/></filter><clipPath id="appClip">${rect(90,226,1420,600,18,'white')}</clipPath><clipPath id="messages">${rect(295,326,1145,389,0,'white')}</clipPath></defs>${rect(0,0,1600,900,0,C.bg)}${logo(93,46,33)}${txt(141,71,'Timeline',24,C.ink,600)}${txt(1507,68,'让长对话更好用',13,C.gray,400,'text-anchor="end"')}${group(introBody,intro*span(t,.15,.65),`translate(0 ${14*(1-span(t,.15,.65))})`)}${header(t)}${browser(t)}${heroRail(t)}${group(chapterBody,chapter)}${group(end,closing,`translate(0 ${12*(1-closing)})`)}${txt(93,871,'CHATGPT · 对话导航扩展',11,'#96998e')}${txt(1507,871,'TIMELINE',11,'#96998e',400,'text-anchor="end"')}</svg>`;
}
