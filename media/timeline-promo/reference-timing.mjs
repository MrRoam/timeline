// 新版画面和原创音效共用的关键时间，单位为秒。
export const T={open:0.12,grow:1.55,scan:3.3,rail:3.55,hover:5.15,jump:6.8,
  collapse:10.75,chapter:11.65,restore:12.9,type:14.0,send:15.65,
  mark:15.92,answer:16.65,returnHover:18.45,returnClick:19.25,close:21.2,end:22.2};
export const audioCues=[
  {at:T.open,kind:'open'}, {at:T.grow,kind:'grow'},
  {at:T.scan,kind:'slide'}, {at:T.rail,kind:'ticks'},
  {at:T.hover,kind:'hover'}, {at:T.jump,kind:'click'}, {at:T.jump+.07,kind:'slide'},
  {at:T.collapse,kind:'close'}, {at:T.chapter,kind:'mark'}, {at:T.restore,kind:'grow'},
  {at:T.send,kind:'click'}, {at:T.send+.08,kind:'slide'}, {at:T.mark,kind:'mark'},
  {at:T.answer,kind:'result'}, {at:T.returnHover,kind:'hover'},
  {at:T.returnClick,kind:'click'}, {at:T.returnClick+.06,kind:'slide'},
  {at:T.close,kind:'close'}, {at:T.end,kind:'open'}
];
