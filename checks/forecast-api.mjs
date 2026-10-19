import {createLastGoodCache,normalizeDMIOpenMeteo} from '../worker/dmi-resilience.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createForecastAPI,normalizeFMI,normalizeDMI,modelTiming,normalizeDMIGeoJSON,createDMIRequester} from '../worker/forecast.mjs';
import {bloscReader} from '../worker/blosc.mjs';
import {loadCopernicus} from '../worker/copernicus.mjs';
const T='2026-10-18T16:00:00Z',point={id:'0',lat:58.3,lon:20};
function fmiXML(points,value='0'){
 return '<wfs:FeatureCollection>'+points.map(p=>['SigWaveHeight','WaveDirection','WavePeriod'].map(field=>`<wfs:member><gml:pos>${p.lat} ${p.lon}</gml:pos><om:observedProperty xlink:href="https://opendata.fmi.fi/meta?observableProperty=forecast&amp;param=${field}&amp;language=eng"/><om:resultTime><gml:TimeInstant><gml:timePosition>2026-10-18T15:48:23Z</gml:timePosition></gml:TimeInstant></om:resultTime><om:parameter><om:NamedValue><om:name xlink:href="analysisTime"/><gml:timePosition>2026-10-18T12:00:00Z</gml:timePosition></om:NamedValue></om:parameter><wml2:MeasurementTVP><wml2:time>${T}</wml2:time><wml2:value>${value}</wml2:value></wml2:MeasurementTVP><wml2:MeasurementTVP><wml2:time>2026-10-18T17:00:00Z</wml2:time><wml2:value>NaN</wml2:value></wml2:MeasurementTVP></wfs:member>`).join('')).join('')+'</wfs:FeatureCollection>';
}
test('FMI preserves zero, missing values, wind-from directions and actual publication time',()=>{
 const d=normalizeFMI(fmiXML([point]),[point]);assert.equal(d.records[0].hourly.wave_height[0],0);assert.equal(d.records[0].hourly.wave_height[1],null);assert.equal(d.records[0].hourly.wave_direction[0],0);
 assert.equal(d.timing.updatedAt,'2026-10-18T15:48:23.000Z');assert.equal(d.timing.referenceTime,'2026-10-18T12:00:00Z');assert.equal(d.timing.nextUpdate,'2026-10-18T21:48:23.000Z');
 assert.equal(normalizeFMI(fmiXML([point],''),[point]).records[0].hourly.wave_height[0],null);
 assert.throws(()=>normalizeFMI('<ExceptionReport/>',[point]));
});
test('DMI interprets axis order, units and missing sea cells without replacing the provider',()=>{
 const values={'wind-speed-10m':[0,9],'wind-dir-10m':[360,180],'gust-wind-speed-10m':[0,null]};
 const data={domain:{axes:{t:{values:[T]},x:{values:[20,20.1]},y:{values:[58.3]}}},ranges:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,{axisNames:['y','t','x'],shape:[1,1,2],values:v}]))};
 const r=normalizeDMI(data,[point],'dmi_harmonie',T);assert.equal(r.records[0].hourly.wind_speed_10m[0],0);assert.equal(r.records[0].hourly.wind_gusts_10m[0],0);assert.equal(r.records[0].hourly.wind_direction_10m[0],360);assert.equal(r.timing.basis,'reference');
 data.ranges={'significant-wave-height':{axisNames:['t','y','x'],shape:[1,1,2],values:[null,1.5]}};
 const sea=normalizeDMI(data,[point],'dmi_wam',T).records[0];assert.equal(sea.longitude,20.1);assert.equal(sea.hourly.wave_height[0],1.5);assert.equal(sea.hourly.wave_period[0],null);
});
test('forecast endpoint restricts models, coordinates, groups, methods and page offsets',async()=>{
 let calls=0;const api=createForecastAPI({fetcher:async()=>{calls++;throw Error('must not fetch');}});
 for(const query of ['model=other','model=fmi_wam&group=any','model=fmi_wam&group=route&offset=1','model=fmi_wam&group=route&offset=999','model=fmi_wam&group=ports&offset=6'])assert.equal((await api(new Request('https://weather.seasync.co/api/forecast?'+query),{})).status,400);
 assert.equal((await api(new Request('https://weather.seasync.co/api/forecast?model=fmi_wam',{method:'POST'}),{})).status,405);assert.equal(calls,0);
});
test('FMI fetches every fixed route point explicitly and reuses cached forecasts',async()=>{
 let calls=0;const api=createForecastAPI({now:()=>Date.parse(T)+27*60000,fetcher:async url=>{calls++;const u=new URL(url);assert.equal(u.hostname,'opendata.fmi.fi');assert.equal(u.searchParams.get('starttime'),'2026-10-18T15:00:00.000Z');assert.equal(u.searchParams.get('endtime'),'2026-10-21T15:00:00.000Z');const points=u.searchParams.getAll('latlon').map(s=>{const [lat,lon]=s.split(',').map(Number);return{lat,lon};});assert.equal(points.length,1);return new Response(fmiXML(points,'1.2'));}});
 const request=()=>new Request('https://weather.seasync.co/api/forecast?model=fmi_wam&group=route');
 const response=await api(request(),{}),d=await response.json();assert.equal(response.status,200);assert.equal(d.records.length,6);assert.equal(d.total,59);assert.equal(d.nextOffset,6);assert.equal(d.records[0].provider,'FMI');assert(d.records.every(r=>r.hourly.wave_height[0]===1.2));assert.equal((await api(request(),{})).status,200);assert.equal(calls,6);
});
test('upstream failure remains an explicit error, never another-model forecast',async()=>{
 const api=createForecastAPI({fetcher:async()=>new Response('busy',{status:429})});const r=await api(new Request('https://weather.seasync.co/api/forecast?model=fmi_wam&group=route'),{});assert.equal(r.status,429);const d=await r.json();assert.equal(d.model,'fmi_wam');assert.equal(d.records,undefined);
});
test('independently compressed Blosc fixtures decode exactly across block boundaries',()=>{
 const fixtures=JSON.parse(fs.readFileSync(new URL('./fixtures/blosc-lz4.json',import.meta.url)));
 for(const fixture of fixtures){const reader=bloscReader(Buffer.from(fixture.base64,'base64'));for(let i=0;i<fixture.count;i++)assert.equal(reader.number(i),Math.fround(i<1000?0:(i-1000)/37));}
});
test('Copernicus starts one hour before now and reads all 73 actual hourly slices',async()=>{
 const raw=values=>{const b=Buffer.alloc(16+values.length*4);b[2]=2;b[3]=4;b.writeUInt32LE(values.length*4,4);b.writeUInt32LE(values.length*4,8);b.writeUInt32LE(b.length,12);values.forEach((v,i)=>b.writeFloatLE(v,16+i*4));return b;};
 const array={shape:[73,1,1],chunks:[73,1,1],dtype:'<f4',order:'C',fill_value:-9999,compressor:{id:'blosc',cname:'lz4'}};
 const metadata=Object.fromEntries(['VHM0','VMDR','VTPK'].map(f=>[f+'/.zarray',array]));for(const a of ['latitude','longitude'])metadata[a+'/.zarray']={shape:[1]};
 const dataset={properties:{admp_released_date:'2023-01-01',admp_updated_data:T},assets:{geoChunked:{href:'https://example.test/zarr',viewDims:{time:{coords:{min:Date.parse(T)-3600000}}}}}};
 const getJSON=async url=>url.endsWith('product.stac.json')?{links:[{rel:'item',href:'cmems_mod_bal_wav_anfc_PT1H-i_202311/dataset.stac.json'}]}:url.endsWith('.zmetadata')?{metadata}:dataset;
 const getBuffer=async url=>raw(url.includes('/latitude/')?[58.3]:url.includes('/longitude/')?[20]:Array.from({length:73},(_,i)=>url.includes('/VHM0/')?i+.5:url.includes('/VMDR/')?0:5));
 const result=await loadCopernicus([point],{getJSON,getBuffer,now:Date.parse(T)+30*60000}),h=result.records[0].hourly;
 assert.equal(h.time[0],Date.parse(T)/1000-3600);assert.equal(h.time[1],Date.parse(T)/1000);assert.equal(h.time.length,73);assert.equal(h.wave_height[0],.5);assert.equal(h.wave_height[72],72.5);assert.equal(h.wave_direction[0],0);
});
test('missing hours offer an explicit jump without changing the time or mixing provider errors',()=>{
 const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{},setAttribute(){},classList:{toggle(){}},append(){}});return nodes.get(id);};
 const c={Intl,Date,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,matchMedia:()=>({matches:false}),document:{getElementById:el,querySelector:el,querySelectorAll:()=>[]}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={state,renderWaveAvailability,nextWaveHour,renderSummary};',c);
 const {state,renderWaveAvailability,nextWaveHour,renderSummary}=c.t,t=Date.parse(T)/1000;state.times=[t,t+3600,t+7200];
 const record={hourly:{time:state.times,wave_height:[0,1,null],wave_direction:[0,90,null],wave_period:[5,5,null]}};
 for(const source of ['ecmwf_wam','fmi_wam','copernicus_baltic','dmi_wam','dwd_ewam','stormglass']){
  state.waveSource=source;state.wave=state.stormglassWave=state.waves[source]=[record,record,record];state.hour=0;
  renderWaveAvailability();assert.match(el('waveDataStatus').textContent,/3\/3/);assert.equal(el('waveAvailableHour').hidden,true);
 }
 state.waveSource='fmi_wam';state.waves.fmi_wam=[{hourly:{time:state.times,wave_height:[null,null,.7]}}];renderWaveAvailability();
 assert.equal(state.hour,0);assert.equal(nextWaveHour(state.waves.fmi_wam),t+7200);assert.match(el('waveDataStatus').textContent,/20:00/);assert.equal(el('waveAvailableHour').hidden,false);
 state.waveSource='dmi_wam';state.waves.dmi_wam=null;state.errors['wave-dmi_wam']='DMI: dostawca zajęty (429)';renderSummary();assert.match(el('waveDataStatus').textContent,/429/);
 state.waveSource='dwd_ewam';renderSummary();assert.doesNotMatch(el('forecastError').textContent,/DMI/);
});
test('selected wave models isolate ports, route, map, and Swedish update clocks',()=>{
 const nodes=new Map(),el=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',style:{},setAttribute(){},classList:{toggle(){}},append(){}});return nodes.get(id);};
 const c={Intl,Date,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,matchMedia:()=>({matches:false}),document:{getElementById:el,querySelector:el,querySelectorAll:()=>[]}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={state,MODELS,WAVE_SOURCES,waveAt,routeWaveValues,currentGrid,renderUpdateClocks,selectWaveSource};',c);
 const t=c.t,timestamp=Date.parse(T)/1000; t.state.times=[timestamp];t.state.layer='wave';
 const record=v=>({hourly:{time:[timestamp],wave_height:[v],wave_direction:[0],wave_period:[5]}});
 t.state.wave=[record(9)];t.state.routeWaveGrid=[{series:record(9)}];t.state.waveGrid=[{series:record(9)}];
 for(const [i,model] of ['fmi_wam','dmi_wam','copernicus_baltic','dwd_ewam'].entries()){
  t.state.waves[model]=[record(i)];t.state.waveRoutes[model]=[{series:record(i)}];t.state.waveFields[model]=[{series:record(i)}];t.state.waveSource=model;
  assert.equal(t.waveAt(0,'wave_height'),i);assert.equal(t.routeWaveValues()[0].value,i);assert.equal(t.currentGrid()[0].series.hourly.wave_height[0],i);
  t.state.timings[model]=modelTiming('2026-10-18T12:00:00Z',6*3600000);t.renderUpdateClocks();assert(el('waveUpdates').innerHTML.includes('14:00'));assert(el('waveUpdates').innerHTML.includes('20:00'));assert(el('waveUpdates').innerHTML.includes('przewidywana'));
 }
 assert.equal(t.selectWaveSource('smhi_swan'),false);assert.equal(t.MODELS.dmi_harmonie.api,true);
 t.state.waveSource='ecmwf_wam';assert.equal(t.waveAt(0,'wave_height'),9);assert.equal(t.currentGrid()[0].series.hourly.wave_height[0],9);
 const html=fs.readFileSync('dist/index.html','utf8');for(const model of ['fmi_wam','dmi_wam','dwd_ewam','copernicus_baltic','dmi_harmonie'])assert(html.includes('value="'+model+'"'));assert(html.includes('id="windSource"'));assert(html.includes('id="waveUpdates"'));
});


test('DMI cloud fractions become percent and accumulated precipitation becomes exact hourly amounts',()=>{
 const fields={'wind-speed-10m':[3,4,5],'fraction-of-cloud-cover':[.5,0,1],'high-cloud-cover':[100,0,50],'low-cloud-cover':[0,0,40],'medium-cloud-cover':[20,0,80],'total-precipitation':[2,2.5,4]};
 const data={domain:{axes:{t:{values:[T,'2026-10-18T17:00:00Z','2026-10-18T18:00:00Z']},x:{values:[20]},y:{values:[58.3]}}},ranges:Object.fromEntries(Object.entries(fields).map(([key,values])=>[key,{axisNames:['t','y','x'],shape:[3,1,1],values}]))};
 const h=normalizeDMI(data,[point],'dmi_harmonie',T).records[0].hourly;assert.deepEqual(h.cloud_cover,[50,0,100]);assert.deepEqual(h.cloud_cover_high,[100,0,50]);assert.deepEqual(h.precipitation,[null,.5,1.5]);
 data.ranges['total-precipitation'].values=[2,1,2];assert.deepEqual(normalizeDMI(data,[point],'dmi_harmonie',T).records[0].hourly.precipitation,[null,null,1]);
 data.domain.axes.t.values[2]='2026-10-18T20:00:00Z';assert.equal(normalizeDMI(data,[point],'dmi_harmonie',T).records[0].hourly.precipitation[2],null);
});


test('documented DMI GeoJSON preserves coordinates, hourly gaps, cloud units, zero and missing values',()=>{
 const f=(step,properties)=>({type:'Feature',geometry:{type:'Point',coordinates:[20.01,58.31]},properties:{step,...properties}});
 const data={type:'FeatureCollection',features:[f('2026-10-18T17:00:00Z',{'wind-speed-10m':4,'fraction-of-cloud-cover':.5,'total-precipitation':2.5}),f(T,{'wind-speed-10m':0,'wind-dir-10m':0,'gust-wind-speed-10m':null,'fraction-of-cloud-cover':0,'low-cloud-cover':0,'total-precipitation':2})]};
 const result=normalizeDMIGeoJSON(data,[point],'dmi_harmonie',null,Date.parse(T)),r=result.records[0];assert.equal(r.longitude,20.01);assert.equal(r.latitude,58.31);assert.deepEqual(r.hourly.wind_speed_10m,[0,4]);assert.deepEqual(r.hourly.cloud_cover,[0,50]);assert.deepEqual(r.hourly.precipitation,[null,.5]);assert.equal(r.hourly.wind_gusts_10m[0],null);assert.equal(r.hourly.wind_direction_10m[0],0);assert.equal(result.timing.basis,'fetch');assert.equal(result.timing.referenceTime,null);
 assert.throws(()=>normalizeDMIGeoJSON({type:'FeatureCollection',features:[]},[point],'dmi_harmonie'));
});

test('DMI uses complete-run collection position, GeoJSON, lon lat, filters and shared positive cache',async()=>{
 let clock=Date.parse(T),calls=0;const urls=[],api=createForecastAPI({now:()=>clock,pause:async ms=>{clock+=ms;},fetcher:async url=>{
  calls++;urls.push(url);const u=new URL(url);assert.equal(u.hostname,'opendataapi.dmi.dk');if(u.pathname.endsWith('/instances'))return new Response(JSON.stringify({instances:[{id:'2026-10-18T120000Z'}]}));if(u.pathname==='/v1/forecastedr/collections/harmonie_dini_sf')return new Response(JSON.stringify({extent:{temporal:{interval:[['2026-10-18T12:00:00Z','2026-10-20T12:00:00Z']]}}}));assert.equal(u.pathname,'/v1/forecastedr/collections/harmonie_dini_sf/position');assert.match(url,/coords=POINT%28[\d.]+%20[\d.]+%29/);assert(!url.includes('+'));assert.equal(u.searchParams.get('f'),'GeoJSON');assert.equal(u.searchParams.get('crs'),'crs84');assert(u.searchParams.get('parameter-name').includes('low-cloud-cover'));assert(u.searchParams.get('parameter-name').includes('total-precipitation'));assert.equal(u.searchParams.get('datetime'),'2026-10-18T14:00:00.000Z/2026-10-20T12:00:00.000Z');
  const [lon,lat]=u.searchParams.get('coords').slice(6,-1).split(' ').map(Number);assert(lon>17&&lon<22);assert(lat>57&&lat<60);assert(!u.searchParams.has('api-key'));
  return new Response(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Point',coordinates:[lon,lat]},properties:{step:T,'wind-speed-10m':3,'wind-dir-10m':90,'fraction-of-cloud-cover':.4}}]}));
 }});
 const request=()=>new Request('https://weather.seasync.co/api/forecast?model=dmi_harmonie&group=ports');const [a,b]=await Promise.all([api(request(),{}),api(request(),{})]);assert.equal(a.status,200);assert.equal(b.status,200);const d=await a.json();assert.equal(d.records.length,3);assert.equal(d.records[0].hourly.cloud_cover[0],40);assert.equal(calls,5);assert.equal((await api(request(),{})).status,200);assert.equal(calls,5);assert(clock-Date.parse(T)>=3000);
});

test('DMI serializes different requests and spaces starts by at least one second',async()=>{
 let clock=0,active=0,maxActive=0;const starts=[];const request=createDMIRequester({now:()=>clock,pause:async ms=>{clock+=ms;},fetcher:async()=>{active++;maxActive=Math.max(maxActive,active);starts.push(clock);await Promise.resolve();active--;return new Response('{}');}});
 await Promise.all([request('https://opendataapi.dmi.dk/a'),request('https://opendataapi.dmi.dk/b'),request('https://opendataapi.dmi.dk/c')]);assert.equal(maxActive,1);assert.deepEqual(starts,[0,1000,2000]);
});

test('DMI respects Retry-After and shares its cooldown across worker instances and groups',async()=>{
 let clock=Date.parse(T),calls=0;const stored=new Map(),cache={async match(req){return stored.get(req.url)?.clone();},async put(req,res){stored.set(req.url,res.clone());}};
 const options={cache,now:()=>clock,pause:async ms=>{clock+=ms;},fetcher:async()=>{calls++;return new Response('busy',{status:429,headers:{'Retry-After':'120'}});}};
 const a=createForecastAPI(options),b=createForecastAPI(options),request=group=>new Request('https://weather.seasync.co/api/forecast?model=dmi_wam&group='+group);
 const first=await a(request('ports'),{});assert.equal(first.status,429);assert.equal(first.headers.get('Retry-After'),'120');assert.equal((await first.json()).retryAt,'2026-10-18T16:02:00.000Z');assert.equal(calls,1);
 const second=await b(request('wave-grid'),{});assert.equal(second.status,429);assert.equal(calls,1);clock+=121000;assert.equal((await b(request('ports'),{})).status,429);assert.equal(calls,2);
});

test('DMI server busy without Retry-After waits sixty seconds and doubles each pause',async()=>{
 let clock=Date.parse(T),calls=0;const api=createForecastAPI({now:()=>clock,fetcher:async()=>{calls++;return new Response('Server is busy',{status:429});}});const req=()=>new Request('https://weather.seasync.co/api/forecast?model=dmi_wam&group=ports');
 const first=await api(req(),{});assert.equal(first.status,429);assert.equal(first.headers.get('Retry-After'),'60');assert.equal(calls,1);assert.equal((await api(req(),{})).status,429);assert.equal(calls,1);
 const metadata=await api(new Request('https://weather.seasync.co/api/model-updates?model=dmi_wam'),{});assert.equal(metadata.status,429);assert.equal(calls,1);clock+=60000;assert.equal((await api(req(),{})).headers.get('Retry-After'),'120');assert.equal(calls,2);clock+=120000;assert.equal((await api(req(),{})).headers.get('Retry-After'),'240');assert.equal(calls,3);
});

test('DMI handles an HTTP date in Retry-After',async()=>{
 const clock=Date.parse(T);let calls=0;const request=createDMIRequester({now:()=>clock,fetcher:async()=>{calls++;return new Response('busy',{status:429,headers:{'Retry-After':'Sun, 18 Oct 2026 16:03:00 GMT'}});}});
 await assert.rejects(request('https://opendataapi.dmi.dk/a'),e=>e.status===429&&e.retryAfter===180);await assert.rejects(request('https://opendataapi.dmi.dk/b'),e=>e.status===429&&e.retryAfter===180);assert.equal(calls,1);
});

test('client respects the DMI server cooldown when another group is selected',async()=>{
 let calls=0;const c={Date,Intl,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,matchMedia:()=>({matches:false}),localStorage:{getItem(){return null;}},document:{getElementById:()=>({})},fetch:async()=>{calls++;return new Response(JSON.stringify({error:'DMI jest przeciążone',retryAt:new Date(Date.now()+120000).toISOString(),retryAfter:120}),{status:429});}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.t={fetchProvider};',c);
 await assert.rejects(c.t.fetchProvider('dmi_harmonie','ports'),e=>e.status===429);await assert.rejects(c.t.fetchProvider('dmi_harmonie','wind-grid'),e=>e.status===429);assert.equal(calls,1);
});

function dmiClientFixture(statuses){
 let clock=Date.parse(T),calls=0,mapLoads=0,id=0;const timers=new Map();
 class Clock extends Date{static now(){return clock;}}
 const c={Date:Clock,Intl,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,matchMedia:()=>({matches:false}),
  setTimeout(fn,delay){timers.set(++id,{fn,at:clock+delay});return id;},clearTimeout(id){timers.delete(id);},
  localStorage:{getItem(){return null;},setItem(){}},document:{hidden:false,getElementById:()=>({})},
  fetch:async()=>{const status=statuses[Math.min(calls++,statuses.length-1)];return new Response(JSON.stringify(status===429?{error:'Server is busy',retryAt:new Date(clock+(calls===1?10000:30000)).toISOString(),retryAfter:calls===1?10:30}:{records:Array.from({length:3},(_,i)=>({id:String(i),hourly:{time:[],wind_speed_10m:[]}})),nextOffset:null}),{status});}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+`;renderAll=()=>{};renderUpdateClocks=()=>{};loadField=async()=>{recordMapLoad();};globalThis.t={state,loadExtraWindPorts,providerRetries,providerRetryTimers,resumeDMIRetries,clearDMIRetryTimers};`,Object.assign(c,{recordMapLoad(){mapLoads++;}}));
 c.t.state.model='dmi_harmonie';return {c,timers,get calls(){return calls;},get mapLoads(){return mapLoads;},advance(ms){clock+=ms;},async fire(){const [id,timer]=[...timers][0];timers.delete(id);clock=Math.max(clock,timer.at);await timer.fn();}};
}
test('selected DMI retries automatically twice, deduplicates timers and recovers chart plus map',async()=>{
 const f=dmiClientFixture([429,429,200]),t=f.c.t;await t.loadExtraWindPorts('dmi_harmonie');assert.equal(f.calls,1);assert.equal(f.timers.size,1);assert.match(t.state.errors.dmi_harmonie,/próba 1\/2/);
 await t.loadExtraWindPorts('dmi_harmonie');assert.equal(f.calls,1);assert.equal(f.timers.size,1);
 await f.fire();assert.equal(f.calls,2);assert.equal(f.timers.size,1);assert.match(t.state.errors.dmi_harmonie,/próba 2\/2/);
 await f.fire();assert.equal(f.calls,3);assert.equal(t.state.wind.dmi_harmonie.length,3);assert.equal(t.state.errors.dmi_harmonie,'');assert.equal(f.timers.size,0);assert.equal(t.providerRetries.size,0);assert.equal(f.mapLoads,1);
});
test('persistent DMI 429 stops automatic attempts after two retries',async()=>{
 const f=dmiClientFixture([429]),t=f.c.t;await t.loadExtraWindPorts('dmi_harmonie');
 // A concurrent map response can replace the retry record before the timer fires.
 t.providerRetries.set('dmi_harmonie',{...t.providerRetries.get('dmi_harmonie')});await f.fire();await f.fire();assert.equal(f.calls,3);assert.equal(f.timers.size,0);assert.equal(f.mapLoads,0);assert.match(t.state.errors.dmi_harmonie,/Automatyczne ponowienia zakończone/);
 t.resumeDMIRetries();assert.equal(f.timers.size,0);assert.equal(f.calls,3);
});
test('automatic DMI retries pause in a hidden page and skip an unselected source',async()=>{
 const f=dmiClientFixture([429]),t=f.c.t;f.c.document.hidden=true;await t.loadExtraWindPorts('dmi_harmonie');assert.equal(f.timers.size,0);assert.equal(f.calls,1);
 f.c.document.hidden=false;t.resumeDMIRetries();assert.equal(f.timers.size,1);f.c.document.hidden=true;t.clearDMIRetryTimers();assert.equal(f.timers.size,0);
 f.c.document.hidden=false;t.resumeDMIRetries();t.state.model='ecmwf_ifs';await f.fire();assert.equal(f.calls,1);assert.equal(f.timers.size,0);
});

function openMeteoFixture(points,time=Date.parse(T)/1000){return points.map(p=>({latitude:p.lat,longitude:p.lon,hourly_units:{wind_speed_10m:'m/s',temperature_2m:'°C'},hourly:{time:[time,time+3600,time+12*3600],wind_speed_10m:[0,3,4],wind_direction_10m:[0,90,180],wind_gusts_10m:[0,5,7],cloud_cover:[0,50,100],precipitation:[0,1.2,null],temperature_2m:[-4,0,6]}}));}
function forecastStore(){const entries=new Map();return {async match(req){return entries.get(req.url)?.clone();},async put(req,res){entries.set(req.url,res.clone());}};}
test('DMI Open-Meteo fallback preserves units, calm, gaps, negative Celsius and declares the ECMWF blend',()=>{
 const r=normalizeDMIOpenMeteo(openMeteoFixture([point]),[point],Date.parse(T));assert.equal(r.delivery,'open-meteo');assert.equal(r.blend,true);assert.match(r.notice,/DMI.*ECMWF/);assert.equal(r.records[0].hourly.wind_speed_10m[0],0);assert.equal(r.records[0].hourly.wind_direction_10m[0],0);assert.equal(r.records[0].hourly.precipitation[2],null);assert.equal(r.records[0].hourly.temperature_2m[0],-4);assert.equal(r.timing.nextUpdate,'2026-10-18T19:00:00.000Z');
 const wrong=openMeteoFixture([point]);wrong[0].hourly_units.wind_speed_10m='km/h';assert.throws(()=>normalizeDMIOpenMeteo(wrong,[point]));
});
test('DMI stores one forecast until its next model update, survives Worker replacement, and returns the original stale snapshot on failure',async()=>{
 let clock=Date.parse(T),loads=0,fallbacks=0;const cache=forecastStore(),options={cache,now:()=>clock},a=createLastGoodCache(options);const load=async()=>{loads++;return {...normalizeDMIOpenMeteo(openMeteoFixture([point]),[point],clock),delivery:'dmi',blend:false};};
 const first=await a('point',load);assert.equal(loads,1);clock+=3599000;const b=createLastGoodCache(options);assert.equal((await b('point',load)).saved,first.saved);assert.equal(loads,1);
 clock+=7202000;const old=await b('point',async()=>{loads++;throw Error('timeout');},async()=>{fallbacks++;throw Error('must use old snapshot');});assert.equal(loads,2);assert.equal(fallbacks,0);assert.equal(old.saved,first.saved);assert.equal(old.delivery,'dmi');assert.equal(old.stale,true);assert.match(old.notice,/może być nieaktualna/);assert.equal(old.records[0].hourly.wind_speed_10m[1],3);
});
test('DMI uses one Open-Meteo query for all ports and parameters after a native failure, then caches it until the next cycle',async()=>{
 let clock=Date.parse(T),dmi=0,meteo=0;const api=createForecastAPI({now:()=>clock,pause:async ms=>{clock+=ms;},fetcher:async (url,options)=>{
  assert(options.signal);const u=new URL(url);if(u.hostname==='opendataapi.dmi.dk'){dmi++;return new Response('busy',{status:429});}
  assert.equal(u.hostname,'api.open-meteo.com');if(u.pathname.includes('/static/meta.json'))return Response.json({last_run_availability_time:Date.parse(T)/1000,last_run_initialisation_time:Date.parse(T)/1000,update_interval_seconds:10800});meteo++;assert.equal(u.searchParams.get('models'),'dmi_seamless');assert.equal(u.searchParams.get('wind_speed_unit'),'ms');assert.equal(u.searchParams.get('temperature_unit'),'celsius');const fields=u.searchParams.get('hourly').split(',');for(const field of ['wind_speed_10m','wind_gusts_10m','wind_direction_10m','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','precipitation','temperature_2m'])assert(fields.includes(field));
  const lats=u.searchParams.get('latitude').split(',').map(Number),lons=u.searchParams.get('longitude').split(',').map(Number);assert.equal(lats.length,3);return new Response(JSON.stringify(openMeteoFixture(lats.map((lat,i)=>({lat,lon:lons[i]})))));
 }});
 const req=()=>new Request('https://weather.seasync.co/api/forecast?model=dmi_harmonie&group=ports');const r=await api(req(),{});assert.equal(r.status,200);const data=await r.json();assert.equal(data.records.length,3);assert.equal(data.delivery,'open-meteo');assert(data.blend);assert.equal(data.stale,false);assert.equal(dmi,1);assert.equal(meteo,1);clock+=3599000;assert.equal((await api(req(),{})).status,200);assert.equal(dmi,1);assert.equal(meteo,1);
});
test('DMI honours a shorter Retry-After with the minimum sixty-second pause',async()=>{
 let clock=0,calls=0;const request=createDMIRequester({now:()=>clock,fetcher:async()=>{calls++;return new Response('busy',{status:429,headers:{'Retry-After':'5'}});}});await assert.rejects(request('https://opendataapi.dmi.dk/a'),e=>e.retryAfter===60);clock=30000;await assert.rejects(request('https://opendataapi.dmi.dk/b'),e=>e.retryAfter===30);assert.equal(calls,1);clock=60000;await assert.rejects(request('https://opendataapi.dmi.dk/b'),e=>e.retryAfter===120);assert.equal(calls,2);
});
test('client labels cached DMI/ECMWF fallback honestly and keeps its own fetch timing',()=>{
 const f=dmiClientFixture([200]);vm.runInContext(';globalThis.extra={windModelInfo,renderUpdateClocks,cacheLabel};',f.c);const t=f.c.t;t.state.metas.dmi_harmonie={delivery:'open-meteo',blend:true,saved:Date.parse(T),stale:true,timing:{updatedAt:T,nextUpdate:'2026-10-18T17:00:00Z',basis:'fetch'}};assert.match(f.c.extra.windModelInfo('dmi_harmonie').label,/DMI.*ECMWF.*Open-Meteo/);assert.equal(f.c.extra.windModelInfo('dmi_harmonie').short,'DMI/IFS');assert.match(f.c.extra.cacheLabel(t.state.metas.dmi_harmonie),/może być nieaktualna/);
});

test('selected weather refreshes when due and waits while the page is hidden',async()=>{
 const f=dmiClientFixture([200]),t=f.c.t;vm.runInContext(';globalThis.refreshDMI=refreshDMIIfDue;',f.c);
 await t.loadExtraWindPorts('dmi_harmonie');assert.equal(f.calls,1);f.advance(3599999);await t.loadExtraWindPorts('dmi_harmonie');assert.equal(f.calls,1);f.advance(1);await t.loadExtraWindPorts('dmi_harmonie');assert.equal(f.calls,2);
 f.advance(3600000);f.c.document.hidden=true;await f.c.refreshDMI();assert.equal(f.calls,2);f.c.document.hidden=false;await f.c.refreshDMI();assert(f.calls>2);assert.equal(f.mapLoads,1);
});

test('server freezes weather and metadata from 06:00 until 12:00 across Worker instances and manual refreshes',async()=>{
 let clock=Date.parse('2026-10-19T06:00:00Z'),calls=0;const cache=forecastStore(),options={cache,now:()=>clock,fetcher:async url=>{calls++;const u=new URL(url);if(u.pathname.endsWith('/static/meta.json'))return Response.json({last_run_availability_time:Math.floor(clock/21600000)*21600,last_run_initialisation_time:Math.floor(clock/21600000)*21600,update_interval_seconds:21600});const points=u.searchParams.get('latitude').split(',').map((lat,i)=>({lat:Number(lat),lon:Number(u.searchParams.get('longitude').split(',')[i])}));return Response.json(openMeteoFixture(points,Math.floor(clock/3600000)*3600));}};
 const req=()=>new Request('https://weather.seasync.co/api/forecast?model=ecmwf_ifs&group=ports');let api=createForecastAPI(options);let first=await(await api(req(),{})).json();assert.equal(first.refreshAfter,'2026-10-19T12:00:00.000Z');assert.equal(calls,2);
 for(const hour of [7,8,9,10,11]){clock=Date.parse('2026-10-19T'+hour.toString().padStart(2,'0')+':59:00Z');api=createForecastAPI(options);assert.equal((await api(req(),{})).status,200);const timing=await api(new Request('https://weather.seasync.co/api/model-updates?model=ecmwf_ifs'),{});assert.equal(timing.status,200);assert.equal(calls,2);}
 clock=Date.parse('2026-10-19T12:00:00Z');api=createForecastAPI(options);const next=await(await api(req(),{})).json();assert.equal(calls,4);assert.equal(next.refreshAfter,'2026-10-19T18:00:00.000Z');
});
test('browser manual refresh returns cached weather until the provider deadline',async()=>{
 let clock=Date.parse('2026-10-19T06:00:00Z'),calls=0;const values=new Map();class Clock extends Date{static now(){return clock;}}
 const c={Date:Clock,Intl,Math,Number,Array,Object,String,Map,Set,console,URLSearchParams,AbortSignal,matchMedia:()=>({matches:false}),document:{getElementById:()=>({})},localStorage:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)},fetch:async()=>{calls++;return Response.json({records:[],refreshAfter:'2026-10-19T12:00:00Z'});}};
 vm.createContext(c);vm.runInContext(fs.readFileSync('dist/app.js','utf8').replace(/start\(\);\s*$/,'')+';globalThis.requestWeather=requestJSON;',c);
 await c.requestWeather('/api/forecast?model=ecmwf_ifs','cycle',true);clock=Date.parse('2026-10-19T11:59:59Z');await c.requestWeather('/api/forecast?model=ecmwf_ifs','cycle',true);assert.equal(calls,1);clock=Date.parse('2026-10-19T12:00:00Z');await c.requestWeather('/api/forecast?model=ecmwf_ifs','cycle',true);assert.equal(calls,2);
});

test('an existing DMI snapshot also suppresses metadata requests before its deadline',async()=>{
 const cache=forecastStore(),saved=Date.parse(T),snapshot=normalizeDMIOpenMeteo(openMeteoFixture([point]),[point],saved);await cache.put(new Request('https://weather.seasync.co/__dmi_last_good/v1/'+encodeURIComponent('dmi_harmonie/ports/0')),Response.json(snapshot));let calls=0;
 const api=createForecastAPI({cache,now:()=>saved+3600000,fetcher:async()=>{calls++;throw Error('must not check DMI');}}),res=await api(new Request('https://weather.seasync.co/api/model-updates?model=dmi_harmonie'),{});assert.equal(res.status,200);assert.equal((await res.json()).refreshAfter,snapshot.timing.nextUpdate);assert.equal(calls,0);
});
