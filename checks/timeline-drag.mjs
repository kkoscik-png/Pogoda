import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=new Map(),timers=[];
const el=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{},setAttribute(){},classList:{toggle(){}}});return nodes.get(id);};
const c={Intl,Date,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,setTimeout:fn=>timers.push(fn),matchMedia:()=>({matches:false}),document:{getElementById:el,querySelector:el,querySelectorAll:()=>[]}};
vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={state,forecastTimes,forecastDayGroups,renderTimeline,bindChartDrag};',c);
const {state,forecastTimes,forecastDayGroups,renderTimeline,bindChartDrag}=c.t;
for(const [date,count,days] of [['2026-10-18T19:00:00Z',72,[24,24,24]],['2026-10-24T12:00:00Z',73,[24,25,24]],['2026-03-28T12:00:00Z',71,[24,23,24]]]){
 const times=forecastTimes(Date.parse(date));assert.equal(times.length,count);const groups=forecastDayGroups(times);assert.deepEqual(Array.from(groups,g=>g.count),days);assert.equal(groups.length,3);for(let i=1;i<times.length;i++)assert.equal(times[i]-times[i-1],3600);
 state.times=times;state.base=times[0];state.hour=0;renderTimeline();assert.equal((el('timelineLabels').innerHTML.match(/class="timeline-day"/g)||[]).length,3);assert(el('timelineLabels').innerHTML.includes('00:00'));assert(el('timelineLabels').innerHTML.includes('23:00'));assert(!el('timelineLabels').innerHTML.includes('NaN'));
}
const times=forecastTimes(Date.parse('2026-10-18T19:00:00Z'));assert.equal(new Date(times[0]*1000).toISOString(),'2026-10-17T22:00:00.000Z');assert.equal(new Date(times.at(-1)*1000).toISOString(),'2026-10-20T21:00:00.000Z');
const handlers=new Map(),captured=new Set(),classes=new Set(),scroller={scrollLeft:400,addEventListener(type,handler){handlers.set(type,handler);},setPointerCapture(id){captured.add(id);},hasPointerCapture(id){return captured.has(id);},releasePointerCapture(id){captured.delete(id);},classList:{add(x){classes.add(x);},remove(x){classes.delete(x);}}};nodes.set('chartScroll',scroller);bindChartDrag();
const event=(x,y,extra={})=>({button:0,isPrimary:true,pointerType:'mouse',pointerId:1,clientX:x,clientY:y,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
state.hour=1;handlers.get('pointerdown')(event(300,100));handlers.get('pointermove')(event(200,101));assert.equal(scroller.scrollLeft,500);assert(classes.has('dragging'));assert(captured.has(1));assert.equal(state.hour,1);
handlers.get('pointerup')(event(200,101));assert(!classes.has('dragging'));assert(!captured.has(1));const click=event(200,101);handlers.get('click')(click);assert(click.prevented&&click.stopped);timers.splice(0).forEach(fn=>fn());
handlers.get('pointerdown')(event(100,100));handlers.get('pointerup')(event(100,100));const normalClick=event(100,100);handlers.get('click')(normalClick);assert(!normalClick.prevented);
handlers.get('pointerdown')(event(300,100,{pointerType:'touch'}));handlers.get('pointermove')(event(200,100,{pointerType:'touch'}));assert.equal(scroller.scrollLeft,500);
handlers.get('pointerdown')(event(300,100));handlers.get('pointermove')(event(300,130));handlers.get('pointermove')(event(200,130));assert.equal(scroller.scrollLeft,500);
console.log('PASS: three full Swedish calendar days including DST, dated day bands, mouse dragging without hour selection, normal clicks, vertical scrolling and native touch panning.');
