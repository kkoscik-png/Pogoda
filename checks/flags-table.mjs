import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{},classList:{toggle(){}},setAttribute(){},append(){}});return nodes.get(id);};
const c={console,Intl,Date,Math,Number,Array,Object,String,Map,Set,URLSearchParams,AbortSignal,matchMedia:()=>({matches:false}),document:{getElementById:el,querySelector:el,querySelectorAll:()=>[],createElement:()=>({})}};
vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.test={state,MODELS,PORTS,windFlagsSVG,buildWindyTable,renderChart,renderTableLabels,windHeat,flowArrow,markerIcon,updateMarkers,setHour,windFlagLayout,windFlagsOverlap,advanceFlagCycle};',c);
const {state,MODELS,PORTS,windFlagsSVG,buildWindyTable,renderChart,windHeat,flowArrow}=c.test;
// Around midnight in Swedish time: table day groups must not use the host timezone.
state.times=[Date.parse('2026-10-16T21:00:00Z')/1000,Date.parse('2026-10-16T22:00:00Z')/1000,Date.parse('2026-10-16T23:00:00Z')/1000];state.base=state.times[0];
state.wind=Object.fromEntries(Object.keys(MODELS).map((model,j)=>[model,PORTS.map((p,i)=>({hourly:{time:state.times,wind_speed_10m:[5+j,10+j,15+j],wind_gusts_10m:[8+j,15+j,21+j],wind_direction_10m:[220+j*5,70+j*5,120+j*5]}}))]));
state.wave=PORTS.map(()=>({hourly:{time:state.times,wave_height:[.5,1,1.5],wave_direction:[190,200,210],wave_period:[3,4,5]}}));
for(let p=0;p<3;p++){
 state.port=p;for(let other=0;other<3;other++)if(other!==p)assert.equal(windFlagsSVG(other),'');state.hour=0;const first=windFlagsSVG(p);assert.equal((first.match(/data-flag-model=/g)||[]).length,3);assert(first.includes('data-wind-from="220"'));assert(first.includes('5,0'));assert.equal((first.match(/class="flag-stem"/g)||[]).length,3);assert(!first.includes('V-155'));assert(first.includes('fill="none"'));assert(first.includes('stroke-width=".8"'));assert(first.includes('d="M0,0 V-42 H'));assert(first.includes('rx="4"'));assert(first.includes('height="78"'));
 state.hour=1;const next=windFlagsSVG(p);assert(next.includes('data-wind-from="70"'));assert(next.includes('10,0'));assert.notEqual(first,next);
 const table=buildWindyTable(state.times);assert.equal((table.match(/data-row-model=/g)||[]).length,5);assert.equal((table.match(/class="meteo-day"/g)||[]).length,2);assert.equal((table.match(/role="cell"/g)||[]).length,18);assert.equal((table.match(/meteo-cell selected/g)||[]).length,6);assert(table.includes('23:00'));assert(table.includes('00:00'));assert(table.includes('Wiatr 10,0 m/s · Porywy 15,0 m/s'));assert(!table.includes('NaN'));renderChart();assert(el('tableLabels').innerHTML.includes('ICON-EU'));assert(el('chartContent').innerHTML.includes('model-meteogram'));
}
assert.notEqual(windHeat(4),windHeat(10));assert.equal(windHeat(null),'#f0f2f3');assert(flowArrow(0).includes('rotate(180deg)'));
state.flags=false;assert.equal(windFlagsSVG(0),'');state.flags=true;state.port=0;state.hour=0;state.wind.icon_eu[0].hourly.wind_speed_10m[0]=null;assert.equal((windFlagsSVG(0).match(/data-flag-model=/g)||[]).length,3);
state.wind.icon_global[0].hourly.wind_speed_10m[0]=0;assert(windFlagsSVG(0).includes('calm-flag'));assert(!windFlagsSVG(0).includes('NaN'));
// Exercise the actual shared hourly selector: flags on the selected marker and every table row follow it.
state.wind.icon_eu[0].hourly.wind_speed_10m[0]=6;
state.wind.icon_global[0].hourly.wind_speed_10m[0]=7;
const icons=[];vm.runInContext('map={};markers=PORTS.map(()=>({setIcon(icon){globalThis.captureIcon(icon)},setZIndexOffset(){}}));',c);c.captureIcon=icon=>icons.push(icon);c.L={divIcon:x=>x};
c.test.setHour(0);const firstMarker=icons[0].html;assert(!icons[1].html.includes('wind-flags-svg'));assert(!icons[2].html.includes('wind-flags-svg'));assert(firstMarker.includes('data-wind-from="220"'));
c.test.setHour(1);const nextMarker=icons[3].html;assert(nextMarker.includes('data-wind-from="70"'));assert.notEqual(firstMarker,nextMarker);assert.equal(icons.length,6);assert.equal(state.hour,1);assert.equal((el('chartContent').innerHTML.match(/meteo-cell selected/g)||[]).length,6);
// Labels use true compass bearings: adjacent directions collide, perpendicular
// and opposing winds stay separate, including the 359°/1° wrap around north.
const {windFlagLayout,windFlagsOverlap,advanceFlagCycle}=c.test;
assert(windFlagsOverlap(359,1));assert(windFlagsOverlap(40,43));assert(!windFlagsOverlap(0,90));assert(!windFlagsOverlap(0,180));
state.port=0;state.hour=0;state.flagCycle=0;
for(const [i,model] of Object.keys(MODELS).entries())state.wind[model][0].hourly.wind_direction_10m[0]=i<3?40+i:220+(i-3)*60;
let layout=windFlagLayout(0);assert.equal(layout.length,3);assert.equal(new Set(layout.map(f=>f.model)).size,3);assert.equal(layout.filter(f=>f.cycleSize===3).length,3);assert.equal(new Set(layout.map(f=>f.lane)).size,3);
const seen=new Set();for(let phase=0;phase<3;phase++){state.flagCycle=phase;layout=windFlagLayout(0);assert.equal(layout.length,3);const front=layout.filter(f=>f.front);assert.equal(front.length,1);seen.add(front[0].model);assert.equal(layout.at(-1).model,front[0].model);const svg=windFlagsSVG(0);assert.equal((svg.match(/aria-hidden="false"/g)||[]).length,3);assert(!svg.includes('flag-obscured'));}
assert.equal(seen.size,3);
// Three slots always include the selected wind source when its data is present.
state.model='smhi_snow';assert(windFlagLayout(0).some(f=>f.model==='smhi_snow'));assert.equal(windFlagLayout(0).length,3);state.model='ecmwf_ifs';
// The timer moves the overlapping card to the top without hiding any card.
state.flagCycle=0;let toggles=0;const raised=[],liveNodes=windFlagLayout(0).map(f=>({model:f.model,dataset:{cycleSize:String(f.cycleSize),cycleIndex:String(f.cycleIndex)},classList:{toggle(name,front){assert.equal(name,'flag-front');this.front=front;toggles++;}},parentNode:{append(node){raised.push(node.model);}}}));
c.document.querySelectorAll=()=>liveNodes;for(let i=0;i<3;i++)advanceFlagCycle();assert.equal(state.flagCycle,3);assert.equal(new Set(raised).size,3);assert.equal(liveNodes.length,3);assert.equal(toggles,9);
state.flags=false;advanceFlagCycle();assert.equal(state.flagCycle,3);state.flags=true;c.document.hidden=true;advanceFlagCycle();assert.equal(state.flagCycle,3);c.document.hidden=false;c.document.querySelectorAll=()=>[];
console.log('PASS: selected-port rounded flags, exact bearing alignment, three simultaneous sources and rotating overlap order without hiding flags, actual hourly-selector synchronization, values/bearings, calm/missing handling, table rows, Swedish day grouping, heat colors and selected column.');
