import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createForecastAPI,normalizeFMI,normalizeDMI,modelTiming} from '../worker/forecast.mjs';
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
