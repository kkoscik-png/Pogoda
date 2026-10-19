import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=new Map(),timers=[];
const el=id=>{if(!nodes.has(id))nodes.set(id,{id,innerHTML:'',textContent:'',style:{},scrollLeft:0,setAttribute(){},classList:{toggle(){}}});return nodes.get(id);};
const c={Intl,Date,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,setTimeout:fn=>timers.push(fn),matchMedia:()=>({matches:false}),document:{getElementById:el,querySelector:el,querySelectorAll:()=>[]}};
vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={state,forecastTimes,forecastDayGroups,buildWindyTable,renderTimeline,bindChartDrag,url};',c);
const {state,forecastTimes,forecastDayGroups,buildWindyTable,renderTimeline,bindChartDrag,url}=c.t;
for(const [date,days] of [['2026-10-18T19:27:00Z',[4,24,24,21]],['2026-10-24T12:27:00Z',[11,25,24,13]],['2026-03-28T12:27:00Z',[12,23,24,14]]]){
 const now=Date.parse(date),times=forecastTimes(now);assert.equal(times.length,73);assert.equal(times[0],Math.floor(now/3600000)*3600-3600);assert.equal(times[1],Math.floor(now/3600000)*3600);assert.equal(times.at(-1)-times[0],72*3600);
 const groups=forecastDayGroups(times);assert.deepEqual(Array.from(groups,g=>g.count),days);for(let i=1;i<times.length;i++)assert.equal(times[i]-times[i-1],3600);
 state.times=times;state.base=times[0];state.hour=1;renderTimeline();const table=buildWindyTable(times);assert.equal((table.match(/class="meteo-day"/g)||[]).length,days.length);assert.equal((table.match(/class="hour-col hour-heading/g)||[]).length,73);assert(table.includes('00:00'));assert(table.includes('23:00'));assert(!table.includes('NaN'));assert(!table.includes('wave-model-row'));
}
const html=fs.readFileSync('dist/index.html','utf8');assert(!html.includes('class="timebar"'));assert(!html.includes('id="hour"'));assert(!html.includes('id="timelineScroll"'));assert.equal((html.match(/id="play"/g)||[]).length,1);assert(html.includes('class="wind-table-toolbar"'));assert(html.indexOf('class="chart-layout"')<html.indexOf('class="forecast-legend"'));
const times=forecastTimes(Date.parse('2026-10-18T19:27:00Z'));state.times=times;const request=new URL(url('https://api.open-meteo.com/v1/forecast',[],{}));assert.equal(request.searchParams.get('start_hour'),'2026-10-18T18:00');assert.equal(request.searchParams.get('end_hour'),'2026-10-21T18:00');
const handlers=new Map(),captured=new Set(),classes=new Set();const scroller={id:'chartScroll',scrollLeft:400,addEventListener(type,handler){handlers.set(type,handler);},setPointerCapture(id){captured.add(id);},hasPointerCapture(id){return captured.has(id);},releasePointerCapture(id){captured.delete(id);},classList:{add(x){classes.add(x);},remove(x){classes.delete(x);}}};nodes.set('chartScroll',scroller);bindChartDrag();
const event=(x,y,extra={})=>({button:0,isPrimary:true,pointerType:'mouse',pointerId:1,clientX:x,clientY:y,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...extra});
state.hour=1;handlers.get('pointerdown')(event(300,100));handlers.get('pointermove')(event(200,101));assert.equal(scroller.scrollLeft,500);assert(classes.has('dragging'));assert(captured.has(1));assert.equal(state.hour,1);
handlers.get('pointerup')(event(200,101));assert(!classes.has('dragging'));assert(!captured.has(1));const click=event(200,101);handlers.get('click')(click);assert(click.prevented&&click.stopped);timers.splice(0).forEach(fn=>fn());
handlers.get('pointerdown')(event(100,100));handlers.get('pointerup')(event(100,100));const normalClick=event(100,100);handlers.get('click')(normalClick);assert(!normalClick.prevented);
handlers.get('pointerdown')(event(300,100,{pointerType:'touch'}));handlers.get('pointermove')(event(200,100,{pointerType:'touch'}));assert.equal(scroller.scrollLeft,500);
handlers.get('pointerdown')(event(300,100));handlers.get('pointermove')(event(300,130));handlers.get('pointermove')(event(200,130));assert.equal(scroller.scrollLeft,500);
console.log('PASS: the wind table is the only time control, 73 hourly columns with Swedish DST day bands, chart legend below the plot, and grab/touch panning without accidental selection.');
