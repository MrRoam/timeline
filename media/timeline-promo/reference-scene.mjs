import copy from './reference-copy.json' with {type:'json'};
import dialogueCopy from './copy.json' with {type:'json'};
import {T,audioCues} from './reference-timing.mjs';

// 与参考片相同的16:9留白构图，使用同一组件展开、收拢与返回。
export const width=1920,height=1080,fps=60,duration=24;
export const stillTimes=[0.6,1.8,2.6,3.8,5.7,6.85,7.6,9.8,11.3,12.2,13.6,14.8,15.6,16.05,16.8,17.9,18.9,19.35,20.1,21.65,22.6,23.6];
export const motionWindows=[[0,.6],[1.55,2.7],[3.3,4.5],[4.7,5.6],[6.8,7.55],
  [10.75,11.7],[12.9,13.9],[14,15.1],[15.35,16.5],[16.65,17.3],
  [18.1,18.85],[19.25,20.1],[21.2,22.4]];
export {audioCues};
const C={bg:'#eff0ea',ink:'#242526',gray:'#8a8d86',line:'#ced1c8',paper:'#fff',yellow:'#f5b700'};
const clamp=p=>Math.max(0,Math.min(1,p));
const mix=(a,b,p)=>a+(b-a)*p;
const ease=p=>{p=clamp(p);return p*p*p*(p*(p*6-15)+10)};
const span=(t,a,b)=>ease((t-a)/(b-a));
const show=(t,a,b,c,d)=>span(t,a,b)*(1-span(t,c,d));
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const rect=(x,y,w,h,r,fill,extra='')=>w<=0||h<=0?'':`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const txt=(x,y,s,size=20,color=C.ink,weight=400,extra='')=>`<text x="${x}" y="${y}" font-family="Microsoft YaHei, Segoe UI, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}" ${extra}>${esc(s)}</text>`;
const group=(s,alpha=1,transform='')=>alpha<=0?'':`<g opacity="${clamp(alpha)}" transform="${transform}">${s}</g>`;
const line=(d,color=C.ink,sw=1.7,extra='')=>`<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const pin=(x,y,color=C.gray,size=18)=>`<g transform="translate(${x} ${y}) scale(${size/24})">${line('M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7l2-2V3H7v2l2 2z',color,1.8)}</g>`;
const railIcon=(x,y,color=C.ink,scale=1)=>`<g transform="translate(${x} ${y}) scale(${scale})">${[12,21,30,21,12].map((w,i)=>rect(30-w,i*7,w,2.5,1.2,color)).join('')}</g>`;
const brandIcon=(x,y,size=22)=>`<g transform="translate(${x} ${y}) scale(${size/64})"><path d="M12 2h40a10 10 0 0 1 10 10v25a10 10 0 0 1-10 10H31L17 60V47h-5A10 10 0 0 1 2 37V12A10 10 0 0 1 12 2Z" fill="url(#brand)"/><path d="M35 9 21 28h11l-5 15 18-23H34Z" fill="#fff"/></g>`;
const rgb=(a,b,p)=>'#'+a.map((v,i)=>Math.round(mix(v,b[i],p)).toString(16).padStart(2,'0')).join('');
const browserBox={x:315,y:190,w:970,h:520},railX=1258,railY=359,step=13;
const target=3*320,reading=target+54,pinY=railY+3.5*step;

function scrollAt(t){
  if(t<T.restore){
    const scanning=mix(8*320,10*320,span(t,T.scan,T.scan+1.1));
    return mix(scanning,target,span(t,T.jump,T.jump+.72));
  }
  const bottom=mix(reading,12*320,span(t,T.send,T.send+.72));
  return mix(bottom,reading,span(t,T.returnClick,T.returnClick+.7));
}

function turn(index,t){
  const item=dialogueCopy.turns[index];
  let body=rect(642,0,Math.min(480,item.q.length*17+44),46,21,'#f0f1ee')+txt(665,29,item.q,17);
  body+=txt(468,84,'ChatGPT',15,C.gray,600)+txt(468,122,item.a[0],18);
  body+=item.a.slice(1).map((s,i)=>txt(468,158+i*34,s,17,'#555951')).join('');
  body+=line('M470 269h12m-8-4-4 4 4 4M506 265v8m-4-4h8','#a2a69c',1.4);
  // 此色条是影片的阅读位置强调，随返回完成消失，不添加产品按钮。
  const emphasis=show(t,13.4,13.8,15.7,16)+show(t,19.8,20.1,20.8,21.1);
  if(index===3)body+=rect(454,143,3,95,1.5,C.yellow,`opacity="${clamp(emphasis*.8)}"`);
  return group(body,1,`translate(0 ${index*320})`);
}

function tooltip(s,y,a){
  const w=s.length*17+34;
  return group(rect(railX-43-w,y-24,w,48,12,'#f8fafc','stroke="#e2e8f0" stroke-width="1"')+
    txt(railX-26-w,y+6,s,17,'#334155'),a,`translate(${8*(1-a)} 0)`);
}

function rail(t){
  const revealed=t<T.restore?span(t,T.rail,T.rail+.55):1;
  const hovered=show(t,T.hover,T.hover+.18,T.jump+.03,T.jump+.22);
  const returnHover=show(t,T.returnHover,T.returnHover+.18,T.returnClick+.04,T.returnClick+.24);
  const pinGrow=span(t,T.mark,T.mark+.28),activePin=t>=T.returnClick+.6;
  const count=t>=T.send?13:12;
  const active=Math.round(scrollAt(t)/320);
  let body='';
  for(let i=0;i<count;i++){
    const near=Math.abs(i-3);
    const hoverW=near===0?28:near===1?20:14;
    const w=mix(14,hoverW,hovered)*revealed;
    const y=railY+i*step+(i>=4?step*pinGrow:0);
    const emphasis=(i===active&&!activePin)||i===3&&hovered>.5;
    body+=rect(railX-w,y-1,w,emphasis?3:2,1.5,emphasis?C.ink:C.line);
  }
  if(pinGrow>0){
    const w=mix(activePin?28:10,28,returnHover)*pinGrow;
    body+=rect(railX-w,pinY-1,w,3,1.5,C.yellow);
  }
  body+=group(pin(railX-13,675,pinGrow>.5?'#c78f13':C.gray),revealed);
  body+=tooltip(dialogueCopy.turns[3].q,railY+3*step,hovered);
  body+=tooltip('回到固定位置',pinY,returnHover);
  return body;
}

function pointer(x,y,t,clicks,a){
  let pulse='',press=0;
  for(const at of clicks){
    const p=(t-at)/.33;
    if(p>=0&&p<1)pulse+=`<circle cx="${x}" cy="${y}" r="${4+p*16}" fill="none" stroke="#51534c" opacity="${.15*(1-p)}"/>`;
    press=Math.max(press,Math.sin(Math.PI*clamp((t-at)/.14)));
  }
  return group(pulse+`<g transform="translate(${x} ${y}) scale(${1-.1*press})"><path d="M0 0v23l6-5 5 11 4-2-5-10h9z" fill="#252627" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></g>`,a);
}

function ui(t){
  const scroll=scrollAt(t);
  let body=txt(378,227,'ChatGPT',20,C.ink,600)+line('M342 214h15M342 222h10','#71766b',1.6);
  body+=line('M469 218l4 4 4-4','#85897f',1.5)+txt(1224,225,'分享',12,C.gray,400,'text-anchor="end"');
  body+=line('M339 245h922','#eef0e9',1);
  body+='<g clip-path="url(#messages)"><g transform="translate(0 '+(272-scroll)+')">';
  body+=dialogueCopy.turns.map((_,i)=>{
    const y=272-scroll+i*320;return y<621&&y+290>263?turn(i,t):'';
  }).join('');
  if(t>=T.send){
    const y=272-scroll+12*320;
    if(y<621){
      const a=span(t,T.answer,T.answer+.32);
      body+=group(rect(648,0,474,46,21,'#f0f1ee')+txt(669,29,copy.followup,17)+
        txt(468,84,'ChatGPT',15,C.gray,600)+
        group(txt(468,122,copy.answer[0],18)+group(txt(468,164,copy.answer[1],18),span(t,T.answer+.2,T.answer+.5)),a),1,`translate(0 ${12*320})`);
      if(t<T.answer)body+=group(`<circle cx="474" cy="${12*320+120}" r="4" fill="#444"/>`,.6);
    }
  }
  body+='</g></g>';
  body+=rect(342,263,866,15,0,'url(#topFade)')+rect(342,597,866,24,0,'url(#bottomFade)');
  body+=rect(331,621,934,74,0,'#fff');
  const draft=t>=T.type&&t<T.send?copy.followup.slice(0,Math.floor(copy.followup.length*clamp((t-T.type)/1.0))):'';
  body+=rect(464,631,676,55,24,'#f4f5f1','stroke="#e9ece3"')+txt(487,664,draft||'询问任何问题',17,draft?C.ink:'#9ba093');
  body+=line('M485 670v9m-4.5-4.5h9','#969c8e',1.5);
  const loading=t>=T.send&&t<T.answer+.5;
  body+=`<circle cx="1114" cy="658" r="17" fill="${draft||loading?C.ink:'#dadeD4'}"/>`;
  body+=loading?rect(1108,652,12,12,2,'#fff'):line('M1114 665v-14m-5 5 5-5 5 5','#fff',1.8);
  body+=txt(800,702,'ChatGPT 也可能会犯错。请核查重要信息。',9,'#a9aea0',400,'text-anchor="middle"');
  body+=rail(t);
  let x,y,a;
  if(t<T.collapse){
    const p=span(t,4.6,5.15);x=mix(1320,1250,p);y=mix(630,railY+3*step,p);
    a=show(t,4.65,4.9,8.4,8.8);
  }else{
    const sendMove=span(t,15.2,15.55),returnMove=span(t,18.05,18.65);
    x=mix(mix(932,1114,sendMove),1250,returnMove);
    y=mix(mix(666,658,sendMove),pinY,returnMove);
    a=show(t,15.18,15.35,20.05,20.45);
  }
  body+=pointer(x,y,t,[T.jump,T.send,T.returnClick],a);
  return body;
}

function component(t){
  let open=span(t,T.grow,T.grow+.95)*(1-span(t,T.collapse,T.collapse+.78));
  if(t>=T.restore)open=span(t,T.restore,T.restore+.9)*(1-span(t,T.close,T.close+.85));
  const chapter=show(t,T.collapse+.2,T.collapse+.8,T.restore+.1,T.restore+.55);
  const pillW=mix(298,350,chapter);
  const w=mix(pillW,browserBox.w,open),h=mix(76,browserBox.h,open);
  const x=800-w/2,y=mix(412,browserBox.y,open),r=mix(38,20,open);
  const pillColor=rgb([35,36,38],[237,182,45],chapter);
  const fill=rgb([parseInt(pillColor.slice(1,3),16),parseInt(pillColor.slice(3,5),16),parseInt(pillColor.slice(5,7),16)],[255,255,255],span(open,.1,.88));
  let body=`<g filter="url(#shadow)">${rect(x,y,w,h,r,fill)}</g>`;
  body+=`<defs><clipPath id="componentClip">${rect(x,y,w,h,r,'#fff')}</clipPath></defs><g clip-path="url(#componentClip)">${group(ui(t),span(open,.55,.99))}</g>`;
  const pillA=1-span(open,.03,.38);
  body+=group(railIcon(686,431,'#fff',1.2)+txt(743,463,'Timeline',36,'#fff',600),pillA*(1-chapter));
  body+=group(pin(656,432,C.ink,28)+txt(704,462,copy.chapter,27,C.ink,600),pillA*chapter);
  return body;
}

function caption(t){
  let s,a,y=764;
  if(t<T.grow){s=copy.tagline;a=span(t,.3,.7)*(1-span(t,1.15,1.55));y=539;}
  else if(t<5.05){s=copy.navigation;a=show(t,2.5,2.9,4.7,5.05);}
  else if(t<7.6){s=copy.hover;a=show(t,5.1,5.4,7.35,7.6);}
  else if(t<10.75){s=copy.located;a=show(t,7.75,8.05,10.35,10.75);}
  else if(t<12.95){s=copy.chapterNote;a=show(t,11.45,11.7,12.65,12.95);y=539;}
  else if(t<15.7){s=copy.reading;a=show(t,13.7,14,15.45,15.7);}
  else if(t<19.1){s=copy.sent;a=show(t,16.3,16.6,18.85,19.1);}
  else if(t<21.2){s=copy.returned;a=show(t,19.65,19.95,20.95,21.2);}
  else{s=copy.closing;a=span(t,22.1,22.45);y=550;}
  let body=group(txt(800,y,s,t>=21.2?26:22,t>=21.2?C.ink:'#74796d',t>=21.2?500:400,'text-anchor="middle"'),a,`translate(0 ${5*(1-a)})`);
  if(t>=21.2){
    const a=span(t,22.4,22.8);
    body+=group(txt(800,594,copy.endnote,16,'#858b7d',400,'text-anchor="middle"')+
      txt(800,649,copy.source,14,'#929888',400,'text-anchor="middle"'),a);
  }
  return body;
}

export function render(time){
  const t=Math.max(0,Math.min(duration,time));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1600 900"><defs>
  <linearGradient id="brand" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#ff52bc"/><stop offset=".5" stop-color="#9c35ff"/><stop offset="1" stop-color="#00a9fa"/></linearGradient>
  <linearGradient id="topFade" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="bottomFade" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff"/></linearGradient>
  <filter id="shadow" x="-20%" y="-25%" width="140%" height="160%"><feDropShadow dx="0" dy="8" stdDeviation="9" flood-color="#414637" flood-opacity=".07"/></filter>
  <clipPath id="messages">${rect(342,263,866,358,0,'#fff')}</clipPath>
  </defs>${rect(0,0,1600,900,0,C.bg)}${brandIcon(65,51,21)}${txt(97,69,'Timeline',15,'#575d50',600)}
  ${group(component(t),span(t,0,.24))}${caption(t)}</svg>`;
}
