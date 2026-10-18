import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=new Map(),timers=[];
const el=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',style:{},scrollLeft:0,setAttribute(){},classList:{toggle(){}}});return nodes.get(id);};
const c={Intl,Date,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,setTimeout:fn=>timers.push(fn),matchMedia:()=>({matches:false}),document:{getElementById:el,querySelector:el,querySelectorAll:()=>[]}};
vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={state,forecastTimes,forecastDayGroups,renderTimeline,bindChartDrag,syncForecastScroll,url};',c);
const {state,forecastTimes,forecastDayGroups,renderTimeline,bindChartDrag,syncForecastScroll,url}=c.t;
for(const [date,days] of [['2026-10-18T19:27:00Z',[4,24,24,21]],['2026-10-24T12:27:00Z',[11,25,24,13]],['2026-03-28T12:27:00Z',[12,23,24,14]]]){
 const now=Date.parse(date),times=forecastTimes(now);assert.equal(times.length,73);assert.equal(times[0],Math.floor(now/3600000)*3600-3600);assert.equal(times[1],Math.floor(now/3600000)*3600);assert.equal(times.at(-1)-times[0],72*3600);
 const groups=forecastDayGroups(times);assert.deepEqual(Array.from(groups,g=>g.count),days);for(let i=1;i<times.length;i++)assert.equal(times[i]-times[i-1],3600);
 state.times=times;state.base=times[0];state.hour=1;renderTimeline();assert.equal((el('timelineLabels').innerHTML.match(/class="timeline-day"/g)||[]).length,days.length);assert.equal((el('timelineLabels').innerHTML.match(/data-hour=/g)||[]).length,73);assert(el('timelineLabels').innerHTML.includes('00:00'));assert(el('timelineLabels').innerHTML.includes('23:00'));assert(!el('timelineLabels').innerHTML.includes('NaN'));assert.equal(el('timelineContent').style.width,'3504px');assert.equal(Number(el('hour').max),72);
}
const times=forecastTimes(Date.parse('2026-10-18T19:27:00Z'));assert.equal(new Date(times[0]*1000).toISOString(),'2026-10-18T18:00:00.000Z');assert.equal(new Date(times.at(-1)*1000).toISOString(),'2026-10-21T18:00:00.000Z');
state.times=times;const request=new URL(url('https://api.open-meteo.com/v1/forecast',[],{}));assert.equal(request.searchParams.get('start_hour'),'2026-10-18T18:00');assert.equal(request.searchParams.get('end_hour'),'2026-10-21T18:00');
function makeScroller(id){const handlers=new Map(),captured=new Set(),classes=new Set();const scroller={id,scrollLeft:400,addEventListener(type,handler){handlers.set(type,handler);},setPointerCapture(id){captured.add(id);},hasPointerCapture(id){return captured.has(id);},releasePointerCapture(id){captured.delete(id);},classList:{add(x){classes.add(x);},remove(x){classes.delete(x);}}};nodes.set(id,scroller);return {scroller,handlers,captured,classes};}
const chart=makeScroller('chartScroll'),timeline=makeScroller('timelineScroll');bindChartDrag();
const event=(x,y,extra={})=>({button:0,isPrimary:true,pointerType:'mouse',pointerId:1,clientX:x,clientY:y,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
for(const current of [chart,timeline]){
 const {scroller,handlers,captured,classes}=current;scroller.scrollLeft=400;syncForecastScroll(scroller);
 state.hour=1;handlers.get('pointerdown')(event(300,100));handlers.get('pointermove')(event(200,101));assert.equal(scroller.scrollLeft,500);assert.equal(chart.scroller.scrollLeft,timeline.scroller.scrollLeft);assert(classes.has('dragging'));assert(captured.has(1));assert.equal(state.hour,1);
 handlers.get('pointerup')(event(200,101));assert(!classes.has('dragging'));assert(!captured.has(1));const click=event(200,101);handlers.get('click')(click);assert(click.prevented&&click.stopped);timers.splice(0).forEach(fn=>fn());
 handlers.get('pointerdown')(event(100,100));handlers.get('pointerup')(event(100,100));const normalClick=event(100,100);handlers.get('click')(normalClick);assert(!normalClick.prevented);
 handlers.get('pointerdown')(event(300,100,{pointerType:'touch'}));handlers.get('pointermove')(event(200,100,{pointerType:'touch'}));assert.equal(scroller.scrollLeft,500);
 handlers.get('pointerdown')(event(300,100));handlers.get('pointermove')(event(300,130));handlers.get('pointermove')(event(200,130));assert.equal(scroller.scrollLeft,500);
 handlers.get('pointerdown')(event(300,100,{target:{closest:()=>({tagName:'INPUT'})}}));handlers.get('pointermove')(event(200,100));assert.equal(scroller.scrollLeft,500);
 // Native touch/wheel/scrollbar changes also synchronize the other viewport.
 scroller.scrollLeft=960;handlers.get('scroll')();assert.equal(chart.scroller.scrollLeft,960);assert.equal(timeline.scroller.scrollLeft,960);
}
console.log('PASS: shared 73-hour axis from now minus one hour through three days, DST day bands, exact API interval, bidirectional scroll and grab synchronization, no accidental selection and native touch panning.');
